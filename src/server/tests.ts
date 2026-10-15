/*
	tests.ts  (server)

	Self-tests for the framework: forge stat sums, damage math, inventory and
	hotbar authority checks, forging validation and weapon wear.

	Runs from main.server.ts in Studio when Config.RunTestsInStudio is on. It
	touches no Instances, so it is safe in an empty place.
*/

import { Config } from "shared/config";
import { getAbility, getAllAbilities, getAllKits, getDefaultAbilities, isBindable } from "shared/abilities/registry";
import { CategoryOrder, DefaultForgeStats, EMPTY_PART, GetPart, HasPart, IsCategory } from "shared/forgeData";
import { ForgeCategory } from "shared/types";
import { Inventory } from "./inventory/inventory";
import { item, new_item_stats } from "./item/item";
import { sword } from "./item/weapon/sword";
import { usable_weapon } from "./item/weapon/weapon";
import { AbilityHolder, HeldAbilities } from "./abilities/abilityHolder";
import { StatModifiers } from "./stats/statModifiers";
import { closestPointOnSegment, closestPointsOnSegments, positionAt, reflect, rotateTowards } from "shared/projectiles/math";

const EPSILON = 0.0001;

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
	if (condition) {
		passed += 1;
	} else {
		failed += 1;
		warn(`[tests] FAIL ${name}${detail !== undefined ? ": " + detail : ""}`);
	}
}

function nearly(a: number, b: number) {
	return math.abs(a - b) < EPSILON;
}

// calc_damage needs a Generic_Player; this is the same formula with plain numbers.
function damage(base: number, strength: number, weaponDamage: number, crit: boolean, critDamage = 1, weaponCd = 0, defense = 0) {
	const d = Config.Damage;
	let amount = (base + weaponDamage * d.WeaponDamageScale) * (1 + strength / d.StrengthDivisor);
	if (crit) amount *= (critDamage + weaponCd) * d.CritMultiplierScale;
	return (amount * 100) / (100 + defense);
}

