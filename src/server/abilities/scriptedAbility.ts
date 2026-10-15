/*
	scriptedAbility.ts  (server)

	An ability whose behaviour is a plain table of functions instead of a
	TypeScript subclass. This is what Luau content uses
	(WC.AbilityCode(id, { OnActivate = function(ctx, payload) ... end })),
	because extending a roblox-ts class from Luau is impractical.

	Every hook is optional and has the same meaning as on `ability`. Two
	differences, to forgive hand-written Luau:
		- CanActivate returning nil counts as "yes" (only `false` refuses)
		- a hook that is not a function is ignored rather than erroring
*/

import { AbilityDef, ResourceCost } from "shared/abilities/types";
import { ability, AbilityContext, ActiveContext, CharacterContext, EndReason } from "./ability";

export interface AbilityScript {
	CanActivate?: (ctx: CharacterContext, payload: unknown) => boolean | undefined;
	OnActivate?: (ctx: ActiveContext, payload: unknown) => boolean | void;
	OnRecast?: (ctx: ActiveContext, payload: unknown) => void;
	OnRelease?: (ctx: ActiveContext, payload: unknown) => void;
	OnInput?: (ctx: ActiveContext, payload: unknown) => void;
	OnTick?: (ctx: ActiveContext, dt: number) => void;
	OnEnd?: (ctx: ActiveContext, reason: EndReason) => void;
	OnGranted?: (ctx: AbilityContext) => void;
	OnRevoked?: (ctx: AbilityContext) => void;
	GetCooldown?: (ctx: AbilityContext) => number;
	GetCosts?: (ctx: AbilityContext) => readonly ResourceCost[];
}

export const SCRIPT_HOOKS: readonly string[] = [
	"CanActivate",
	"OnActivate",
	"OnRecast",
	"OnRelease",
	"OnInput",
	"OnTick",
	"OnEnd",
	"OnGranted",
	"OnRevoked",
	"GetCooldown",
	"GetCosts",
];

export class ScriptedAbility extends ability {
	constructor(
		def: AbilityDef,
		private readonly hooks: AbilityScript,
	) {
		super(def);
	}

	public CanActivate(ctx: CharacterContext, payload: unknown): boolean {
		const f = this.hooks.CanActivate;
		return typeIs(f, "function") ? f(ctx, payload) !== false : true;
	}

	public OnActivate(ctx: ActiveContext, payload: unknown): boolean | void {
		const f = this.hooks.OnActivate;
		if (typeIs(f, "function")) return f(ctx, payload);
	}

	public OnRecast(ctx: ActiveContext, payload: unknown) {
		const f = this.hooks.OnRecast;
		if (typeIs(f, "function")) f(ctx, payload);
	}

	public OnRelease(ctx: ActiveContext, payload: unknown) {
		const f = this.hooks.OnRelease;
		if (typeIs(f, "function")) f(ctx, payload);
		else super.OnRelease(ctx, payload);
	}

	public OnInput(ctx: ActiveContext, payload: unknown) {
		const f = this.hooks.OnInput;
		if (typeIs(f, "function")) f(ctx, payload);
	}

	public OnTick(ctx: ActiveContext, dt: number) {
		const f = this.hooks.OnTick;
		if (typeIs(f, "function")) f(ctx, dt);
	}

	public OnEnd(ctx: ActiveContext, reason: EndReason) {
		const f = this.hooks.OnEnd;
		if (typeIs(f, "function")) f(ctx, reason);
	}

	public OnGranted(ctx: AbilityContext) {
		const f = this.hooks.OnGranted;
		if (typeIs(f, "function")) f(ctx);
	}

	public OnRevoked(ctx: AbilityContext) {
		const f = this.hooks.OnRevoked;
		if (typeIs(f, "function")) f(ctx);
	}

	public GetCooldown(ctx: AbilityContext): number {
		const f = this.hooks.GetCooldown;
		const value = typeIs(f, "function") ? f(ctx) : undefined;
		return typeIs(value, "number") ? value : super.GetCooldown(ctx);
	}

	public GetCosts(ctx: AbilityContext): readonly ResourceCost[] {
		const f = this.hooks.GetCosts;
		const value = typeIs(f, "function") ? f(ctx) : undefined;
		return typeIs(value, "table") ? value : super.GetCosts(ctx);
	}
}
