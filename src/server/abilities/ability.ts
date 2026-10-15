/*
	ability.ts  (server)

	Base class for ability behaviour. One instance per ability type, shared by
	every player - per-player and per-use data goes in the context
	(`ctx.active.state`), never in fields.

	abilityService.ts calls the hooks. Every hook is optional; override only
	what you need.

	Activation, in order:
		1. service checks: owns it, alive, not blocked (blockedBy / Tool /
		   requiresWeapon), a charge is available, the costs are affordable
		2. CanActivate(ctx, payload)      - your extra checks
		3. OnActivate(ctx, payload)       - do it. Return false to refuse;
		                                    nothing is charged.
		4. costs are paid, a charge is consumed

	While active (press with maxDuration, hold, toggle):
		OnRecast(ctx, payload)  press  - key pressed again (combo stages)
		OnRelease(ctx, payload) hold   - key released; toggle - pressed again.
		                                 Default: ctx.End("released").
		OnInput(ctx, payload)          - any extra message from the client
		                                 (aim, a target, a stage choice...)
		OnTick(ctx, dt)                - every frame
		OnEnd(ctx, reason)             - always called exactly once

	Ends on its own when: maxDuration runs out ("expired"), a blocking
	attribute appears ("interrupted"), the character dies ("died"), or the
	ability stops being granted ("revoked").

	Lifetime (every input mode, mainly passives):
		OnGranted(ctx) / OnRevoked(ctx)

	Dynamic numbers: GetCooldown(ctx), GetCosts(ctx).

	Helpers (public so the Luau API can reach them) clean up after themselves: listen()/addDamageHook() connections
	made in OnGranted are dropped on revoke; listenWhileActive() connections
	are dropped when the activation ends.
*/

import { AbilityDef, ResourceCost } from "shared/abilities/types";
import { getRemote } from "shared/remotes";
import { broadcast, strike, StrikeOptions, StrikeResult } from "../combat/combatService";
import type { Generic_Player } from "../generic_player/generic_player";
import { Beam, BeamOptions } from "../projectiles/beam";
import { Projectile, ProjectileOptions } from "../projectiles/projectile";
import { fireBeam, fireProjectile } from "../projectiles/projectileService";
import { ActiveAbility } from "./abilityHolder";
import { Connection, DamageHook, Signal } from "./events";

export type EndReason = "released" | "expired" | "completed" | "cancelled" | "interrupted" | "revoked" | "died";

export interface AbilityContext {
	readonly def: AbilityDef;
	readonly caster: Generic_Player;
	readonly player: Player;
	// What granted it: "innate", "kit:<id>", "item:<uid>", ...
	readonly source: string;
}

// The character parts, resolved when the hook runs.
export interface CharacterContext extends AbilityContext {
	readonly character: Model;
	readonly humanoid: Humanoid;
	readonly root: BasePart;
}

export interface ActiveContext extends CharacterContext {
	readonly active: ActiveAbility;
	// Seconds since activation.
	Elapsed: () => number;
	// End this activation now (OnEnd runs with `reason`).
	End: (reason?: EndReason) => void;
	// Change the time left; undefined removes the limit.
	SetRemaining: (seconds: number | undefined) => void;
}

const effectRemote = getRemote("CombatEffect");

export abstract class ability {
	// player -> connections made while granted
	private readonly grantedConnections = new Map<Generic_Player, Connection[]>();
	// activation -> connections made while active
	private readonly activeConnections = new WeakMap<ActiveAbility, Connection[]>();

	constructor(public readonly def: AbilityDef) {}

	// ------------------------------------------------------------------------
	// hooks
	// ------------------------------------------------------------------------

	public CanActivate(_ctx: CharacterContext, _payload: unknown): boolean {
		return true;
	}

	public OnActivate(_ctx: ActiveContext, _payload: unknown): boolean | void {}

	public OnRecast(_ctx: ActiveContext, _payload: unknown): void {}

	public OnRelease(ctx: ActiveContext, _payload: unknown): void {
		ctx.End("released");
	}

	public OnInput(_ctx: ActiveContext, _payload: unknown): void {}

	public OnTick(_ctx: ActiveContext, _dt: number): void {}

	public OnEnd(_ctx: ActiveContext, _reason: EndReason): void {}

	public OnGranted(_ctx: AbilityContext): void {}

	public OnRevoked(_ctx: AbilityContext): void {}

	public GetCooldown(_ctx: AbilityContext): number {
		return this.def.cooldown;
	}

	public GetCosts(_ctx: AbilityContext): readonly ResourceCost[] {
		return this.def.costs ?? [];
	}

