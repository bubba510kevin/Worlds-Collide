/*
	abilities/registry.ts  (shared)

	Every ability, kit and resource the game knows about. It starts with the
	built-in ones from catalog.ts; Luau content adds more at startup through
	the WC API (registerAbility / registerKit / registerResource).

	Getters take `unknown` and return undefined for anything that is not a
	real id, so they are safe to call on raw client input.

	register* functions validate their input and throw a plain-English error
	pointing at the bad field, because the data often comes from hand-written
	Luau tables.
*/

import { ABILITIES, DEFAULT_ABILITIES, KITS, RESOURCES } from "./catalog";
import { AbilityBinding, AbilityDef, AbilityInput, KitDef, ResourceDef, StatKey } from "./types";

const abilityById = new Map<string, AbilityDef>();
const kitById = new Map<string, KitDef>();
const resourceById = new Map<string, ResourceDef>();
// Insertion order, so lists are stable.
const abilityOrder: AbilityDef[] = [];
const kitOrder: KitDef[] = [];
const resourceOrder: ResourceDef[] = [];
const defaultAbilities: string[] = [];
const listeners: (() => void)[] = [];

const BINDINGS = new Set<string>(["player", "item", "any"]);
const INPUTS = new Set<string>(["press", "hold", "toggle", "passive"]);
const STATS = new Set<string>(["health", "defense", "energy", "speed", "strength", "critChance", "critDamage"]);

// ----------------------------------------------------------------------------
// validation
// ----------------------------------------------------------------------------

function fail(what: string, message: string): never {
	// level 3: point at the caller's caller (the content module), not here.
	error(`${what}: ${message}`, 3);
}

function needString(what: string, t: Record<string, unknown>, key: string) {
	if (!typeIs(t[key], "string") || t[key] === "") fail(what, `"${key}" must be a non-empty string`);
}

function needNumber(what: string, t: Record<string, unknown>, key: string, optional = false) {
	const v = t[key];
	if (v === undefined && optional) return;
	if (!typeIs(v, "number") || v !== v) fail(what, `"${key}" must be a number${optional ? " (or left out)" : ""}`);
}

function needStringList(what: string, t: Record<string, unknown>, key: string, optional = false) {
	const v = t[key];
	if (v === undefined && optional) return;
	if (!typeIs(v, "table")) fail(what, `"${key}" must be a list of strings, like {"A", "B"}`);
	for (const [, item] of pairs(v as object)) {
		if (!typeIs(item, "string")) fail(what, `"${key}" must only contain strings`);
	}
}

function validateAbility(raw: unknown): AbilityDef {
	if (!typeIs(raw, "table")) error("AddAbility: you must pass a table, like WC.AddAbility({ id = ..., ... })", 3);
	const t = raw as Record<string, unknown>;
	const what = `AddAbility("${tostring(t.id)}")`;

	needString(what, t, "id");
	needString(what, t, "name");
	if (t.description !== undefined && !typeIs(t.description, "string")) fail(what, `"description" must be a string`);
	if (!BINDINGS.has(t.binding as string)) fail(what, `"binding" must be "player", "item" or "any"`);
	if (!INPUTS.has(t.input as string)) fail(what, `"input" must be "press", "hold", "toggle" or "passive"`);
	needNumber(what, t, "cooldown");
	needNumber(what, t, "charges", true);
	needNumber(what, t, "maxDuration", true);
	if (t.defaultKey !== undefined && !typeIs(t.defaultKey, "EnumItem")) {
		fail(what, `"defaultKey" must be a key, like Enum.KeyCode.V`);
	}
	if (t.input === "passive" && t.defaultKey !== undefined) fail(what, `a "passive" ability can't have a defaultKey`);

	if (t.costs !== undefined) {
		if (!typeIs(t.costs, "table")) fail(what, `"costs" must be a list, like { { resource = "Energy", amount = 20 } }`);
		for (const [, cost] of pairs(t.costs as object)) {
			const c = cost as Record<string, unknown>;
			if (!typeIs(c, "table") || !typeIs(c.resource, "string") || !typeIs(c.amount, "number")) {
				fail(what, `each cost must look like { resource = "Energy", amount = 20 }`);
			}
		}
	}
	if (t.modifiers !== undefined) {
		if (!typeIs(t.modifiers, "table")) fail(what, `"modifiers" must be a list, like { { stat = "defense", flat = 10 } }`);
		for (const [, mod] of pairs(t.modifiers as object)) {
			const m = mod as Record<string, unknown>;
			if (!typeIs(m, "table") || !STATS.has(m.stat as string)) {
				fail(what, `each modifier needs a "stat": one of ${[...STATS].join(", ")}`);
			}
			if (m.flat !== undefined && !typeIs(m.flat, "number")) fail(what, `modifier "flat" must be a number`);
			if (m.mult !== undefined && !typeIs(m.mult, "number")) fail(what, `modifier "mult" must be a number`);
		}
	}
	needStringList(what, t, "blockedBy", true);
	needStringList(what, t, "interruptedBy", true);
	needStringList(what, t, "tags", true);
	if (t.data !== undefined && !typeIs(t.data, "table")) fail(what, `"data" must be a table`);

	return {
		...(t as unknown as AbilityDef),
		description: (t.description as string | undefined) ?? "",
	};
}

