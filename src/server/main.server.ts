/*
	main.server.ts  (server entry point)

	Stands the server up. Everything else is a module started from here, so
	the start order is explicit.
*/

import { ReplicatedStorage, RunService, ServerScriptService } from "@rbxts/services";
import * as SharedAPI from "shared/api";
import { Config } from "shared/config";
import { loadContent } from "shared/contentLoader";
import * as AbilityService from "./abilities/abilityService";
import * as ServerAPI from "./api";
import * as CombatService from "./combat/combatService";
import * as Verity from "./npc/verity";
import * as Stands from "./powers/stands";
import * as Projectiles from "./projectiles/projectileService";
import * as PlayerService from "./services/playerService";
import * as Tests from "./tests";

// Luau content first, so its abilities exist before anyone can use them.
loadContent(ReplicatedStorage.FindFirstChild("WorldsCollide_Shared"), SharedAPI, "Shared");
loadContent(ServerScriptService.FindFirstChild("WorldsCollide_Server"), ServerAPI, "Server");

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
