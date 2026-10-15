/*
	projectileClient.ts  (client)

	Draws what the server simulates. Projectiles are moved locally with the
	same kinematics as the server (shared/projectiles/math.ts), timed with
	Workspace.GetServerTimeNow() so they appear where the server has them;
	"sync" messages correct them after bounces, homing and redirects.

	Beams arrive at ~20 updates a second and are smoothed between updates.

	Purely cosmetic: nothing here affects a hit.
*/

import { RunService, Workspace } from "@rbxts/services";
import { positionAt, velocityAt } from "shared/projectiles/math";
import { getRemote } from "shared/remotes";
import { BeamVisual, getBeamRenderer, getProjectileRenderer, ProjectileVisual } from "./renderers";

interface LiveProjectile {
	visual: ProjectileVisual;
	t0: number;
	origin: Vector3;
	velocity: Vector3;
	gravity: number;
	spawnedAt: number;
}

interface LiveBeam {
	visual: BeamVisual;
	width: number;
	// latest from the server
	origin: Vector3;
	direction: Vector3;
	reach: number;
	clashing: boolean;
	// what is drawn, eased toward the latest
	shownOrigin: Vector3;
	shownDirection: Vector3;
	shownReach: number;
}

// Projectiles the server never ended (lost message) are cleaned up after this.
const MAX_CLIENT_LIFETIME = 30;
// How quickly beams catch up to server updates (higher = snappier).
const BEAM_SMOOTHING = 30;

const projectiles = new Map<number, LiveProjectile>();
const beams = new Map<number, LiveBeam>();

function safely(what: string, fn: () => void) {
	const [ok, err] = pcall(fn);
	if (!ok) warn(`[projectiles] ${what} errored: ${err}`);
}

function poseOf(p: LiveProjectile, now: number): LuaTuple<[Vector3, Vector3]> {
	const age = math.max(0, now - p.t0);
	return $tuple(positionAt(p.origin, p.velocity, p.gravity, age), velocityAt(p.velocity, p.gravity, age));
}

function onMessage(kind: unknown, a: unknown, b: unknown, c: unknown, d: unknown, e: unknown, f: unknown, g: unknown, h: unknown, i: unknown) {
	if (kind === "spawn") {
		// id, visual, t0, origin, velocity, gravity, radius, ownerChar, data
		if (!typeIs(a, "number") || !typeIs(b, "string") || !typeIs(c, "number") || !typeIs(d, "Vector3") || !typeIs(e, "Vector3")) return;
		const owner = typeIs(h, "Instance") && h.IsA("Model") ? h : undefined;
		const radius = typeIs(g, "number") ? g : 0;
		safely(`renderer ${b}`, () => {
			const visual = getProjectileRenderer(b).Create({ radius, owner, data: i });
			projectiles.set(a, {
				visual,
				t0: c,
				origin: d,
				velocity: e,
				gravity: typeIs(f, "number") ? f : 0,
				spawnedAt: os.clock(),
			});
		});
	} else if (kind === "sync") {
		// id, t0, position, velocity
		const p = typeIs(a, "number") ? projectiles.get(a) : undefined;
		if (!p || !typeIs(b, "number") || !typeIs(c, "Vector3") || !typeIs(d, "Vector3")) return;
		p.t0 = b;
		p.origin = c;
		p.velocity = d;
	} else if (kind === "end") {
		// id, position, reason
		const p = typeIs(a, "number") ? projectiles.get(a) : undefined;
		if (!p) return;
		projectiles.delete(a as number);
		const position = typeIs(b, "Vector3") ? b : poseOf(p, Workspace.GetServerTimeNow())[0];
		safely("projectile Destroy", () => p.visual.Destroy(position, typeIs(c, "string") ? c : "expired"));
	} else if (kind === "beam") {
		// id, visual, origin, direction, reach, width, ownerChar, data
		if (!typeIs(a, "number") || !typeIs(b, "string") || !typeIs(c, "Vector3") || !typeIs(d, "Vector3")) return;
		const reach = typeIs(e, "number") ? e : 0;
		const width = typeIs(f, "number") ? f : 1;
		const owner = typeIs(g, "Instance") && g.IsA("Model") ? g : undefined;
		safely(`beam renderer ${b}`, () => {
			const visual = getBeamRenderer(b).Create({ width, owner, data: h });
			beams.set(a, {
				visual,
				width,
				origin: c,
				direction: d,
				reach,
				clashing: false,
				shownOrigin: c,
				shownDirection: d,
				shownReach: reach,
			});
		});
	} else if (kind === "beamUpdate") {
		// id, origin, direction, reach, clashing
		const beam = typeIs(a, "number") ? beams.get(a) : undefined;
		if (!beam || !typeIs(b, "Vector3") || !typeIs(c, "Vector3") || !typeIs(d, "number")) return;
		beam.origin = b;
		beam.direction = c;
		beam.reach = d;
		beam.clashing = e === true;
	} else if (kind === "beamEnd") {
		// id, reason
		const beam = typeIs(a, "number") ? beams.get(a) : undefined;
		if (!beam) return;
		beams.delete(a as number);
		safely("beam Destroy", () => beam.visual.Destroy(typeIs(b, "string") ? b : "cancelled"));
	}
}

function render(dt: number) {
	const now = Workspace.GetServerTimeNow();
	const clock = os.clock();

	for (const [id, p] of projectiles) {
		if (clock - p.spawnedAt > MAX_CLIENT_LIFETIME) {
			projectiles.delete(id);
			const [position] = poseOf(p, now);
			safely("projectile Destroy", () => p.visual.Destroy(position, "expired"));
			continue;
		}
		const [position, velocity] = poseOf(p, now);
		const facing = velocity.Magnitude > 1e-3 ? CFrame.lookAt(position, position.add(velocity)) : new CFrame(position);
		safely("projectile Update", () => p.visual.Update(facing, velocity));
	}

	const alpha = 1 - math.exp(-BEAM_SMOOTHING * dt);
	for (const [, beam] of beams) {
		beam.shownOrigin = beam.shownOrigin.Lerp(beam.origin, alpha);
		const dir = beam.shownDirection.Lerp(beam.direction, alpha);
		beam.shownDirection = dir.Magnitude > 1e-3 ? dir.Unit : beam.direction;
		beam.shownReach += (beam.reach - beam.shownReach) * alpha;
		safely("beam Update", () =>
			beam.visual.Update(beam.shownOrigin, beam.shownDirection, beam.shownReach, beam.width, beam.clashing),
		);
	}
}

export function start() {
	getRemote("Projectile").OnClientEvent.Connect(onMessage);
	RunService.RenderStepped.Connect(render);
}
