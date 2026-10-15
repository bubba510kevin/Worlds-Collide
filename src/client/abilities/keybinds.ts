/*
	keybinds.ts  (client)

	Which key triggers which ability. Starts from each ability's defaultKey;
	SetKey rebinds (a settings menu, a loadout screen...). One key per
	ability, one ability per key: binding a taken key unbinds the other.
*/

import { getAllAbilities } from "shared/abilities/registry";

const keyOf = new Map<string, Enum.KeyCode>();
const abilityOf = new Map<Enum.KeyCode, string>();
const listeners: (() => void)[] = [];

for (const def of getAllAbilities()) {
	if (def.defaultKey && def.input !== "passive" && !abilityOf.has(def.defaultKey)) {
		keyOf.set(def.id, def.defaultKey);
		abilityOf.set(def.defaultKey, def.id);
	}
}

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
