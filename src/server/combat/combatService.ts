/*
	combatService.ts  (server)

	Server-authoritative M1 combat, built on the framework:

		- the client sends only "M1" / "Block"; timing, hitboxes and damage are
		  all decided here
		- swing speed and reach come from the held weapon's stats
		- damage goes through calc_damage (strength, crits, defense)
		- every landed hit wears the held weapon down

	Also handles combo tracking, hitstun, movement locks, finisher knockback,
	i-frames, frontal blocking, and broadcasting cosmetic effects to nearby
	clients. No combat while holding a Roblox Tool.
*/

import { Debris, Players, RunService, Workspace } from "@rbxts/services";
import { attackCooldown, ComboAttack, CombatConfig, getComboAttack } from "shared/combatConfig";
import { GetCharacterFromPart, GetHumanoidAndRoot, Push } from "shared/combatUtil";
import { effectPart } from "shared/effects";
import { getRemote } from "shared/remotes";
import { Generic_Player } from "../generic_player/generic_player";
import { DamageInfo, GameEvents } from "../abilities/events";
import type { weapon } from "../item/weapon/weapon";
import { onRemote } from "../network/remoteHandler";
import { getGenericPlayerFromCharacter } from "../players";
import { calc_damage, calc_hit, deal_damage, HitData } from "./CalcHit";

const effectRemote = getRemote("CombatEffect");

const COMBO_LENGTH = CombatConfig.Combo.size();

// ----------------------------------------------------------------------------
// per-player combat state
// ----------------------------------------------------------------------------

interface CombatState {
	combo: number; // 1-based index of the last attack, 0 = none
	nextM1: number;
	comboExpires: number;
	swingId: number; // bumping this cancels any swing in progress
	blocking: boolean;
}

const states = new Map<Player, CombatState>();

function getState(player: Player): CombatState {
	let state = states.get(player);
	if (!state) {
		state = { combo: 0, nextM1: 0, comboExpires: 0, swingId: 0, blocking: false };
		states.set(player, state);
	}
	return state;
}

function resetCombo(state: CombatState) {
	state.swingId += 1;
	state.combo = 0;
	state.comboExpires = 0;
	state.nextM1 = 0;
}

// ----------------------------------------------------------------------------
// movement
// ----------------------------------------------------------------------------

interface Movement {
	WalkSpeed: number;
	JumpPower: number;
	JumpHeight: number;
	AutoRotate: boolean;
}

const normalMovement = new WeakMap<Humanoid, Movement>();

function saveNormalMovement(humanoid: Humanoid) {
	normalMovement.set(humanoid, {
		WalkSpeed: humanoid.WalkSpeed,
		JumpPower: humanoid.JumpPower,
		JumpHeight: humanoid.JumpHeight,
		AutoRotate: humanoid.AutoRotate,
	});
}

function setLockedMovement(humanoid: Humanoid, speed: number, autoRotate: boolean) {
	humanoid.WalkSpeed = speed;
	humanoid.JumpPower = 0;
	humanoid.JumpHeight = 0;
	humanoid.SetStateEnabled(Enum.HumanoidStateType.Jumping, false);
	humanoid.AutoRotate = autoRotate;
}

function restoreNormalMovement(humanoid: Humanoid) {
	if (!humanoid.Parent || humanoid.Health <= 0) return;
	const normal = normalMovement.get(humanoid);
	if (!normal) return;

	// A player's normal speed is their speed stat, which may have changed
	// since the snapshot was taken.
	const character = humanoid.Parent;
	const gp = character.IsA("Model") ? getGenericPlayerFromCharacter(character) : undefined;

	humanoid.WalkSpeed = gp ? gp.GetStat("speed") : normal.WalkSpeed;
	humanoid.JumpPower = normal.JumpPower;
	humanoid.JumpHeight = normal.JumpHeight;
	humanoid.AutoRotate = normal.AutoRotate;
	humanoid.SetStateEnabled(Enum.HumanoidStateType.Jumping, true);
}

// humanoid -> os.clock() its movement lock ends
const movementLocks = new WeakMap<Humanoid, number>();

function isMovementLocked(humanoid: Humanoid): boolean {
	return (movementLocks.get(humanoid) ?? 0) > os.clock();
}