	// ------------------------------------------------------------------------
	// helpers
	// ------------------------------------------------------------------------

	// Subscribe for as long as the ability is granted (call from OnGranted).
	public listen<T extends unknown[]>(ctx: AbilityContext, signal: Signal<T>, handler: (...args: T) => void) {
		this.track(ctx.caster, signal.Connect(handler));
	}

	// Subscribe for as long as this activation lasts.
	public listenWhileActive<T extends unknown[]>(ctx: ActiveContext, signal: Signal<T>, handler: (...args: T) => void) {
		const list = this.activeConnections.get(ctx.active) ?? [];
		list.push(signal.Connect(handler));
		this.activeConnections.set(ctx.active, list);
	}

	// Change damage the caster deals ("outgoing") or takes ("incoming") while granted.
	public addDamageHook(ctx: AbilityContext, direction: "outgoing" | "incoming", hook: DamageHook) {
		this.track(ctx.caster, this.hookDamage(ctx, direction, hook));
	}

	// Same, but only for as long as this activation lasts.
	public addDamageHookWhileActive(ctx: ActiveContext, direction: "outgoing" | "incoming", hook: DamageHook) {
		const list = this.activeConnections.get(ctx.active) ?? [];
		list.push(this.hookDamage(ctx, direction, hook));
		this.activeConnections.set(ctx.active, list);
	}

	private hookDamage(ctx: AbilityContext, direction: "outgoing" | "incoming", hook: DamageHook): Connection {
		const set = direction === "outgoing" ? ctx.caster.outgoingDamage : ctx.caster.incomingDamage;
		set.add(hook);
		return { Disconnect: () => set.delete(hook) };
	}

	// Hit someone through the shared combat rules, tagged with this ability.
	public strike(ctx: AbilityContext, victim: Model, opts: StrikeOptions): StrikeResult | undefined {
		return strike(ctx.caster, victim, { ...opts, tags: ["ability", this.def.id, ...(opts.tags ?? [])] });
	}

	// Fire a projectile owned by the caster, tagged with this ability.
	public fireProjectile(ctx: AbilityContext, opts: ProjectileOptions): Projectile {
		return fireProjectile(ctx.caster, { ...opts, tags: ["ability", this.def.id, ...(opts.tags ?? [])] });
	}

	// Fire a beam owned by the caster. It lasts until its own duration/End().
	public fireBeam(ctx: AbilityContext, opts: BeamOptions): Beam {
		return fireBeam(ctx.caster, { ...opts, tags: ["ability", this.def.id, ...(opts.tags ?? [])] });
	}

	// Fire a beam that ends when this activation ends (channelled beams).
	public fireBeamWhileActive(ctx: ActiveContext, opts: BeamOptions): Beam {
		const beam = this.fireBeam(ctx, opts);
		const list = this.activeConnections.get(ctx.active) ?? [];
		list.push({ Disconnect: () => beam.End("cancelled") });
		this.activeConnections.set(ctx.active, list);
		return beam;
	}

	// Cosmetic effect for every client near `position`: handler.Effect(character, ...args).
	public broadcast(ctx: CharacterContext, position: Vector3, ...args: unknown[]) {
		broadcast(position, undefined, "Ability", this.def.id, ctx.character, ...args);
	}

	// Cosmetic effect for the caster's client only.
	public tell(ctx: AbilityContext, ...args: unknown[]) {
		effectRemote.FireClient(ctx.player, "Ability", this.def.id, ctx.caster.GetCharacter(), ...args);
	}

	// Hit FX on the caster's screen for a landed ability hit.
	public confirmHit(ctx: AbilityContext, victim: Model, position: Vector3, crit: boolean) {
		effectRemote.FireClient(ctx.player, "AbilityHit", victim, position, crit);
	}

	// ------------------------------------------------------------------------
	// service plumbing
	// ------------------------------------------------------------------------

	private track(gp: Generic_Player, connection: Connection) {
		const list = this.grantedConnections.get(gp) ?? [];
		list.push(connection);
		this.grantedConnections.set(gp, list);
	}

	/** @internal called by abilityService after OnRevoked */
	public _cleanupGranted(gp: Generic_Player) {
		for (const c of this.grantedConnections.get(gp) ?? []) c.Disconnect();
		this.grantedConnections.delete(gp);
	}

	/** @internal called by abilityService after OnEnd */
	public _cleanupActive(active: ActiveAbility) {
		for (const c of this.activeConnections.get(active) ?? []) c.Disconnect();
		this.activeConnections.delete(active);
	}
}

// Used for any ability with no class of its own (pure data: stat passives,
// client-only abilities). Every hook keeps its default.
export class DataAbility extends ability {}
