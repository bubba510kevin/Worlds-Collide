/*
	api.ts  (server)  -  the `WC` table given to modules in WorldsCollide_Server

	Everything Luau content needs on the server: ability code, giving and
	taking abilities, stats, resources, items, hitting things, projectiles,
	beams and events. Ordinary Luau Scripts can use it too:

		local WC = require(game.ServerScriptService.TS.api)

	Functions that take `ctx` only work inside ability code (the `ctx` an
	ability hook receives). Functions that take `player` take a Roblox
	Player. Errors are written for humans: they say what was wrong.
*/

import { Players } from "@rbxts/services";
import { getAbility, getKit, isStatKey } from "shared/abilities/registry";
import { CombatConfig } from "shared/combatConfig";
import { ability, AbilityContext, ActiveContext } from "./abilities/ability";
import { cancelAbility, getBehaviour, registerBehaviour } from "./abilities/abilityService";
import { DamageHook, GameEvents } from "./abilities/events";
import { AbilityScript, SCRIPT_HOOKS, ScriptedAbility } from "./abilities/scriptedAbility";
import { lockMovement, setTimedAttribute, strike, StrikeOptions, StrikeResult } from "./combat/combatService";
import { Generic_Player } from "./generic_player/generic_player";
import { item, new_item_stats } from "./item/item";
import { sword } from "./item/weapon/sword";
import { getGenericPlayer, getGenericPlayerFromCharacter } from "./players";
import { Beam, BeamOptions } from "./projectiles/beam";
import { Projectile, ProjectileOptions } from "./projectiles/projectile";
import { fireBeam, fireProjectile } from "./projectiles/projectileService";

export { GetAbility, GetKit, GetResourceInfo } from "shared/api";

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function needPlayer(fnName: string, player: unknown): Generic_Player | undefined {
	if (!typeIs(player, "Instance") || !player.IsA("Player")) {
		error(`WC.${fnName}: the first argument must be a Player (got ${typeOf(player)})`, 3);
	}
	const gp = getGenericPlayer(player);
	if (!gp) warn(`WC.${fnName}: ${player.Name} isn't set up yet (called before they finished joining?)`);
	return gp;
}

function needBehaviour(fnName: string, ctx: unknown): ability {
	const id = typeIs(ctx, "table") ? (ctx as AbilityContext).def?.id : undefined;
	const impl = id !== undefined ? getBehaviour(id) : undefined;
	if (!impl) error(`WC.${fnName}: pass the "ctx" your ability hook was given`, 3);
	return impl;
}

function needActive(fnName: string, ctx: unknown): ActiveContext {
	if (!typeIs(ctx, "table") || (ctx as ActiveContext).active === undefined) {
		error(`WC.${fnName}: only works while the ability is active (OnActivate, OnTick, OnInput...)`, 3);
	}
	return ctx as ActiveContext;
}

const EVENT_NAMES = ["Hit", "Damaged", "AbilityActivated", "AbilityEnded", "AbilityGranted", "AbilityRevoked"];

function needEvent(fnName: string, name: unknown) {
	const signal = typeIs(name, "string") ? (GameEvents as unknown as Record<string, typeof GameEvents.Hit>)[name] : undefined;
	if (!signal) error(`WC.${fnName}: unknown event "${tostring(name)}". Use one of: ${EVENT_NAMES.join(", ")}`, 3);
	return signal;
}

// ----------------------------------------------------------------------------
// definitions belong in the Shared folder
// ----------------------------------------------------------------------------

function sharedOnly(fnName: string) {
	return () => error(`WC.${fnName} only works in a module inside ReplicatedStorage.WorldsCollide_Shared`, 2);
}

export const AddAbility = sharedOnly("AddAbility");
export const AddKit = sharedOnly("AddKit");
export const AddResource = sharedOnly("AddResource");
export const AddDefaultAbility = sharedOnly("AddDefaultAbility");

// ----------------------------------------------------------------------------
// ability code
// ----------------------------------------------------------------------------

/*
	Give an ability its server code: a table of hook functions.
	WC.AbilityCode("Fireball", { OnActivate = function(ctx, aim) ... end })
*/
export function AbilityCode(id: unknown, hooks: unknown) {
	const def = getAbility(id);
	if (!def) error(`WC.AbilityCode: no ability called "${tostring(id)}". Add it with WC.AddAbility in the Shared folder first`, 2);
	if (!typeIs(hooks, "table")) error(`WC.AbilityCode("${def.id}"): the second argument must be a table of functions`, 2);
	for (const [key] of pairs(hooks as object)) {
		if (!SCRIPT_HOOKS.includes(key as string)) {
			warn(`WC.AbilityCode("${def.id}"): "${tostring(key)}" isn't a hook and will never run. Hooks are: ${SCRIPT_HOOKS.join(", ")}`);
		}
	}
	registerBehaviour(new ScriptedAbility(def, hooks as AbilityScript));
}

