/*
	item.ts  (server)

	Base class for everything that can sit in an Inventory.

	Item objects exist only on the server. A client never holds one, only the
	ItemSnapshot that ToSnapshot() produces.
*/

import { HttpService } from "@rbxts/services";
import { isBindable } from "shared/abilities/registry";
import { AbilityId, generic_item_stats, ItemKind, ItemSnapshot } from "shared/types";
import type { Generic_Player } from "../generic_player/generic_player";

export function new_item_stats(name: string): generic_item_stats {
	return { name, capacity: 0, abilities: [] };
}

export class item {
	// Stable id. The hotbar and every client request refer to items by uid.
	public readonly uid = HttpService.GenerateGUID(false);
	public readonly kind: ItemKind = "item";

	protected _item_stats: generic_item_stats;

	/*
		Item-bound abilities attached to this one item instance (e.g. a sword's
		signature technique).
		Kept apart from _item_stats.abilities, which subclasses rebuild from
		their parts, so recomputing stats never strips a bound ability.
	*/
	private readonly bound = new Set<AbilityId>();
	// Bumped whenever GetAbilities() changes, so ability holders know to re-read it.
	public abilityVersion = 0;

	constructor(_in_stats: generic_item_stats) {
		this._item_stats = _in_stats;
	}

	public GetName(): string {
		return this._item_stats.name;
	}

	public GetItemStats(): Readonly<generic_item_stats> {
		return this._item_stats;
	}

	// Every ability this item grants while held: from its parts plus bound ones.
	public GetAbilities(): AbilityId[] {
		const result = [...this._item_stats.abilities];
		for (const id of this.bound) if (!result.includes(id)) result.push(id);
		return result;
	}

	/*
		Bind an ability to this item for good. Refuses unknown ids and
		abilities whose binding is "player".
	*/
	public BindAbility(id: AbilityId): boolean {
		if (!isBindable(id, "item") || this.bound.has(id)) return false;
		this.bound.add(id);
		this.abilityVersion += 1;
		return true;
	}

	public UnbindAbility(id: AbilityId): boolean {
		if (!this.bound.delete(id)) return false;
		this.abilityVersion += 1;
		return true;
	}

	public HasBoundAbility(id: AbilityId): boolean {
		return this.bound.has(id);
	}

	/*
		Called when the owner presses the use key while holding this item.
		Returns true if something changed, so the owner's state is re-sent.
		A plain item does nothing; subclasses override.
	*/
	public Use(_owner: Generic_Player): boolean {
		return false;
	}

	public ToSnapshot(): ItemSnapshot {
		return {
			uid: this.uid,
			kind: this.kind,
			stats: {
				name: this._item_stats.name,
				capacity: this._item_stats.capacity,
				abilities: this.GetAbilities(),
			},
		};
	}
}
