/*
	generic_player.ts  (server)

	The server's wrapper around a Roblox Player: stats, inventory, what they
	are holding, abilities, resources, and the bookkeeping the network layer
	needs (rate limits, violations, whether a fresh snapshot is owed).

	Stats come in two layers:
		base       GetGenericPlayerStats / PutGenericPlayerStats / SetStat
		effective  GetStat - base run through `modifiers` (passives, buffs,
		           debuffs, gear...). Game logic should read GetStat.

	Abilities live in `abilities` (an AbilityHolder: grants, kits, charges,
	active instances) and are driven by server/abilities/abilityService.ts.
	Resource pools (energy, ...) live in `resources`.

	One exists per connected player, held in `activePlayers` (players.ts) and
	dropped on PlayerRemoving. Because it holds a strong reference to the
	Player, forgetting to drop it would leak the Player forever.
*/

import { StatKey } from "shared/abilities/types";
import { Config } from "shared/config";
import { Generic_Player_stats, PlayerSnapshot } from "shared/types";
import { AbilityHolder } from "../abilities/abilityHolder";
import { DamageHook } from "../abilities/events";
import { Resources } from "../abilities/resources";
import { Inventory, isValidHotbarSlot } from "../inventory/inventory";
import { item } from "../item/item";
import { usable_weapon, weapon } from "../item/weapon/weapon";
import { RateLimiter } from "../network/rateLimiter";
import { StatModifiers } from "../stats/statModifiers";

export type { Generic_Player_stats };

export class Generic_Player {
	private genps: Generic_Player_stats = { ...Config.DefaultPlayerStats };
	private readonly instance: Player;
	private readonly inven = new Inventory();
	// 1-based hotbar slot being held; 0 = empty-handed.
	private holding = 0;

	// Changes to effective stats. Remove by source when the cause goes away.
	public readonly modifiers = new StatModifiers<StatKey>();
	public readonly resources = new Resources((stat) => this.GetStat(stat));
	public readonly abilities = new AbilityHolder(() => {
		const held = this.HoldingItem();
		return held ? { uid: held.uid, abilities: held.GetAbilities() } : undefined;
	});

	// Damage hooks (see abilities/events.ts): hits this player lands / takes.
	public readonly outgoingDamage = new Set<DamageHook>();
	public readonly incomingDamage = new Set<DamageHook>();

	// network bookkeeping, used by network/remoteHandler.ts
	public readonly limiter = new RateLimiter();
	// Fractional: violations decay continuously.
	public violations = 0;
	public violationsUpdatedAt = os.clock();
	public dirty = false;

	// modifiers.version when stats were last pushed to the character
	private appliedVersion = -1;

	constructor(player: Player) {
		this.instance = player;
	}

	public GetInstance(): Player {
		return this.instance;
	}

	public GetCharacter(): Model | undefined {
		return this.instance.Character;
	}

	public GetInventory(): Inventory {
		return this.inven;
	}

	// ------------------------------------------------------------------------
	// stats
	// ------------------------------------------------------------------------

	public PutGenericPlayerStats(i: Generic_Player_stats) {
		this.genps = { ...i };
		this.OnStatsChanged();
	}

	// Base stats, before modifiers.
	public GetGenericPlayerStats(): Readonly<Generic_Player_stats> {
		return this.genps;
	}

	// Effective stat: base run through every active modifier.
	public GetStat(stat: StatKey): number {
		return this.modifiers.Apply(stat, this.genps[stat]);
	}

	public GetEffectiveStats(): Generic_Player_stats {
		return this.modifiers.ApplyAll(this.genps);
	}

	public SetStat(stat: StatKey, value: number) {
		if (value !== value) return; // NaN would poison every formula it reaches
		this.genps[stat] = value;
		this.OnStatsChanged();
	}

	/*
		Re-apply effective stats to the character and resources. Called by the
		ability service whenever the modifier stack changed, and after base
		stats change.
	*/
	public OnStatsChanged() {
		this.appliedVersion = this.modifiers.version;
		this.resources.Clamp();
		this.ApplyStatsToCharacter();
		this.MarkDirty();
	}

	// True when modifiers changed since the last OnStatsChanged.
	public StatsOutOfDate(): boolean {
		return this.appliedVersion !== this.modifiers.version;
	}

	// Push max health and walk speed onto the current character.
	public ApplyStatsToCharacter() {
		const character = this.instance.Character;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !humanoid || humanoid.Health <= 0) return;

		const health = this.GetStat("health");
		const healthFraction = humanoid.MaxHealth > 0 ? humanoid.Health / humanoid.MaxHealth : 1;
		humanoid.MaxHealth = health;
		humanoid.Health = health * healthFraction;

		// Combat owns WalkSpeed while the character is locked; it restores the
		// speed stat itself when the lock ends.
		const locked = character.GetAttribute("MovementLocked") === true || character.GetAttribute("Blocking") === true;
		if (!locked) humanoid.WalkSpeed = this.GetStat("speed");
	}

	// ------------------------------------------------------------------------
	// holding
	// ------------------------------------------------------------------------

	public GetHolding(): number {
		return this.holding;
	}

	// 0 unequips; anything else must be a real, filled hotbar slot.
	public SetHolding(slot: number): boolean {
		if (slot !== 0 && (!isValidHotbarSlot(slot) || !this.inven.AtHotbar(slot))) return false;
		if (slot !== this.holding) {
			this.holding = slot;
			this.MarkDirty();
		}
		return true;
	}

	// undefined when empty-handed, which is a normal state, not an error.
	public HoldingItem(): item | undefined {
		return this.holding === 0 ? undefined : this.inven.AtHotbar(this.holding);
	}

	// The held weapon, or undefined if unarmed, holding a non-weapon, or the weapon is broken.
	public HeldWeapon(): weapon | undefined {
		return usable_weapon(this.HoldingItem());
	}

	// ------------------------------------------------------------------------
	// replication
	// ------------------------------------------------------------------------

	public MarkDirty() {
		this.dirty = true;
	}

	public ToSnapshot(): PlayerSnapshot {
		return {
			stats: this.GetEffectiveStats(),
			inventory: this.inven.ToSnapshot(this.holding),
			abilities: this.abilities.ToSnapshot(),
			resources: this.resources.ToSnapshot(),
			kits: this.abilities.GetKits(),
		};
	}
}
