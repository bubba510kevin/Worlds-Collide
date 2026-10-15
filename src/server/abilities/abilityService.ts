/*
	abilityService.ts  (server)

	Drives every player's abilities:

		- AbilityInput(id, action, payload) from clients, where action is
		  "press" | "release" | "input"; validated, then routed to the hooks
		- grant bookkeeping: notices abilities appearing/disappearing (item
		  swaps, kits, timed grants...) and runs OnGranted / OnRevoked, and
		  applies each ability's stat `modifiers` while it is granted
		- active instances: ticks them and ends them on expiry, interruption,
		  death or revocation
		- resource regen, and pushing a snapshot whenever something changed

	Behaviour classes are listed in library/index.ts. An ability with no class
	still works as pure data (DataAbility).
*/

import { Players, RunService } from "@rbxts/services";
import { DEFAULT_BLOCKED_BY, DEFAULT_INTERRUPTED_BY, getAbility } from "shared/abilities/registry";
import { AbilityDef } from "shared/abilities/types";
import { GetHumanoidAndRoot } from "shared/combatUtil";
import { isHoldingTool } from "../combat/combatService";
import { Generic_Player } from "../generic_player/generic_player";
import { onRemote, push, reject } from "../network/remoteHandler";
import { activePlayers } from "../players";
import { ability, AbilityContext, ActiveContext, CharacterContext, DataAbility, EndReason } from "./ability";
import { ActiveAbility } from "./abilityHolder";
import { GameEvents } from "./events";
import { LIBRARY } from "./library";

// A use this early counts as on time: the client's cooldown clock runs ahead
// of the server's by however long the request took to arrive.
const CHARGE_TOLERANCE = 0.15;

const behaviours = new Map<string, ability>();
for (const impl of LIBRARY) {
	assert(getAbility(impl.def.id), `ability class ${impl.def.id} has no entry in shared/abilities/catalog.ts`);
	behaviours.set(impl.def.id, impl);
}

function behaviourOf(def: AbilityDef): ability {
	let impl = behaviours.get(def.id);
	if (!impl) {
		impl = new DataAbility(def);
		behaviours.set(def.id, impl);
	}
	return impl;
}

// ability ids (and their sources) each player had at the last sync
const granted = new Map<Generic_Player, Map<string, string>>();

// The context built at activation, so every hook of one activation sees the same object.
const activeContexts = new WeakMap<ActiveAbility, ActiveContext>();

// ----------------------------------------------------------------------------
// contexts
// ----------------------------------------------------------------------------

function baseContext(gp: Generic_Player, def: AbilityDef, source: string): AbilityContext {
	return { def, caster: gp, player: gp.GetInstance(), source };
}

function characterContext(gp: Generic_Player, def: AbilityDef, source: string): CharacterContext | undefined {
	const character = gp.GetCharacter();
	const [humanoid, root] = GetHumanoidAndRoot(character);
	if (!character || !humanoid || !root) return undefined;
	return { ...baseContext(gp, def, source), character, humanoid, root };
}

function activeContext(gp: Generic_Player, def: AbilityDef, base: CharacterContext, active: ActiveAbility): ActiveContext {
	return {
		...base,
		active,
		Elapsed: () => os.clock() - active.startedAt,
		End: (reason: EndReason = "completed") => endActive(gp, def.id, reason),
		SetRemaining: (seconds) => {
			active.endsAt = seconds !== undefined ? os.clock() + seconds : undefined;
			gp.MarkDirty();
		},
	};
}

function safeCall(what: string, fn: () => void) {
	const [ok, err] = pcall(fn);
	if (!ok) warn(`[abilities] ${what} errored: ${err}`);
}

// ----------------------------------------------------------------------------
// activation
// ----------------------------------------------------------------------------

function isBlocked(def: AbilityDef, gp: Generic_Player, character: Model): boolean {
	for (const attribute of def.blockedBy ?? DEFAULT_BLOCKED_BY) {
		if (character.GetAttribute(attribute) === true) return true;
	}
	if (!def.allowWithTool && isHoldingTool(character)) return true;
	if (def.requiresWeapon && !gp.HeldWeapon()) return true;
	return false;
}