/*
	Slow `humanoid` to `speed` for `duration` seconds. Overlapping locks extend
	each other; the humanoid is only released when the last one ends. The
	character's MovementLocked attribute tells the client (e.g. sprint) to keep
	its hands off WalkSpeed meanwhile.
*/
function lockMovement(humanoid: Humanoid, speed: number, duration: number) {
	if (humanoid.Health <= 0) return;
	if (!normalMovement.has(humanoid)) saveNormalMovement(humanoid);

	const expected = math.max(movementLocks.get(humanoid) ?? 0, os.clock() + duration);
	movementLocks.set(humanoid, expected);

	setLockedMovement(humanoid, speed, false);
	humanoid.Parent?.SetAttribute("MovementLocked", true);

	task.delay(math.max(0, expected - os.clock()), () => {
		// A later lock extended it; that one's timer releases it.
		if (movementLocks.get(humanoid) !== expected) return;
		movementLocks.delete(humanoid);

		const character = humanoid.Parent;
		if (!character || humanoid.Health <= 0) return;
		character.SetAttribute("MovementLocked", false);

		if (character.GetAttribute("Blocking") === true) {
			setLockedMovement(humanoid, CombatConfig.BlockWalkSpeed, true);
			return;
		}
		restoreNormalMovement(humanoid);
	});
}

// ----------------------------------------------------------------------------
// timed attributes (Stunned, IFrames)
// ----------------------------------------------------------------------------

const timedAttributes = new WeakMap<Instance, Map<string, number>>();

