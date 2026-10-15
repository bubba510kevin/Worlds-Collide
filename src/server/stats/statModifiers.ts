/*
	statModifiers.ts  (server)

	A stack of changes to a set of numeric stats, used for players
	(Generic_Player.modifiers) and weapons (weapon.modifiers).

		final = (base + sum of flat) * product of mult

	Every modifier has an id and a source. Adding the same id from the same
	source replaces it (refresh, no stacking); use distinct ids to stack.
	RemoveSource drops everything one source added, which is how an ability,
	kit or item cleans up after itself. Modifiers can expire on their own.
*/

export interface StatModifier<K extends string> {
	readonly id: string;
	readonly source: string;
	readonly stat: K;
	readonly flat?: number;
	readonly mult?: number;
	// os.clock() it stops applying; undefined = until removed.
	readonly until?: number;
}

function keyOf(source: string, id: string) {
	return `${source}/${id}`;
}

export class StatModifiers<K extends string> {
	private readonly mods = new Map<string, StatModifier<K>>();
	// Bumped on every change, so callers can cheaply notice "something changed".
	public version = 0;

	// Per-stat totals, rebuilt only when the version moves or a timed one expires.
	private totals = new Map<K, { flat: number; mult: number }>();
	private totalsVersion = -1;
	private nextExpiry = math.huge;

	public Add(mod: StatModifier<K>) {
		this.mods.set(keyOf(mod.source, mod.id), mod);
		if (mod.until !== undefined) this.nextExpiry = math.min(this.nextExpiry, mod.until);
		this.version += 1;
	}

	// Convenience: a modifier that expires `duration` seconds from now.
	public AddTimed(mod: Omit<StatModifier<K>, "until">, duration: number) {
		this.Add({ ...mod, until: os.clock() + duration });
	}

	public Remove(source: string, id: string): boolean {
		const removed = this.mods.delete(keyOf(source, id));
		if (removed) this.version += 1;
		return removed;
	}

	public RemoveSource(source: string): number {
		let count = 0;
		for (const [key, mod] of this.mods) {
			if (mod.source === source) {
				this.mods.delete(key);
				count += 1;
			}
		}
		if (count > 0) this.version += 1;
		return count;
	}

	public Has(source: string, id: string): boolean {
		const mod = this.mods.get(keyOf(source, id));
		return mod !== undefined && (mod.until === undefined || mod.until > os.clock());
	}

	public GetAll(): StatModifier<K>[] {
		this.prune();
		const list: StatModifier<K>[] = [];
		for (const [, mod] of this.mods) list.push(mod);
		return list;
	}

	public Apply(stat: K, base: number): number {
		const total = this.getTotals().get(stat);
		return total ? (base + total.flat) * total.mult : base;
	}

	public ApplyAll<T extends Record<K, number>>(base: T): T {
		const result = { ...base };
		for (const [stat, value] of pairs(base)) {
			(result as Record<K, number>)[stat as K] = this.Apply(stat as K, value as number);
		}
		return result;
	}

	private prune() {
		const now = os.clock();
		if (now < this.nextExpiry) return;
		this.nextExpiry = math.huge;
		for (const [key, mod] of this.mods) {
			if (mod.until === undefined) continue;
			if (mod.until <= now) {
				this.mods.delete(key);
				this.version += 1;
			} else {
				this.nextExpiry = math.min(this.nextExpiry, mod.until);
			}
		}
	}

	// One pass over every modifier, summed per stat; reused until something changes.
	private getTotals(): Map<K, { flat: number; mult: number }> {
		this.prune();
		if (this.totalsVersion === this.version) return this.totals;

		const totals = new Map<K, { flat: number; mult: number }>();
		for (const [, mod] of this.mods) {
			const t = totals.get(mod.stat) ?? { flat: 0, mult: 1 };
			t.flat += mod.flat ?? 0;
			t.mult *= mod.mult ?? 1;
			totals.set(mod.stat, t);
		}
		this.totals = totals;
		this.totalsVersion = this.version;
		return totals;
	}
}