function activate(gp: Generic_Player, def: AbilityDef, source: string, payload: unknown) {
	const holder = gp.abilities;
	const impl = behaviourOf(def);
	const ctx = characterContext(gp, def, source);
	if (!ctx || isBlocked(def, gp, ctx.character)) return gp.MarkDirty();
	if (!holder.CanUse(def.id, CHARGE_TOLERANCE)) return gp.MarkDirty();

	const costs = impl.GetCosts(ctx);
	if (!gp.resources.CanAfford(costs)) return gp.MarkDirty();

	let allowed = false;
	safeCall(`${def.id}.CanActivate`, () => (allowed = impl.CanActivate(ctx, payload)));
	if (!allowed) return gp.MarkDirty();

	const maxDuration = def.maxDuration ?? (def.input === "press" ? 0 : undefined);
	const active = holder.StartActive(def.id, source, maxDuration);
	const actx = activeContext(gp, def, ctx, active);
	activeContexts.set(active, actx);

	// Boxed so the closure's write is visible to the type checker.
	const outcome: { result: boolean | void } = { result: undefined };
	safeCall(`${def.id}.OnActivate`, () => (outcome.result = impl.OnActivate(actx, payload)));
	if (outcome.result === false) {
		// Refused: undo without OnEnd, charge nothing.
		if (holder.GetActive(def.id) === active) holder.RemoveActive(def.id);
		impl._cleanupActive(active);
		return gp.MarkDirty();
	}

	gp.resources.Spend(costs);
	holder.ConsumeCharge(def.id, impl.GetCooldown(ctx), def.cooldownStartsOnEnd === true, CHARGE_TOLERANCE);
	GameEvents.AbilityActivated.Fire(gp, def.id);

	const stillActive = holder.GetActive(def.id) === active;
	if (stillActive && active.endsAt !== undefined && active.endsAt <= os.clock()) {
		// An instant ability (press, maxDuration 0).
		endActive(gp, def.id, "completed");
	} else if (!stillActive && def.cooldownStartsOnEnd) {
		// It ended inside OnActivate, before the charge was consumed.
		holder.ResumeRecharge(def.id);
	}
	gp.MarkDirty();
}

function endActive(gp: Generic_Player, id: string, reason: EndReason) {
	const active = gp.abilities.RemoveActive(id);
	const def = getAbility(id);
	if (!active || !def) return;

	const impl = behaviourOf(def);
	const actx = activeContexts.get(active);
	if (actx) safeCall(`${id}.OnEnd`, () => impl.OnEnd(actx, reason));
	impl._cleanupActive(active);

	if (def.cooldownStartsOnEnd) gp.abilities.ResumeRecharge(id);
	GameEvents.AbilityEnded.Fire(gp, id, reason);
	gp.MarkDirty();
}

// End an active ability from anywhere (another ability, a status effect...).
export function cancelAbility(gp: Generic_Player, id: string, reason: EndReason = "cancelled") {
	endActive(gp, id, reason);
}

function onInput(gp: Generic_Player, id: unknown, action: unknown, payload: unknown) {
	const def = getAbility(id);
	if (!def) return reject(gp, "AbilityInput", `unknown ability ${tostring(id)}`);
	if (action !== "press" && action !== "release" && action !== "input") {
		return reject(gp, "AbilityInput", `bad action ${tostring(action)}`);
	}

	// Not having it, or it not being active, happens to honest clients
	// (weapon swapped, ability ended a frame earlier): ignore and resync.
	const source = gp.abilities.SourceOf(def.id);
	if (source === undefined) return gp.MarkDirty();

	const impl = behaviourOf(def);
	const active = gp.abilities.GetActive(def.id);
	const actx = active ? activeContexts.get(active) : undefined;

	if (action === "press") {
		if (def.input === "passive") return;
		if (actx) {
			if (def.input === "toggle") safeCall(`${def.id}.OnRelease`, () => impl.OnRelease(actx, payload));
			else if (def.input === "press") safeCall(`${def.id}.OnRecast`, () => impl.OnRecast(actx, payload));
			return;
		}
		activate(gp, def, source, payload);
	} else if (action === "release") {
		if (actx && def.input === "hold") safeCall(`${def.id}.OnRelease`, () => impl.OnRelease(actx, payload));
	} else if (actx) {
		safeCall(`${def.id}.OnInput`, () => impl.OnInput(actx, payload));
	}
}

