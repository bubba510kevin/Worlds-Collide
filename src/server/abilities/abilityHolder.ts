/*
	abilityHolder.ts  (server)

	One per Generic_Player: which abilities they have, where each came from,
	charges and recharge timers, and which abilities are active right now.

	It is pure bookkeeping - no Instances, no networking - so it can be unit
	tested. abilityService.ts drives the behaviour on top of it.

	Sources:
		player-bound grants  Grant(id, source, duration?) with any source string
		                     ("innate", "quest:intro", "buff:rage", ...)
		kits                 AddKit(id) grants the kit's abilities as "kit:<id>"
		the held item        its abilities, as "item:<uid>" (read live, not stored)

	Each source only contributes abilities its binding allows.
*/

import { getAbility, getKit, isBindable } from "shared/abilities/registry";
import { AbilitySnapshot } from "shared/abilities/types";

// What the holder needs from the held item (an `item` satisfies this).
export interface HeldAbilities {
	readonly uid: string;
	// Bumped whenever GetAbilities() would return something different.
	readonly abilityVersion: number;
	GetAbilities(): readonly string[];
}

export interface ActiveAbility {
	readonly id: string;
	readonly source: string;
	readonly startedAt: number;
	// os.clock() it ends on its own; undefined = no time limit.
	endsAt?: number;
	// Free per-activation storage for the ability's own use.
	readonly state: Map<string, unknown>;
}

interface ChargeState {
	charges: number;
	// os.clock() the next charge returns; undefined = not recharging.
	rechargeAt?: number;
	// Seconds per charge for the current recharge (cooldowns can be dynamic).
	cooldown: number;
	// Waiting for the active instance to end before recharging.
	paused: boolean;
}

export class AbilityHolder {
	// ability id -> source -> expiry (undefined = permanent)
	private readonly grants = new Map<string, Map<string, number | undefined>>();
	private readonly kits = new Set<string>();
	private readonly chargeStates = new Map<string, ChargeState>();
	private readonly actives = new Map<string, ActiveAbility>();

	// GetAll() cache. Rebuilt only when grants change, the held item (or its
	// abilities) change, or a timed grant expires - not every frame.
	private grantsVersion = 0;
	private cached?: Map<string, string>;
	private cachedGrantsVersion = -1;
	private cachedHeld?: HeldAbilities;
	private cachedHeldVersion = -1;
	private cacheExpiresAt = 0;

	constructor(private readonly heldItem: () => HeldAbilities | undefined) {}

	// ------------------------------------------------------------------------
	// grants
	// ------------------------------------------------------------------------

	/*
		Grant a player-bound ability. `duration` makes it temporary. Granting
		the same id from several sources is fine: it stays until every source
		has revoked it.
	*/
	public Grant(id: string, source = "innate", duration?: number): boolean {
		if (!isBindable(id, "player")) return false;
		let sources = this.grants.get(id);
		if (!sources) {
			sources = new Map();
			this.grants.set(id, sources);
		}
		sources.set(source, duration !== undefined ? os.clock() + duration : undefined);
		this.grantsVersion += 1;
		return true;
	}

	public Revoke(id: string, source = "innate"): boolean {
		const sources = this.grants.get(id);
		if (!sources || !sources.delete(source)) return false;
		if (sources.isEmpty()) this.grants.delete(id);
		this.grantsVersion += 1;
		return true;
	}

	// Drop every grant from one source.
	public RevokeSource(source: string): number {
		let count = 0;
		for (const [id] of this.grants) if (this.Revoke(id, source)) count += 1;
		return count;
	}

	public HasGrant(id: string, source?: string): boolean {
		const sources = this.grants.get(id);
		if (!sources) return false;
		return source === undefined ? !sources.isEmpty() : sources.has(source);
	}

	// ------------------------------------------------------------------------
	// kits
	// ------------------------------------------------------------------------

