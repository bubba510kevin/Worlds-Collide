/*
	CalcHit.ts  (server)

	The two questions every attack asks:

		calc_hit    - what is inside this attack's hitbox?
		calc_damage - how much does it hurt, and did it crit?

	Neither trusts the client. The hitbox is built from the attacker's
	server-side position, and damage comes only from server-held stats and a
	server-held Random.
*/

import { Workspace } from "@rbxts/services";
import { Config } from "shared/config";
import { GetCharacterFromPart } from "shared/combatUtil";
import { generic_weapon_stats } from "shared/types";
import type { Generic_Player } from "../generic_player/generic_player";

export type HitData = {
	damage: number; // the attack's base damage
	hitbox_x: number; // width
	hitbox_y: number; // height
	hitbox_z: number; // reach in front of the attacker
};

export interface DamageResult {
	amount: number;
	crit: boolean;
}

// One server-side RNG. No remote can advance it predictably, and a rejected
// attack never consumes a roll, so a client cannot re-roll crits it dislikes.
const rng = new Random();

const overlapParams = new OverlapParams();
overlapParams.FilterType = Enum.RaycastFilterType.Exclude;

/*
	Every character model inside a box that starts at the attacker and extends
	`hitbox_z` studs forward. Each model appears once, however many of its parts
	are in the box. The attacker is never included.

	Returns the box too, so a debug view can draw it.
*/
export interface HitBox {
	targets: Model[];
	boxCFrame: CFrame;
	boxSize: Vector3;
}

export function calc_hit(attacker: Generic_Player, hitda: HitData): HitBox {
	const character = attacker.GetCharacter();
	const root = character?.FindFirstChild("HumanoidRootPart");
	const targets: Model[] = [];
	const boxSize = new Vector3(hitda.hitbox_x, hitda.hitbox_y, hitda.hitbox_z);

	if (!character || !root || !root.IsA("BasePart")) {
		return { targets, boxCFrame: CFrame.identity, boxSize };
	}

	const boxCFrame = root.CFrame.mul(new CFrame(0, 0, -hitda.hitbox_z / 2));
	overlapParams.FilterDescendantsInstances = [character];

	const seen = new Set<Model>();
	for (const part of Workspace.GetPartBoundsInBox(boxCFrame, boxSize, overlapParams)) {
		const model = GetCharacterFromPart(part);
		if (model && model !== character && !seen.has(model)) {
			seen.add(model);
			targets.push(model);
		}
	}

	return { targets, boxCFrame, boxSize };
}

export function rolls_crit(attacker: Generic_Player, weapon_stats?: generic_weapon_stats): boolean {
	const chance = attacker.GetStat("critChance") + (weapon_stats?.cc ?? 0);
	if (chance <= 0) return false;
	if (chance >= Config.Damage.MaxCritChance) return true;
	return rng.NextNumber() <= chance;
}

/*
	raw   = (base + weapon.damage * WeaponDamageScale) * (1 + strength / StrengthDivisor)
	crit  = raw * (critDamage + weapon.cd) * CritMultiplierScale
	final = value * 100 / (100 + victim defense)

	`victim` is undefined for NPCs, which have no defense stat.
	Pass canCrit = false for abilities that should never crit.
*/
export function calc_damage(
	attacker: Generic_Player,
	victim: Generic_Player | undefined,
	base: number,
	weapon_stats?: generic_weapon_stats,
	canCrit = true,
): DamageResult {
	const d = Config.Damage;
	const strength = attacker.GetStat("strength");

	let amount = (base + (weapon_stats?.damage ?? 0) * d.WeaponDamageScale) * (1 + strength / d.StrengthDivisor);

	const crit = canCrit && rolls_crit(attacker, weapon_stats);
	if (crit) {
		amount *= (attacker.GetStat("critDamage") + (weapon_stats?.cd ?? 0)) * d.CritMultiplierScale;
	}

	const defense = math.max(0, victim?.GetStat("defense") ?? 0);
	amount = (amount * 100) / (100 + defense);

	// Bad tuning data must never heal (negative) or poison Health (NaN/inf).
	if (amount !== amount || amount === math.huge || amount < 0) amount = 0;

	return { amount, crit };
}

export function deal_damage(victimHumanoid: Humanoid, amount: number) {
	if (amount > 0 && victimHumanoid.Health > 0) victimHumanoid.TakeDamage(amount);
}
