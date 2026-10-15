/*
	events.ts  (server)

	Game-wide events abilities can react to (on-hit effects, lifesteal,
	counters, combo trackers...), plus a tiny Signal class to make more.

	From an ability, subscribe with `this.listen(ctx, GameEvents.Hit, fn)` so
	the connection is dropped automatically when the ability is revoked.
*/

import type { StrikeResult } from "../combat/combatService";
import type { Generic_Player } from "../generic_player/generic_player";

export interface Connection {
	Disconnect: () => void;
}

export class Signal<T extends unknown[]> {
	private readonly handlers = new Set<(...args: T) => void>();

	public Connect(handler: (...args: T) => void): Connection {
		this.handlers.add(handler);
		return { Disconnect: () => this.handlers.delete(handler) };
	}

	// Handlers run in order; one that errors is logged and does not stop the rest.
	public Fire(...args: T) {
		for (const handler of this.handlers) {
			const [ok, err] = pcall(handler, ...args);
			if (!ok) warn(`[events] handler errored: ${err}`);
		}
	}
}

export const GameEvents = {
	// A strike connected (fully blocked hits included; check result.blocked).
	Hit: new Signal<[attacker: Generic_Player, victim: Model, result: StrikeResult]>(),
	// A player took damage from a strike.
	Damaged: new Signal<[victim: Generic_Player, amount: number, attacker: Generic_Player]>(),
	AbilityActivated: new Signal<[caster: Generic_Player, abilityId: string]>(),
	AbilityEnded: new Signal<[caster: Generic_Player, abilityId: string, reason: string]>(),
	AbilityGranted: new Signal<[holder: Generic_Player, abilityId: string]>(),
	AbilityRevoked: new Signal<[holder: Generic_Player, abilityId: string]>(),
};

/*
	Damage hooks run inside strike(), before damage is dealt, and may change
	it. Each Generic_Player has an `outgoing` and an `incoming` list:

		outgoing - runs for hits this player lands
		incoming - runs for hits this player takes

	A hook gets the hit and returns the new amount (return info.amount to
	leave it alone). Use for damage boosts, shields, damage reduction,
	execute effects, and so on.
*/
export interface DamageInfo {
	readonly attacker: Generic_Player;
	readonly victim: Model;
	readonly victimPlayer?: Generic_Player;
	readonly amount: number;
	readonly crit: boolean;
	// Free-form tags the strike was made with, e.g. ["melee"] or ["ability", "FlashStep"].
	readonly tags: readonly string[];
}

export type DamageHook = (info: DamageInfo) => number;
