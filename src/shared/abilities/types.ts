/*
	abilities/types.ts  (shared)

	The data side of the ability system. Everything here is plain data that
	both server and client read; behaviour lives in server ability classes
	(src/server/abilities) and client handlers (src/client/abilities).
*/

import { Generic_Player_stats } from "../types";

export type StatKey = keyof Generic_Player_stats;

/*
	Where an ability is allowed to come from.

	"player" - belongs to the player whatever they hold: innate grants, timed
	           grants, kits (a Stand, a class, a race, a transformation...).
	"item"   - only works while the item granting it is held: from its parts
	           (forge) or bound to that one item instance.
	"any"    - may come from either.

	A source that offers an ability of the wrong binding is ignored, so a
	mislabelled id can never leak across.
*/
export type AbilityBinding = "player" | "item" | "any";

/*
	How the key drives the ability.

	"press"   - key down activates. It stays active for `maxDuration` (0 =
	            ends straight away) or until the ability ends it. Pressing
	            again while active calls OnRecast (combo stages, re-casts).
	"hold"    - key down activates, key up releases (OnRelease). Charge-ups
	            are hold abilities that act in OnRelease using how long the
	            server saw them held.
	"toggle"  - first press activates, second press releases.
	"passive" - no key. Active for as long as it is granted: OnGranted /
	            OnRevoked, stat modifiers, event and damage hooks.
*/
export type AbilityInput = "press" | "hold" | "toggle" | "passive";

export interface ResourceCost {
	readonly resource: string;
	readonly amount: number;
}

// A change to one player stat: (base + flat) * mult.
export interface StatModifierDef {
	readonly stat: StatKey;
	readonly flat?: number;
	readonly mult?: number;
}

export interface AbilityDef {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly binding: AbilityBinding;
	readonly input: AbilityInput;

	// Default key; players can rebind (client/abilities/keybinds.ts).
	readonly defaultKey?: Enum.KeyCode;

	// Seconds to regain one charge.
	readonly cooldown: number;
	// Uses stored before waiting on the cooldown. Default 1.
	readonly charges?: number;
	// false (default): recharge starts on activation. true: starts when it ends.
	readonly cooldownStartsOnEnd?: boolean;

	// Paid on activation, all or nothing. Abilities can override with GetCosts.
	readonly costs?: readonly ResourceCost[];

	// Longest it can stay active, in seconds. press: 0 by default.
	readonly maxDuration?: number;

	// Character attributes that prevent activation. Default ["Stunned", "Blocking"].
	readonly blockedBy?: readonly string[];
	// Character attributes that end it while active. Default ["Stunned"].
	readonly interruptedBy?: readonly string[];
	// Usable while a Roblox Tool is equipped. Default false.
	readonly allowWithTool?: boolean;
	// Needs a usable (unbroken) weapon in hand.
	readonly requiresWeapon?: boolean;

	// Applied to the player for as long as the ability is granted (passives).
	readonly modifiers?: readonly StatModifierDef[];

	// Free-form labels, e.g. "movement", "stand". Abilities can query them.
	readonly tags?: readonly string[];

	// Free-form tuning shared with the client (radii, durations, ...).
	readonly data?: Readonly<Record<string, unknown>>;
}

/*
	A named bundle of player-bound abilities: a Stand, a class, a race, a
	transformation. A player can hold many kits, but only one per `group`:
	adding a kit removes any other kit in the same group.
*/
export interface KitDef {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly group?: string;
	readonly abilities: readonly string[];
}

/*
	A pool abilities can spend: energy, mana, stamina, rage...

	max:        a number, or the name of a player stat to read it from
	regen:      per second (negative drains)
	regenDelay: seconds after spending before regen resumes
*/
export interface ResourceDef {
	readonly id: string;
	readonly name: string;
	readonly max: number | StatKey;
	readonly regen: number;
	readonly regenDelay?: number;
	readonly startEmpty?: boolean;
	readonly color?: Color3;
}

// ----------------------------------------------------------------------------
// replication
// ----------------------------------------------------------------------------

export interface AbilitySnapshot {
	id: string;
	// What granted it: "innate", "kit:<id>", "item:<uid>", or any custom source.
	source: string;
	charges: number;
	maxCharges: number;
	// Seconds until the next charge comes back; 0 when full.
	recharge: number;
	// Whether the recharge clock is running (false while waiting on OnEnd).
	recharging: boolean;
	active: boolean;
	// Seconds left if active with a time limit.
	activeRemaining?: number;
}

export interface ResourceSnapshot {
	id: string;
	value: number;
	max: number;
	// Seconds until regen resumes.
	regenIn: number;
}
