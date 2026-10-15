/*
	punchAnimator.ts  (client)

	Procedural punch / block / dash / hit-react animation for the local
	character, written straight onto Motor6D.Transform every PreSimulation, so
	it needs no animation assets. Built for R6 joint names ("Right Shoulder").

	Hitstop freezes every running animation for a few frames on impact.
*/

import { RunService } from "@rbxts/services";

interface Pose {
	pitch: number;
	yaw: number;
	push: number;
	twist: number;
	lean: number;
	lunge: number;
}

interface ArmPose {
	pitch: number;
	yaw: number;
	push: number;
}

interface Timing {
	Windup: number;
	Extend: number;
	Hold: number;
	Retract: number;
}

interface PunchDef {
	Right: boolean;
	Heavy?: boolean;
	Arc: number;
	Timing?: Timing;
	Windup: Pose;
	Strike: Pose;
	OffArm?: ArmPose;
}

interface WindFx {
	Trails: Trail[];
	Attachments: Attachment[];
}

interface PunchAction {
	Kind: "Punch";
	Joint: Motor6D;
	OffJoint?: Motor6D;
	OffArm?: ArmPose;
	Heavy: boolean;
	Side: number;
	Timing: Timing;
	WindupPose: Pose;
	StrikePose: Pose;
	ArcLift: number;
	StartTime: number;
	Pose: Pose;
	FadeStart?: number;
	FadeDuration: number;
	WindOn: boolean;
}

interface DashAction {
	Kind: "Dash";
	StartTime: number;
	Duration: number;
	FadeStart?: number;
	FadeDuration: number;
}

type Action = PunchAction | DashAction;

let Character: Model | undefined;
let Humanoid: Humanoid | undefined;
let Root: BasePart | undefined;
let RootJoint: Motor6D | undefined;
let RightShoulder: Motor6D | undefined;
let LeftShoulder: Motor6D | undefined;
let RightHip: Motor6D | undefined;
let LeftHip: Motor6D | undefined;

let CurrentAction: Action | undefined;
let Lingering: Action[] = [];

let Blocking = false;
let BlockAlpha = 0;

let HitStart = 0;
let HitUntil = 0;
let HitTwist = 0;
let HitstopUntil = 0;

const IDENTITY = CFrame.identity;

const LastWritten = new Map<Motor6D, CFrame>();
const FrameTouched = new Set<Motor6D>();
const Snapshot = new Map<Motor6D, CFrame>();

const PUNCH_WALKSPEED = 2;

const PUNCH_TIMING: Timing = { Windup: 0.13, Extend: 0.16, Hold: 0.07, Retract: 0.2 };
const FINISHER_TIMING: Timing = { Windup: 0.2, Extend: 0.16, Hold: 0.08, Retract: 0.22 };

const FOLLOW_THROUGH = 0.12;
const BLOCK_SPEED = 16;
const HIT_LEAN = -10;
const HIT_TWIST = 6;

const NEUTRAL: Pose = { pitch: 12, yaw: 0, push: 0, twist: 0, lean: 0, lunge: 0 };

const PUNCHES: PunchDef[] = [
	{
		Right: true,
		Arc: 12,
		Windup: { pitch: 78, yaw: -58, push: -0.2, twist: -24, lean: 0, lunge: -0.05 },
		Strike: { pitch: 90, yaw: 42, push: 0.8, twist: 30, lean: 8, lunge: 0.22 },
	},
	{
		Right: false,
		Arc: 14,
		Windup: { pitch: 80, yaw: -62, push: -0.25, twist: -30, lean: -2, lunge: -0.08 },
		Strike: { pitch: 92, yaw: 48, push: 0.9, twist: 36, lean: 10, lunge: 0.3 },
	},
	{
		Right: true,
		Arc: -10,
		Windup: { pitch: 108, yaw: -66, push: -0.15, twist: -28, lean: -4, lunge: -0.05 },
		Strike: { pitch: 82, yaw: 52, push: 0.85, twist: 34, lean: 12, lunge: 0.28 },
	},
	{
		Right: false,
		Arc: 16,
		Windup: { pitch: 42, yaw: -52, push: -0.3, twist: -32, lean: -6, lunge: -0.1 },
		Strike: { pitch: 122, yaw: 30, push: 1.0, twist: 38, lean: 12, lunge: 0.35 },
	},
	{
		Right: true,
		Heavy: true,
		Arc: 10,
		Timing: FINISHER_TIMING,
		Windup: { pitch: 72, yaw: -78, push: -0.45, twist: -44, lean: -10, lunge: -0.15 },
		Strike: { pitch: 92, yaw: 34, push: 1.5, twist: 48, lean: 18, lunge: 0.55 },
		OffArm: { pitch: 62, yaw: 30, push: 0.1 },
	},
];

