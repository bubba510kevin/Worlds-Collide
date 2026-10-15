/*
	forgeData.ts  (shared)

	The forge part database. Part id 0 in every category is the safe default,
	so a weapon with an unknown or zeroed forge still resolves to real stats.

	The last column is the item-bound ability ids (passives included) a part
	grants while the weapon is held; see shared/abilities/catalog.ts.

	Shared on purpose: names and descriptions are display data the client needs
	for a crafting UI. The server is still the only thing that computes stats
	from it.
*/

import { AbilityId, ForgeCategory, ForgeStats, PartStats } from "./types";

// Fixed iteration order so stat sums are deterministic.
export const CategoryOrder: readonly ForgeCategory[] = [
	"Materials",
	"Blade",
	"Hilt",
	"Guard",
	"Smith",
	"Place",
	"Tools",
	"Quench",
	"Fuel",
	"Intent",
];

export const EMPTY_PART: PartStats = {
	name: "",
	description: "",
	damage: 0,
	durability: 0,
	critDamage: 0,
	critChance: 0,
	energy: 0,
	capacity: 0,
	abilities: [],
};

function part(
	name: string,
	description: string,
	damage: number,
	durability: number,
	critDamage: number,
	critChance: number,
	energy: number,
	capacity: number,
	abilities: AbilityId[] = [],
): PartStats {
	return { name, description, damage, durability, critDamage, critChance, energy, capacity, abilities };
}

const PARTS: Readonly<Record<ForgeCategory, ReadonlyMap<number, PartStats>>> = {
	Materials: new Map([
		[0, part("Iron", "Basic iron", 10, 100, 0, 0.01, 0, 0)],
		[1, part("Steel", "Folded steel", 16, 140, 0.05, 0.02, 0, 0)],
		[2, part("Meteoric Iron", "Fell from the sky", 24, 120, 0.15, 0.04, 5, 1)],
	]),
	Blade: new Map([
		[0, part("Basic Blade", "A basic forged blade", 20, 100, 0, 0.02, 0, 0)],
		[1, part("Longblade", "Reach over power", 26, 90, 0, 0.03, 0, 0)],
		[2, part("Serrated Blade", "Bites on the draw", 22, 80, 0.2, 0.06, 0, 0)],
	]),
	Hilt: new Map([
		[0, part("Basic Hilt", "A basic hilt", 0, 25, 0, 0.01, 0, 0)],
		[1, part("Wrapped Hilt", "Leather over hardwood", 0, 40, 0.05, 0.02, 0, 0)],
	]),
	Guard: new Map([
		[0, part("Basic Guard", "A basic guard", 0, 25, 0, 0.01, 0, 0)],
		[1, part("Crossguard", "Catches a blade", 0, 45, 0, 0.015, 0, 0)],
	]),
	Smith: new Map([
		[0, part("Apprentice Smith", "A basic smithing result", 0, 10, 0, 0.01, 0, 0)],
		[1, part("Journeyman Smith", "Even hammer work", 2, 25, 0.05, 0.02, 0, 0)],
	]),
	Place: new Map([
		[0, part("Basic Forge", "A basic forging place", 0, 10, 0, 0.01, 0, 0)],
		[1, part("Deep Forge", "Hotter, steadier", 2, 20, 0, 0.02, 0, 0)],
	]),
	Tools: new Map([
		[0, part("Basic Tools", "Basic forging tools", 0, 10, 0, 0.01, 0, 0)],
		[1, part("Master Tools", "Precise to the blow", 1, 20, 0.05, 0.02, 0, 0)],
	]),
	Quench: new Map([
		[0, part("Water Quench", "A basic quenching method", 0, 10, 0, 0.01, 0, 0)],
		[1, part("Oil Quench", "Gentler on the steel", 0, 30, 0, 0.015, 0, 0)],
	]),
	Fuel: new Map([
		[0, part("Coal", "Basic forge fuel", 0, 10, 0, 0.01, 0, 0)],
		[1, part("Charcoal", "Cleaner burn", 1, 15, 0, 0.015, 0, 0)],
	]),
	Intent: new Map([
		[0, part("Basic Intent", "A basic forging intent", 0, 10, 0, 0.01, 0, 0)],
		[1, part("Intent: Ruin", "Made to break things", 4, 5, 0.1, 0.03, 0, 0)],
	]),
};

// Never undefined: a miss returns EMPTY_PART so callers can sum without checks.
export function GetPart(category: ForgeCategory, id: number): PartStats {
	return PARTS[category]?.get(id) ?? EMPTY_PART;
}

// True only if the part really exists. The server uses this to refuse a part id
// a client made up.
export function HasPart(category: ForgeCategory, id: number): boolean {
	return PARTS[category]?.has(id) ?? false;
}

export function IsCategory(value: unknown): value is ForgeCategory {
	return typeIs(value, "string") && PARTS[value as ForgeCategory] !== undefined;
}

export function DefaultForgeStats(): ForgeStats {
	return {
		Materials: 0,
		Blade: 0,
		Hilt: 0,
		Guard: 0,
		Smith: 0,
		Place: 0,
		Tools: 0,
		Quench: 0,
		Fuel: 0,
		Intent: 0,
	};
}