function setTimedAttribute(instance: Instance, name: string, duration: number) {
	let record = timedAttributes.get(instance);
	if (!record) {
		record = new Map();
		timedAttributes.set(instance, record);
	}

	const untilTime = os.clock() + duration;
	const current = record.get(name);
	if (current !== undefined && current >= untilTime) return;

	record.set(name, untilTime);
	instance.SetAttribute(name, true);

	const thisRecord = record;
	task.delay(duration, () => {
		if (thisRecord.get(name) === untilTime) {
			thisRecord.delete(name);
			instance.SetAttribute(name, false);
		}
	});
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function isHoldingTool(character: Model | undefined): boolean {
	return character?.FindFirstChildOfClass("Tool") !== undefined;
}

// Cosmetic effect to every player within ReplicationRadius of `origin`.
function broadcast(origin: Vector3, except: Player | undefined, ...args: unknown[]) {
	for (const player of Players.GetPlayers()) {
		if (player === except) continue;
		const root = player.Character?.FindFirstChild("HumanoidRootPart");
		if (root && root.IsA("BasePart") && root.Position.sub(origin).Magnitude <= CombatConfig.ReplicationRadius) {
			effectRemote.FireClient(player, ...args);
		}
	}
}

const rayParams = new RaycastParams();
rayParams.FilterType = Enum.RaycastFilterType.Exclude;
rayParams.RespectCanCollide = true;

// True when no solid geometry sits between attacker and victim.
function hasLineOfSight(attackerRoot: BasePart, victimRoot: BasePart, attackerChar: Model, victimChar: Model) {
	rayParams.FilterDescendantsInstances = [attackerChar, victimChar];
	const origin = attackerRoot.Position;
	const result = Workspace.Raycast(origin, victimRoot.Position.sub(origin), rayParams);
	if (!result) return true;
	// Another character in the way is not cover.
	return GetCharacterFromPart(result.Instance) !== undefined;
}

function showHitbox(boxCFrame: CFrame, boxSize: Vector3) {
	const part = effectPart();
	part.Color = Color3.fromRGB(255, 60, 60);
	part.Transparency = 0.7;
	part.Size = boxSize;
	part.CFrame = boxCFrame;
	part.Parent = Workspace;
	Debris.AddItem(part, 0.1);
}

function applyPush(victimPlayer: Player | undefined, victimRoot: BasePart, direction: Vector3, distance: number, duration: number) {
	if (victimPlayer) {
		// The victim's client owns its character's physics, so it moves itself.
		effectRemote.FireClient(victimPlayer, "Push", direction, distance, duration);
	} else {
		pcall(() => victimRoot.SetNetworkOwner(undefined));
		Push(victimRoot, direction, distance, duration, 2);
	}
}

// Fraction of the hit stopped by a frontal block (0 = not blocked).
// `from` is where the hit comes from: the attacker, or a projectile.
function blockedFraction(from: Vector3, victimRoot: BasePart, victim: Model): number {
	if (victim.GetAttribute("Blocking") !== true) return 0;

	const victimGp = getGenericPlayerFromCharacter(victim);
	const fraction = math.clamp(victimGp?.HeldWeapon()?.block() ?? 1, 0, 1);

	const toAttacker = from.sub(victimRoot.Position);
	let flatDirection = new Vector3(toAttacker.X, 0, toAttacker.Z);
	if (flatDirection.Magnitude < 0.01) return fraction;
	flatDirection = flatDirection.Unit;

	const look = victimRoot.CFrame.LookVector;
	let flatLook = new Vector3(look.X, 0, look.Z);
	if (flatLook.Magnitude < 0.01) return 0;
	flatLook = flatLook.Unit;

	return flatLook.Dot(flatDirection) >= CombatConfig.BlockFrontDot ? fraction : 0;
}

// ----------------------------------------------------------------------------
// block
// ----------------------------------------------------------------------------

function stopBlocking(player: Player) {
	const state = states.get(player);
	if (!state) return;

	state.blocking = false;
	const character = player.Character;
	character?.SetAttribute("Blocking", false);

	const humanoid = character?.FindFirstChildOfClass("Humanoid");
	if (humanoid && humanoid.Parent) {
		if (isMovementLocked(humanoid)) {
			setLockedMovement(humanoid, CombatConfig.AttackWalkSpeed, false);
		} else {
			restoreNormalMovement(humanoid);
		}
	}

	effectRemote.FireClient(player, "Block", false);
}

function startBlocking(player: Player) {
	const character = player.Character;
	const [humanoid] = GetHumanoidAndRoot(character);
	if (!character || !humanoid) return;
	if (character.GetAttribute("Stunned") === true || isHoldingTool(character)) return;

	const state = getState(player);
	if (state.blocking) return;

	resetCombo(state);
	state.blocking = true;

	if (!normalMovement.has(humanoid)) saveNormalMovement(humanoid);
	character.SetAttribute("Blocking", true);
	setLockedMovement(humanoid, CombatConfig.BlockWalkSpeed, true);

	effectRemote.FireClient(player, "Block", true);
}

// ----------------------------------------------------------------------------
// hits
// ----------------------------------------------------------------------------

export interface StrikeOptions {
	base: number; // base damage, before weapon / strength / crit / defense
	weapon?: weapon; // adds its stats to the damage and takes wear
	canCrit?: boolean; // default true
	stun: number; // seconds; 0 for none
	knockback?: { direction: Vector3; distance: number; duration: number };
	wallCheck?: boolean; // default CombatConfig.WallCheck
	// Labels damage hooks and event listeners can read, e.g. ["melee"], ["ability", "FlashStep"].
	tags?: readonly string[];
	/*
		Where the hit comes from, for blocking direction. Defaults to the
		attacker's position. Projectiles pass their own position, which also
		lets a hit land after the attacker has died or moved away.
	*/
	fromPosition?: Vector3;
	// Can't be blocked (grabs, throws).
	ignoreBlock?: boolean;
}

export interface StrikeResult {
	amount: number;
	crit: boolean;
	blocked: boolean; // fully blocked: no damage, no stun
	victimRoot: BasePart;
}

// Whether `victim` can be hit at all right now: alive, not invulnerable, PvP rules.
export function canBeHit(victim: Model): boolean {
	const [humanoid, root] = GetHumanoidAndRoot(victim);
	if (!humanoid || !root || victim.GetAttribute("IFrames") === true) return false;
	return CombatConfig.PvP || Players.GetPlayerFromCharacter(victim) === undefined;
}

/*
	Stun a character for `seconds`: the Stunned attribute, a movement lock,
	and for players a dropped combo and block. The block is dropped before the
	lock so its walk speed can't override the stun.
*/
export function applyStun(character: Model, seconds: number) {
	if (seconds <= 0) return;
	const player = Players.GetPlayerFromCharacter(character);
	if (player) {
		const state = getState(player);
		resetCombo(state);
		if (state.blocking) stopBlocking(player);
	}
	setTimedAttribute(character, "Stunned", seconds);
	const humanoid = character.FindFirstChildOfClass("Humanoid");
	if (humanoid) lockMovement(humanoid, CombatConfig.HitWalkSpeed, seconds);
}

/*
	Land one hit from `attacker` on `victim`. Everything that hurts someone -
	M1s and abilities alike - goes through here, so i-frames, PvP, walls,
	blocking, defense, stun and weapon wear behave the same everywhere.

	Order: checks -> block -> calc_damage -> attacker's outgoing damage hooks
	-> victim's incoming damage hooks -> damage, wear, stun, knockback ->
	GameEvents.Hit / GameEvents.Damaged.

	Returns undefined when the hit could not connect at all (dead, i-frames,
	behind a wall, ...), or a result, which may be a full block.
*/
export function strike(attacker: Generic_Player, victim: Model, opts: StrikeOptions): StrikeResult | undefined {
	const attackerChar = attacker.GetCharacter();
	const rootInstance = attackerChar?.FindFirstChild("HumanoidRootPart");
	const attackerRoot = rootInstance && rootInstance.IsA("BasePart") ? rootInstance : undefined;
	if (victim === attackerChar) return undefined;
	const from = opts.fromPosition ?? attackerRoot?.Position;
	if (!from) return undefined;

	if (!canBeHit(victim)) return undefined;
	const [victimHumanoid, victimRoot] = GetHumanoidAndRoot(victim);
	if (!victimHumanoid || !victimRoot) return undefined;

	if (opts.wallCheck ?? CombatConfig.WallCheck) {
		if (!attackerChar || !attackerRoot || !hasLineOfSight(attackerRoot, victimRoot, attackerChar, victim)) return undefined;
	}

	const attackerPlayer = attacker.GetInstance();
	const victimPlayer = Players.GetPlayerFromCharacter(victim);
	const victimGp = getGenericPlayerFromCharacter(victim);
	const tags = opts.tags ?? [];

	const blocked = opts.ignoreBlock ? 0 : blockedFraction(from, victimRoot, victim);
	if (blocked >= 1) {
		if (victimPlayer) effectRemote.FireClient(victimPlayer, "BlockHit", attackerChar, victimRoot.Position);
		effectRemote.FireClient(attackerPlayer, "Blocked", victim, victimRoot.Position);
		const blockedResult = { amount: 0, crit: false, blocked: true, victimRoot };
		GameEvents.Hit.Fire(attacker, victim, blockedResult);
		return blockedResult;
	}

	const result = calc_damage(attacker, victimGp, opts.base, opts.weapon?.GetWeaponStats(), opts.canCrit ?? true);
	let amount = result.amount * (1 - blocked);

	const runHooks = (hooks: ReadonlySet<(info: DamageInfo) => number>) => {
		for (const hook of hooks) {
			const [ok, value] = pcall(hook, { attacker, victim, victimPlayer: victimGp, amount, crit: result.crit, tags });
			if (ok && typeIs(value, "number") && value === value) amount = math.max(0, value);
			else if (!ok) warn(`[combat] damage hook errored: ${value}`);
		}
	};
	runHooks(attacker.outgoingDamage);
	if (victimGp) runHooks(victimGp.incomingDamage);

	deal_damage(victimHumanoid, amount);

	if (opts.weapon) {
		opts.weapon.ApplyWear();
		attacker.MarkDirty();
	}

	// A partially blocked hit still hurts, but does not stun or knock back.
	if (blocked <= 0) {
		applyStun(victim, opts.stun);

		const kb = opts.knockback;
		if (kb && kb.distance > 0) {
			const flat = new Vector3(kb.direction.X, 0, kb.direction.Z);
			if (flat.Magnitude > 0.01) applyPush(victimPlayer, victimRoot, flat.Unit, kb.distance, kb.duration);
		}
	}

	const hit = { amount, crit: result.crit, blocked: false, victimRoot };
	GameEvents.Hit.Fire(attacker, victim, hit);
	if (victimGp && amount > 0) GameEvents.Damaged.Fire(victimGp, amount, attacker);
	return hit;
}

function applyHit(attacker: Generic_Player, attackerChar: Model, attackerRoot: BasePart, victim: Model, attack: ComboAttack, index: number): boolean {
	const look = attackerRoot.CFrame.LookVector;
	const result = strike(attacker, victim, {
		base: attack.Damage,
		weapon: attacker.HeldWeapon(),
		stun: attack.Stun,
		tags: ["melee", "m1"],
		knockback: attack.Finisher
			? {
					direction: look,
					distance: attack.KnockbackDistance * CombatConfig.KnockbackMultiplier,
					duration: attack.KnockbackDuration,
				}
			: undefined,
	});
	if (!result || result.blocked) return false;

	const position = result.victimRoot.Position;
	effectRemote.FireClient(attacker.GetInstance(), "HitConfirm", victim, position, index, result.amount, result.crit);
	broadcast(position, undefined, "Hit", attackerChar, victim, index);
	return true;
}

function runSwing(attacker: Generic_Player, character: Model, humanoid: Humanoid, attack: ComboAttack, index: number, swingId: number) {
	const player = attacker.GetInstance();
	const state = getState(player);

	task.wait(math.max(0, attack.Startup - CombatConfig.M1.HitboxLeadTime));

	const alreadyHit = new Set<Model>();
	const endTime = os.clock() + attack.Active + CombatConfig.M1.HitboxLeadTime;

	do {
		if (
			state.swingId !== swingId ||
			humanoid.Health <= 0 ||
			!character.Parent ||
			character.GetAttribute("Stunned") === true ||
			character.GetAttribute("Blocking") === true ||
			isHoldingTool(character)
		) {
			break;
		}

		const [, root] = GetHumanoidAndRoot(character);
		if (!root) break;

		const hitda: HitData = {
			hitbox_x: attack.Width,
			hitbox_y: attack.Height,
			hitbox_z: attack.Range,
		};
		// A held weapon shapes the hitbox (its range stretches it); bare hands use it as-is.
		const held = attacker.HeldWeapon();
		const { targets, boxCFrame, boxSize } = held ? held.hit(attacker, hitda) : calc_hit(attacker, hitda);
		if (CombatConfig.Debug) showHitbox(boxCFrame, boxSize);

		for (const model of targets) {
			if (!alreadyHit.has(model) && applyHit(attacker, character, root, model, attack, index)) {
				alreadyHit.add(model);
			}
		}

		RunService.Heartbeat.Wait();
	} while (os.clock() < endTime);
}

function handleM1(attacker: Generic_Player) {
	const player = attacker.GetInstance();
	const character = player.Character;
	const [humanoid, root] = GetHumanoidAndRoot(character);
	if (!character || !humanoid || !root) return;
	if (character.GetAttribute("Stunned") === true || character.GetAttribute("Blocking") === true) return;
	if (isHoldingTool(character)) return;

	const state = getState(player);
	const now = os.clock();
	const tolerance = CombatConfig.M1.LatencyTolerance;

	// Early clicks are ordinary under latency; ignore them rather than reject.
	if (now < state.nextM1 - tolerance) return;
	if (now > state.comboExpires + tolerance) state.combo = 0;

	state.combo = (state.combo % COMBO_LENGTH) + 1;
	const index = state.combo;
	const attack = getComboAttack(index)!;

	state.swingId += 1;
	const swingId = state.swingId;

	const cooldown = attackCooldown(attack, attacker.HeldWeapon()?.GetWeaponStats().attack_speed);
	state.nextM1 = math.max(now, state.nextM1) + cooldown;
	state.comboExpires = state.nextM1 + CombatConfig.M1.ComboWindow;

	lockMovement(humanoid, CombatConfig.AttackWalkSpeed, cooldown);

	broadcast(root.Position, player, "Swing", character, index);
	effectRemote.FireClient(player, "Sync", index);

	task.spawn(runSwing, attacker, character, humanoid, attack, index, swingId);
}

// ----------------------------------------------------------------------------
// lifecycle
// ----------------------------------------------------------------------------

function watchPlayer(player: Player) {
	const hook = (character: Model) => {
		states.delete(player);
		character.SetAttribute("Blocking", false);
		character.SetAttribute("Stunned", false);
		character.SetAttribute("IFrames", false);
		character.SetAttribute("MovementLocked", false);

		const humanoid = character.WaitForChild("Humanoid", 10);
		if (humanoid && humanoid.IsA("Humanoid")) {
			saveNormalMovement(humanoid);
			humanoid.SetStateEnabled(Enum.HumanoidStateType.Jumping, true);
		}

		// Equipping a Tool cancels the swing and drops the block.
		character.ChildAdded.Connect((child) => {
			if (!child.IsA("Tool")) return;
			const state = states.get(player);
			if (!state) return;
			state.swingId += 1;
			if (state.blocking) stopBlocking(player);
		});
	};

	player.CharacterAdded.Connect(hook);
	if (player.Character) task.spawn(hook, player.Character);
}

export function start() {
	Players.PlayerAdded.Connect(watchPlayer);
	for (const player of Players.GetPlayers()) watchPlayer(player);
	Players.PlayerRemoving.Connect((player) => states.delete(player));

	// CombatInput("M1") | CombatInput("Block", boolean)
	onRemote("CombatInput", (gp, action, argument) => {
		if (action === "M1") {
			handleM1(gp);
		} else if (action === "Block") {
			if (argument === true) startBlocking(gp.GetInstance());
			else if (argument === false) stopBlocking(gp.GetInstance());
		}
	});
}

// Exposed so abilities can respect the same rules.
export { broadcast, isHoldingTool, lockMovement, setTimedAttribute };