const BLOCK_R: Pose = { pitch: 82, yaw: 34, push: 0.15, twist: 0, lean: 6, lunge: -0.05 };
const BLOCK_L: ArmPose = { pitch: 92, yaw: 34, push: 0.2 };
const DASH_POSE: Pose = { pitch: -40, yaw: -8, push: -0.15, twist: 0, lean: 18, lunge: 0.2 };
const HIT_ARM: ArmPose = { pitch: -20, yaw: -12, push: -0.1 };

const WIND_COLOR = Color3.fromRGB(235, 245, 255);
const WIND_LINE_THICKNESS = 0.14;

const WIND_LINES = [
	{ X: 0.0, Y: -0.95, Z: 0.0, Life: 0.24 },
	{ X: 0.55, Y: -0.9, Z: 0.2, Life: 0.18 },
	{ X: -0.55, Y: -0.85, Z: -0.2, Life: 0.18 },
	{ X: 0.25, Y: -0.8, Z: -0.6, Life: 0.14 },
	{ X: -0.25, Y: -0.8, Z: 0.6, Life: 0.14 },
	{ X: 0.7, Y: -0.7, Z: -0.4, Life: 0.11 },
	{ X: -0.7, Y: -0.7, Z: 0.4, Life: 0.11 },
];

const WIND = {
	Punch: { LifeScale: 1.0, Width: 1.0 },
	Heavy: { LifeScale: 1.5, Width: 1.5 },
};

const Wind = new Map<Motor6D, WindFx>();

// ----------------------------------------------------------------------------
// easing
// ----------------------------------------------------------------------------

function clamp01(v: number) {
	return math.clamp(v, 0, 1);
}

function easeOutQuart(t: number) {
	t = clamp01(t);
	return 1 - (1 - t) ** 4;
}

function easeInOutSine(t: number) {
	return -(math.cos(math.pi * clamp01(t)) - 1) / 2;
}

function easeInOutCubic(t: number) {
	t = clamp01(t);
	if (t < 0.5) return 4 * t * t * t;
	return 1 - (-2 * t + 2) ** 3 / 2;
}

function blendPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
	out.pitch = a.pitch + (b.pitch - a.pitch) * t;
	out.yaw = a.yaw + (b.yaw - a.yaw) * t;
	out.push = a.push + (b.push - a.push) * t;
	out.twist = a.twist + (b.twist - a.twist) * t;
	out.lean = a.lean + (b.lean - a.lean) * t;
	out.lunge = a.lunge + (b.lunge - a.lunge) * t;
	return out;
}

// ----------------------------------------------------------------------------
// joints
// ----------------------------------------------------------------------------

function getForward(): Vector3 {
	if (!Root) return new Vector3(0, 0, -1);
	const f = Root.CFrame.LookVector;
	const flat = new Vector3(f.X, 0, f.Z);
	return flat.Magnitude < 0.001 ? new Vector3(0, 0, -1) : flat.Unit;
}

function hasToolEquipped() {
	return Character?.FindFirstChildOfClass("Tool") !== undefined;
}

// The joint's transform this frame from the default Animate script, or
// identity if nothing but us has written it since our last write.
function freshBase(joint: Motor6D): CFrame {
	const last = LastWritten.get(joint);
	const current = joint.Transform;
	if (last !== undefined && current === last) return IDENTITY;
	return current;
}

