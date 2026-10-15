/*
	projectile.ts  (server)

	One server-simulated projectile. The server moves it with ray/sphere
	casts every frame and decides every hit; clients only draw it
	(projectileClient.ts), using the same kinematics from shared/projectiles/math.ts.

	Everything is optional except origin, direction and speed. Callbacks are
	plain function properties: `OnHitCharacter: (p, victim) => ...`.

	What a hit does is decided by the matching callback's return value:
		"stop"   end here
		"pierce" keep going through this character (they can't be hit twice)
		"bounce" reflect off this surface
		"pass"   ignore this thing entirely
	With no callback (or no return value) the defaults are: characters ->
	pierce while `pierce` charges remain, else stop; world -> bounce while
	`bounces` remain, else stop.
*/

import { Workspace } from "@rbxts/services";
import { GetCharacterFromPart } from "shared/combatUtil";
import { Config } from "shared/config";
import { reflect, rotateTowards } from "shared/projectiles/math";
import { StrikeOptions, StrikeResult } from "../combat/combatService";
import type { Generic_Player } from "../generic_player/generic_player";

export type HitDecision = "stop" | "pierce" | "bounce" | "pass";

export type ProjectileEndReason = "hit" | "hitWorld" | "expired" | "clashed" | "cancelled" | "replaced";

// Damage applied automatically on a character hit, through strike().
export interface ProjectileStrike extends Omit<StrikeOptions, "knockback" | "fromPosition" | "wallCheck"> {
	// Knockback along the projectile's travel direction.
	knockback?: number;
	knockbackDuration?: number;
}

export interface ProjectileOptions {
	origin: Vector3;
	direction: Vector3;
	speed: number;

	gravity?: number; // studs/s², downward. 0 = straight line.
	radius?: number; // sphere-cast radius; 0 = thin ray
	lifetime?: number; // seconds
	maxDistance?: number; // studs travelled

	pierce?: number; // characters it can pass through before stopping
	bounces?: number; // surfaces it can bounce off
	bounciness?: number; // speed kept per bounce, 0..1 (default 0.8)
	hitsWorld?: boolean; // false = flies through geometry (default true)

	homing?: {
		target: BasePart | Model | (() => Vector3 | undefined);
		turnRate: number; // degrees per second
	};

	// Meets an enemy projectile with clash: the stronger survives with power
	// reduced by the weaker's; equal powers destroy each other.
	clash?: { power: number };

	// Client renderer id (projectileClient.ts) and anything it needs.
	visual?: string;
	visualData?: unknown;

	tags?: string[];
	// Extra Instances casts ignore.
	ignore?: Instance[];

	strike?: ProjectileStrike;

	CanHit?: (p: Projectile, victim: Model) => boolean;
	OnHitCharacter?: (p: Projectile, victim: Model, position: Vector3, result?: StrikeResult) => HitDecision | void;
	OnHitWorld?: (p: Projectile, hit: RaycastResult) => HitDecision | void;
	OnTick?: (p: Projectile, dt: number) => void;
	OnClash?: (p: Projectile, other: Projectile) => void;
	OnEnd?: (p: Projectile, reason: ProjectileEndReason, position: Vector3) => void;
}

// Hooks the service provides, so this file does not import it back.
export interface ProjectileHost {
	strike: (attacker: Generic_Player, victim: Model, opts: StrikeOptions) => StrikeResult | undefined;
	replicateEnd: (p: Projectile, reason: ProjectileEndReason) => void;
}

let nextId = 0;

export class Projectile {
	public readonly id: number;
	public readonly owner: Generic_Player;
	public readonly opts: ProjectileOptions;
	public readonly radius: number;
	public readonly gravity: number;
	public readonly tags: readonly string[];
	// Free per-projectile storage for callbacks.
	public readonly state = new Map<string, unknown>();

	public position: Vector3;
	public velocity: Vector3;
	public age = 0;
	public distance = 0;
	public alive = true;
	public pierceLeft: number;
	public bouncesLeft: number;
	public clashPower: number;
	// Characters already hit; never hit twice.
	public readonly hit = new Set<Model>();

	// Set when the velocity changed in a way clients can't predict.
	public needsSync = false;
	public lastSyncAt = 0;

	private readonly ignore: Instance[];
	private readonly params = new RaycastParams();
	// The ignore list changed since it was last handed to `params`.
	private filterDirty = true;

	constructor(owner: Generic_Player, opts: ProjectileOptions, private readonly host: ProjectileHost) {
		nextId += 1;
		this.id = nextId;
		this.owner = owner;
		this.opts = opts;
		this.radius = math.max(0, opts.radius ?? 0);
		this.gravity = opts.gravity ?? 0;
		this.tags = opts.tags ?? [];
		this.position = opts.origin;
		const dir = opts.direction.Magnitude > 1e-4 ? opts.direction.Unit : new Vector3(0, 0, -1);
		this.velocity = dir.mul(opts.speed);
		this.pierceLeft = opts.pierce ?? 0;
		this.bouncesLeft = opts.bounces ?? 0;
		this.clashPower = opts.clash?.power ?? 0;

		this.ignore = [...(opts.ignore ?? [])];
		const ownerChar = owner.GetCharacter();
		if (ownerChar) this.ignore.push(ownerChar);
		this.params.FilterType = Enum.RaycastFilterType.Exclude;
	}

	// ------------------------------------------------------------------------
	// control (callable from callbacks and abilities)
	// ------------------------------------------------------------------------

	public SetVelocity(velocity: Vector3) {
		this.velocity = velocity;
		this.needsSync = true;
	}

	// Same speed, new heading.
	public Redirect(direction: Vector3) {
		if (direction.Magnitude < 1e-4) return;
		this.SetVelocity(direction.Unit.mul(this.velocity.Magnitude));
	}

