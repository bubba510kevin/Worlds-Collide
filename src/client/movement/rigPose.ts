/*
	rigPose.ts  (client)

	Procedural full-body poses applied by offsetting Motor6D.C0, for R6 and
	R15. Used by sprint (the crouched run) and Flash Step (the run and the
	grab-and-slam).

	startPose() disables the default Animate script while the pose runs and
	returns a function that stops it and puts every joint back.
*/

import { RunService } from "@rbxts/services";

export type PoseMode = "run" | "grab";

type SetJoint = (name: string, offset: CFrame) => void;

// run pose tuning
const CROUCH = 0.9;
const BODY_LEAN = 40;
const WAIST_LEAN = 15;
const ARM_BACK = 55;
const LEG_SWING = 55;
const KNEE_BASE = 35;
const KNEE_BEND = 50;
const LEG_SPEED = 22;

const R15_JOINTS = [
	"RootJoint",
	"Waist",
	"Neck",
	"RightShoulder",
	"LeftShoulder",
	"RightElbow",
	"LeftElbow",
	"RightHip",
	"LeftHip",
	"RightKnee",
	"LeftKnee",
];

const R6_JOINTS = ["RootJoint", "Neck", "Right Shoulder", "Left Shoulder", "Right Hip", "Left Hip"];

const rad = math.rad;

function runR15(setJoint: SetJoint, e: number) {
	const t = e * LEG_SPEED;
	const rightSwing = math.sin(t);
	const leftSwing = math.sin(t + math.pi);
	const rightRecover = math.max(0, math.cos(t));
	const leftRecover = math.max(0, math.cos(t + math.pi));

	setJoint("RootJoint", new CFrame(0, -CROUCH, 0).mul(CFrame.Angles(-rad(BODY_LEAN), 0, 0)));
	setJoint("Waist", CFrame.Angles(-rad(WAIST_LEAN), 0, 0));
	setJoint("Neck", CFrame.Angles(rad((BODY_LEAN + WAIST_LEAN) * 0.8), 0, 0));

	setJoint("RightShoulder", CFrame.Angles(-rad(ARM_BACK) + rad(6) * rightSwing, 0, 0));
	setJoint("LeftShoulder", CFrame.Angles(-rad(ARM_BACK) + rad(6) * leftSwing, 0, 0));
	setJoint("RightElbow", CFrame.Angles(rad(15), 0, 0));
	setJoint("LeftElbow", CFrame.Angles(rad(15), 0, 0));

	const hipBase = rad(BODY_LEAN * 0.8);
	setJoint("RightHip", CFrame.Angles(hipBase + rad(LEG_SWING) * rightSwing, 0, 0));
	setJoint("LeftHip", CFrame.Angles(hipBase + rad(LEG_SWING) * leftSwing, 0, 0));

	setJoint("RightKnee", CFrame.Angles(-(rad(KNEE_BASE) + rad(KNEE_BEND) * rightRecover), 0, 0));
	setJoint("LeftKnee", CFrame.Angles(-(rad(KNEE_BASE) + rad(KNEE_BEND) * leftRecover), 0, 0));
}

function runR6(setJoint: SetJoint, e: number) {
	const t = e * LEG_SPEED;
	const rightSwing = math.sin(t);
	const leftSwing = math.sin(t + math.pi);

	setJoint("RootJoint", CFrame.Angles(rad(BODY_LEAN), 0, 0));
	setJoint("Neck", CFrame.Angles(-rad(BODY_LEAN * 0.8), 0, 0));

	setJoint("Right Shoulder", CFrame.Angles(0, 0, -rad(ARM_BACK) + rad(6) * rightSwing));
	setJoint("Left Shoulder", CFrame.Angles(0, 0, rad(ARM_BACK) - rad(6) * leftSwing));

	const hipBase = rad(BODY_LEAN * 0.8);
	setJoint("Right Hip", CFrame.Angles(0, 0, hipBase + rad(LEG_SWING) * rightSwing));
	setJoint("Left Hip", CFrame.Angles(0, 0, -(hipBase + rad(LEG_SWING) * leftSwing)));
}