function writeJoint(joint: Motor6D | undefined, target: CFrame, weight: number) {
	if (!joint || !joint.Parent) return;

	let base: CFrame;
	if (FrameTouched.has(joint)) {
		base = joint.Transform;
	} else {
		base = freshBase(joint);
		FrameTouched.add(joint);
	}

	const result = base.Lerp(target, clamp01(weight));
	joint.Transform = result;
	LastWritten.set(joint, result);
}

function buildRootTarget(twist: number, lean: number, lunge: number): CFrame {
	return new CFrame(0, -lunge, 0).mul(CFrame.Angles(0, 0, math.rad(twist))).mul(CFrame.Angles(math.rad(lean), 0, 0));
}

function getTorsoCF(): CFrame | undefined {
	if (!RootJoint || !RootJoint.Part0) return undefined;
	return RootJoint.Part0.CFrame.mul(RootJoint.C0).mul(RootJoint.Transform).mul(RootJoint.C1.Inverse());
}

function limbTarget(joint: Motor6D, torsoCF: CFrame | undefined, pitch: number, yaw: number, push: number): CFrame {
	const parentCF = torsoCF ?? joint.Part0?.CFrame;
	if (!parentCF) return IDENTITY;

	const base = parentCF.mul(joint.C0);
	const forward = getForward();
	const flat = CFrame.lookAt(Vector3.zero, forward);
	const orientation = flat.mul(CFrame.Angles(0, math.rad(yaw), 0)).mul(CFrame.Angles(math.rad(pitch), 0, 0));
	const desired = new CFrame(base.Position.add(forward.mul(push))).mul(orientation).mul(joint.C1.Rotation);

	return base.ToObjectSpace(desired);
}

function applyTorso(pose: Pose, side: number, weight: number): CFrame | undefined {
	if (!RootJoint) return undefined;
	writeJoint(RootJoint, buildRootTarget(side * pose.twist, pose.lean, pose.lunge), weight);
	return getTorsoCF();
}

function applyLimb(joint: Motor6D | undefined, torsoCF: CFrame | undefined, pose: ArmPose, side: number, weight: number) {
	if (!joint) return;
	writeJoint(joint, limbTarget(joint, torsoCF, pose.pitch, side * pose.yaw, pose.push), weight);
}

// ----------------------------------------------------------------------------
// sampling
// ----------------------------------------------------------------------------

// Writes the pose for `elapsed` into `out` and returns its weight, or undefined once finished.
function samplePhases(elapsed: number, timing: Timing, windupPose: Pose, strikePose: Pose, out: Pose, arcLift: number) {
	if (elapsed < timing.Windup) {
		const a = elapsed / timing.Windup;
		blendPose(NEUTRAL, windupPose, easeInOutCubic(a), out);
		return easeInOutSine(math.min(1, a * 2));
	}
	elapsed -= timing.Windup;

	if (elapsed < timing.Extend) {
		const x = elapsed / timing.Extend;
		const t = easeOutQuart(x);
		blendPose(windupPose, strikePose, t, out);
		const drive = easeInOutSine(x);
		out.push = windupPose.push + (strikePose.push - windupPose.push) * drive;
		out.pitch += math.sin(math.pi * t) * arcLift;
		return 1;
	}
	elapsed -= timing.Extend;

	if (elapsed < timing.Hold) {
		blendPose(strikePose, strikePose, 0, out);
		out.push += FOLLOW_THROUGH * (elapsed / timing.Hold);
		return 1;
	}
	elapsed -= timing.Hold;

	if (elapsed < timing.Retract) {
		const a = elapsed / timing.Retract;
		blendPose(strikePose, NEUTRAL, easeInOutCubic(a), out);
		out.push += FOLLOW_THROUGH * (1 - easeInOutCubic(a));
		return 1 - easeInOutSine(a);
	}

	return undefined;
}

function sampleDash(elapsed: number, duration: number) {
	if (elapsed >= duration) return undefined;
	const a = elapsed / duration;
	if (a < 0.25) return easeOutQuart(a / 0.25);
	if (a > 0.7) return 1 - easeInOutSine((a - 0.7) / 0.3);
	return 1;
}

// ----------------------------------------------------------------------------
// wind trails
// ----------------------------------------------------------------------------

