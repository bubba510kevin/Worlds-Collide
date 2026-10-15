/*
	resources.ts  (server)

	A player's resource pools (energy, mana, stamina...), as defined in
	shared/abilities/catalog.ts. Spending is all-or-nothing across several
	resources, so a multi-cost ability never half-pays.
*/

import { getAllResources, getResource } from "shared/abilities/registry";
import { ResourceCost, ResourceSnapshot, StatKey } from "shared/abilities/types";

interface Pool {
	value: number;
	// os.clock() before which regen is paused
	regenAt: number;
}

export class Resources {
	private readonly pools = new Map<string, Pool>();

	// `readStat` resolves a max given as a stat name.
	constructor(private readonly readStat: (stat: StatKey) => number) {
		this.addMissing();
	}

	// Create pools for resources registered since (Luau content can add more).
	private addMissing() {
		for (const def of getAllResources()) {
			if (!this.pools.has(def.id)) {
				this.pools.set(def.id, { value: def.startEmpty ? 0 : this.GetMax(def.id), regenAt: 0 });
			}
		}
	}

	public GetMax(id: string): number {
		const def = getResource(id);
		if (!def) return 0;
		return typeIs(def.max, "number") ? def.max : this.readStat(def.max);
	}

	public Get(id: string): number {
		return this.pools.get(id)?.value ?? 0;
	}

	public Set(id: string, value: number) {
		const pool = this.pools.get(id);
		if (pool && value === value) pool.value = math.clamp(value, 0, this.GetMax(id));
	}

	public Add(id: string, amount: number) {
		this.Set(id, this.Get(id) + amount);
	}

	public CanAfford(costs: readonly ResourceCost[]): boolean {
		// Sum per resource first: two costs on the same pool must both fit.
		const totals = new Map<string, number>();
		for (const c of costs) totals.set(c.resource, (totals.get(c.resource) ?? 0) + c.amount);
		for (const [id, amount] of totals) {
			if (!this.pools.has(id) || this.Get(id) < amount) return false;
		}
		return true;
	}

	// All or nothing. Returns false (and spends nothing) if any cost can't be paid.
	public Spend(costs: readonly ResourceCost[]): boolean {
		if (!this.CanAfford(costs)) return false;
		const now = os.clock();
		for (const c of costs) {
			const pool = this.pools.get(c.resource)!;
			pool.value -= c.amount;
			if (c.amount > 0) pool.regenAt = now + (getResource(c.resource)?.regenDelay ?? 0);
		}
		return true;
	}

	public Tick(dt: number) {
		if (this.pools.size() < getAllResources().size()) this.addMissing();
		const now = os.clock();
		for (const [id, pool] of this.pools) {
			const def = getResource(id);
			if (!def || now < pool.regenAt) continue;
			pool.value = math.clamp(pool.value + def.regen * dt, 0, this.GetMax(id));
		}
	}

	// Re-clamp after a max changed (a stat dropped).
	public Clamp() {
		for (const [id, pool] of this.pools) pool.value = math.min(pool.value, this.GetMax(id));
	}

	public ToSnapshot(): ResourceSnapshot[] {
		const now = os.clock();
		const list: ResourceSnapshot[] = [];
		for (const [id, pool] of this.pools) {
			list.push({ id, value: pool.value, max: this.GetMax(id), regenIn: math.max(0, pool.regenAt - now) });
		}
		return list;
	}
}