export function run(): boolean {
	passed = 0;
	failed = 0;

	// ------------------------------------------------------------------
	// sword stats from the default forge parts
	// ------------------------------------------------------------------

	const s = new sword(new_item_stats("Test Sword"), DefaultForgeStats());
	const st = s.GetWeaponStats();

	// 0.02 (blade) + 0.01 from each of the other nine parts
	check("default sword crit chance is 0.11", nearly(st.cc, 0.11), `got ${st.cc}`);
	// iron 10 + basic blade 20
	check("default sword damage is 30", nearly(st.damage, 30), `got ${st.damage}`);
	// 100 + 100 + 25 + 25 + 10 * 6
	check("default sword durability is 310", nearly(s.GetMaxDurability(), 310), `got ${s.GetMaxDurability()}`);
	check("new sword starts at full durability", nearly(s.GetDurability(), s.GetMaxDurability()));
	check("sword keeps base attack speed", nearly(st.attack_speed, 1));

	// ------------------------------------------------------------------
	// damage formula (defaults: WeaponDamageScale 0.25, StrengthDivisor 50, crit 1.5x)
	// ------------------------------------------------------------------

	// (5 + 30 * 0.25) * (1 + 50 / 50) = 12.5 * 2 = 25
	check("jab with default sword at 50 strength is 25", nearly(damage(5, 50, 30, false), 25));
	// 25 * (1 + 0) * 1.5 = 37.5
	check("crit jab is 37.5", nearly(damage(5, 50, 30, true), 37.5));
	// 5 * 1 = 5
	check("unarmed jab at 0 strength is 5", nearly(damage(5, 0, 0, false), 5));
	// 100 defense halves damage
	check("100 defense halves damage", nearly(damage(10, 0, 0, false, 1, 0, 100), 5));

	// ------------------------------------------------------------------
	// inventory and hotbar
	// ------------------------------------------------------------------

	const inv = new Inventory();
	check("AddItem accepts a sword", inv.AddItem(s));
	check("AddItem refuses the same item twice", !inv.AddItem(s));
	check("SetHotbar accepts an owned uid", inv.SetHotbar(1, s.uid));
	check("AtHotbar returns the item", inv.AtHotbar(1) === s);

	check("SetHotbar refuses an unowned uid", !inv.SetHotbar(2, "not-a-real-uid"));
	check("SetHotbar refuses slot 0", !inv.SetHotbar(0, s.uid));
	check("SetHotbar refuses slot 10", !inv.SetHotbar(10, s.uid));
	check("SetHotbar refuses a fractional slot", !inv.SetHotbar(1.5, s.uid));
	check("SetHotbar refuses NaN", !inv.SetHotbar(0 / 0, s.uid));
	check("AtHotbar is undefined for an empty slot", inv.AtHotbar(5) === undefined);
	check("AtHotbar is undefined out of range", inv.AtHotbar(99) === undefined);

	const sparse = new Inventory();
	const probe = new item(new_item_stats("probe"));
	sparse.AddItem(probe);
	sparse.SetHotbar(3, probe.uid);
	const snapshot = sparse.ToSnapshot(3);
	check("snapshot hotbar is dense", snapshot.hotbar.size() === Config.Inventory.HotbarSlots, `got ${snapshot.hotbar.size()}`);
	check("filled snapshot slot holds the uid", snapshot.hotbar[2] === probe.uid);
	check("empty snapshot slots are false", snapshot.hotbar[0] === false);

	check("RemoveItem returns the item", inv.RemoveItem(s.uid) === s);
	check("hotbar entry is gone after removal", inv.AtHotbar(1) === undefined);
	check("inventory is empty after removal", inv.Size() === 0);

	const capped = new Inventory();
	for (let i = 0; i < Config.Inventory.MaxSlots; i++) capped.AddItem(new item(new_item_stats("filler")));
	check("inventory holds MaxSlots", capped.Size() === Config.Inventory.MaxSlots);
	check("inventory refuses one more", !capped.AddItem(new item(new_item_stats("overflow"))));

	// ------------------------------------------------------------------
	// forging
	// ------------------------------------------------------------------

	const forged = new sword(new_item_stats("Forged"));
	const before = forged.GetWeaponStats().damage;
	check("SetForgePart accepts a real part", forged.SetForgePart("Materials", 2));
	check("stats changed after forging", forged.GetWeaponStats().damage !== before);
	check("SetForgePart refuses an unknown id", !forged.SetForgePart("Materials", 9999));
	check("SetForgePart refuses a negative id", !forged.SetForgePart("Blade", -1));
	check("SetForgePart refuses a fractional id", !forged.SetForgePart("Blade", 1.5));
	check("SetForgePart refuses an unknown category", !forged.SetForgePart("Nonsense" as ForgeCategory, 0));
	check("forge unchanged after a rejected id", forged.GetForgeStats().Materials === 2);

	const bad = DefaultForgeStats();
	bad.Hilt = 9999;
	check("PutForgeStats refuses a bad set", !forged.PutForgeStats(bad));
	check("PutForgeStats left the forge alone", forged.GetForgeStats().Hilt === 0);

	// ------------------------------------------------------------------
	// wear
	// ------------------------------------------------------------------

	const worn = new sword(new_item_stats("Worn"));
	check("new sword is not broken", !worn.IsBroken());
	check("one hit does not break it", !worn.ApplyWear(1));
	check("it breaks when worn out", worn.ApplyWear(worn.GetMaxDurability()));
	check("broken sword reports broken", worn.IsBroken());
	check("durability never goes negative", worn.GetDurability() >= 0);
	check("a broken sword fights like bare hands", usable_weapon(worn) === undefined);
	check("a plain item is not a weapon", usable_weapon(probe) === undefined);

	// ------------------------------------------------------------------
	// forge database
	// ------------------------------------------------------------------

	check("GetPart returns EMPTY on a miss", GetPart("Blade", 9999) === EMPTY_PART);
	check("GetPart never returns undefined", GetPart("Nonsense" as ForgeCategory, 0) !== undefined);
	check("HasPart is false for a miss", !HasPart("Blade", 9999));
	check("HasPart is true for the default", HasPart("Blade", 0));
	check("IsCategory rejects a number", !IsCategory(7));
	check("IsCategory rejects an unknown string", !IsCategory("Nonsense"));

	runAbilityTests();
	runProjectileMathTests();

	print(`[tests] ${passed} passed, ${failed} failed`);
	return failed === 0;
}

// ----------------------------------------------------------------------------
// ability system (data integrity + the pure-logic pieces)
// ----------------------------------------------------------------------------

