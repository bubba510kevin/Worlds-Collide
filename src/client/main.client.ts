/*
	main.client.ts  (client entry point)

	Starts every client module. The client holds no stats and decides nothing:
	it turns input into requests and renders what the server sends back.
*/

import { ReplicatedStorage } from "@rbxts/services";
import * as SharedAPI from "shared/api";
import { loadContent } from "shared/contentLoader";
import * as AbilityClient from "./abilities/abilityClient";
import * as ClientAPI from "./api";
import * as CombatClient from "./combat/combatClient";
import * as PunchAnimator from "./combat/punchAnimator";
import * as HotbarInput from "./inventory/hotbarInput";
import * as Sprint from "./movement/sprint";
import * as Projectiles from "./projectiles/projectileClient";
import * as State from "./state";
import * as AbilityBar from "./ui/abilityBar";
import * as NpcDialogue from "./ui/npcDialogue";

// Luau content first: the same Shared definitions the server loaded, then the client looks.
loadContent(ReplicatedStorage.WaitForChild("WorldsCollide_Shared", 5), SharedAPI, "Shared");
loadContent(ReplicatedStorage.WaitForChild("WorldsCollide_Client", 5), ClientAPI, "Client");

State.start();
PunchAnimator.start();
CombatClient.start();
HotbarInput.start();
Sprint.start();
AbilityClient.start();
Projectiles.start();
AbilityBar.start();
NpcDialogue.start();
