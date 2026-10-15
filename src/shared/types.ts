/*
	types.ts  (shared)

	Plain data that both sides agree on: the stat blocks the framework is built
	from, and the snapshots the server sends to clients.

	The server never hands a live object across a remote. It builds one of the
	*Snapshot types below, so a client only ever sees a copy.
*/

import type { AbilitySnapshot, ResourceSnapshot } from "./abilities/types";

export type AbilityId = string;

// ----------------------------------------------------------------------------
// framework stat blocks
// ----------------------------------------------------------------------------

/*
	Per-player stats, owned by Generic_Player.

	`health` is the character's MaxHealth and `speed` its normal WalkSpeed; both
	are pushed onto the Humanoid on spawn. Current health lives on the Humanoid,
	which Roblox already replicates, so there is no second copy here to drift.
*/
export interface Generic_Player_stats {
	health: number;
	defense: number;
	energy: number;
	speed: number;
	strength: number;
	critChance: number;
	critDamage: number;
}

// Stats every item has, weapon or not.
export interface generic_item_stats {
	name: string;
	capacity: number;
	// Item-bound ability ids this item grants while held, derived from its
	// parts. (Passives are abilities too: input "passive".)
	abilities: AbilityId[];
}

/*
	Stats every weapon has.

	damage       - added to the base damage of each attack
	attack_speed - multiplier on swing speed: 2 = attacks recover twice as fast
	range        - multiplier on hitbox reach
	cc           - crit chance, 0..1
	cd           - crit damage, added to the player's critDamage
*/
export interface generic_weapon_stats {
	damage: number;
	attack_speed: number;
	range: number;
	cc: number;
	cd: number;
}

// ----------------------------------------------------------------------------
// forge
// ----------------------------------------------------------------------------

export type ForgeCategory =
	| "Materials"
	| "Blade"
	| "Hilt"
	| "Guard"
	| "Smith"
	| "Place"
	| "Tools"
	| "Quench"
	| "Fuel"
	| "Intent";

// Which part id is installed in each category.
export type ForgeStats = Record<ForgeCategory, number>;

export interface PartStats {
	readonly name: string;
	readonly description: string;
	readonly damage: number;
	readonly durability: number;
	readonly critDamage: number;
	readonly critChance: number;
	readonly energy: number;
	readonly capacity: number;
	// Item-bound abilities (including passives) the part grants.
	readonly abilities: readonly AbilityId[];
}

// ----------------------------------------------------------------------------
// replication
// ----------------------------------------------------------------------------

export type ItemKind = "item" | "weapon" | "sword";

export interface ItemSnapshot {
	uid: string;
	kind: ItemKind;
	stats: generic_item_stats;
	weapon?: generic_weapon_stats;
	durability?: number;
	maxDurability?: number;
	inscription?: string;
	forge?: ForgeStats;
}

export interface InventorySnapshot {
	items: ItemSnapshot[];
	/*
		uid per hotbar slot, `false` for empty. Always dense, one entry per slot.
		It is `false` rather than undefined because a sparse array is sent over a
		remote as a dictionary with stringified keys, and every numeric lookup on
		the client then misses.
	*/
	hotbar: (string | false)[];
	// 1-based hotbar slot being held, 0 for empty-handed.
	holding: number;
}

export interface PlayerSnapshot {
	// Effective stats: base stats plus every active passive.
	stats: Generic_Player_stats;
	inventory: InventorySnapshot;
	abilities: AbilitySnapshot[];
	resources: ResourceSnapshot[];
	kits: string[];
}
