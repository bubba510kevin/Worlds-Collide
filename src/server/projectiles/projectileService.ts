/*
	projectileService.ts  (server)

	Owns every live projectile and beam: steps them each frame, resolves
	projectile-vs-projectile clashes, beam struggles and beams eating
	projectiles, enforces per-owner caps, and replicates to clients.

	Public API:
		fireProjectile(owner, opts) -> Projectile
		fireBeam(owner, opts)       -> Beam
		getProjectiles(owner?) / getBeams(owner?)
		clearOwner(owner)

	From an ability, prefer the helpers on `ability` (fireProjectile,
	fireBeam, fireBeamWhileActive), which tag the shots with the ability id.

	Replication ("Projectile" remote, all clients). Times use
	Workspace.GetServerTimeNow(), which clients share, so a client places a
	projectile where the server has it rather than where it was when the
	message left.
		("spawn", id, visual, t0, origin, velocity, gravity, radius, ownerChar, data)
		("sync",  id, t0, position, velocity)
		("end",   id, position, reason)
		("beam",  id, visual, origin, direction, reach, width, ownerChar, data)
		("beamUpdate", id, origin, direction, reach, clashing)
		("beamEnd", id, reason)
*/

import { Players, RunService, Workspace } from "@rbxts/services";
import { Config } from "shared/config";
import { closestPointOnSegment, closestPointsOnSegments } from "shared/projectiles/math";
import { getRemote } from "shared/remotes";
import { strike } from "../combat/combatService";
import type { Generic_Player } from "../generic_player/generic_player";
import { Beam, BeamEndReason, BeamHost, BeamOptions, Struggle } from "./beam";
import { Projectile, ProjectileEndReason, ProjectileHost, ProjectileOptions } from "./projectile";

const remote = getRemote("Projectile");

const projectiles: Projectile[] = [];
const beams: Beam[] = [];
const struggles: Struggle[] = [];

// ----------------------------------------------------------------------------
// replication
// ----------------------------------------------------------------------------

function serverTime() {
	return Workspace.GetServerTimeNow();
}

function sendSpawn(p: Projectile) {
	remote.FireAllClients(
		"spawn",
		p.id,
		p.opts.visual ?? "default",
		serverTime(),
		p.position,
		p.velocity,
		p.gravity,
		p.radius,
		p.owner.GetCharacter(),
		p.opts.visualData,
	);
	p.lastSyncAt = os.clock();
}

function sendSync(p: Projectile) {
	remote.FireAllClients("sync", p.id, serverTime(), p.position, p.velocity);
	p.needsSync = false;
	p.lastSyncAt = os.clock();
}

function sendBeam(b: Beam) {
	remote.FireAllClients(
		"beam",
		b.id,
		b.opts.visual ?? "default",
		b.origin,
		b.direction,
		b.reach,
		b.opts.width,
		b.owner.GetCharacter(),
		b.opts.visualData,
	);
	b.needsSync = false;
	b.lastSyncAt = os.clock();
}

function sendBeamUpdate(b: Beam) {
	remote.FireAllClients("beamUpdate", b.id, b.origin, b.direction, b.reach, b.struggle !== undefined);
	b.needsSync = false;
	b.lastSyncAt = os.clock();
}

const projectileHost: ProjectileHost = {
	strike: (attacker, victim, opts) => strike(attacker, victim, opts),
	replicateEnd: (p: Projectile, reason: ProjectileEndReason) => remote.FireAllClients("end", p.id, p.position, reason),
};

const beamHost: BeamHost = {
	strike: (attacker, victim, opts) => strike(attacker, victim, opts),
	replicateEnd: (b: Beam, reason: BeamEndReason) => remote.FireAllClients("beamEnd", b.id, reason),
};

// ----------------------------------------------------------------------------
// public API
// ----------------------------------------------------------------------------

export function getProjectiles(owner?: Generic_Player): Projectile[] {
	return projectiles.filter((p) => p.alive && (owner === undefined || p.owner === owner));
}

export function getBeams(owner?: Generic_Player): Beam[] {
	return beams.filter((b) => b.alive && (owner === undefined || b.owner === owner));
}

export function fireProjectile(owner: Generic_Player, opts: ProjectileOptions): Projectile {
	const mine = getProjectiles(owner);
	if (mine.size() >= Config.Projectiles.MaxProjectilesPerOwner) mine[0].End("replaced");

	const p = new Projectile(owner, opts, projectileHost);
	projectiles.push(p);
	sendSpawn(p);
	return p;
}

export function fireBeam(owner: Generic_Player, opts: BeamOptions): Beam {
	const mine = getBeams(owner);
	if (mine.size() >= Config.Projectiles.MaxBeamsPerOwner) mine[0].End("replaced");

	const b = new Beam(owner, opts, beamHost);
	beams.push(b);
	sendBeam(b);
	return b;
}

// End everything one owner has in flight (they left, died, got sealed...).
export function clearOwner(owner: Generic_Player) {
	for (const p of getProjectiles(owner)) p.End("cancelled");
	for (const b of getBeams(owner)) b.End("cancelled");
}

// ----------------------------------------------------------------------------
// clashes
// ----------------------------------------------------------------------------

