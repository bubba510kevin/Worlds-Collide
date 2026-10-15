/*
	weapon.ts  (server)

	An item that can be swung. Holds the weapon's stats and durability; the
	combat service decides *when* a swing happens, the weapon decides what its
	hitbox and damage look like.
*/

import { Config } from "shared/config";
import { generic_item_stats, generic_weapon_stats, ItemKind, ItemSnapshot } from "shared/types";
import { calc_hit, HitBox, HitData } from "../../combat/CalcHit";
import { StatModifiers } from "../../stats/statModifiers";
import type { Generic_Player } from "../../generic_player/generic_player";
import { item } from "../item";

export class weapon extends item {
	public readonly kind: ItemKind = "weapon";

	// The weapon's final stats. Subclasses rebuild these in CalculateStats().
	protected stats: generic_weapon_stats = { damage: 1, attack_speed: 1, range: 1, cc: 0, cd: 0 };

	protected durability = 0;
	protected maxDurability = 0; // 0 = unbreakable

	// Changes to this weapon's stats (buffs, enchantments, a released form...).
	public readonly modifiers = new StatModifiers<keyof generic_weapon_stats>();

	constructor(in_stats: generic_weapon_stats, _in_item_stats: generic_item_stats) {
		super(_in_item_stats);
		this.stats = in_stats;
	}

	// Current stats, with every active modifier applied.
	public GetWeaponStats(): Readonly<generic_weapon_stats> {
		return this.modifiers.ApplyAll(this.stats);
	}

	/*
		Finds what this swing hits. The weapon's range stat stretches the
		attack's hitbox forward; everything else is up to calc_hit.
	*/
	public hit(player: Generic_Player, hitda: HitData): HitBox {
		return calc_hit(player, { ...hitda, hitbox_z: hitda.hitbox_z * this.GetWeaponStats().range });
	}

	/*
		Fraction of an incoming frontal hit this weapon stops while blocking.
		1 = blocks it completely. Override for weapons that block worse (or
		better) than bare hands.
	*/
	public block(): number {
		return 1;
	}

	/*
		Recompute derived stats (from forge parts, enchantments, ...). A plain
		weapon has nothing to derive from, so this is a no-op.
	*/
	public CalculateStats(): void {}

	public GetDurability(): number {
		return this.durability;
	}

	public GetMaxDurability(): number {
		return this.maxDurability;
	}

	public IsBroken(): boolean {
		return this.maxDurability > 0 && this.durability <= 0;
	}

	// Returns true if the weapon broke on this hit.
	public ApplyWear(amount: number = Config.Damage.DurabilityCostPerHit): boolean {
		if (amount <= 0 || this.maxDurability <= 0) return false;
		this.durability = math.max(0, this.durability - amount);
		return this.durability <= 0;
	}

	public ToSnapshot(): ItemSnapshot {
		const snapshot = super.ToSnapshot();
		snapshot.weapon = { ...this.GetWeaponStats() };
		snapshot.durability = this.durability;
		snapshot.maxDurability = this.maxDurability;
		return snapshot;
	}
}

// A broken weapon still sits in the inventory but fights like bare hands.
export function usable_weapon(held: item | undefined): weapon | undefined {
	if (held instanceof weapon && !held.IsBroken()) return held;
	return undefined;
}