// ----------------------------------------------------------------------------
// players and their abilities
// ----------------------------------------------------------------------------

// The framework's object for a player, for anything not covered below.
export function GetPlayer(player: unknown): Generic_Player | undefined {
	return needPlayer("GetPlayer", player);
}

// The Player behind a character model (undefined for NPCs).
export function GetPlayerFromCharacter(character: unknown): Player | undefined {
	if (!typeIs(character, "Instance") || !character.IsA("Model")) return undefined;
	return getGenericPlayerFromCharacter(character)?.GetInstance();
}

// seconds: leave out for "forever".
export function GiveAbility(player: unknown, id: unknown, source?: unknown, seconds?: unknown): boolean {
	const gp = needPlayer("GiveAbility", player);
	if (!gp) return false;
	if (!getAbility(id)) error(`WC.GiveAbility: no ability called "${tostring(id)}"`, 2);
	if (seconds !== undefined && !typeIs(seconds, "number")) error(`WC.GiveAbility: "seconds" must be a number or left out`, 2);
	const ok = gp.abilities.Grant(id as string, typeIs(source, "string") ? source : "innate", seconds);
	if (!ok) warn(`WC.GiveAbility: "${tostring(id)}" can't be given to a player (its binding is "item")`);
	return ok;
}

export function TakeAbility(player: unknown, id: unknown, source?: unknown): boolean {
	const gp = needPlayer("TakeAbility", player);
	return gp ? gp.abilities.Revoke(tostring(id), typeIs(source, "string") ? source : "innate") : false;
}

// Take back everything one source gave (e.g. "quest:dragon").
export function TakeAbilitiesFrom(player: unknown, source: unknown): number {
	const gp = needPlayer("TakeAbilitiesFrom", player);
	return gp ? gp.abilities.RevokeSource(tostring(source)) : 0;
}

export function HasAbility(player: unknown, id: unknown): boolean {
	const gp = needPlayer("HasAbility", player);
	return gp ? gp.abilities.Has(tostring(id)) : false;
}

export function GiveKit(player: unknown, kitId: unknown): boolean {
	const gp = needPlayer("GiveKit", player);
	if (!gp) return false;
	if (!getKit(kitId)) error(`WC.GiveKit: no kit called "${tostring(kitId)}"`, 2);
	return gp.abilities.AddKit(kitId as string);
}

export function TakeKit(player: unknown, kitId: unknown): boolean {
	const gp = needPlayer("TakeKit", player);
	return gp ? gp.abilities.RemoveKit(tostring(kitId)) : false;
}

export function ResetCooldown(player: unknown, id: unknown) {
	needPlayer("ResetCooldown", player)?.abilities.ResetCooldown(tostring(id));
}

// Stop an ability that is running right now.
export function CancelAbility(player: unknown, id: unknown) {
	const gp = needPlayer("CancelAbility", player);
	if (gp) cancelAbility(gp, tostring(id));
}

// ----------------------------------------------------------------------------
// stats and resources
// ----------------------------------------------------------------------------

/*
	WC.AddStatBonus(player, { id = "potion", stat = "strength", flat = 10, seconds = 30 })
	source defaults to the id. Same id + source replaces instead of stacking.
*/
export function AddStatBonus(player: unknown, bonus: unknown) {
	const gp = needPlayer("AddStatBonus", player);
	if (!gp) return;
	const b = bonus as { id?: unknown; source?: unknown; stat?: unknown; flat?: unknown; mult?: unknown; seconds?: unknown };
	if (!typeIs(bonus, "table") || !typeIs(b.id, "string")) error(`WC.AddStatBonus: needs a table with an "id"`, 2);
	if (!isStatKey(b.stat)) error(`WC.AddStatBonus: "stat" must be health, defense, energy, speed, strength, critChance or critDamage`, 2);
	const mod = {
		id: b.id,
		source: typeIs(b.source, "string") ? b.source : b.id,
		stat: b.stat,
		flat: typeIs(b.flat, "number") ? b.flat : undefined,
		mult: typeIs(b.mult, "number") ? b.mult : undefined,
	};
	if (typeIs(b.seconds, "number")) gp.modifiers.AddTimed(mod, b.seconds);
	else gp.modifiers.Add(mod);
}