function grabAmounts(e: number) {
	const raise = math.clamp(e / 0.35, 0, 1);
	const slam = math.clamp((e - 0.35) / 0.15, 0, 1);
	return { raise, slam };
}

function grabR15(setJoint: SetJoint, e: number) {
	const { raise, slam } = grabAmounts(e);
	const armAngle = rad(170) * raise * (1 - slam) + rad(40) * slam;
	const lean = rad(35) * slam;

	setJoint("RootJoint", new CFrame(0, -0.4 * slam, 0).mul(CFrame.Angles(-lean, 0, 0)));
	setJoint("Waist", CFrame.Angles(-rad(10) * slam, 0, 0));
	setJoint("RightShoulder", CFrame.Angles(armAngle, 0, 0));
	setJoint("LeftShoulder", CFrame.Angles(armAngle, 0, 0));
	setJoint("RightElbow", CFrame.Angles(rad(10), 0, 0));
	setJoint("LeftElbow", CFrame.Angles(rad(10), 0, 0));
	setJoint("RightKnee", CFrame.Angles(-rad(25) * slam, 0, 0));
	setJoint("LeftKnee", CFrame.Angles(-rad(25) * slam, 0, 0));
}

function grabR6(setJoint: SetJoint, e: number) {
	const { raise, slam } = grabAmounts(e);
	const armAngle = rad(170) * raise * (1 - slam) + rad(40) * slam;

	setJoint("RootJoint", CFrame.Angles(rad(30) * slam, 0, 0));
	setJoint("Right Shoulder", CFrame.Angles(0, 0, armAngle));
	setJoint("Left Shoulder", CFrame.Angles(0, 0, -armAngle));
}

function findMotor(character: Model, name: string): Motor6D | undefined {
	for (const obj of character.GetDescendants()) {
		if (obj.IsA("Motor6D") && obj.Name === name) return obj;
	}
	return undefined;
}

function setAnimateEnabled(animate: Instance | undefined, enabled: boolean) {
	if (animate && animate.IsA("BaseScript")) animate.Enabled = enabled;
}

// Starts the pose. Returns a function that stops it and restores the character.
export function startPose(character: Model, humanoid: Humanoid, mode: PoseMode): () => void {
	const isR15 = humanoid.RigType === Enum.HumanoidRigType.R15;
	const names = isR15 ? R15_JOINTS : R6_JOINTS;
	const poseFunction = mode === "grab" ? (isR15 ? grabR15 : grabR6) : isR15 ? runR15 : runR6;

	const joints = new Map<string, { motor: Motor6D; c0: CFrame }>();
	for (const name of names) {
		const motor = findMotor(character, name);
		if (motor) joints.set(name, { motor, c0: motor.C0 });
	}

	const setJoint: SetJoint = (name, offset) => {
		const j = joints.get(name);
		if (j && j.motor.Parent) j.motor.C0 = j.c0.mul(offset);
	};

	const animate = character.FindFirstChild("Animate");
	setAnimateEnabled(animate, false);

	const animator = humanoid.FindFirstChildOfClass("Animator");
	const startTime = os.clock();

	const applyPose = () => {
		if (animator) {
			for (const track of animator.GetPlayingAnimationTracks()) track.Stop(0);
		}
		poseFunction(setJoint, os.clock() - startTime);
	};

	applyPose();
	const renderConnection = RunService.PreRender.Connect(applyPose);
	const simulationConnection = RunService.PreSimulation.Connect(applyPose);

	return () => {
		renderConnection.Disconnect();
		simulationConnection.Disconnect();
		for (const [, j] of joints) {
			if (j.motor.Parent) j.motor.C0 = j.c0;
		}
		setAnimateEnabled(animate, true);
	};
}
