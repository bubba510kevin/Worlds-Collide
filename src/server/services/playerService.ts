/*
	playerService.ts  (server)

	Player lifecycle and the inventory/forge requests.

	Joining creates a Generic_Player, gives the starter kit and sends the first
	snapshot. Leaving drops the wrapper so the Player can be garbage collected.
*/

import { Players } from "@rbxts/services";
import { DEFAULT_ABILITIES } from "shared/abilities/catalog";
import { Config } from "shared/config";
import { DefaultForgeStats, IsCategory } from "shared/forgeData";
import { Generic_Player } from "../generic_player/generic_player";
import { isValidHotbarSlot } from "../inventory/inventory";
import { new_item_stats } from "../item/item";
import { sword } from "../item/weapon/sword";
import { onRemote, push, reject } from "../network/remoteHandler";
import { activePlayers } from "../players";

function giveStarterKit(gp: Generic_Player) {
	const starter = new sword(new_item_stats("Apprentice Sword"), DefaultForgeStats(), "Forged from the default parts.");
	const inv = gp.GetInventory();
	if (inv.AddItem(starter)) {
		inv.SetHotbar(1, starter.uid);
		gp.SetHolding(1);
	}}

function onPlayerAdded(player: Player) {
	if (activePlayers.has(player)) return;

	const gp = new Generic_Player(player);
	activePlayers.set(player, gp);

	player.CharacterAdded.Connect((character) => {
		character.WaitForChild("Humanoid", 10);
		gp.ApplyStatsToCharacter();
	});
	if (player.Character) gp.ApplyStatsToCharacter();

	for (const id of DEFAULT_ABILITIES) gp.abilities.Grant(id, "innate");
	giveStarterKit(gp);
	push(gp);
}

function onPlayerRemoving(player: Player) {
	// Drop the wrapper so its reference to the Player is released.
	activePlayers.delete(player);
}

// ----------------------------------------------------------------------------
// client -> server
// ----------------------------------------------------------------------------

function registerHandlers() {
	// RequestEquip(slot) - hold a hotbar slot, or 0 for empty-handed.
	onRemote("RequestEquip", (gp, slot) => {
		if (!typeIs(slot, "number")) return reject(gp, "RequestEquip", "slot is not a number");
		if (!gp.SetHolding(slot)) return reject(gp, "RequestEquip", `invalid slot ${slot}`);
		gp.MarkDirty();
	});

	// RequestSetHotbar(slot, uid?) - an undefined uid clears the slot.
	onRemote("RequestSetHotbar", (gp, slot, uid) => {
		if (!isValidHotbarSlot(slot)) return reject(gp, "RequestSetHotbar", "invalid slot");
		const inv = gp.GetInventory();

		if (uid === undefined) {
			inv.ClearHotbar(slot);
			if (gp.GetHolding() === slot) gp.SetHolding(0);
			gp.MarkDirty();
			return;
		}

		if (!typeIs(uid, "string")) return reject(gp, "RequestSetHotbar", "uid is not a string");
		// Ownership is enforced inside SetHotbar.
		if (!inv.SetHotbar(slot, uid)) return reject(gp, "RequestSetHotbar", "item not owned");
		gp.MarkDirty();
	});

	// RequestUseItem() - use whatever is held. The client does not get to name the item.
	onRemote("RequestUseItem", (gp) => {
		const held = gp.HoldingItem();
		if (held && held.Use(gp)) gp.MarkDirty();
	});

	// RequestForge(uid, category, partId) - swap a part on a sword the player owns.
	onRemote("RequestForge", (gp, uid, category, partId) => {
		if (!typeIs(uid, "string")) return reject(gp, "RequestForge", "uid is not a string");
		if (!IsCategory(category)) return reject(gp, "RequestForge", "unknown category");
		if (!typeIs(partId, "number")) return reject(gp, "RequestForge", "partId is not a number");

		const owned = gp.GetInventory().GetByUid(uid);
		if (!owned) return reject(gp, "RequestForge", "item not owned");
		if (!(owned instanceof sword)) return reject(gp, "RequestForge", "item cannot be forged");
		if (!owned.SetForgePart(category, partId)) return reject(gp, "RequestForge", "invalid part");
		gp.MarkDirty();
	});
}

export function start() {
	registerHandlers();

	Players.PlayerAdded.Connect(onPlayerAdded);
	Players.PlayerRemoving.Connect(onPlayerRemoving);
	for (const player of Players.GetPlayers()) onPlayerAdded(player);

	// Safety net only: handlers push immediately. This catches a missed update.
	task.spawn(() => {
		for (;;) {
			task.wait(Config.SnapshotInterval);
			for (const [, gp] of activePlayers) push(gp);
		}
	});
}
