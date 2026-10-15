/*
	sword.ts  (server)

	A forged weapon. Its stats are the sword's base stats plus the sum of every
	installed forge part, recomputed whenever a part changes.
*/

import { Config } from "shared/config";
import { CategoryOrder, DefaultForgeStats, GetPart, HasPart, IsCategory } from "shared/forgeData";
import { AbilityId, ForgeCategory, ForgeStats, generic_item_stats, generic_weapon_stats, ItemKind, ItemSnapshot } from "shared/types";
import { weapon } from "./weapon";

function isPartId(id: unknown): id is number {
	// Rejects NaN, negatives and fractions before they reach the database.
	return typeIs(id, "number") && id === id && id >= 0 && id % 1 === 0;
}

export class sword extends weapon {
	public readonly kind: ItemKind = "sword";

	protected forge_st: ForgeStats;
	protected inscription: string;
	// Energy granted by the forge parts. Nothing spends it yet.
	protected energy = 0;

	// The sword's stats before forge parts; CalculateStats adds the parts on top.
	private readonly base_stats: generic_weapon_stats;

	constructor(
		_in_gi_stats: generic_item_stats,
		_in_fws_: ForgeStats = DefaultForgeStats(),
		inscription = "",
		_in_gw_stats: generic_weapon_stats = { ...Config.SwordBaseStats },
	) {
		super({ ..._in_gw_stats }, _in_gi_stats);
		this.base_stats = { ..._in_gw_stats };
		this.forge_st = { ..._in_fws_ };
		this.inscription = inscription;
		this.CalculateStats();
		// A freshly forged sword starts at full durability.
		this.durability = this.maxDurability;
	}

	public GetForgeStats(): Readonly<ForgeStats> {
		return this.forge_st;
	}

	// Replace every part at once. Refused entirely if any part id is invalid.
	public PutForgeStats(i: ForgeStats): boolean {
		for (const category of CategoryOrder) {
			if (!isPartId(i[category]) || !HasPart(category, i[category])) return false;
		}
		this.forge_st = { ...i };
		this.CalculateStats();
		return true;
	}

	/*
		Swap one forge part. Rejects a category or part id that is not in the
		database - this is what makes RequestForge safe to expose, since the
		worst a forged payload can do is get refused.
	*/
	public SetForgePart(category: ForgeCategory, id: number): boolean {
		if (!IsCategory(category) || !isPartId(id) || !HasPart(category, id)) return false;
		this.forge_st[category] = id;
		this.CalculateStats();
		return true;
	}

	public GetInscription(): string {
		return this.inscription;
	}

	public CalculateStats(): void {
		let damage = this.base_stats.damage;
		let cc = this.base_stats.cc;
		let cd = this.base_stats.cd;
		let durability = 0;
		let energy = 0;
		let capacity = 0;
		const abilities: AbilityId[] = [];

		// Fixed order: float addition is not associative.
		for (const category of CategoryOrder) {
			const p = GetPart(category, this.forge_st[category]);
			damage += p.damage;
			cc += p.critChance;
			cd += p.critDamage;
			durability += p.durability;
			energy += p.energy;
			capacity += p.capacity;
			for (const a of p.abilities) abilities.push(a);
		}

		this.stats = {
			damage,
			attack_speed: this.base_stats.attack_speed,
			range: this.base_stats.range,
			cc,
			cd,
		};
		this._item_stats.capacity = capacity;
		this._item_stats.abilities = abilities;
		this.energy = energy;

		// Keep the same wear fraction when parts change, so re-forging is not a
		// free repair.
		const previousMax = this.maxDurability;
		this.maxDurability = durability;
		if (previousMax <= 0) {
			this.durability = durability;
		} else {
			this.durability = durability * math.clamp(this.durability / previousMax, 0, 1);
		}
	}

	public GetEnergy(): number {
		return this.energy;
	}

	public ToSnapshot(): ItemSnapshot {
		const snapshot = super.ToSnapshot();
		snapshot.inscription = this.inscription;
		snapshot.forge = { ...this.forge_st };
		return snapshot;
	}
}
