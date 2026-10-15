/*
	effects.ts  (shared)

	Small helpers for purely visual parts.
*/

// An anchored, non-colliding, unqueryable neon part: the base of every effect.
export function effectPart(): Part {
	const part = new Instance("Part");
	part.Anchored = true;
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = false;
	part.Material = Enum.Material.Neon;
	return part;
}
