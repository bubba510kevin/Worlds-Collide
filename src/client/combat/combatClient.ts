/*
	combatClient.ts  (client)

	Input and presentation for M1 combat. The client predicts the combo so the
	punch animates instantly, but it only ever *asks*: the server decides
	whether the swing happens, what it hits and how much it hurts.

	M1 / gamepad R2 attacks (hold to keep swinging), F blocks.
*/

import { Players, RunService, UserInputService } from "@rbxts/services";
import { attackCooldown, CombatConfig, getComboAttack } from "shared/combatConfig";
import { Push } from "shared/combatUtil";
import { getRemote } from "shared/remotes";
import { heldWeaponStats } from "../state";
import * as CombatFX from "./combatFX";
import * as PunchAnimator from "./punchAnimator";

const player = Players.LocalPlayer;

const inputRemote = getRemote("CombatInput");
const effectRemote = getRemote("CombatEffect");

const COMBO_LENGTH = CombatConfig.Combo.size();
const COMBAT_ROTATION_SPEED = 18;
const COMBAT_ROTATION_TIME = 0.2;

let character: Model | undefined;
let humanoid: Humanoid | undefined;
let root: BasePart | undefined;

let state = { combo: 0, nextM1: 0, comboExpires: 0 };
let held = false;
let bufferUntil = 0;
let blocking = false;

let rotationTarget: BasePart | undefined;
let rotationUntil = 0;
// consecutive hits landed, for the combo popup
let hitStreak = 0;
let hitStreakExpires = 0;

function validCharacter(): boolean {
	return (
		character !== undefined &&
		character.Parent !== undefined &&
		humanoid !== undefined &&
		humanoid.Parent !== undefined &&
		root !== undefined &&
		root.Parent !== undefined &&
		humanoid.Health > 0
	);
}

function holdingTool() {
	return character?.FindFirstChildOfClass("Tool") !== undefined;
}

function canAct() {
	return validCharacter() && character!.GetAttribute("Stunned") !== true;
}

function setCombatRotation(target: Instance | undefined) {
	if (!validCharacter() || !target || target === character) return;
	const targetRoot = target.FindFirstChild("HumanoidRootPart");
	if (!targetRoot || !targetRoot.IsA("BasePart")) return;
	rotationTarget = targetRoot;
	rotationUntil = os.clock() + COMBAT_ROTATION_TIME;
}

function playSound(soundId: string, parent: Instance | undefined, volume = 1, playbackSpeed = 1) {
	if (soundId === "" || !parent) return;
	const sound = new Instance("Sound");
	sound.SoundId = soundId;
	sound.Volume = volume;
	sound.PlaybackSpeed = playbackSpeed;
	sound.Parent = parent;
	sound.Play();
	sound.Ended.Connect(() => sound.Destroy());
}

function tryM1(): boolean {
	if (!canAct() || holdingTool() || blocking) return false;

	const now = os.clock();
	if (now < state.nextM1) return false;
	if (now > state.comboExpires) state.combo = 0;

	state.combo = (state.combo % COMBO_LENGTH) + 1;
	const index = state.combo;
	const attack = getComboAttack(index);
	if (!attack) return false;

	state.nextM1 = now + attackCooldown(attack, heldWeaponStats()?.attack_speed);
	state.comboExpires = state.nextM1 + CombatConfig.M1.ComboWindow;

	inputRemote.FireServer("M1");
	PunchAnimator.PlayAttack(index);
	playSound(CombatConfig.Sounds.Swing, root, 0.6, 0.95 + index * 0.04);
	return true;
}

function startBlock() {
	if (blocking || !canAct() || holdingTool()) return;

	blocking = true;
	state = { combo: 0, nextM1: 0, comboExpires: 0 };
	rotationTarget = undefined;

	PunchAnimator.CancelActions();
	PunchAnimator.PlayBlock();
	inputRemote.FireServer("Block", true);
}

function stopBlock() {
	if (!blocking) return;
	blocking = false;
	PunchAnimator.StopBlock();
	inputRemote.FireServer("Block", false);
}

// ----------------------------------------------------------------------------
// server -> client effects
// ----------------------------------------------------------------------------

