/*
	flashStep.ts  (client)

	A short invisible burst of speed that leaves afterimages. Running into
	someone grabs them: the handler sends the target as an ability "input",
	and the server re-checks the grab and does the slam.

	Exclusive: no other ability can start while the dash and grab play out.
*/

import { Debris, RunService, TweenService, Workspace } from "@rbxts/services";
import { startPose } from "../../movement/rigPose";
import * as Sprint from "../../movement/sprint";
import { ClientAbility } from "../clientAbility";

const FLASH_SPEED = 34;
const DURATION = 0.4;
const AFTERIMAGE_INTERVAL = 0.2;
const FADE_TIME = 0.5;
const GHOST_START_TRANSPARENCY = 0.35;
const FOV_BOOST = 12;
const HIDE_CHARACTER = true;

const GHOST_COLOR = Color3.fromRGB(0, 0, 0);
const OUTLINE_COLOR = Color3.fromRGB(255, 255, 255);

const HIT_RANGE = 4;
const GRAB_TIME = 1.03;

type Saved = Map<BasePart | Decal, number>;

function saveTransparencies(character: Model): Saved {
	const saved: Saved = new Map();
	for (const obj of character.GetDescendants()) {
		if ((obj.IsA("BasePart") && obj.Name !== "HumanoidRootPart") || obj.IsA("Decal")) {
			saved.set(obj, obj.Transparency);
		}
	}
	return saved;
}

function setInvisible(saved: Saved) {
	for (const [obj] of saved) if (obj.Parent) obj.Transparency = 1;
}

function restoreVisibility(saved: Saved) {
	for (const [obj, original] of saved) if (obj.Parent) obj.Transparency = original;
}

function createAfterimage(saved: Saved) {
	const model = new Instance("Model");
	model.Name = "FlashStepAfterimage";

	for (const [part, original] of saved) {
		if (!part.IsA("BasePart") || !part.Parent || original >= 1) continue;

		const ghost = part.Clone();
		ghost.ClearAllChildren();
		for (const child of part.GetChildren()) {
			if (child.IsA("SpecialMesh")) child.Clone().Parent = ghost;
		}
		if (ghost.IsA("MeshPart")) ghost.TextureID = "";

		ghost.Anchored = true;
		ghost.CanCollide = false;
		ghost.CanQuery = false;
		ghost.CanTouch = false;
		ghost.Massless = true;
		ghost.Material = Enum.Material.Neon;
		ghost.Color = GHOST_COLOR;
		ghost.Transparency = GHOST_START_TRANSPARENCY;
		ghost.CFrame = part.CFrame;
		ghost.Parent = model;

		TweenService.Create(ghost, new TweenInfo(FADE_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			Transparency: 1,
		}).Play();
	}

	const highlight = new Instance("Highlight");
	highlight.Adornee = model;
	highlight.FillTransparency = 1;
	highlight.OutlineColor = OUTLINE_COLOR;
	highlight.OutlineTransparency = 0;
	highlight.DepthMode = Enum.HighlightDepthMode.Occluded;
	highlight.Parent = model;

	model.Parent = Workspace;

	TweenService.Create(highlight, new TweenInfo(FADE_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		OutlineTransparency: 1,
	}).Play();
	Debris.AddItem(model, FADE_TIME + 0.1);
}

function findTarget(root: BasePart, params: OverlapParams): Model | undefined {
	for (const part of Workspace.GetPartBoundsInRadius(root.Position, HIT_RANGE, params)) {
		const model = part.FindFirstAncestorOfClass("Model");
		const hum = model?.FindFirstChildOfClass("Humanoid");
		if (model && hum && hum.Health > 0 && model.FindFirstChild("HumanoidRootPart")) return model;
	}
	return undefined;
}

export const FlashStep: ClientAbility = {
	id: "FlashStep",
	exclusive: true,

	OnPress: ({ character, humanoid, root, send }) => {
		const camera = Workspace.CurrentCamera;
		if (!camera) return;

		Sprint.setSuppressed(true);
		const originalSpeed = Sprint.getBaseSpeed(humanoid);
		const originalFOV = camera.FieldOfView;
		const saved = saveTransparencies(character);

		const params = new OverlapParams();
		params.FilterDescendantsInstances = [character];
		params.FilterType = Enum.RaycastFilterType.Exclude;

		TweenService.Create(camera, new TweenInfo(0.2), { FieldOfView: originalFOV + FOV_BOOST }).Play();
		humanoid.WalkSpeed = FLASH_SPEED;

		const stopRunPose = startPose(character, humanoid, "run");
		RunService.Heartbeat.Wait();

		createAfterimage(saved);
		if (HIDE_CHARACTER) setInvisible(saved);

		const startTime = os.clock();
		let lastGhost = 0;
		let hitTarget: Model | undefined;

		const connection = RunService.Heartbeat.Connect(() => {
			const elapsed = os.clock() - startTime;
			if (elapsed >= DURATION || humanoid.Health <= 0 || !root.Parent) {
				connection.Disconnect();
				return;
			}

			humanoid.WalkSpeed = FLASH_SPEED;
			if (HIDE_CHARACTER) setInvisible(saved);

			const target = findTarget(root, params);
			if (target) {
				hitTarget = target;
				connection.Disconnect();
				return;
			}

			let moveDir = humanoid.MoveDirection;
			if (moveDir.Magnitude < 0.1) moveDir = root.CFrame.LookVector;
			humanoid.Move(moveDir, false);

			if (elapsed - lastGhost >= AFTERIMAGE_INTERVAL) {
				lastGhost = elapsed;
				createAfterimage(saved);
			}
		});

		while (connection.Connected) task.wait();
		stopRunPose();

		const targetRoot = hitTarget?.FindFirstChild("HumanoidRootPart");
		if (hitTarget && targetRoot && targetRoot.IsA("BasePart") && humanoid.Health > 0) {
			humanoid.WalkSpeed = 0;
			humanoid.Move(Vector3.zero, false);
			root.AssemblyLinearVelocity = Vector3.zero;

			const p = targetRoot.Position;
			root.CFrame = CFrame.lookAt(root.Position, new Vector3(p.X, root.Position.Y, p.Z));

			restoreVisibility(saved);
			send(hitTarget);

			const stopGrab = startPose(character, humanoid, "grab");
			task.wait(GRAB_TIME);
			stopGrab();
		}

		restoreVisibility(saved);
		if (humanoid.Parent) {
			humanoid.WalkSpeed = originalSpeed;
			humanoid.Move(Vector3.zero, false);
		}
		Sprint.setSuppressed(false);
		TweenService.Create(camera, new TweenInfo(0.3), { FieldOfView: originalFOV }).Play();
	},
};
