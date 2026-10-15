/*
	projectiles/math.ts  (shared)

	Pure functions both sides use, so the client draws a projectile exactly
	where the server simulates it.
*/

const DOWN = new Vector3(0, -1, 0);

// Position after `t` seconds from `origin` at `velocity`, under `gravity` (studs/s², downward).
export function positionAt(origin: Vector3, velocity: Vector3, gravity: number, t: number): Vector3 {
	return origin.add(velocity.mul(t)).add(DOWN.mul(0.5 * gravity * t * t));
}

export function velocityAt(velocity: Vector3, gravity: number, t: number): Vector3 {
	return velocity.add(DOWN.mul(gravity * t));
}

// Turn unit vector `from` toward unit vector `to` by at most `maxAngle` radians.
export function rotateTowards(from: Vector3, to: Vector3, maxAngle: number): Vector3 {
	const dot = math.clamp(from.Dot(to), -1, 1);
	const angle = math.acos(dot);
	if (angle < 1e-4 || maxAngle <= 0) return angle < 1e-4 ? to : from;
	if (angle <= maxAngle) return to;

	const t = maxAngle / angle;
	const sinAngle = math.sin(angle);
	if (math.abs(sinAngle) < 1e-4) {
		// Exactly opposite: any perpendicular axis will do.
		const axis = math.abs(from.Y) < 0.99 ? from.Cross(Vector3.yAxis).Unit : from.Cross(Vector3.xAxis).Unit;
		return CFrame.fromAxisAngle(axis, maxAngle).mul(from);
	}
	return from
		.mul(math.sin((1 - t) * angle) / sinAngle)
		.add(to.mul(math.sin(t * angle) / sinAngle))
		.Unit;
}

// Mirror `v` off a surface with unit `normal`.
export function reflect(v: Vector3, normal: Vector3): Vector3 {
	return v.sub(normal.mul(2 * v.Dot(normal)));
}

// The closest point to `p` on segment a-b.
export function closestPointOnSegment(p: Vector3, a: Vector3, b: Vector3): Vector3 {
	const ab = b.sub(a);
	const lengthSq = ab.Dot(ab);
	if (lengthSq < 1e-8) return a;
	return a.add(ab.mul(math.clamp(p.sub(a).Dot(ab) / lengthSq, 0, 1)));
}

// The closest pair of points between segments p1-q1 and p2-q2.
export function closestPointsOnSegments(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): [Vector3, Vector3] {
	const d1 = q1.sub(p1);
	const d2 = q2.sub(p2);
	const r = p1.sub(p2);
	const a = d1.Dot(d1);
	const e = d2.Dot(d2);
	const f = d2.Dot(r);
	const EPS = 1e-8;

	let s: number;
	let t: number;
	if (a <= EPS && e <= EPS) return [p1, p2];
	if (a <= EPS) {
		s = 0;
		t = math.clamp(f / e, 0, 1);
	} else {
		const c = d1.Dot(r);
		if (e <= EPS) {
			t = 0;
			s = math.clamp(-c / a, 0, 1);
		} else {
			const b = d1.Dot(d2);
			const denom = a * e - b * b;
			s = denom > EPS ? math.clamp((b * f - c * e) / denom, 0, 1) : 0;
			t = (b * s + f) / e;
			if (t < 0) {
				t = 0;
				s = math.clamp(-c / a, 0, 1);
			} else if (t > 1) {
				t = 1;
				s = math.clamp((b - c) / a, 0, 1);
			}
		}
	}
	return [p1.add(d1.mul(s)), p2.add(d2.mul(t))];
}
