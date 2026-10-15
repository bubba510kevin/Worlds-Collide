/*
	beam.ts  (server)

	A continuous ray: Kamehameha, Getsuga, a laser, a stream of fire. It
	starts at `origin`, points along `direction` (both may be functions, so a
	beam can follow the caster's hand and aim), grows at `extendSpeed` up to
	`maxLength`, is cut short by walls, and hits what it touches every
	`tickInterval` seconds.

	Two beams with `clash` that touch lock into a struggle: the meeting point
	slides toward the weaker beam (power can be a function - charge, button
	mashing, a resource...). When it reaches one beam's origin, that beam
	ends "overpowered" and the winner is free to extend through.

	A clashing beam also destroys enemy projectiles that fly into it.
*/

import { Workspace } from "@rbxts/services";
import { GetCharacterFromPart } from "shared/combatUtil";
import type { Generic_Player } from "../generic_player/generic_player";
import { StrikeOptions, StrikeResult } from "../combat/combatService";
import { ProjectileStrike } from "./projectile";

export type BeamEndReason = "expired" | "overpowered" | "cancelled" | "replaced";

export interface BeamOptions {
	origin: Vector3 | (() => Vector3 | undefined);
	direction: Vector3 | (() => Vector3 | undefined);
	width: number;
	maxLength: number;
	extendSpeed?: number; // studs/s; default instant
	duration?: number; // seconds; default until ended
	tickInterval?: number; // seconds between hits on the same target (default 0.2)
	hitsWorld?: boolean; // walls cut it short (default true)
	pierce?: boolean; // hit everyone along it, not just the nearest (default false)

	clash?: {
		power: number | (() => number);
		// Studs per second the meeting point moves per point of power difference (default 4).
		struggleSpeed?: number;
	};

	visual?: string;
	visualData?: unknown;
	tags?: string[];
	ignore?: Instance[];

	strike?: ProjectileStrike;

	CanHit?: (beam: Beam, victim: Model) => boolean;
	OnHitCharacter?: (beam: Beam, victim: Model, position: Vector3, result?: StrikeResult) => void;
	OnTick?: (beam: Beam, dt: number) => void;
	OnClash?: (beam: Beam, other: Beam) => void;
	OnEnd?: (beam: Beam, reason: BeamEndReason) => void;
}

export interface BeamHost {
	strike: (attacker: Generic_Player, victim: Model, opts: StrikeOptions) => StrikeResult | undefined;
	replicateEnd: (beam: Beam, reason: BeamEndReason) => void;
}

// Shared by both beams in a struggle.
export interface Struggle {
	a: Beam;
	b: Beam;
	// 0 = at a's origin, 1 = at b's origin
	t: number;
}

let nextId = 0;

export class Beam {
	public readonly id: number;
	public readonly owner: Generic_Player;
	public readonly opts: BeamOptions;
	public readonly tags: readonly string[];
	public readonly state = new Map<string, unknown>();

	public origin: Vector3;
	public direction: Vector3;
	// How far it has grown.
	public length = 0;
	// How far it actually reaches this frame (walls, struggles).
	public reach = 0;
	public age = 0;
	public alive = true;
	public struggle?: Struggle;

	public lastSyncAt = 0;
	public needsSync = true;

	private readonly lastHit = new Map<Model, number>();
	private readonly ignore: Instance[];
	private readonly params = new RaycastParams();
	private readonly overlap = new OverlapParams();

	constructor(owner: Generic_Player, opts: BeamOptions, private readonly host: BeamHost) {
		nextId += 1;
		this.id = nextId;
		this.owner = owner;
		this.opts = opts;
		this.tags = opts.tags ?? [];

		this.ignore = [...(opts.ignore ?? [])];
		const ownerChar = owner.GetCharacter();
		if (ownerChar) this.ignore.push(ownerChar);
		this.params.FilterType = Enum.RaycastFilterType.Exclude;
		this.params.FilterDescendantsInstances = this.ignore;
		this.overlap.FilterType = Enum.RaycastFilterType.Exclude;
		this.overlap.FilterDescendantsInstances = this.ignore;

		this.origin = this.resolveOrigin() ?? Vector3.zero;
		this.direction = this.resolveDirection() ?? new Vector3(0, 0, -1);
		if (opts.extendSpeed === undefined) this.length = opts.maxLength;
	}

	public Power(): number {
		const p = this.opts.clash?.power;
		if (p === undefined) return 0;
		return typeIs(p, "function") ? p() : p;
	}

	// The current tip of the beam.
	public Tip(): Vector3 {
		return this.origin.add(this.direction.mul(this.reach));
	}

	public End(reason: BeamEndReason = "cancelled") {
		if (!this.alive) return;
		this.alive = false;
		this.opts.OnEnd?.(this, reason);
		this.host.replicateEnd(this, reason);
	}