function resolveProjectileClashes() {
	const clashers = projectiles.filter((p) => p.alive && p.opts.clash !== undefined);
	for (let i = 0; i < clashers.size(); i++) {
		const a = clashers[i];
		for (let j = i + 1; j < clashers.size(); j++) {
			const b = clashers[j];
			if (!a.alive) break;
			if (!b.alive || a.owner === b.owner) continue;
			if (a.position.sub(b.position).Magnitude > a.radius + b.radius + 0.5) continue;

			a.opts.OnClash?.(a, b);
			b.opts.OnClash?.(b, a);
			const pa = a.clashPower;
			const pb = b.clashPower;
			if (pa > pb) {
				a.clashPower -= pb;
				b.End("clashed");
			} else if (pb > pa) {
				b.clashPower -= pa;
				a.End("clashed");
			} else {
				a.End("clashed");
				b.End("clashed");
			}
		}
	}
}

// A clashing beam swallows enemy projectiles that fly into it.
function beamsEatProjectiles() {
	for (const b of beams) {
		if (!b.alive || !b.opts.clash || b.reach <= 0) continue;
		const tip = b.Tip();
		for (const p of projectiles) {
			if (!p.alive || p.owner === b.owner) continue;
			const closest = closestPointOnSegment(p.position, b.origin, tip);
			if (closest.sub(p.position).Magnitude <= p.radius + b.opts.width / 2) p.End("clashed");
		}
	}
}

function startStruggles() {
	const free = beams.filter((b) => b.alive && b.opts.clash !== undefined && b.struggle === undefined);
	for (let i = 0; i < free.size(); i++) {
		const a = free[i];
		for (let j = i + 1; j < free.size(); j++) {
			const b = free[j];
			if (a.struggle || b.struggle || a.owner === b.owner) continue;

			const [pa, pb] = closestPointsOnSegments(a.origin, a.Tip(), b.origin, b.Tip());
			if (pa.sub(pb).Magnitude > (a.opts.width + b.opts.width) / 2) continue;

			// The meeting point, as a fraction of the way from a's origin to b's.
			const total = b.origin.sub(a.origin).Magnitude;
			if (total < 1e-3) continue;
			const meet = pa.Lerp(pb, 0.5);
			const t = math.clamp(meet.sub(a.origin).Magnitude / total, 0.05, 0.95);

			const struggle: Struggle = { a, b, t };
			a.struggle = struggle;
			b.struggle = struggle;
			struggles.push(struggle);
			a.opts.OnClash?.(a, b);
			b.opts.OnClash?.(b, a);
		}
	}
}

function stepStruggles(dt: number) {
	for (let i = struggles.size() - 1; i >= 0; i--) {
		const s = struggles[i];
		const { a, b } = s;

		// Either side gone: the other is free again.
		if (!a.alive || !b.alive) {
			a.struggle = undefined;
			b.struggle = undefined;
			struggles.remove(i);
			continue;
		}

		const total = b.origin.sub(a.origin).Magnitude;
		if (total > 1e-3) {
			const speed = ((a.opts.clash?.struggleSpeed ?? 4) + (b.opts.clash?.struggleSpeed ?? 4)) / 2;
			s.t = math.clamp(s.t + ((a.Power() - b.Power()) * speed * dt) / total, 0, 1);
		}

		// Both beams aim at the meeting point while locked.
		const point = a.origin.Lerp(b.origin, s.t);
		for (const beam of [a, b]) {
			const toPoint = point.sub(beam.origin);
			beam.reach = toPoint.Magnitude;
			if (toPoint.Magnitude > 1e-3) beam.direction = toPoint.Unit;
			beam.needsSync = true;
		}

		if (s.t >= 0.999) {
			b.End("overpowered");
			a.length = math.max(a.length, a.reach);
		} else if (s.t <= 0.001) {
			a.End("overpowered");
			b.length = math.max(b.length, b.reach);
		}
	}
}

// ----------------------------------------------------------------------------
// loop
// ----------------------------------------------------------------------------

function step(dt: number) {
	const now = os.clock();
	const syncInterval = Config.Projectiles.SyncInterval;

	for (const p of projectiles) {
		p.Step(dt);
		if (p.alive && p.needsSync && now - p.lastSyncAt >= syncInterval) sendSync(p);
	}
	resolveProjectileClashes();

	stepStruggles(dt);
	for (const b of beams) b.Step(dt);
	startStruggles();
	beamsEatProjectiles();
	for (const b of beams) {
		if (b.alive && b.needsSync && now - b.lastSyncAt >= syncInterval) sendBeamUpdate(b);
	}

	// Drop the dead.
	for (let i = projectiles.size() - 1; i >= 0; i--) if (!projectiles[i].alive) projectiles.remove(i);
	for (let i = beams.size() - 1; i >= 0; i--) if (!beams[i].alive) beams.remove(i);
}

export function start() {
	RunService.Heartbeat.Connect((dt) => {
		const [ok, err] = pcall(step, dt);
		if (!ok) warn(`[projectiles] step errored: ${err}`);
	});

	// Shots outlive their owner only while the owner is in the game.
	Players.PlayerRemoving.Connect((player) => {
		for (const p of projectiles) if (p.owner.GetInstance() === player) p.End("cancelled");
		for (const b of beams) if (b.owner.GetInstance() === player) b.End("cancelled");
	});

	// Late joiners need everything already in flight.
	Players.PlayerAdded.Connect((player) => {
		for (const p of getProjectiles()) {
			remote.FireClient(
				player,
				"spawn",
				p.id,
				p.opts.visual ?? "default",
				serverTime(),
				p.position,
				p.velocity,
				p.gravity,
				p.radius,
				p.owner.GetCharacter(),
				p.opts.visualData,
			);
		}
		for (const b of getBeams()) {
			remote.FireClient(
				player,
				"beam",
				b.id,
				b.opts.visual ?? "default",
				b.origin,
				b.direction,
				b.reach,
				b.opts.width,
				b.owner.GetCharacter(),
				b.opts.visualData,
			);
		}
	});
}