function createWind(joint: Motor6D | undefined) {
	if (!joint || !joint.Part1 || Wind.has(joint)) return;

	const part = joint.Part1;
	const fx: WindFx = { Trails: [], Attachments: [] };

	WIND_LINES.forEach((line, i) => {
		const a0 = new Instance("Attachment");
		a0.Name = `SpeedLineA${i + 1}`;
		a0.Position = new Vector3(line.X, line.Y, line.Z);
		a0.Parent = part;

		const a1 = new Instance("Attachment");
		a1.Name = `SpeedLineB${i + 1}`;
		a1.Position = new Vector3(line.X + WIND_LINE_THICKNESS, line.Y, line.Z);
		a1.Parent = part;

		const trail = new Instance("Trail");
		trail.Name = `SpeedLine${i + 1}`;
		trail.Attachment0 = a0;
		trail.Attachment1 = a1;
		trail.Lifetime = line.Life;
		trail.MinLength = 0;
		trail.FaceCamera = true;
		trail.LightEmission = 1;
		trail.Color = new ColorSequence(WIND_COLOR);
		trail.Transparency = new NumberSequence([
			new NumberSequenceKeypoint(0, 0.15),
			new NumberSequenceKeypoint(0.6, 0.6),
			new NumberSequenceKeypoint(1, 1),
		]);
		trail.WidthScale = new NumberSequence(1, 0);
		trail.Enabled = false;
		trail.Parent = part;

		fx.Trails.push(trail);
		fx.Attachments.push(a0, a1);
	});

	Wind.set(joint, fx);
}

function disableWind() {
	for (const [, fx] of Wind) {
		for (const trail of fx.Trails) trail.Enabled = false;
	}
}

function destroyWind() {
	for (const [, fx] of Wind) {
		for (const trail of fx.Trails) trail.Destroy();
		for (const attachment of fx.Attachments) attachment.Destroy();
	}
	Wind.clear();
}

function setWind(action: PunchAction, on: boolean) {
	if (action.WindOn === on) return;
	action.WindOn = on;

	const fx = Wind.get(action.Joint);
	if (!fx) return;

	const cfg = action.Heavy ? WIND.Heavy : WIND.Punch;
	fx.Trails.forEach((trail, i) => {
		if (on) {
			trail.Lifetime = WIND_LINES[i].Life * cfg.LifeScale;
			trail.WidthScale = new NumberSequence(cfg.Width, 0);
		}
		trail.Enabled = on;
	});
}

function updateWind(action: PunchAction, elapsed: number) {
	const t = action.Timing;
	const active =
		action.FadeStart === undefined && elapsed >= t.Windup * 0.85 && elapsed < t.Windup + t.Extend + t.Hold * 0.5;
	setWind(action, active);
}

// ----------------------------------------------------------------------------
// per-frame update
// ----------------------------------------------------------------------------

function updateAction(action: Action, now: number): boolean {
	const elapsed = now - action.StartTime;

	let weight =
		action.Kind === "Dash"
			? sampleDash(elapsed, action.Duration)
			: samplePhases(elapsed, action.Timing, action.WindupPose, action.StrikePose, action.Pose, action.ArcLift);

	if (weight === undefined) {
		if (action.Kind === "Punch") setWind(action, false);
		return false;
	}

	if (action.FadeStart !== undefined) {
		const f = (now - action.FadeStart) / action.FadeDuration;
		if (f >= 1) {
			if (action.Kind === "Punch") setWind(action, false);
			return false;
		}
		weight *= 1 - easeInOutSine(f);
	}

	if (action.Kind === "Dash") {
		const torsoCF = applyTorso(DASH_POSE, 1, weight);
		applyLimb(RightShoulder, torsoCF, DASH_POSE, 1, weight);
		applyLimb(LeftShoulder, torsoCF, DASH_POSE, -1, weight);
	} else {
		updateWind(action, elapsed);
		const torsoCF = applyTorso(action.Pose, action.Side, weight);
		applyLimb(action.Joint, torsoCF, action.Pose, action.Side, weight);
		if (action.OffJoint && action.OffArm) {
			applyLimb(action.OffJoint, torsoCF, action.OffArm, -action.Side, weight * 0.8);
		}
	}

	return true;
}

