/*
	hotbarInput.ts  (client)

	Number keys select a framework hotbar slot (press the held slot again to
	go empty-handed), R uses the held item, T prints what you are holding.

	For an inventory/forge UI the remaining requests are one-liners:

		getRemote("RequestSetHotbar").FireServer(3, item.uid)   // undefined uid clears
		getRemote("RequestForge").FireServer(sword.uid, "Blade", 2)
*/

import { UserInputService } from "@rbxts/services";
import { Config } from "shared/config";
import { getRemote } from "shared/remotes";
import { getSnapshot, heldItem } from "../state";

const RequestEquip = getRemote("RequestEquip");
const RequestUseItem = getRemote("RequestUseItem");

const USE_KEY = Enum.KeyCode.R;
const DESCRIBE_KEY = Enum.KeyCode.T;

export function start() {
	UserInputService.InputBegan.Connect((input, processed) => {
		if (processed) return;
		const key = input.KeyCode;

		if (key.Value >= Enum.KeyCode.One.Value && key.Value <= Enum.KeyCode.Nine.Value) {
			const slot = key.Value - Enum.KeyCode.One.Value + 1;
			if (slot > Config.Inventory.HotbarSlots) return;
			const holding = getSnapshot()?.inventory.holding ?? 0;
			RequestEquip.FireServer(holding === slot ? 0 : slot);
			return;
		}

		if (key === USE_KEY) {
			RequestUseItem.FireServer();
			return;
		}

		if (key === DESCRIBE_KEY) {
			const held = heldItem();
			print(`[hotbar] holding: ${held ? held.stats.name : "nothing"}`);
		}
	});
}
