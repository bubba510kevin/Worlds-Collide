/*
	combatUtil.ts  (shared)

	Small helpers used by both sides. Push() drives dashes, punch lunges and
	knockback.
*/

import { RunService } from "@rbxts/services";

interface ActivePush {
	connection: RBXScriptConnection;
	velocity: LinearVelocity;
	attachment: Attachment;
}

const activePushes = new WeakMap<BasePart, ActivePush>();

// The Humanoid model a part belongs to (handles accessories and nested models).
export function GetCharacterFromPart(part: Instance): Model | undefined {
	let model = part.FindFirstAncestorOfClass("Model");
	while (model) {
		if (model.FindFirstChildOfClass("Humanoid")) return model;
		model = model.Parent?.FindFirstAncestorOfClass("Model");
	}
	return undefined;
}

export function GetHumanoidAndRoot(character: Model | undefined): LuaTuple<[Humanoid?, BasePart?]> {
	if (!character) return $tuple(undefined, undefined);
	const humanoid = character.FindFirstChildOfClass("Humanoid");
	const root = character.FindFirstChild("HumanoidRootPart");
	if (humanoid && root && root.IsA("BasePart") && humanoid.Health > 0) {
		return $tuple(humanoid, root);
	}
	return $tuple(undefined, undefined);
}

export function CancelPush(root: BasePart) {
	const push = activePushes.get(root);
	if (!push) return;
	activePushes.delete(root);
	push.connection.Disconnect();
	push.velocity.Destroy();
	push.attachment.Destroy();
}

/*
	Moves `root` horizontally `distance` studs over `duration` seconds, fast at
	first and easing out: speed(t) = peak * (1 - t)^exponent. Vertical motion
	(gravity, jumping) is left alone.

	Whoever has network ownership of the part must call this: the client for its
	own character, the server for NPCs.
*/
export function Push(root: BasePart, direction: Vector3, distance: number, duration: number, exponent = 2) {
	CancelPush(root);

	let flat = new Vector3(direction.X, 0, direction.Z);
	if (flat.Magnitude < 1e-3 || distance <= 0 || duration <= 0) return;
	flat = flat.Unit;

	const peak = (distance * (exponent + 1)) / duration;

	const attachment = new Instance("Attachment");
	attachment.Name = "CombatPushAttachment";
	attachment.Parent = root;

	const velocity = new Instance("LinearVelocity");
	velocity.Name = "CombatPush";
	velocity.Attachment0 = attachment;
	velocity.RelativeTo = Enum.ActuatorRelativeTo.World;
	velocity.VelocityConstraintMode = Enum.VelocityConstraintMode.Plane;
	velocity.PrimaryTangentAxis = Vector3.xAxis;
	velocity.SecondaryTangentAxis = Vector3.zAxis;
	velocity.PlaneVelocity = new Vector2(flat.X * peak, flat.Z * peak);
	velocity.MaxForce = math.huge;
	velocity.Parent = root;

	const startTime = os.clock();
	const connection = RunService.Heartbeat.Connect(() => {
		const alpha = (os.clock() - startTime) / duration;
		if (alpha >= 1 || !root.Parent) {
			CancelPush(root);
			return;
		}
		const speed = peak * (1 - alpha) ** exponent;
		velocity.PlaneVelocity = new Vector2(flat.X * speed, flat.Z * speed);
	});

	activePushes.set(root, { connection, velocity, attachment });
}