	public Teleport(position: Vector3) {
		this.position = position;
		this.needsSync = true;
	}

	public End(reason: ProjectileEndReason = "cancelled") {
		if (!this.alive) return;
		this.alive = false;
		this.opts.OnEnd?.(this, reason, this.position);
		this.host.replicateEnd(this, reason);
	}

	// ------------------------------------------------------------------------
	// simulation
	// ------------------------------------------------------------------------

	public Step(dt: number) {
		if (!this.alive) return;
		this.age += dt;
		this.opts.OnTick?.(this, dt);
		if (!this.alive) return;

		if (this.age >= (this.opts.lifetime ?? Config.Projectiles.DefaultLifetime)) return this.End("expired");
		this.steer(dt);

		// Exact displacement under gravity for this frame.
		const down = new Vector3(0, -this.gravity, 0);
		let remaining = this.velocity.mul(dt).add(down.mul(0.5 * dt * dt));
		this.velocity = this.velocity.add(down.mul(dt));
		const travelled = remaining.Magnitude;

		for (let cast = 0; cast < Config.Projectiles.MaxCastsPerStep && this.alive; cast++) {
			if (remaining.Magnitude < 1e-4) break;

			const hit = this.cast(remaining);
			if (!hit) {
				this.position = this.position.add(remaining);
				break;
			}

			const direction = remaining.Unit;
			const center = this.position.add(direction.mul(hit.Distance));
			const leftover = remaining.sub(direction.mul(hit.Distance));
			this.position = center;

			const victim = GetCharacterFromPart(hit.Instance);
			if (victim) {
				remaining = this.onCharacter(victim, hit, leftover);
			} else if (!hit.Instance.CanCollide && this.opts.hitsWorld !== false) {
				// Non-collidable scenery (VFX, hitboxes) never stops a projectile.
				this.addIgnore(hit.Instance);
				remaining = leftover;
			} else {
				remaining = this.onWorld(hit, leftover);
			}
		}

		if (!this.alive) return;
		this.distance += travelled;
		if (this.distance >= (this.opts.maxDistance ?? Config.Projectiles.DefaultMaxDistance)) this.End("expired");
	}

	private steer(dt: number) {
		const homing = this.opts.homing;
		if (!homing) return;

		let targetPos: Vector3 | undefined;
		const target = homing.target;
		if (typeIs(target, "function")) targetPos = target();
		else if (target.IsA("BasePart")) targetPos = target.Parent ? target.Position : undefined;
		else targetPos = target.Parent ? target.GetPivot().Position : undefined;
		if (!targetPos) return;

		const toTarget = targetPos.sub(this.position);
		if (toTarget.Magnitude < 1e-3 || this.velocity.Magnitude < 1e-3) return;

		const heading = rotateTowards(this.velocity.Unit, toTarget.Unit, math.rad(homing.turnRate) * dt);
		this.velocity = heading.mul(this.velocity.Magnitude);
		this.needsSync = true;
	}

	private cast(displacement: Vector3): RaycastResult | undefined {
		if (this.filterDirty) {
			this.params.FilterDescendantsInstances = this.ignore;
			this.filterDirty = false;
		}
		if (this.radius > 0) return Workspace.Spherecast(this.position, this.radius, displacement, this.params);
		return Workspace.Raycast(this.position, displacement, this.params);
	}

	private addIgnore(instance: Instance) {
		this.ignore.push(instance);
		this.filterDirty = true;
	}

	private onCharacter(victim: Model, hit: RaycastResult, leftover: Vector3): Vector3 {
		this.addIgnore(victim);
		if (this.hit.has(victim)) return leftover;
		if (this.opts.CanHit && !this.opts.CanHit(this, victim)) return leftover;
		this.hit.add(victim);

		let result: StrikeResult | undefined;
		const s = this.opts.strike;
		if (s) {
			result = this.host.strike(this.owner, victim, {
				...s,
				tags: [...this.tags, ...(s.tags ?? []), "projectile"],
				fromPosition: this.position,
				// The cast already proved the path is clear.
				wallCheck: false,
				knockback:
					s.knockback !== undefined && s.knockback > 0
						? { direction: this.velocity, distance: s.knockback, duration: s.knockbackDuration ?? 0.25 }
						: undefined,
			});
		}

		let decision = this.opts.OnHitCharacter?.(this, victim, hit.Position, result);
		if (decision === undefined) decision = this.pierceLeft > 0 ? "pierce" : "stop";

		if (decision === "stop") {
			this.End("hit");
		} else if (decision === "pierce") {
			this.pierceLeft -= 1;
		} else if (decision === "bounce") {
			return this.bounce(hit.Normal, leftover);
		}
		return leftover;
	}

	private onWorld(hit: RaycastResult, leftover: Vector3): Vector3 {
		let decision = this.opts.OnHitWorld?.(this, hit);
		if (decision === undefined) {
			if (this.opts.hitsWorld === false) decision = "pass";
			else decision = this.bouncesLeft > 0 ? "bounce" : "stop";
		}

		if (decision === "pass") {
			this.addIgnore(hit.Instance);
			return leftover;
		}
		if (decision === "bounce") {
			this.bouncesLeft -= 1;
			return this.bounce(hit.Normal, leftover);
		}
		this.End("hitWorld");
		return Vector3.zero;
	}

	private bounce(normal: Vector3, leftover: Vector3): Vector3 {
		const keep = math.clamp(this.opts.bounciness ?? 0.8, 0, 1);
		this.velocity = reflect(this.velocity, normal).mul(keep);
		// Step off the surface so the next cast doesn't start inside it.
		this.position = this.position.add(normal.mul(0.05));
		this.needsSync = true;
		return reflect(leftover, normal).mul(keep);
	}
}
