/*
	keybinds.ts  (client)

	Which key triggers which ability. Starts from each ability's defaultKey
	(abilities registered later by Luau content are picked up too); SetKey
	rebinds (a settings menu, a loadout screen...). One key per ability, one
	ability per key: binding a taken key unbinds the other.
*/

import { getAllAbilities, onRegistryChanged } from "shared/abilities/registry";

const keyOf = new Map<string, Enum.KeyCode>();
const abilityOf = new Map<Enum.KeyCode, string>();
const listeners: (() => void)[] = [];
// Abilities whose default key has been considered (bound, or skipped as taken).
const seen = new Set<string>();

// Give every newly registered ability its default key, if that key is free.
function addDefaults() {
	for (const def of getAllAbilities()) {
		if (seen.has(def.id)) continue;
		seen.add(def.id);
		if (def.defaultKey && def.input !== "passive" && !abilityOf.has(def.defaultKey) && !keyOf.has(def.id)) {
			keyOf.set(def.id, def.defaultKey);
			abilityOf.set(def.defaultKey, def.id);
		}
	}
}
addDefaults();
onRegistryChanged(() => {
	addDefaults();
	for (const listener of listeners) listener();
});

export function GetKey(id: string): Enum.KeyCode | undefined {
	return keyOf.get(id);
}

export function GetAbilityForKey(key: Enum.KeyCode): string | undefined {
	return abilityOf.get(key);
}

// Bind `id` to `key`, or unbind it with undefined.
export function SetKey(id: string, key: Enum.KeyCode | undefined) {
	const old = keyOf.get(id);
	if (old) abilityOf.delete(old);
	keyOf.delete(id);

	if (key) {
		const previous = abilityOf.get(key);
		if (previous !== undefined) keyOf.delete(previous);
		keyOf.set(id, key);
		abilityOf.set(key, id);
	}
	for (const listener of listeners) listener();
}

export function OnChanged(listener: () => void) {
	listeners.push(listener);
}
