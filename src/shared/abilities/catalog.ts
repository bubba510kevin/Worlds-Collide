/*
	abilities/catalog.ts  (shared)

	THE place to add content. Every ability, kit and resource in the game is
	listed here; nothing else needs touching for the data side.

	Adding an ability:
		1. Add its AbilityDef to ABILITIES.
		2. Server behaviour: a class extending `ability` in
		   src/server/abilities/library/, listed in server/abilities/library/index.ts.
		   (Pure stat passives need no class - `modifiers` is enough.)
		3. Client side (movement, animation, FX): a ClientAbility in
		   src/client/abilities/handlers/, listed in handlers/index.ts.
		   Optional - without one, the key just sends the request.
*/

import { AbilityDef, KitDef, ResourceDef } from "./types";

export const RESOURCES: readonly ResourceDef[] = [
	{
		id: "Energy",
		name: "Energy",
		max: "energy", // the player's energy stat
		regen: 8,
		color: Color3.fromRGB(80, 180, 255),
	},
];

export const ABILITIES: readonly AbilityDef[] = [
	{
		id: "FlashStep",
		name: "Flash Step",
		description: "Vanish into a burst of speed. Run into someone to grab them and slam them into the ground.",
		binding: "player",
		input: "press",
		defaultKey: Enum.KeyCode.Q,
		cooldown: 4,
		costs: [{ resource: "Energy", amount: 25 }],
		// Stays active while the client dashes, so it can report a grab target.
		maxDuration: 1,
		tags: ["movement"],
		data: { damage: 15, grabRange: 15 },
	},
];

export const KITS: readonly KitDef[] = [
	// e.g. { id: "MyStand", name: "My Stand", description: "...", group: "stand", abilities: ["..."] },
];

// Granted to every player on join, with source "innate".
export const DEFAULT_ABILITIES: readonly string[] = ["FlashStep"];
