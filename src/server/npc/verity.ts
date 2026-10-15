/*
	verity.ts  (server)

	Verity, the helper NPC. Her dialogue runs on the client; the one thing that
	needs the server is handing out a Stand Arrow.

	Expects a model named "Verity" (with a HumanoidRootPart) in Workspace and a
	Tool named "StandArrow" in ServerStorage. Both are place assets, not code.
*/

import { ServerStorage, Workspace } from "@rbxts/services";
import { onRemote } from "../network/remoteHandler";
import { ARROW_NAME, STAND_GROUP } from "../powers/stands";

const NPC_NAME = "Verity";
const MAX_DISTANCE = 20;

export function start() {
	onRemote("GiveStandArrow", (gp) => {
		const player = gp.GetInstance();

		const npcRoot = Workspace.FindFirstChild(NPC_NAME)?.FindFirstChild("HumanoidRootPart");
		const root = player.Character?.FindFirstChild("HumanoidRootPart");

		// Must be standing near Verity - stops the remote being fired from anywhere.
		if (!npcRoot || !npcRoot.IsA("BasePart") || !root || !root.IsA("BasePart")) return;
		if (root.Position.sub(npcRoot.Position).Magnitude > MAX_DISTANCE) return;

		// One Stand per player: no arrow for someone who already has one.
		if (gp.abilities.GetKitInGroup(STAND_GROUP) !== undefined) return;

		// No duplicates.
		const backpack = player.FindFirstChildOfClass("Backpack");
		if (!backpack || backpack.FindFirstChild(ARROW_NAME) || player.Character?.FindFirstChild(ARROW_NAME)) return;

		const template = ServerStorage.FindFirstChild(ARROW_NAME);
		if (!template) {
			warn(`[Verity] ServerStorage.${ARROW_NAME} is missing`);
			return;
		}
		template.Clone().Parent = backpack;
	});
}