export function RemoveStatBonuses(player: unknown, source: unknown) {
	needPlayer("RemoveStatBonuses", player)?.modifiers.RemoveSource(tostring(source));
}

// The stat after every bonus.
export function GetStat(player: unknown, stat: unknown): number {
	if (!isStatKey(stat)) error(`WC.GetStat: unknown stat "${tostring(stat)}"`, 2);
	return needPlayer("GetStat", player)?.GetStat(stat) ?? 0;
}

export function GetResource(player: unknown, id: unknown): number {
	return needPlayer("GetResource", player)?.resources.Get(tostring(id)) ?? 0;
}

// Negative amounts take away.
export function GiveResource(player: unknown, id: unknown, amount: unknown) {
	if (!typeIs(amount, "number")) error(`WC.GiveResource: "amount" must be a number`, 2);
	needPlayer("GiveResource", player)?.resources.Add(tostring(id), amount);
}

// ----------------------------------------------------------------------------
// items
// ----------------------------------------------------------------------------

export function CreateItem(name: unknown): item {
	if (!typeIs(name, "string")) error(`WC.CreateItem: give it a name, like WC.CreateItem("Rock")`, 2);
	return new item(new_item_stats(name));
}

export function CreateSword(name: unknown): sword {
	if (!typeIs(name, "string")) error(`WC.CreateSword: give it a name, like WC.CreateSword("Zangetsu")`, 2);
	return new sword(new_item_stats(name));
}

// Put an item in their inventory, and on a hotbar slot (1-9) if given.
export function GiveItem(player: unknown, thing: unknown, hotbarSlot?: unknown): boolean {
	const gp = needPlayer("GiveItem", player);
	if (!gp) return false;
	if (!(thing instanceof item)) error(`WC.GiveItem: the second argument must come from WC.CreateItem or WC.CreateSword`, 2);
	const inv = gp.GetInventory();
	if (!inv.AddItem(thing)) {
		warn(`WC.GiveItem: couldn't add it (inventory full, or they already have that exact item)`);
		return false;
	}
	if (typeIs(hotbarSlot, "number")) inv.SetHotbar(hotbarSlot, thing.uid);
	gp.MarkDirty();
	return true;
}

// ----------------------------------------------------------------------------
// hitting things
// ----------------------------------------------------------------------------

// Hit someone from inside an ability: WC.Strike(ctx, victim, { base = 10, stun = 0.3 })
export function Strike(ctx: unknown, victim: unknown, opts: unknown): StrikeResult | undefined {
	const impl = needBehaviour("Strike", ctx);
	if (!typeIs(victim, "Instance") || !victim.IsA("Model")) error(`WC.Strike: the victim must be a character Model`, 2);
	return impl.strike(ctx as AbilityContext, victim, opts as StrikeOptions);
}

// Hit someone from anywhere (a trap, a quest script): attacker is a Player.
export function Hit(attacker: unknown, victim: unknown, opts: unknown): StrikeResult | undefined {
	const gp = needPlayer("Hit", attacker);
	if (!gp) return undefined;
	if (!typeIs(victim, "Instance") || !victim.IsA("Model")) error(`WC.Hit: the victim must be a character Model`, 2);
	return strike(gp, victim, opts as StrikeOptions);
}

export function Stun(character: unknown, seconds: unknown) {
	if (!typeIs(character, "Instance") || !character.IsA("Model") || !typeIs(seconds, "number")) {
		error(`WC.Stun: use WC.Stun(characterModel, seconds)`, 2);
	}
	setTimedAttribute(character, "Stunned", seconds);
	const humanoid = character.FindFirstChildOfClass("Humanoid");
	if (humanoid) lockMovement(humanoid, CombatConfig.HitWalkSpeed, seconds);
}

export function MakeInvulnerable(character: unknown, seconds: unknown) {
	if (!typeIs(character, "Instance") || !character.IsA("Model") || !typeIs(seconds, "number")) {
		error(`WC.MakeInvulnerable: use WC.MakeInvulnerable(characterModel, seconds)`, 2);
	}
	setTimedAttribute(character, "IFrames", seconds);
}

// ----------------------------------------------------------------------------
// projectiles and beams
// ----------------------------------------------------------------------------

export function FireProjectile(ctx: unknown, opts: unknown): Projectile {
	return needBehaviour("FireProjectile", ctx).fireProjectile(ctx as AbilityContext, opts as ProjectileOptions);
}

