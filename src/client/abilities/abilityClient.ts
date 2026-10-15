/*
	abilityClient.ts  (client)

	Turns keys into AbilityInput requests, according to each ability's input
	mode, and runs the client handlers.

		press  key down -> "press" (again while active -> recast)
		hold   key down -> "press", key up -> "release"
		toggle key down -> "press" (the server toggles it off if active)

	Before sending, it checks everything it can see locally (has it, a charge
	is ready, can afford it, not blocked), so a press that would be refused
	does nothing instead of playing an animation the server then ignores.

	press(id) / release(id) are exported for touch buttons and other UI.
*/

import { Players, UserInputService } from "@rbxts/services";
import { DEFAULT_BLOCKED_BY, getAbility } from "shared/abilities/registry";
import { AbilityDef } from "shared/abilities/types";
import { getRemote } from "shared/remotes";
import * as CombatFX from "../combat/combatFX";
import { heldWeaponStats } from "../state";
import * as AbilityState from "./abilityState";
import { ClientAbility, ClientAbilityContext } from "./clientAbility";
import { HANDLERS } from "./handlers";
import * as Keybinds from "./keybinds";

const player = Players.LocalPlayer;
const AbilityInput = getRemote("AbilityInput");
const effectRemote = getRemote("CombatEffect");

const handlers = new Map<string, ClientAbility>();
for (const h of HANDLERS) {
	assert(getAbility(h.id), `client handler ${h.id} has no entry in shared/abilities/catalog.ts`);
	handlers.set(h.id, h);
}

// Add or replace an ability's client handler (used by the Luau API: WC.AbilityLook).
export function registerHandler(handler: ClientAbility) {
	if (!getAbility(handler.id)) error(`no ability called "${handler.id}" - add it with WC.AddAbility first`, 3);
	handlers.set(handler.id, handler);
}

// An exclusive handler's OnPress is running.
let busy = false;
// hold abilities currently held down: id -> os.clock() pressed
const held = new Map<string, number>();
// last known server active state, for OnActiveChanged
const lastActive = new Map<string, boolean>();

function send(id: string, action: "press" | "release" | "input", payload?: unknown) {
	AbilityInput.FireServer(id, action, payload);
}

function makeContext(def: AbilityDef): ClientAbilityContext | undefined {
	const character = player.Character;
	const humanoid = character?.FindFirstChildOfClass("Humanoid");
	const root = character?.FindFirstChild("HumanoidRootPart");
	if (!character || !humanoid || humanoid.Health <= 0 || !root || !root.IsA("BasePart")) return undefined;
	return {
		def,
		character,
		humanoid,
		root,
		send: (payload) => send(def.id, "input", payload),
		isActive: () => AbilityState.isActive(def.id),
		heldFor: () => {
			const at = held.get(def.id);
			return at !== undefined ? os.clock() - at : 0;
		},
	};
}

// Mirrors the server's checks with what the client can see.
function passesLocalChecks(def: AbilityDef, ctx: ClientAbilityContext): boolean {
	if (!AbilityState.has(def.id)) return false;
	if (AbilityState.charges(def.id) < 1) return false;
	if (!AbilityState.canAfford(def.costs ?? [])) return false;
	for (const attribute of def.blockedBy ?? DEFAULT_BLOCKED_BY) {
		if (ctx.character.GetAttribute(attribute) === true) return false;
	}
	if (!def.allowWithTool && ctx.character.FindFirstChildOfClass("Tool")) return false;
	if (def.requiresWeapon && !heldWeaponStats()) return false;
	return true;
}

function runHook(id: string, name: string, fn: () => void) {
	const [ok, err] = pcall(fn);
	if (!ok) warn(`[abilities] ${id}.${name} errored: ${err}`);
}

export function press(id: string): boolean {
	const def = getAbility(id);
	if (!def || def.input === "passive" || busy) return false;
	const ctx = makeContext(def);
	if (!ctx) return false;
	const handler = handlers.get(id);

	// Already active: a second press means recast (press) or switch off (toggle).
	if (AbilityState.isActive(id)) {
		if (def.input === "toggle") {
			send(id, "press", handler?.GetReleasePayload?.(ctx));
			if (handler?.OnRelease) runHook(id, "OnRelease", () => handler.OnRelease!(ctx));
			return true;
		}
		if (def.input === "press") {
			send(id, "press", handler?.GetPressPayload?.(ctx));
			if (handler?.OnRecast) runHook(id, "OnRecast", () => handler.OnRecast!(ctx));
			return true;
		}
		return false;
	}

	if (!passesLocalChecks(def, ctx)) return false;
	if (handler?.CanPress && !handler.CanPress(ctx)) return false;

	AbilityState.predictUse(def);
	if (def.input === "hold") held.set(id, os.clock());
	send(id, "press", handler?.GetPressPayload?.(ctx));

	if (handler?.OnPress) {
		if (handler.exclusive) busy = true;
		task.spawn(() => {
			runHook(id, "OnPress", () => handler.OnPress!(ctx));
			if (handler.exclusive) busy = false;
		});
	}
	return true;
}

export function release(id: string) {
	const def = getAbility(id);
	if (!def || def.input !== "hold" || !held.has(id)) return;
	const ctx = makeContext(def);
	const handler = handlers.get(id);

	send(id, "release", ctx ? handler?.GetReleasePayload?.(ctx) : undefined);
	if (ctx && handler?.OnRelease) runHook(id, "OnRelease", () => handler.OnRelease!(ctx));
	held.delete(id);
}

export function start() {
	AbilityState.start();

	UserInputService.InputBegan.Connect((input, processed) => {
		if (processed) return;
		const id = Keybinds.GetAbilityForKey(input.KeyCode);
		if (id !== undefined) press(id);
	});

	UserInputService.InputEnded.Connect((input) => {
		const id = Keybinds.GetAbilityForKey(input.KeyCode);
		if (id !== undefined) release(id);
	});

	AbilityState.onChanged(() => {
		for (const [id, handler] of handlers) {
			const active = AbilityState.isActive(id);
			if ((lastActive.get(id) ?? false) !== active) {
				lastActive.set(id, active);
				if (handler.OnActiveChanged) runHook(id, "OnActiveChanged", () => handler.OnActiveChanged!(active));
			}
		}
	});

	// Explicit parameters rather than a rest array: an undefined in the middle
	// of a Luau varargs list would cut a table short.
	effectRemote.OnClientEvent.Connect(
		(effect: unknown, a: unknown, b: unknown, c: unknown, d: unknown, e: unknown, f: unknown, g: unknown, h: unknown) => {
			if (effect === "Ability") {
				// ("Ability", id, character, ...up to 6 args)
				const handler = typeIs(a, "string") ? handlers.get(a) : undefined;
				if (handler?.Effect && typeIs(b, "Instance") && b.IsA("Model")) {
					runHook(a as string, "Effect", () => handler.Effect!(b, c, d, e, f, g, h));
				}
			} else if (effect === "AbilityHit") {
				// ("AbilityHit", victim, position, crit)
				if (typeIs(a, "Instance") && a.IsA("Model") && typeIs(b, "Vector3")) CombatFX.Hit(a, b, c === true);
			}
		},
	);

	// A respawn mid-ability must not leave input locked.
	player.CharacterAdded.Connect(() => {
		busy = false;
		held.clear();
	});
}