function onEffect(effect: unknown, a: unknown, b: unknown, c: unknown, _amount: unknown, e: unknown) {
	if (effect === "Sync") {
		if (typeIs(a, "number")) state.combo = a;
	} else if (effect === "Block") {
		if (a === true) PunchAnimator.PlayBlock();
		else PunchAnimator.StopBlock();
	} else if (effect === "Hit") {
		const attack = getComboAttack(c);
		if (!attack || !typeIs(a, "Instance") || !typeIs(b, "Instance")) return;

		if (b === character) {
			setCombatRotation(a);
			PunchAnimator.PlayHitReact(attack.Stun);
			playSound(CombatConfig.Sounds.Hit, root, 0.8, 1);
		} else if (a === character) {
			setCombatRotation(b);
			PunchAnimator.Hitstop(attack.Hitstop);
		}
	} else if (effect === "HitConfirm") {
		// (victim, position, index, amount, crit)
		const attack = getComboAttack(c);
		if (!attack) return;

		PunchAnimator.Hitstop(attack.Hitstop);
		playSound(attack.Finisher ? CombatConfig.Sounds.HitFinisher : CombatConfig.Sounds.Hit, root, 0.9, 1);

		if (typeIs(a, "Instance") && a.IsA("Model") && typeIs(b, "Vector3")) {
			CombatFX.Hit(a, b, attack.Finisher || e === true);
		}

		const now = os.clock();
		hitStreak = now <= hitStreakExpires ? hitStreak + 1 : 1;
		hitStreakExpires = now + CombatConfig.M1.ComboWindow + attack.Cooldown;
		if (hitStreak >= 2) CombatFX.ShowCombo(hitStreak);
	} else if (effect === "BlockHit") {
		playSound(CombatConfig.Sounds.Hit, root, 0.7, 0.85);
	} else if (effect === "Blocked") {
		PunchAnimator.Hitstop(0.05);
		playSound(CombatConfig.Sounds.Hit, root, 0.6, 0.8);
	} else if (effect === "Push") {
		if (root && typeIs(a, "Vector3") && typeIs(b, "number") && typeIs(c, "number")) {
			Push(root, a, b, c, 2);
		}
	} else if (effect === "Swing") {
		if (typeIs(a, "Instance") && a !== character) {
			const attackerRoot = a.FindFirstChild("HumanoidRootPart");
			if (attackerRoot) playSound(CombatConfig.Sounds.Swing, attackerRoot, 0.5, 0.95);
		}
	}
}

// ----------------------------------------------------------------------------
// setup
// ----------------------------------------------------------------------------

function setupCharacter(char: Model) {
	character = char;
	humanoid = char.WaitForChild("Humanoid") as Humanoid;
	root = char.WaitForChild("HumanoidRootPart") as BasePart;

	state = { combo: 0, nextM1: 0, comboExpires: 0 };
	held = false;
	bufferUntil = 0;
	blocking = false;
	rotationTarget = undefined;
	rotationUntil = 0;

	PunchAnimator.Setup(char);

	char.ChildAdded.Connect((child) => {
		if (child.IsA("Tool")) {
			stopBlock();
			PunchAnimator.CancelActions();
		}
	});

	char.GetAttributeChangedSignal("Stunned").Connect(() => {
		if (char.GetAttribute("Stunned") === true) {
			PunchAnimator.CancelActions();
			blocking = false;
			rotationTarget = undefined;
		}
	});
}

export function start() {
	// Turn smoothly toward whoever we just hit / got hit by.
	RunService.BindToRenderStep("CombatSmoothRotation", Enum.RenderPriority.Character.Value + 1, (dt) => {
		if (!validCharacter() || !rotationTarget || os.clock() >= rotationUntil || !rotationTarget.Parent) {
			rotationTarget = undefined;
			return;
		}
		const r = root!;
		const offset = rotationTarget.Position.sub(r.Position);
		const flat = new Vector3(offset.X, 0, offset.Z);
		if (flat.Magnitude < 0.05) return;

		const desired = CFrame.lookAt(r.Position, r.Position.add(flat.Unit));
		const alpha = 1 - math.exp(-COMBAT_ROTATION_SPEED * math.max(dt, 0));
		r.CFrame = r.CFrame.Lerp(desired, alpha);
	});

	UserInputService.InputBegan.Connect((input, processed) => {
		if (processed) return;
		if (input.UserInputType === Enum.UserInputType.MouseButton1) {
			held = true;
			tryM1();
		} else if (input.KeyCode === CombatConfig.Keys.Block) {
			startBlock();
		} else if (input.KeyCode === CombatConfig.Keys.GamepadAttack) {
			tryM1();
		}
	});

	UserInputService.InputEnded.Connect((input) => {
		if (input.UserInputType === Enum.UserInputType.MouseButton1) held = false;
		else if (input.KeyCode === CombatConfig.Keys.Block) stopBlock();
	});

	// Holding M1 keeps swinging, with a small input buffer.
	RunService.Heartbeat.Connect(() => {
		if (!held || blocking || !canAct() || os.clock() < bufferUntil) return;
		if (tryM1()) bufferUntil = os.clock() + CombatConfig.M1.InputBuffer;
	});

	effectRemote.OnClientEvent.Connect(onEffect);

	if (player.Character) task.spawn(setupCharacter, player.Character);
	player.CharacterAdded.Connect(setupCharacter);
}
