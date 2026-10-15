/*
	inventory.ts  (server)

	Owns a player's items and their hotbar.

	The hotbar stores uids, not item references, and resolves them through the
	owning map. Removing an item therefore can never leave a dangling hotbar
	entry pointing at something the player no longer has.

	Every mutator returns success/failure instead of throwing. These are called
	from remote handlers, and a client sending a bad slot must produce a
	rejection, not a server error.

	Hotbar slots are 1-based everywhere (1..HotbarSlots), on the wire and here.
*/

import { Config } from "shared/config";
import { InventorySnapshot, ItemSnapshot } from "shared/types";
import { item } from "../item/item";

const MAX_SLOTS = Config.Inventory.MaxSlots;
const HOTBAR_SLOTS = Config.Inventory.HotbarSlots;

/*
	Shared slot validation. Rejects NaN explicitly: NaN fails every comparison,
	so a range check alone would not catch it.
*/
export function isValidHotbarSlot(slot: unknown): slot is number {
	return typeIs(slot, "number") && slot === slot && slot % 1 === 0 && slot >= 1 && slot <= HOTBAR_SLOTS;
}

export class Inventory {
	private readonly items: item[] = [];
	private readonly byUid = new Map<string, item>();
	private readonly hotbar = new Map<number, string>();

	public Size(): number {
		return this.items.size();
	}

	public IsFull(): boolean {
		return this.items.size() >= MAX_SLOTS;
	}

	public GetItems(): readonly item[] {
		return this.items;
	}

	// Refuses duplicates and anything past the slot cap.
	public AddItem(i: item): boolean {
		if (this.byUid.has(i.uid) || this.IsFull()) return false;
		this.items.push(i);
		this.byUid.set(i.uid, i);
		return true;
	}

	public RemoveItem(uid: string): item | undefined {
		const i = this.byUid.get(uid);
		if (!i) return undefined;

		this.byUid.delete(uid);
		const index = this.items.indexOf(i);
		if (index !== -1) this.items.remove(index);

		for (const [slot, slotUid] of this.hotbar) {
			if (slotUid === uid) this.hotbar.delete(slot);
		}
		return i;
	}

	public GetByUid(uid: unknown): item | undefined {
		return typeIs(uid, "string") ? this.byUid.get(uid) : undefined;
	}

	// undefined for an invalid or empty slot - never throws.
	public AtHotbar(slot: number): item | undefined {
		if (!isValidHotbarSlot(slot)) return undefined;
		const uid = this.hotbar.get(slot);
		return uid !== undefined ? this.byUid.get(uid) : undefined;
	}

	/*
		The authority check: the uid must name an item this inventory owns. A
		client sending another player's uid, or one it invented, is refused.
	*/
	public SetHotbar(slot: number, uid: string): boolean {
		if (!isValidHotbarSlot(slot) || !this.byUid.has(uid)) return false;
		this.hotbar.set(slot, uid);
		return true;
	}

	public ClearHotbar(slot: number): boolean {
		if (!isValidHotbarSlot(slot)) return false;
		this.hotbar.delete(slot);
		return true;
	}

	public ToSnapshot(holding: number): InventorySnapshot {
		const items: ItemSnapshot[] = this.items.map((i) => i.ToSnapshot());

		// Dense on purpose - see InventorySnapshot.hotbar.
		const hotbar: (string | false)[] = [];
		for (let slot = 1; slot <= HOTBAR_SLOTS; slot++) {
			hotbar.push(this.hotbar.get(slot) ?? false);
		}

		return { items, hotbar, holding };
	}
}