function runAbilityTests() {
	// catalog integrity
	for (const id of getDefaultAbilities()) check(`default ability ${id} is player-bindable`, isBindable(id, "player"));
	for (const def of getAllAbilities()) {
		check(`${def.id} has a non-negative cooldown`, def.cooldown >= 0);
		check(`${def.id}: passives have no key`, def.input !== "passive" || def.defaultKey === undefined);
	}
	for (const kit of getAllKits()) {
		for (const a of kit.abilities) check(`kit ${kit.id} grants a player-bindable ability (${a})`, isBindable(a, "player"));
	}
	for (const category of CategoryOrder) {
		for (let id = 0; HasPart(category, id); id++) {
			for (const a of GetPart(category, id).abilities) {
				check(`${category} ${id} grants an item-bindable ability (${a})`, isBindable(a, "item"));
			}
		}
	}
	check("getAbility rejects unknown ids", getAbility("NotAnAbility") === undefined);
	check("getAbility rejects non-strings", getAbility(5) === undefined);

	// StatModifiers: (base + flat) * mult, by source, with expiry
	const mods = new StatModifiers<"power">();
	mods.Add({ id: "a", source: "s1", stat: "power", flat: 10 });
	mods.Add({ id: "b", source: "s2", stat: "power", mult: 2 });
	check("modifiers: (base + flat) * mult", nearly(mods.Apply("power", 5), 30));
	mods.Add({ id: "a", source: "s1", stat: "power", flat: 20 });
	check("modifiers: same id refreshes, no stacking", nearly(mods.Apply("power", 5), 50));
	mods.RemoveSource("s2");
	check("modifiers: RemoveSource", nearly(mods.Apply("power", 5), 25));
	mods.AddTimed({ id: "t", source: "s3", stat: "power", flat: 100 }, 0);
	check("modifiers: expired ones stop applying", nearly(mods.Apply("power", 5), 25));

	// AbilityHolder with a fake held item. Uses FlashStep (player-bound) for
	// grants; item-bound behaviour is checked through binding rules.
	let held: HeldAbilities | undefined;
	const holder = new AbilityHolder(() => held);
	const playerId = getDefaultAbilities()[0];
	if (playerId !== undefined) {
		check("holder: grant a player ability", holder.Grant(playerId, "innate"));
		check("holder: has it", holder.Has(playerId) && holder.SourceOf(playerId) === "innate");
		holder.Grant(playerId, "quest");
		holder.Revoke(playerId, "innate");
		check("holder: kept while another source grants it", holder.Has(playerId));
		holder.RevokeSource("quest");
		check("holder: gone when every source revoked", !holder.Has(playerId));

		holder.Grant(playerId, "buff", 0);
		check("holder: expired timed grant is gone", !holder.Has(playerId));

		held = {
			uid: "x",
			abilityVersion: 0,
			GetAbilities() {
				return [playerId];
			},
		};
		check(
			"holder: an item cannot grant a player-only ability",
			getAbility(playerId)!.binding !== "player" || !holder.Has(playerId),
		);
		held = undefined;

		check("holder: a fresh ability has a charge", holder.CanUse(playerId));
		check("holder: consume a charge", holder.ConsumeCharge(playerId, 10));
		check("holder: no charge left", !holder.CanUse(playerId));
		check("holder: recharge is running", holder.RechargeRemaining(playerId) > 9);
		holder.ReduceCooldown(playerId, 100);
		check("holder: cooldown reduction refills", holder.CanUse(playerId));

		holder.ConsumeCharge(playerId, 10, true);
		check("holder: start-on-end waits", holder.RechargeRemaining(playerId) === 0 && !holder.CanUse(playerId));
		holder.ResumeRecharge(playerId);
		check("holder: resume starts the recharge", holder.RechargeRemaining(playerId) > 9);
		holder.ResetCooldown(playerId);
		check("holder: reset refills", holder.CanUse(playerId));
	}
	check("holder: unknown ids can't be granted", !holder.Grant("NotAnAbility"));
	check("holder: unknown kits can't be added", !holder.AddKit("NotAKit"));
}

// ----------------------------------------------------------------------------
// projectile math (shared by server simulation and client drawing)
// ----------------------------------------------------------------------------

function near(a: Vector3, b: Vector3) {
	return a.sub(b).Magnitude < 1e-3;
}

function runProjectileMathTests() {
	check("straight flight", near(positionAt(Vector3.zero, new Vector3(10, 0, 0), 0, 2), new Vector3(20, 0, 0)));
	check("gravity drops 0.5*g*t^2", near(positionAt(Vector3.zero, Vector3.zero, 10, 2), new Vector3(0, -20, 0)));

	check("reflect off a floor", near(reflect(new Vector3(1, -1, 0), Vector3.yAxis), new Vector3(1, 1, 0)));

	const turned = rotateTowards(Vector3.xAxis, Vector3.zAxis, math.rad(30));
	check("rotateTowards turns by at most maxAngle", math.abs(math.deg(math.acos(turned.Dot(Vector3.xAxis))) - 30) < 0.01);
	check("rotateTowards snaps when close enough", near(rotateTowards(Vector3.xAxis, Vector3.zAxis, math.pi), Vector3.zAxis));
	const opposite = rotateTowards(Vector3.xAxis, Vector3.xAxis.mul(-1), math.rad(10));
	check("rotateTowards handles opposite vectors", math.abs(opposite.Magnitude - 1) < 1e-3);

	check(
		"closest point on segment clamps to the end",
		near(closestPointOnSegment(new Vector3(20, 5, 0), Vector3.zero, new Vector3(10, 0, 0)), new Vector3(10, 0, 0)),
	);

	// Two crossing segments meet at the origin.
	const [p, q] = closestPointsOnSegments(new Vector3(-5, 0, 0), new Vector3(5, 0, 0), new Vector3(0, -5, 0), new Vector3(0, 5, 0));
	check("crossing segments meet", near(p, Vector3.zero) && near(q, Vector3.zero));
	// Parallel segments 3 apart.
	const [p2, q2] = closestPointsOnSegments(Vector3.zero, new Vector3(10, 0, 0), new Vector3(0, 3, 0), new Vector3(10, 3, 0));
	check("parallel segments are 3 apart", math.abs(p2.sub(q2).Magnitude - 3) < 1e-3);
}
