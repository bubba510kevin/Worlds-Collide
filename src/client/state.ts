/*
	state.ts  (client)

	The last snapshot the server sent. A cache for UI and prediction only:
	editing it changes what this player sees on their own screen and nothing
	else. The server never reads it back and the next snapshot overwrites it.
*/

import { getRemote } from "shared/remotes";
import { generic_weapon_stats, ItemSnapshot, PlayerSnapshot } from "shared/types";

let snapshot: PlayerSnapshot | undefined;
const listeners: ((s: PlayerSnapshot) => void)[] = [];

export function getSnapshot(): PlayerSnapshot | undefined {
	return snapshot;
}

// Called with every new snapshot. Hook inventory/hotbar UI refreshes here.
export function onSnapshot(listener: (s: PlayerSnapshot) => void) {
	listeners.push(listener);
	if (snapshot) listener(snapshot);
}

export function heldItem(): ItemSnapshot | undefined {
	const inv = snapshot?.inventory;
	if (!inv || inv.holding === 0) return undefined;
	// Empty slots arrive as `false`; slots are 1-based, the array 0-based.
	const uid = inv.hotbar[inv.holding - 1];
	if (!uid) return undefined;
	return inv.items.find((i) => i.uid === uid);
}

// The held weapon's stats, or undefined when unarmed / holding a broken weapon.
export function heldWeaponStats(): generic_weapon_stats | undefined {
	const held = heldItem();
	if (!held || !held.weapon) return undefined;
	if (held.maxDurability !== undefined && held.maxDurability > 0 && (held.durability ?? 0) <= 0) return undefined;
	return held.weapon;
}

export function start() {
	getRemote("StateChanged").OnClientEvent.Connect((s: PlayerSnapshot) => {
		snapshot = s;
		for (const listener of listeners) task.spawn(listener, s);
	});
}