function shiftTimeline(action: Action, dt: number) {
	action.StartTime += dt;
	if (action.FadeStart !== undefined) action.FadeStart += dt;
}

// Move an action to the lingering list so it blends out under the next one.
function retire(action: Action | undefined, fadeTime?: number) {
	if (!action) return;

	const now = os.clock();
	const elapsed = now - action.StartTime;
	const early = action.Kind === "Punch" && elapsed < action.Timing.Windup + action.Timing.Extend;

	if (fadeTime !== undefined || action.Kind === "Dash" || early) {
		action.FadeStart = now;
		action.FadeDuration = fadeTime ?? 0.1;
	}

	Lingering.push(action);
	while (Lingering.size() > 3) Lingering.remove(0);
}

function updateBlock(dt: number) {
	const target = Blocking ? 1 : 0;
	BlockAlpha += (target - BlockAlpha) * (1 - math.exp(-dt * BLOCK_SPEED));

	if (!Blocking && BlockAlpha < 0.01) {
		BlockAlpha = 0;
		return;
	}

	const torsoCF = applyTorso(BLOCK_R, 1, BlockAlpha);
	applyLimb(RightShoulder, torsoCF, BLOCK_R, 1, BlockAlpha);
	applyLimb(LeftShoulder, torsoCF, BLOCK_L, -1, BlockAlpha);
}

function updateHit(now: number) {
	if (now >= HitUntil) return;

	const t = clamp01((now - HitStart) / math.max(HitUntil - HitStart, 0.001));
	const env = t < 0.2 ? easeOutQuart(t / 0.2) : 1 - easeInOutSine((t - 0.2) / 0.8);

	if (RootJoint) writeJoint(RootJoint, buildRootTarget(HitTwist, HIT_LEAN, -0.18), env);

	const torsoCF = getTorsoCF();
	applyLimb(RightShoulder, torsoCF, HIT_ARM, 1, env * 0.7);
	applyLimb(LeftShoulder, torsoCF, HIT_ARM, -1, env * 0.7);
}

function preSimulation(dt: number) {
	if (!Character || !Character.Parent || !Root) return;

	const now = os.clock();

	// Hitstop: push every timeline forward by dt and hold last frame's pose.
	if (HitstopUntil > now) {
		if (CurrentAction) shiftTimeline(CurrentAction, dt);
		for (const action of Lingering) shiftTimeline(action, dt);
		HitStart += dt;
		HitUntil += dt;

		for (const [joint, cf] of Snapshot) {
			if (joint.Parent) joint.Transform = cf;
		}
		return;
	}

	FrameTouched.clear();

	if (Blocking || BlockAlpha > 0) updateBlock(dt);

	for (let i = Lingering.size() - 1; i >= 0; i--) {
		if (!updateAction(Lingering[i], now)) Lingering.remove(i);
	}

	if (CurrentAction && !updateAction(CurrentAction, now)) {
		CurrentAction = undefined;
		if (Humanoid && Humanoid.Parent) Humanoid.AutoRotate = true;
	}

	updateHit(now);

	Snapshot.clear();
	for (const joint of FrameTouched) Snapshot.set(joint, joint.Transform);
}

// ----------------------------------------------------------------------------
// public API
// ----------------------------------------------------------------------------

function findMotor(parent: Instance, name: string, recursive = false): Motor6D | undefined {
	const found = parent.FindFirstChild(name, recursive);
	return found && found.IsA("Motor6D") ? found : undefined;
}

export function Setup(character: Model) {
	Character = character;
	Humanoid = character.FindFirstChildOfClass("Humanoid");
	const root = character.FindFirstChild("HumanoidRootPart");
	Root = root && root.IsA("BasePart") ? root : undefined;
	if (!Humanoid || !Root) return;

	RootJoint = findMotor(Root, "RootJoint");
	RightShoulder = findMotor(character, "Right Shoulder", true);
	LeftShoulder = findMotor(character, "Left Shoulder", true);
	RightHip = findMotor(character, "Right Hip", true);
	LeftHip = findMotor(character, "Left Hip", true);

	destroyWind();
	createWind(RightShoulder);
	createWind(LeftShoulder);

	CurrentAction = undefined;
	Lingering = [];
	Blocking = false;
	BlockAlpha = 0;
	HitStart = 0;
	HitUntil = 0;
	HitTwist = 0;
	HitstopUntil = 0;

	LastWritten.clear();
	FrameTouched.clear();
	Snapshot.clear();
}