export function FireBeam(ctx: unknown, opts: unknown): Beam {
	return needBehaviour("FireBeam", ctx).fireBeam(ctx as AbilityContext, opts as BeamOptions);
}

// A beam that stops when the ability stops.
export function FireBeamWhileActive(ctx: unknown, opts: unknown): Beam {
	const impl = needBehaviour("FireBeamWhileActive", ctx);
	return impl.fireBeamWhileActive(needActive("FireBeamWhileActive", ctx), opts as BeamOptions);
}

// Fire from anywhere, owned by a Player.
export function ShootProjectile(player: unknown, opts: unknown): Projectile | undefined {
	const gp = needPlayer("ShootProjectile", player);
	return gp ? fireProjectile(gp, opts as ProjectileOptions) : undefined;
}

export function ShootBeam(player: unknown, opts: unknown): Beam | undefined {
	const gp = needPlayer("ShootBeam", player);
	return gp ? fireBeam(gp, opts as BeamOptions) : undefined;
}

// ----------------------------------------------------------------------------
// events, damage hooks, effects
// ----------------------------------------------------------------------------

// The raw event objects: WC.Events.Hit:Connect(function(attacker, victim, result) end)
export const Events = GameEvents;

// Listen while the ability is owned. Event names: see EVENT_NAMES.
export function Listen(ctx: unknown, eventName: unknown, fn: unknown) {
	const impl = needBehaviour("Listen", ctx);
	const signal = needEvent("Listen", eventName);
	if (!typeIs(fn, "function")) error(`WC.Listen: the third argument must be a function`, 2);
	impl.listen(ctx as AbilityContext, signal, fn as never);
}

// Listen only while the ability is active.
export function ListenWhileActive(ctx: unknown, eventName: unknown, fn: unknown) {
	const impl = needBehaviour("ListenWhileActive", ctx);
	const signal = needEvent("ListenWhileActive", eventName);
	if (!typeIs(fn, "function")) error(`WC.ListenWhileActive: the third argument must be a function`, 2);
	impl.listenWhileActive(needActive("ListenWhileActive", ctx), signal, fn as never);
}

// Change damage the caster deals ("outgoing") or takes ("incoming"). fn(info) returns the new amount.
export function AddDamageHook(ctx: unknown, direction: unknown, fn: unknown) {
	const impl = needBehaviour("AddDamageHook", ctx);
	if (direction !== "incoming" && direction !== "outgoing") error(`WC.AddDamageHook: direction must be "incoming" or "outgoing"`, 2);
	if (!typeIs(fn, "function")) error(`WC.AddDamageHook: the third argument must be a function`, 2);
	impl.addDamageHook(ctx as AbilityContext, direction, fn as DamageHook);
}

export function AddDamageHookWhileActive(ctx: unknown, direction: unknown, fn: unknown) {
	const impl = needBehaviour("AddDamageHookWhileActive", ctx);
	if (direction !== "incoming" && direction !== "outgoing") error(`WC.AddDamageHookWhileActive: direction must be "incoming" or "outgoing"`, 2);
	if (!typeIs(fn, "function")) error(`WC.AddDamageHookWhileActive: the third argument must be a function`, 2);
	impl.addDamageHookWhileActive(needActive("AddDamageHookWhileActive", ctx), direction, fn as DamageHook);
}

// Show an effect on every nearby screen: runs the ability's client Effect(character, ...).
export function Broadcast(ctx: unknown, position: unknown, ...args: unknown[]) {
	const impl = needBehaviour("Broadcast", ctx);
	if (!typeIs(position, "Vector3")) error(`WC.Broadcast: the second argument must be a position (Vector3)`, 2);
	impl.broadcast(needActive("Broadcast", ctx), position, ...args);
}

// Show an effect only on the caster's screen.
export function Tell(ctx: unknown, ...args: unknown[]) {
	needBehaviour("Tell", ctx).tell(ctx as AbilityContext, ...args);
}

// Hit sparkles on the caster's screen.
export function ConfirmHit(ctx: unknown, victim: unknown, position: unknown, crit?: unknown) {
	if (!typeIs(victim, "Instance") || !victim.IsA("Model") || !typeIs(position, "Vector3")) {
		error(`WC.ConfirmHit: use WC.ConfirmHit(ctx, victimModel, position, crit)`, 2);
	}
	needBehaviour("ConfirmHit", ctx).confirmHit(ctx as AbilityContext, victim, position, crit === true);
}

// Every player in the game right now.
export function GetAllPlayers(): Player[] {
	return Players.GetPlayers().filter((p) => getGenericPlayer(p) !== undefined);
}