// ----------------------------------------------------------------------------
// per-frame upkeep
// ----------------------------------------------------------------------------

function onGranted(gp: Generic_Player, id: string, source: string) {
	const def = getAbility(id);
	if (!def) return;
	def.modifiers?.forEach((mod, i) => gp.modifiers.Add({ ...mod, id: tostring(i), source: `ability:${id}` }));
	const impl = behaviourOf(def);
	safeCall(`${id}.OnGranted`, () => impl.OnGranted(baseContext(gp, def, source)));
	GameEvents.AbilityGranted.Fire(gp, id);
}

function onRevoked(gp: Generic_Player, id: string, source: string) {
	const def = getAbility(id);
	if (!def) return;
	if (gp.abilities.IsActive(id)) endActive(gp, id, "revoked");
	gp.modifiers.RemoveSource(`ability:${id}`);
	const impl = behaviourOf(def);
	safeCall(`${id}.OnRevoked`, () => impl.OnRevoked(baseContext(gp, def, source)));
	impl._cleanupGranted(gp);
	GameEvents.AbilityRevoked.Fire(gp, id);
}

function syncGrants(gp: Generic_Player) {
	const now = gp.abilities.GetAll();
	const before = granted.get(gp) ?? new Map<string, string>();
	let changed = false;

	for (const [id, source] of before) {
		if (!now.has(id)) {
			onRevoked(gp, id, source);
			changed = true;
		}
	}
	for (const [id, source] of now) {
		if (!before.has(id)) {
			onGranted(gp, id, source);
			changed = true;
		} else if (before.get(id) !== source) {
			changed = true; // same ability, new source (e.g. a different sword)
		}
	}

	granted.set(gp, now);
	if (changed) gp.MarkDirty();
}

function tickActives(gp: Generic_Player, dt: number) {
	const character = gp.GetCharacter();
	const [humanoid] = GetHumanoidAndRoot(character);
	const now = os.clock();

	for (const active of gp.abilities.GetActives()) {
		const def = getAbility(active.id);
		const actx = activeContexts.get(active);
		if (!def || !actx) {
			gp.abilities.RemoveActive(active.id);
			continue;
		}

		if (!humanoid || character !== actx.character) {
			endActive(gp, active.id, "died");
			continue;
		}
		const interrupted = (def.interruptedBy ?? DEFAULT_INTERRUPTED_BY).some(
			(attribute) => actx.character.GetAttribute(attribute) === true,
		);
		if (interrupted) {
			endActive(gp, active.id, "interrupted");
			continue;
		}
		if (active.endsAt !== undefined && now >= active.endsAt) {
			endActive(gp, active.id, "expired");
			continue;
		}

		const impl = behaviourOf(def);
		safeCall(`${def.id}.OnTick`, () => impl.OnTick(actx, dt));
	}
}

function teardown(gp: Generic_Player) {
	for (const active of gp.abilities.GetActives()) endActive(gp, active.id, "revoked");
	for (const [id, source] of granted.get(gp) ?? new Map<string, string>()) onRevoked(gp, id, source);
	granted.delete(gp);
}

export function start() {
	onRemote("AbilityInput", (gp, id, action, payload) => onInput(gp, id, action, payload));

	RunService.Heartbeat.Connect((dt) => {
		// Players who left: release their hooks and connections.
		for (const [gp] of granted) {
			if (activePlayers.get(gp.GetInstance()) !== gp) teardown(gp);
		}

		for (const [, gp] of activePlayers) {
			gp.resources.Tick(dt);
			syncGrants(gp);
			tickActives(gp, dt);
			if (gp.StatsOutOfDate()) gp.OnStatsChanged();
			if (gp.dirty) push(gp);
		}
	});

	Players.PlayerRemoving.Connect((player) => {
		for (const [gp] of granted) if (gp.GetInstance() === player) teardown(gp);
	});
}