export function CanPunch() {
	return Character !== undefined && !hasToolEquipped();
}

// `index` is the 1-based combo index.
export function PlayAttack(index: number): boolean {
	if (!Character || !Humanoid || !Root || hasToolEquipped()) return false;

	const def = PUNCHES[(index - 1) % PUNCHES.size()];
	const joint = def.Right ? RightShoulder : LeftShoulder;
	if (!joint) return false;

	const offJoint = def.OffArm ? (def.Right ? LeftShoulder : RightShoulder) : undefined;

	const action: PunchAction = {
		Kind: "Punch",
		Joint: joint,
		OffJoint: offJoint,
		OffArm: def.OffArm,
		Heavy: def.Heavy === true,
		Side: def.Right ? 1 : -1,
		Timing: def.Timing ?? PUNCH_TIMING,
		WindupPose: def.Windup,
		StrikePose: def.Strike,
		ArcLift: def.Arc,
		StartTime: os.clock(),
		Pose: { ...NEUTRAL },
		FadeDuration: 0.1,
		WindOn: false,
	};

	Blocking = false;
	Humanoid.AutoRotate = true;
	Humanoid.WalkSpeed = PUNCH_WALKSPEED;

	retire(CurrentAction);
	CurrentAction = action;
	return true;
}

export function PlayBlock(): boolean {
	if (!Character || !Humanoid || !Root || hasToolEquipped()) return false;

	retire(CurrentAction, 0.12);
	CurrentAction = undefined;
	Blocking = true;

	Humanoid.AutoRotate = true;
	Humanoid.WalkSpeed = 2;
	return true;
}

export function StopBlock() {
	Blocking = false;
	if (Humanoid && Humanoid.Parent) Humanoid.AutoRotate = true;
}

export function PlayDash(duration = 0.25) {
	if (!Character || !Root) return;

	retire(CurrentAction, 0.1);
	Blocking = false;
	if (Humanoid) Humanoid.AutoRotate = true;

	CurrentAction = { Kind: "Dash", StartTime: os.clock(), Duration: duration, FadeDuration: 0.1 };
}

export function PlayHitReact(duration = 0.2) {
	if (!Character || !Root) return;

	retire(CurrentAction, 0.1);
	CurrentAction = undefined;
	Blocking = false;

	HitStart = os.clock();
	HitUntil = HitStart + duration;
	HitTwist = (math.random() < 0.5 ? -1 : 1) * HIT_TWIST;
}

export function Hitstop(duration = 0.06) {
	HitstopUntil = math.max(HitstopUntil, os.clock() + duration);
}

export function CancelActions() {
	CurrentAction = undefined;
	Lingering = [];
	Blocking = false;
	BlockAlpha = 0;
	HitUntil = 0;
	HitstopUntil = 0;

	// Not an array literal: missing joints would leave holes in it.
	if (RightShoulder) RightShoulder.Transform = IDENTITY;
	if (LeftShoulder) LeftShoulder.Transform = IDENTITY;
	if (RightHip) RightHip.Transform = IDENTITY;
	if (LeftHip) LeftHip.Transform = IDENTITY;
	if (RootJoint) RootJoint.Transform = IDENTITY;

	LastWritten.clear();
	FrameTouched.clear();
	Snapshot.clear();
	disableWind();

	if (Humanoid && Humanoid.Parent) Humanoid.AutoRotate = true;
}

export function Destroy() {
	CancelActions();
	destroyWind();
	Character = undefined;
	Humanoid = undefined;
	Root = undefined;
	RootJoint = undefined;
	RightShoulder = undefined;
	LeftShoulder = undefined;
	RightHip = undefined;
	LeftHip = undefined;
}

export function start() {
	RunService.PreSimulation.Connect(preSimulation);
}