	// Add a kit. Any other kit in the same group is removed first.
	public AddKit(id: string): boolean {
		const kit = getKit(id);
		if (!kit || this.kits.has(id)) return false;
		if (kit.group !== undefined) {
			for (const other of this.kits) if (getKit(other)?.group === kit.group) this.RemoveKit(other);
		}
		this.kits.add(id);
		for (const ability of kit.abilities) this.Grant(ability, `kit:${id}`);
		return true;
	}

	public RemoveKit(id: string): boolean {
		if (!this.kits.delete(id)) return false;
		this.RevokeSource(`kit:${id}`);
		return true;
	}

	public HasKit(id: string): boolean {
		return this.kits.has(id);
	}

	public GetKits(): string[] {
		const list: string[] = [];
		for (const id of this.kits) list.push(id);
		return list;
	}

	public GetKitInGroup(group: string): string | undefined {
		for (const id of this.kits) if (getKit(id)?.group === group) return id;
		return undefined;
	}

	// ------------------------------------------------------------------------
	// what the player has right now
	// ------------------------------------------------------------------------

	/*
		ability id -> the source providing it. Expired timed grants are dropped.
		The map is cached and shared: read it, never modify it. The same map
		object is returned until something changes, so callers can compare
		identity to notice changes cheaply.
	*/
	public GetAll(): ReadonlyMap<string, string> {
		const now = os.clock();
		const held = this.heldItem();
		if (
			this.cached &&
			this.cachedGrantsVersion === this.grantsVersion &&
			this.cachedHeld === held &&
			this.cachedHeldVersion === (held?.abilityVersion ?? -1) &&
			now < this.cacheExpiresAt
		) {
			return this.cached;
		}

		const result = new Map<string, string>();
		let nextExpiry = math.huge;
		for (const [id, sources] of this.grants) {
			for (const [source, untilTime] of sources) {
				if (untilTime !== undefined && untilTime <= now) {
					sources.delete(source);
					continue;
				}
				if (untilTime !== undefined) nextExpiry = math.min(nextExpiry, untilTime);
				if (!result.has(id)) result.set(id, source);
			}
			if (sources.isEmpty()) this.grants.delete(id);
		}
		if (held) {
			for (const id of held.GetAbilities()) {
				if (!result.has(id) && isBindable(id, "item")) result.set(id, `item:${held.uid}`);
			}
		}

		this.cached = result;
		this.cachedGrantsVersion = this.grantsVersion;
		this.cachedHeld = held;
		this.cachedHeldVersion = held?.abilityVersion ?? -1;
		this.cacheExpiresAt = nextExpiry;
		return result;
	}

	public Has(id: string): boolean {
		return this.GetAll().has(id);
	}

	public SourceOf(id: string): string | undefined {
		return this.GetAll().get(id);
	}

	// ------------------------------------------------------------------------
	// charges and cooldowns
	// ------------------------------------------------------------------------

	public MaxCharges(id: string): number {
		return math.max(1, getAbility(id)?.charges ?? 1);
	}

	private state(id: string): ChargeState {
		let s = this.chargeStates.get(id);
		if (!s) {
			s = { charges: this.MaxCharges(id), cooldown: getAbility(id)?.cooldown ?? 0, paused: false };
			this.chargeStates.set(id, s);
		}
		this.refresh(id, s, os.clock());
		return s;
	}

	private refresh(id: string, s: ChargeState, now: number) {
		const max = this.MaxCharges(id);
		if (s.charges > max) s.charges = max;
		while (!s.paused && s.rechargeAt !== undefined && s.charges < max && now >= s.rechargeAt) {
			s.charges += 1;
			s.rechargeAt = s.charges < max ? s.rechargeAt + s.cooldown : undefined;
		}
		if (s.charges >= max) s.rechargeAt = undefined;
	}

	public GetCharges(id: string): number {
		return this.state(id).charges;
	}

