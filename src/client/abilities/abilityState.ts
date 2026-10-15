/*
	abilityState.ts  (client)

	Predicted ability and resource state, so the bar and the input checks
	react instantly instead of waiting a round trip. Every snapshot resets
	the prediction to the server's numbers; nothing here is trusted.
*/

import { getAbility, getResource } from "shared/abilities/registry";
import { AbilityDef, AbilitySnapshot, ResourceCost } from "shared/abilities/types";
import { onSnapshot } from "../state";

interface Predicted {
	snapshot: AbilitySnapshot;
	charges: number;
	// local os.clock() the next charge returns; undefined = not recharging
	rechargeAt?: number;
	cooldown: number;
}

interface PredictedResource {
	value: number;
	max: number;
	at: number;
	regenAt: number;
}

const abilities = new Map<string, Predicted>();
const resources = new Map<string, PredictedResource>();
let order: string[] = [];
const listeners: (() => void)[] = [];

// ----------------------------------------------------------------------------
// abilities
// ----------------------------------------------------------------------------

export function owned(): string[] {
	return order;
}

export function has(id: string): boolean {
	return abilities.has(id);
}

export function snapshotOf(id: string): AbilitySnapshot | undefined {
	return abilities.get(id)?.snapshot;
}

export function isActive(id: string): boolean {
	return abilities.get(id)?.snapshot.active ?? false;
}

function refresh(p: Predicted) {
	const now = os.clock();
	while (p.rechargeAt !== undefined && now >= p.rechargeAt && p.charges < p.snapshot.maxCharges) {
		p.charges += 1;
		p.rechargeAt = p.charges < p.snapshot.maxCharges ? p.rechargeAt + p.cooldown : undefined;
	}
}

export function charges(id: string): number {
	const p = abilities.get(id);
	if (!p) return 0;
	refresh(p);
	return p.charges;
}

export function rechargeRemaining(id: string): number {
	const p = abilities.get(id);
	if (!p) return 0;
	refresh(p);
	return p.rechargeAt !== undefined ? math.max(0, p.rechargeAt - os.clock()) : 0;
}

// ----------------------------------------------------------------------------
// resources
// ----------------------------------------------------------------------------

export function resourceIds(): string[] {
	const list: string[] = [];
	for (const [id] of resources) list.push(id);
	return list;
}

export function resource(id: string): number {
	const r = resources.get(id);
	if (!r) return 0;
	const regen = getResource(id)?.regen ?? 0;
	const now = os.clock();
	const regenTime = math.max(0, now - math.max(r.at, r.regenAt));
	return math.clamp(r.value + regen * regenTime, 0, r.max);
}

export function resourceMax(id: string): number {
	return resources.get(id)?.max ?? 0;
}

export function canAfford(costs: readonly ResourceCost[]): boolean {
	for (const c of costs) if (resource(c.resource) < c.amount) return false;
	return true;
}

// ----------------------------------------------------------------------------
// prediction
// ----------------------------------------------------------------------------

// Charge a use locally, ahead of the server confirming it.
export function predictUse(def: AbilityDef) {
	const now = os.clock();
	const p = abilities.get(def.id);
	if (p) {
		refresh(p);
		p.charges = math.max(0, p.charges - 1);
		p.cooldown = def.cooldown;
		if (def.cooldownStartsOnEnd) p.rechargeAt = undefined;
		else if (p.rechargeAt === undefined) p.rechargeAt = now + def.cooldown;
	}
	for (const c of def.costs ?? []) {
		const r = resources.get(c.resource);
		if (!r) continue;
		r.value = resource(c.resource) - c.amount;
		r.at = now;
		r.regenAt = now + (getResource(c.resource)?.regenDelay ?? 0);
	}
}

// Called whenever a new snapshot arrives (after the state is updated).
export function onChanged(listener: () => void) {
	listeners.push(listener);
}

export function start() {
	onSnapshot((s) => {
		const now = os.clock();
		abilities.clear();
		order = [];
		for (const a of s.abilities) {
			abilities.set(a.id, {
				snapshot: a,
				charges: a.charges,
				rechargeAt: a.recharging && a.charges < a.maxCharges ? now + a.recharge : undefined,
				// Per-charge time for any charges after the next. (Abilities with a
				// dynamic GetCooldown are corrected by the next snapshot.)
				cooldown: getAbility(a.id)?.cooldown ?? 0,
			});
			order.push(a.id);
		}

		resources.clear();
		for (const r of s.resources) {
			resources.set(r.id, { value: r.value, max: r.max, at: now, regenAt: now + r.regenIn });
		}
		for (const listener of listeners) task.spawn(listener);
	});
}
