/*
	stands.ts  (server)

	Stand Arrows. A Stand is a kit (shared/abilities/catalog.ts, KITS) in the
	"stand" group, so a player can only ever have one. Using a Stand Arrow (a
	Tool named "StandArrow", handed out by Verity) gives a random Stand kit
	and consumes the arrow. A player who already has one cannot use another.

	No Stand kits exist yet; until one is added the arrow does nothing.

	Tool.Activated fires on the server when the holder clicks, so nothing here
	trusts the client beyond "I clicked with the arrow out".
*/

import { Players } from "@rbxts/services";
import { getKitsInGroup } from "shared/abilities/registry";
import { getGenericPlayer } from "../players";

export const ARROW_NAME = "StandArrow";
export const STAND_GROUP = "stand";

const rng = new Random();
const hooked = new WeakSet<Tool>();

export function awakenStand(player: Player): boolean {
	const gp = getGenericPlayer(player);
	if (!gp || gp.abilities.GetKitInGroup(STAND_GROUP) !== undefined) return false;

	const stands = getKitsInGroup(STAND_GROUP);
	if (stands.isEmpty()) {
		warn(`[stands] no kits in group "${STAND_GROUP}" - add one to shared/abilities/catalog.ts`);
		return false;
	}
	const stand = stands[rng.NextInteger(0, stands.size() - 1)];
	if (!gp.abilities.AddKit(stand.id)) return false;
	gp.MarkDirty();
	return true;
}

function hookTool(player: Player, tool: Instance) {
	if (!tool.IsA("Tool") || tool.Name !== ARROW_NAME || hooked.has(tool)) return;
	hooked.add(tool);

	tool.Activated.Connect(() => {
		// Only the arrow's current holder, and only while it is in hand.
		if (tool.Parent !== player.Character) return;
		if (awakenStand(player)) tool.Destroy();
	});
}

function watchPlayer(player: Player) {
	const watch = (container: Instance) => {
		for (const child of container.GetChildren()) hookTool(player, child);
		container.ChildAdded.Connect((child) => hookTool(player, child));
	};

	player.CharacterAdded.Connect(watch);
	if (player.Character) watch(player.Character);

	const backpack = player.WaitForChild("Backpack", 10);
	if (backpack) watch(backpack);
	// The Backpack is replaced on respawn.
	player.ChildAdded.Connect((child) => {
		if (child.IsA("Backpack")) watch(child);
	});
}

export function start() {
	Players.PlayerAdded.Connect((player) => task.spawn(watchPlayer, player));
	for (const player of Players.GetPlayers()) task.spawn(watchPlayer, player);
}