	private resolveOrigin(): Vector3 | undefined {
		const o = this.opts.origin;
		return typeIs(o, "function") ? o() : o;
	}

	private resolveDirection(): Vector3 | undefined {
		const d = this.opts.direction;
		const v = typeIs(d, "function") ? d() : d;
		return v && v.Magnitude > 1e-4 ? v.Unit : undefined;
	}

	// Distance to the first wall along the beam, up to `max`.
	private wallDistance(max: number): number {
		if (this.opts.hitsWorld === false || max <= 0) return max;
		// `params` holds the permanent ignore list; anything skipped this frame
		// is added on top and the list is restored afterwards.
		let skipped = false;
		let distance = max;
		for (let pass = 0; pass < 6; pass++) {
			const hit = Workspace.Raycast(this.origin, this.direction.mul(max), this.params);
			if (!hit) break;
			// Characters are targets and VFX parts are scenery; neither stops it.
			const owner = GetCharacterFromPart(hit.Instance);
			if (!owner && hit.Instance.CanCollide) {
				distance = hit.Distance;
				break;
			}
			this.params.AddToFilter(owner ?? hit.Instance);
			skipped = true;
		}
		if (skipped) this.params.FilterDescendantsInstances = this.ignore;
		return distance;
	}

	/*
		Move, grow and hit. The struggle position (if any) has already been
		applied to `reach` by the service before this runs.
	*/
	public Step(dt: number) {
		if (!this.alive) return;
		this.age += dt;
		this.opts.OnTick?.(this, dt);
		if (!this.alive) return;
		if (this.opts.duration !== undefined && this.age >= this.opts.duration) return this.End("expired");

		const origin = this.resolveOrigin();
		const direction = this.resolveDirection();
		if (!origin || !direction) return this.End("cancelled");
		if (origin.sub(this.origin).Magnitude > 0.05) this.needsSync = true;
		this.origin = origin;
		// While locked in a struggle the service aims it at the meeting point.
		if (!this.struggle) {
			if (direction.Dot(this.direction) < 0.9999) this.needsSync = true;
			this.direction = direction;
		}

		if (!this.struggle) {
			if (this.length < this.opts.maxLength) {
				this.length = math.min(this.opts.maxLength, this.length + (this.opts.extendSpeed ?? math.huge) * dt);
				this.needsSync = true;
			}
			const reach = this.wallDistance(this.length);
			if (math.abs(reach - this.reach) > 0.05) this.needsSync = true;
			this.reach = reach;
		}

		this.hitAlong();
	}

	private hitAlong() {
		if (this.reach <= 0.1) return;
		const interval = this.opts.tickInterval ?? 0.2;
		const now = os.clock();

		const center = this.origin.add(this.direction.mul(this.reach / 2));
		const boxCFrame = CFrame.lookAt(center, center.add(this.direction));
		const size = new Vector3(this.opts.width, this.opts.width, this.reach);

		// Every character touching the beam, nearest first.
		const seen = new Set<Model>();
		const victims: { model: Model; distance: number }[] = [];
		for (const part of Workspace.GetPartBoundsInBox(boxCFrame, size, this.overlap)) {
			const model = GetCharacterFromPart(part);
			if (!model || seen.has(model)) continue;
			seen.add(model);
			victims.push({ model, distance: part.Position.sub(this.origin).Dot(this.direction) });
		}
		victims.sort((x, y) => x.distance < y.distance);

		// A non-piercing beam visibly stops at the first body in its way.
		const first = victims[0];
		if (!this.opts.pierce && first && !this.struggle) {
			const stopAt = math.clamp(first.distance, 0, this.reach);
			if (math.abs(stopAt - this.reach) > 0.05) this.needsSync = true;
			this.reach = stopAt;
		}

		for (const { model } of victims) {
			if (this.opts.CanHit && !this.opts.CanHit(this, model)) continue;

			const last = this.lastHit.get(model);
			if (last === undefined || now - last >= interval) {
				this.lastHit.set(model, now);
				const position = model.GetPivot().Position;
				let result: StrikeResult | undefined;
				const s = this.opts.strike;
				if (s) {
					result = this.host.strike(this.owner, model, {
						...s,
						tags: [...this.tags, ...(s.tags ?? []), "beam"],
						fromPosition: this.origin,
						wallCheck: false,
						knockback:
							s.knockback !== undefined && s.knockback > 0
								? { direction: this.direction, distance: s.knockback, duration: s.knockbackDuration ?? 0.2 }
								: undefined,
					});
				}
				this.opts.OnHitCharacter?.(this, model, position, result);
			}
			// A non-piercing beam stops at the first body in its path.
			if (!this.opts.pierce) break;
		}
	}
}
