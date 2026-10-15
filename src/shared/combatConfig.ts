/*
	combatConfig.ts  (shared)

	Everything about the M1 combo you will want to tune. The server and the
	client both read this file.
*/

export interface ComboAttack {
	Name: string;
	Damage: number;

	Startup: number;
	Active: number;
	Cooldown: number;

	// hitbox, in studs, before the weapon's range multiplier
	Range: number;
	Width: number;
	Height: number;

	Stun: number;
	KnockbackDistance: number;
	KnockbackDuration: number;
	Hitstop: number;
	Finisher: boolean;
}

const DEFAULTS = {
	Range: 6.5,
	Width: 5,
	Height: 5,
	Stun: 0.4,
	KnockbackDistance: 1.5,
	KnockbackDuration: 0.15,
	Hitstop: 0.06,
	Finisher: false,
};

type AttackSpec = Pick<ComboAttack, "Name" | "Damage" | "Startup" | "Active" | "Cooldown"> & Partial<ComboAttack>;

function attack(spec: AttackSpec): ComboAttack {
	return { ...DEFAULTS, ...spec };
}

export const CombatConfig = {
	PvP: true,
	WallCheck: true,
	ReplicationRadius: 300,
	Debug: false,

	Keys: {
		Block: Enum.KeyCode.F,
		GamepadAttack: Enum.KeyCode.ButtonR2,
	},

	M1: {
		ComboWindow: 0.45,
		InputBuffer: 0.25,
		LatencyTolerance: 0.12,
		HitboxLeadTime: 0.03,
	},

	// Seconds the attacker is slowed after a swing, and to what.
	AttackWalkSpeed: 2,
	BlockWalkSpeed: 2,
	HitWalkSpeed: 0,

	// The finisher's knockback is multiplied by this.
	KnockbackMultiplier: 2,
	// How far in front of the victim a hit must come from to be blocked (dot product).
	BlockFrontDot: 0.5,

	Sounds: {
		Swing: "",
		Hit: "",
		HitFinisher: "",
	},

	Combo: [
		attack({ Name: "Jab", Damage: 5, Startup: 0.12, Active: 0.1, Cooldown: 0.36 }),
		attack({ Name: "Cross", Damage: 5, Startup: 0.12, Active: 0.1, Cooldown: 0.36 }),
		attack({ Name: "Hook", Damage: 6, Startup: 0.15, Active: 0.1, Cooldown: 0.4, Hitstop: 0.07 }),
		attack({
			Name: "Left Hook",
			Damage: 7,
			Startup: 0.15,
			Active: 0.1,
			Cooldown: 0.42,
			Hitstop: 0.07,
		}),
		attack({
			Name: "Roundhouse Kick",
			Finisher: true,
			Damage: 12,
			Startup: 0.24,
			Active: 0.12,
			Cooldown: 0.85,
			Stun: 0.7,
			KnockbackDistance: 13,
			KnockbackDuration: 0.35,
			Hitstop: 0.12,
		}),
	] as readonly ComboAttack[],
};

// Combo indices on the wire are 1-based (1 = Jab). Returns undefined for anything else.
export function getComboAttack(index: unknown): ComboAttack | undefined {
	if (!typeIs(index, "number") || index % 1 !== 0) return undefined;
	return CombatConfig.Combo[index - 1];
}

// Recovery after an attack: the held weapon's attack_speed shortens (or lengthens) it.
// Shared so the client predicts exactly what the server enforces.
export function attackCooldown(attack: ComboAttack, attackSpeed = 1): number {
	return attack.Cooldown / math.max(attackSpeed, 0.1);
}
