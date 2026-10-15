/*
	main.server.ts  (server entry point)

	Stands the server up. Everything else is a module started from here, so
	the start order is explicit.
*/

import { RunService } from "@rbxts/services";
import { Config } from "shared/config";
import * as AbilityService from "./abilities/abilityService";
import * as CombatService from "./combat/combatService";
import * as Verity from "./npc/verity";
import * as Stands from "./powers/stands";
import * as Projectiles from "./projectiles/projectileService";
import * as PlayerService from "./services/playerService";
import * as Tests from "./tests";

if (Config.RunTestsInStudio && RunService.IsStudio()) {
	Tests.run();
}

// Handlers first, then players: PlayerService.start() registers everyone
// already in the server, and their first requests must have somewhere to go.
CombatService.start();
AbilityService.start();
Projectiles.start();
Verity.start();
Stands.start();
PlayerService.start();

print("[Worlds Collide] server online");
