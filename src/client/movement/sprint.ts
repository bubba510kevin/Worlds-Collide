/*
	sprint.ts  (client)

	Hold Left Shift to sprint, with the crouched running pose while moving.

	Combat owns WalkSpeed while the server has the character locked (attacking,
	stunned, blocking), and abilities like Flash Step can suppress sprint while
	they drive movement themselves. Sprint stays out of the way then and picks
	up again afterwards.
*/

import { Players, RunService, UserInputService } from "@rbxts/services";
import { startPose } from "./rigPose";

const KEY = Enum.KeyCode.LeftShift;
const SPRINT_SPEED = 25;

const player = Players.LocalPlayer;

let sprinting = false;
let normalSpeed: number | undefined;
let currentHumanoid: Humanoid | undefined;
let stopPose: (() => void) | undefined;
let loopConnection: RBXScriptConnection | undefined;
let suppressed = false;

function isCombatLocked(character: Model) {
	return (
		character.GetAttribute("MovementLocked") === true ||
		character.GetAttribute("Stunned") === true ||
		character.GetAttribute("Blocking") === true
	);
}

function endPose() {
	if (stopPose) {
		stopPose();
		stopPose = undefined;
	}
}

function stopSprint() {
	if (!sprinting) return;
	sprinting = false;

	loopConnection?.Disconnect();
	loopConnection = undefined;
	endPose();

	const character = currentHumanoid?.Parent;
	if (!suppressed && currentHumanoid && character && character.IsA("Model") && normalSpeed !== undefined && !isCombatLocked(character)) {
		currentHumanoid.WalkSpeed = normalSpeed;
	}
	normalSpeed = undefined;
	currentHumanoid = undefined;
}

function startSprint() {
	if (sprinting) return;

	const character = player.Character;
	const humanoid = character?.FindFirstChildOfClass("Humanoid");
	if (!character || !humanoid || humanoid.Health <= 0 || isCombatLocked(character)) return;

	sprinting = true;
	currentHumanoid = humanoid;
	normalSpeed = humanoid.WalkSpeed;

	loopConnection = RunService.Heartbeat.Connect(() => {
		if (!humanoid.Parent || humanoid.Health <= 0) {
			stopSprint();
			return;
		}

		if (suppressed || isCombatLocked(character)) {
			endPose();
			return;
		}

		// The server may have changed the base speed (speed stat, end of a lock).
		if (humanoid.WalkSpeed !== SPRINT_SPEED) {
			normalSpeed = humanoid.WalkSpeed;
			humanoid.WalkSpeed = SPRINT_SPEED;
		}

		const moving = humanoid.MoveDirection.Magnitude > 0.1;
		if (moving && !stopPose) stopPose = startPose(character, humanoid, "run");
		else if (!moving && stopPose) endPose();
	});
}

export function start() {
	UserInputService.InputBegan.Connect((input, processed) => {
		if (!processed && input.KeyCode === KEY) startSprint();
	});
	UserInputService.InputEnded.Connect((input) => {
		if (input.KeyCode === KEY) stopSprint();
	});
	player.CharacterRemoving.Connect(stopSprint);
}

// Pause sprint while something else (an ability) drives WalkSpeed and the rig.
export function setSuppressed(value: boolean) {
	suppressed = value;
	if (value) endPose();
}

// The character's walking speed, ignoring any sprint boost.
export function getBaseSpeed(humanoid: Humanoid): number {
	return sprinting && normalSpeed !== undefined ? normalSpeed : humanoid.WalkSpeed;
}