function validateKit(raw: unknown): KitDef {
	if (!typeIs(raw, "table")) error("AddKit: you must pass a table, like WC.AddKit({ id = ..., ... })", 3);
	const t = raw as Record<string, unknown>;
	const what = `AddKit("${tostring(t.id)}")`;
	needString(what, t, "id");
	needString(what, t, "name");
	if (t.group !== undefined && !typeIs(t.group, "string")) fail(what, `"group" must be a string (or left out)`);
	needStringList(what, t, "abilities");
	return { ...(t as unknown as KitDef), description: (t.description as string | undefined) ?? "" };
}

function validateResource(raw: unknown): ResourceDef {
	if (!typeIs(raw, "table")) error("AddResource: you must pass a table, like WC.AddResource({ id = ..., ... })", 3);
	const t = raw as Record<string, unknown>;
	const what = `AddResource("${tostring(t.id)}")`;
	needString(what, t, "id");
	needString(what, t, "name");
	if (!typeIs(t.max, "number") && !STATS.has(t.max as string)) {
		fail(what, `"max" must be a number, or a stat name like "energy"`);
	}
	needNumber(what, t, "regen");
	needNumber(what, t, "regenDelay", true);
	if (t.color !== undefined && !typeIs(t.color, "Color3")) fail(what, `"color" must be a Color3`);
	return t as unknown as ResourceDef;
}

// ----------------------------------------------------------------------------
// registration
// ----------------------------------------------------------------------------

function changed() {
	for (const listener of listeners) listener();
}

export function registerAbility(raw: unknown): AbilityDef {
	const def = validateAbility(raw);
	if (abilityById.has(def.id)) error(`AddAbility: there is already an ability called "${def.id}"`, 2);
	abilityById.set(def.id, def);
	abilityOrder.push(def);
	changed();
	return def;
}

export function registerKit(raw: unknown): KitDef {
	const def = validateKit(raw);
	if (kitById.has(def.id)) error(`AddKit: there is already a kit called "${def.id}"`, 2);
	kitById.set(def.id, def);
	kitOrder.push(def);
	changed();
	return def;
}

export function registerResource(raw: unknown): ResourceDef {
	const def = validateResource(raw);
	if (resourceById.has(def.id)) error(`AddResource: there is already a resource called "${def.id}"`, 2);
	resourceById.set(def.id, def);
	resourceOrder.push(def);
	changed();
	return def;
}

// Everyone gets these on join (source "innate").
export function addDefaultAbility(id: unknown) {
	if (!typeIs(id, "string")) error("AddDefaultAbility: pass the ability's id, like WC.AddDefaultAbility(\"Fireball\")", 2);
	if (!defaultAbilities.includes(id)) defaultAbilities.push(id);
}

// Called after anything is registered (keybinds, UI rebuild themselves).
export function onRegistryChanged(listener: () => void) {
	listeners.push(listener);
}

for (const def of ABILITIES) registerAbility(def);
for (const def of KITS) registerKit(def);
for (const def of RESOURCES) registerResource(def);
for (const id of DEFAULT_ABILITIES) addDefaultAbility(id);

// ----------------------------------------------------------------------------
// lookups
// ----------------------------------------------------------------------------

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
	return abilityOrder;
}

export function getAllKits(): readonly KitDef[] {
	return kitOrder;
}

export function getAllResources(): readonly ResourceDef[] {
	return resourceOrder;
}

export function getDefaultAbilities(): readonly string[] {
	return defaultAbilities;
}

export function getKitsInGroup(group: string): KitDef[] {
	return kitOrder.filter((k) => k.group === group);
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

export function isStatKey(value: unknown): value is StatKey {
	return typeIs(value, "string") && STATS.has(value);
}

// Typed read of an ability's free-form `data`, with a fallback.
export function abilityData<T>(def: AbilityDef, key: string, fallback: T): T {
	const value = def.data?.[key];
	return value !== undefined && typeOf(value) === typeOf(fallback) ? (value as T) : fallback;
}

export const DEFAULT_BLOCKED_BY: readonly string[] = ["Stunned", "Blocking"];
export const DEFAULT_INTERRUPTED_BY: readonly string[] = ["Stunned"];
