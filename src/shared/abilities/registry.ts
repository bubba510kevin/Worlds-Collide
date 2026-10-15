/*
	abilities/registry.ts  (shared)

	Lookups over the catalog. Every getter takes `unknown` and returns
	undefined for anything that is not a real id, so they are safe to call on
	raw client input.
*/

import { ABILITIES, KITS, RESOURCES } from "./catalog";
import { AbilityBinding, AbilityDef, AbilityInput, KitDef, ResourceDef } from "./types";

const abilityById = new Map<string, AbilityDef>();
const kitById = new Map<string, KitDef>();
const resourceById = new Map<string, ResourceDef>();

for (const def of ABILITIES) {
	assert(!abilityById.has(def.id), `duplicate ability id ${def.id}`);
	abilityById.set(def.id, def);
}
for (const def of KITS) {
	assert(!kitById.has(def.id), `duplicate kit id ${def.id}`);
	kitById.set(def.id, def);
}
for (const def of RESOURCES) {
	assert(!resourceById.has(def.id), `duplicate resource id ${def.id}`);
	resourceById.set(def.id, def);
}

export function getAbility(id: unknown): AbilityDef | undefined {
	return typeIs(id, "string") ? abilityById.get(id) : undefined;
}

export function getKit(id: unknown): KitDef | undefined {
	return typeIs(id, "string") ? kitById.get(id) : undefined;
}

export function getResource(id: unknown): ResourceDef | undefined {
	return typeIs(id, "string") ? resourceById.get(id) : undefined;
}

export function getAllAbilities(): readonly AbilityDef[] {
	return ABILITIES;
}

export function getAllKits(): readonly KitDef[] {
	return KITS;
}

export function getAllResources(): readonly ResourceDef[] {
	return RESOURCES;
}

export function getKitsInGroup(group: string): KitDef[] {
	return KITS.filter((k) => k.group === group);
}

// Can an ability with this id come from a source of kind `from`?
export function isBindable(id: unknown, from: "player" | "item"): boolean {
	const binding: AbilityBinding | undefined = getAbility(id)?.binding;
	return binding === from || binding === "any";
}

export function hasTag(id: unknown, tag: string): boolean {
	return getAbility(id)?.tags?.includes(tag) ?? false;
}

export function inputOf(id: unknown): AbilityInput | undefined {
	return getAbility(id)?.input;
}

// Typed read of an ability's free-form `data`, with a fallback.
export function abilityData<T>(def: AbilityDef, key: string, fallback: T): T {
	const value = def.data?.[key];
	return value !== undefined && typeOf(value) === typeOf(fallback) ? (value as T) : fallback;
}

export const DEFAULT_BLOCKED_BY: readonly string[] = ["Stunned", "Blocking"];
export const DEFAULT_INTERRUPTED_BY: readonly string[] = ["Stunned"];