	// Seconds until the next charge returns (0 if full or paused).
	public RechargeRemaining(id: string): number {
		const s = this.state(id);
		return s.rechargeAt !== undefined ? math.max(0, s.rechargeAt - os.clock()) : 0;
	}

	// Whether a charge is available (counting one due within `tolerance` seconds).
	public CanUse(id: string, tolerance = 0): boolean {
		const s = this.state(id);
		this.refresh(id, s, os.clock() + tolerance);
		return s.charges >= 1;
	}

	/*
		Spend one charge. `tolerance` lets a use that arrives slightly early
		(network latency) count. `startOnEnd` holds the recharge until
		ResumeRecharge is called (the ability ending).
	*/
	public ConsumeCharge(id: string, cooldown: number, startOnEnd = false, tolerance = 0): boolean {
		const s = this.state(id);
		this.refresh(id, s, os.clock() + tolerance);
		if (s.charges < 1) return false;

		s.charges -= 1;
		s.cooldown = cooldown;
		if (startOnEnd) {
			s.paused = true;
			s.rechargeAt = undefined;
		} else if (s.rechargeAt === undefined) {
			s.rechargeAt = os.clock() + cooldown;
		}
		return true;
	}

	// Start a recharge that was held for the ability ending.
	public ResumeRecharge(id: string) {
		const s = this.state(id);
		if (!s.paused) return;
		s.paused = false;
		if (s.charges < this.MaxCharges(id)) s.rechargeAt = os.clock() + s.cooldown;
	}

	// Refill every charge now.
	public ResetCooldown(id: string) {
		const s = this.state(id);
		s.charges = this.MaxCharges(id);
		s.rechargeAt = undefined;
		s.paused = false;
	}

	// Bring the next charge `seconds` closer (cooldown reduction effects).
	public ReduceCooldown(id: string, seconds: number) {
		const s = this.state(id);
		if (s.rechargeAt !== undefined) {
			s.rechargeAt -= seconds;
			this.refresh(id, s, os.clock());
		}
	}

	// ------------------------------------------------------------------------
	// active instances
	// ------------------------------------------------------------------------

	public StartActive(id: string, source: string, maxDuration?: number): ActiveAbility {
		const now = os.clock();
		const active: ActiveAbility = {
			id,
			source,
			startedAt: now,
			endsAt: maxDuration !== undefined ? now + maxDuration : undefined,
			state: new Map(),
		};
		this.actives.set(id, active);
		return active;
	}

	public GetActive(id: string): ActiveAbility | undefined {
		return this.actives.get(id);
	}

	public IsActive(id: string): boolean {
		return this.actives.has(id);
	}

	public HasActives(): boolean {
		return !this.actives.isEmpty();
	}

	public GetActives(): ActiveAbility[] {
		const list: ActiveAbility[] = [];
		for (const [, a] of this.actives) list.push(a);
		return list;
	}

	// Bookkeeping only; abilityService.End() runs the ability's OnEnd.
	public RemoveActive(id: string): ActiveAbility | undefined {
		const active = this.actives.get(id);
		this.actives.delete(id);
		return active;
	}

	// ------------------------------------------------------------------------

	public ToSnapshot(): AbilitySnapshot[] {
		const now = os.clock();
		const list: AbilitySnapshot[] = [];
		for (const [id, source] of this.GetAll()) {
			const s = this.state(id);
			const active = this.actives.get(id);
			list.push({
				id,
				source,
				charges: s.charges,
				maxCharges: this.MaxCharges(id),
				recharge: s.rechargeAt !== undefined ? math.max(0, s.rechargeAt - now) : 0,
				recharging: s.rechargeAt !== undefined,
				active: active !== undefined,
				activeRemaining: active?.endsAt !== undefined ? math.max(0, active.endsAt - now) : undefined,
			});
		}
		list.sort((a, b) => a.id < b.id);
		return list;
	}
}
