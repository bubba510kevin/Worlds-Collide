/*
	renderers.ts  (client)

	How projectiles and beams look. The server names a visual id per shot
	(ProjectileOptions.visual / BeamOptions.visual) and passes `visualData`;
	this registry turns that into parts and effects. Unknown ids fall back to
	"default".

	Add a look with registerProjectileRenderer / registerBeamRenderer, e.g.
	from an ability's client handler file. Renderers are purely cosmetic.

	Default visuals read `visualData.color` (a Color3) if present.
*/

import { Debris, TweenService, Workspace } from "@rbxts/services";
import * as CombatFX from "../combat/combatFX";

export interface ProjectileVisual {
	// Called every frame with the projectile's pose (facing its velocity).
	Update: (cframe: CFrame, velocity: Vector3) => void;
	// reason: "hit" | "hitWorld" | "expired" | "clashed" | "cancelled" | "replaced"
	Destroy: (position: Vector3, reason: string) => void;
}

export interface ProjectileRenderer {
	Create: (args: { radius: number; owner?: Model; data: unknown }) => ProjectileVisual;
}

export interface BeamVisual {
	Update: (origin: Vector3, direction: Vector3, reach: number, width: number, clashing: boolean) => void;
	Destroy: (reason: string) => void;
}

export interface BeamRenderer {
	Create: (args: { width: number; owner?: Model; data: unknown }) => BeamVisual;
}

const projectileRenderers = new Map<string, ProjectileRenderer>();
const beamRenderers = new Map<string, BeamRenderer>();

export function registerProjectileRenderer(id: string, renderer: ProjectileRenderer) {
	projectileRenderers.set(id, renderer);
}

export function registerBeamRenderer(id: string, renderer: BeamRenderer) {
	beamRenderers.set(id, renderer);
}

export function getProjectileRenderer(id: string): ProjectileRenderer {
	return projectileRenderers.get(id) ?? projectileRenderers.get("default")!;
}

export function getBeamRenderer(id: string): BeamRenderer {
	return beamRenderers.get(id) ?? beamRenderers.get("default")!;
}

function colorFrom(data: unknown, fallback: Color3): Color3 {
	if (typeIs(data, "table")) {
		const color = (data as { color?: unknown }).color;
		if (typeIs(color, "Color3")) return color;
	}
	return fallback;
}

function effectPart(): Part {
	const part = new Instance("Part");
	part.Anchored = true;
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = false;
	part.Material = Enum.Material.Neon;
	return part;
}

// ----------------------------------------------------------------------------
// defaults
// ----------------------------------------------------------------------------

// A glowing orb with a trail.
registerProjectileRenderer("default", {
	Create: ({ radius, data }) => {
		const color = colorFrom(data, Color3.fromRGB(140, 200, 255));
		const size = math.max(0.4, radius * 2);

		const orb = effectPart();
		orb.Shape = Enum.PartType.Ball;
		orb.Color = color;
		orb.Size = new Vector3(size, size, size);
		orb.Parent = Workspace;

		const a0 = new Instance("Attachment");
		a0.Position = new Vector3(0, size * 0.3, 0);
		a0.Parent = orb;
		const a1 = new Instance("Attachment");
		a1.Position = new Vector3(0, -size * 0.3, 0);
		a1.Parent = orb;
		const trail = new Instance("Trail");
		trail.Attachment0 = a0;
		trail.Attachment1 = a1;
		trail.Lifetime = 0.2;
		trail.LightEmission = 1;
		trail.Color = new ColorSequence(color);
		trail.Transparency = new NumberSequence(0.2, 1);
		trail.FaceCamera = true;
		trail.Parent = orb;

		return {
			Update: (cframe) => {
				orb.CFrame = cframe;
			},
			Destroy: (position, reason) => {
				if (reason === "hit" || reason === "hitWorld" || reason === "clashed") CombatFX.Impact(position);
				orb.Transparency = 1;
				trail.Enabled = false;
				Debris.AddItem(orb, trail.Lifetime + 0.05);
			},
		};
	},
});

// A glowing cylinder from origin to tip, with a ball on the end.
registerBeamRenderer("default", {
	Create: ({ data }) => {
		const color = colorFrom(data, Color3.fromRGB(140, 200, 255));

		const body = effectPart();
		body.Shape = Enum.PartType.Cylinder;
		body.Color = color;
		body.Transparency = 0.15;
		body.Parent = Workspace;

		const tip = effectPart();
		tip.Shape = Enum.PartType.Ball;
		tip.Color = color;
		tip.Parent = Workspace;

		return {
			Update: (origin, direction, reach, w, clashing) => {
				// Clashing beams flicker in thickness.
				const thickness = clashing ? w * (1 + 0.15 * math.sin(os.clock() * 40)) : w;
				const length = math.max(0.05, reach);
				const center = origin.add(direction.mul(length / 2));
				// A cylinder's axis is X; turn it to point along the beam.
				body.CFrame = CFrame.lookAt(center, center.add(direction)).mul(CFrame.Angles(0, math.rad(90), 0));
				body.Size = new Vector3(length, thickness, thickness);
				const tipSize = thickness * (clashing ? 1.8 : 1.3);
				tip.Size = new Vector3(tipSize, tipSize, tipSize);
				tip.Position = origin.add(direction.mul(length));
			},
			Destroy: () => {
				for (const part of [body, tip]) {
					TweenService.Create(part, new TweenInfo(0.2), { Transparency: 1 }).Play();
					Debris.AddItem(part, 0.25);
				}
			},
		};
	},
});
