/*
	clientAbility.ts  (client)

	The client half of an ability: what happens on this screen (movement,
	animation, camera, UI) and cosmetic effects the server broadcasts. Every
	hook is optional; an ability with no handler at all still works - its key
	just sends the request.

	The request itself is sent by abilityClient.ts, not the handler:
		press/hold/toggle on  -> "press" (with GetPressPayload's result)
		hold up / toggle off  -> "release" (with GetReleasePayload's result)
	Handlers send anything else with ctx.send("input", payload).

	Hooks run after the local checks pass (has it, charge ready, can afford,
	not blocked). OnPress may yield; while it runs, `exclusive` handlers
	stop other abilities from starting.
*/

import { AbilityDef } from "shared/abilities/types";

export interface ClientAbilityContext {
	readonly def: AbilityDef;
	readonly character: Model;
	readonly humanoid: Humanoid;
	readonly root: BasePart;
	// Send the server an extra message for this ability (its OnInput hook).
	send: (payload?: unknown) => void;
	// Whether the server says it is active (from the last snapshot).
	isActive: () => boolean;
	// Seconds the key has been held (hold abilities; 0 otherwise).
	heldFor: () => number;
}

export interface ClientAbility {
	readonly id: string;

	// Block every other ability while OnPress runs (e.g. a dash that controls the character).
	readonly exclusive?: boolean;

	// Extra checks before anything is sent (a target in range, aiming at ground...).
	CanPress?: (ctx: ClientAbilityContext) => boolean;
	// Data sent with "press" (aim direction, mouse hit, chosen target...).
	GetPressPayload?: (ctx: ClientAbilityContext) => unknown;
	// Data sent with "release" (final aim, charge level...).
	GetReleasePayload?: (ctx: ClientAbilityContext) => unknown;

	OnPress?: (ctx: ClientAbilityContext) => void;
	OnRelease?: (ctx: ClientAbilityContext) => void;
	// Pressed again while active (press abilities: recasts / combo stages).
	OnRecast?: (ctx: ClientAbilityContext) => void;

	// The server's view changed: it became active, or ended.
	OnActiveChanged?: (active: boolean) => void;

	// Cosmetic effect the server broadcast for some player's use (maybe ours).
	Effect?: (character: Model, ...args: unknown[]) => void;
}
