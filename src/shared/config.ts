/*
	config.ts  (shared)

	Tuning values and the server's validation limits. Shared so the client can
	predict and display, but only the server enforces any of it.
*/

import { Generic_Player_stats, generic_weapon_stats } from "./types";

export const Config = {
	Inventory: {
		MaxSlots: 27,
		HotbarSlots: 9,
	},

	// Starting stats for a freshly joined player.
	DefaultPlayerStats: {
		health: 100,
		defense: 0,
		energy: 100,
		speed: 16,
		strength: 0,
		critChance: 0,
		// Not 0: a crit multiplies by (critDamage + weapon.cd) * CritMultiplierScale,
		// so 0 here would make an ungeared crit deal nothing.
		critDamage: 1,
	} satisfies Generic_Player_stats,

	// Base stats of a sword before forge parts are added on top.
	SwordBaseStats: {
		damage: 0,
		attack_speed: 1,
		range: 1,
		cc: 0,
		cd: 0,
	} satisfies generic_weapon_stats,

	Damage: {
		/*
			raw    = (attack.Damage + weapon.damage * WeaponDamageScale) * (1 + strength / StrengthDivisor)
			crit   = raw * (player.critDamage + weapon.cd) * CritMultiplierScale
			final  = value * 100 / (100 + victim.defense)
		*/
		WeaponDamageScale: 0.25,
		StrengthDivisor: 50,
		CritMultiplierScale: 1.5,
		// Crit chance at or above this always crits.
		MaxCritChance: 1,
		DurabilityCostPerHit: 1,
	},

	// Token-bucket limits per remote, per player.
	// burst = requests allowed at once, refill = tokens per second.
	RateLimits: {
		CombatInput: { burst: 12, refill: 8 },
		// press + release + inputs: a held or multi-stage ability sends several
		AbilityInput: { burst: 20, refill: 12 },
		GiveStandArrow: { burst: 3, refill: 0.5 },
		RequestEquip: { burst: 10, refill: 5 },
		RequestSetHotbar: { burst: 10, refill: 4 },
		RequestUseItem: { burst: 8, refill: 4 },
		RequestForge: { burst: 4, refill: 1 },
	} as Record<string, { burst: number; refill: number } | undefined>,

	Projectiles: {
		// Per owner. Firing past the cap removes that owner's oldest.
		MaxProjectilesPerOwner: 60,
		MaxBeamsPerOwner: 4,
		// Defaults for anything an option leaves out.
		DefaultLifetime: 5,
		DefaultMaxDistance: 600,
		// Casts per projectile per frame (pierces and bounces each use one).
		MaxCastsPerStep: 6,
		// How often moving beams and homing projectiles resync to clients.
		SyncInterval: 0.05,
	},

	// Seconds between safety-net snapshot pushes. Changes push immediately.
	SnapshotInterval: 10,

	/*
		Violations decay, so what gets a player kicked is a sustained rate of
		invalid requests, not a lifetime total. Ordinary misses (cooldown, range)
		are never counted. Set MaxViolations to 0 to only log.
	*/
	MaxViolations: 40,
	ViolationDecayRate: 0.5,

	// Run the framework self-tests when the server starts in Studio.
	RunTestsInStudio: true,
} as const;
