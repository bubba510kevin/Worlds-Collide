/*
	abilityBar.ts  (client)

	One bar per resource, and one slot per usable (non-passive) ability the
	player has right now, showing:

		key (from keybinds), name, charges (when more than one),
		a cooldown sweep with seconds to the next charge,
		a glow while the server says it is active,
		a red tint when the costs can't be paid,
		border colour by binding: purple player, gold item, teal any.

	Rebuilt whenever the set of abilities or the keybinds change.
*/

import { Players, RunService, UserInputService } from "@rbxts/services";
import { getAbility, getResource } from "shared/abilities/registry";
import { AbilityBinding } from "shared/abilities/types";
import * as AbilityState from "../abilities/abilityState";
import * as Keybinds from "../abilities/keybinds";

const player = Players.LocalPlayer;

const SLOT_SIZE = 64;
const SLOT_GAP = 8;
const BAR_HEIGHT = 8;

const BINDING_COLOR: Record<AbilityBinding, Color3> = {
	player: Color3.fromRGB(150, 120, 220),
	item: Color3.fromRGB(235, 190, 80),
	any: Color3.fromRGB(90, 200, 190),
};
const ACTIVE_COLOR = Color3.fromRGB(255, 255, 255);
const NORMAL_BG = Color3.fromRGB(30, 25, 45);
const BROKE_BG = Color3.fromRGB(70, 25, 35);

interface Slot {
	id: string;
	frame: Frame;
	stroke: UIStroke;
	cooldownFill: Frame;
	cooldownText: TextLabel;
	chargesText: TextLabel;
}

interface Bar {
	id: string;
	fill: Frame;
}

function corner(parent: GuiObject, radius: number) {
	const c = new Instance("UICorner");
	c.CornerRadius = new UDim(0, radius);
	c.Parent = parent;
}

function label(parent: Instance, props: Partial<WritableInstanceProperties<TextLabel>>): TextLabel {
	const l = new Instance("TextLabel");
	l.BackgroundTransparency = 1;
	l.TextColor3 = new Color3(1, 1, 1);
	l.Font = Enum.Font.GothamBold;
	for (const [k, v] of pairs(props)) (l as unknown as Record<string, unknown>)[k as string] = v;
	l.Parent = parent;
	return l;
}

function keyName(key: Enum.KeyCode | undefined): string {
	if (!key) return "";
	return UserInputService.GetStringForKeyCode(key) || key.Name;
}

export function start() {
	const gui = new Instance("ScreenGui");
	gui.Name = "AbilityBar";
	gui.ResetOnSpawn = false;
	gui.Parent = player.WaitForChild("PlayerGui");

	const holder = new Instance("Frame");
	holder.Name = "Holder";
	holder.AnchorPoint = new Vector2(0.5, 1);
	holder.Position = new UDim2(0.5, 0, 1, -16);
	holder.Size = UDim2.fromOffset(0, 0);
	holder.AutomaticSize = Enum.AutomaticSize.XY;
	holder.BackgroundTransparency = 1;
	holder.Parent = gui;

	const column = new Instance("UIListLayout");
	column.FillDirection = Enum.FillDirection.Vertical;
	column.HorizontalAlignment = Enum.HorizontalAlignment.Center;
	column.Padding = new UDim(0, 6);
	column.SortOrder = Enum.SortOrder.LayoutOrder;
	column.Parent = holder;

	const slotsFrame = new Instance("Frame");
	slotsFrame.Name = "Slots";
	slotsFrame.LayoutOrder = 1;
	slotsFrame.Size = new UDim2(0, 0, 0, SLOT_SIZE);
	slotsFrame.AutomaticSize = Enum.AutomaticSize.X;
	slotsFrame.BackgroundTransparency = 1;
	slotsFrame.Parent = holder;

	const row = new Instance("UIListLayout");
	row.FillDirection = Enum.FillDirection.Horizontal;
	row.Padding = new UDim(0, SLOT_GAP);
	row.SortOrder = Enum.SortOrder.LayoutOrder;
	row.Parent = slotsFrame;

	const barsFrame = new Instance("Frame");
	barsFrame.Name = "Resources";
	barsFrame.LayoutOrder = 2;
	barsFrame.Size = UDim2.fromOffset(300, 0);
	barsFrame.AutomaticSize = Enum.AutomaticSize.Y;
	barsFrame.BackgroundTransparency = 1;
	barsFrame.Parent = holder;

	const barList = new Instance("UIListLayout");
	barList.Padding = new UDim(0, 3);
	barList.Parent = barsFrame;

	let slots: Slot[] = [];
	let bars: Bar[] = [];
	let shownKey = "";

	const build = () => {
		for (const s of slots) s.frame.Destroy();
		for (const b of bars) b.fill.Parent?.Destroy();
		slots = [];
		bars = [];

		for (const id of AbilityState.resourceIds()) {
			const def = getResource(id);
			const back = new Instance("Frame");
			back.Name = id;
			back.Size = new UDim2(1, 0, 0, BAR_HEIGHT);
			back.BackgroundColor3 = Color3.fromRGB(20, 20, 30);
			back.BorderSizePixel = 0;
			back.Parent = barsFrame;
			corner(back, 4);

			const fill = new Instance("Frame");
			fill.Size = new UDim2(1, 0, 1, 0);
			fill.BackgroundColor3 = def?.color ?? Color3.fromRGB(200, 200, 200);
			fill.BorderSizePixel = 0;
			fill.Parent = back;
			corner(fill, 4);

			bars.push({ id, fill });
		}

		AbilityState.owned().forEach((id, i) => {
			const def = getAbility(id);
			if (!def || def.input === "passive") return;

			const frame = new Instance("Frame");
			frame.Name = id;
			frame.LayoutOrder = i;
			frame.Size = UDim2.fromOffset(SLOT_SIZE, SLOT_SIZE);
			frame.BackgroundColor3 = NORMAL_BG;
			frame.BorderSizePixel = 0;
			frame.ClipsDescendants = true;
			frame.Parent = slotsFrame;
			corner(frame, 8);

			const stroke = new Instance("UIStroke");
			stroke.Color = BINDING_COLOR[def.binding];
			stroke.Thickness = 2;
			stroke.Parent = frame;

			label(frame, {
				Position: new UDim2(0, 4, 0, 18),
				Size: new UDim2(1, -8, 1, -22),
				TextScaled: true,
				TextWrapped: true,
				Text: def.name,
			});
			label(frame, {
				Position: new UDim2(0, 4, 0, 2),
				Size: new UDim2(1, -8, 0, 16),
				Font: Enum.Font.GothamBlack,
				TextColor3: Color3.fromRGB(255, 220, 120),
				TextSize: 14,
				TextXAlignment: Enum.TextXAlignment.Left,
				Text: keyName(Keybinds.GetKey(id)),
			});
			const chargesText = label(frame, {
				Position: new UDim2(0, 4, 0, 2),
				Size: new UDim2(1, -8, 0, 16),
				Font: Enum.Font.GothamBlack,
				TextSize: 14,
				TextXAlignment: Enum.TextXAlignment.Right,
				Text: "",
				ZIndex: 4,
			});

			// Sweeps down as the next charge comes back.
			const cooldownFill = new Instance("Frame");
			cooldownFill.AnchorPoint = new Vector2(0, 1);
			cooldownFill.Position = new UDim2(0, 0, 1, 0);
			cooldownFill.Size = new UDim2(1, 0, 0, 0);
			cooldownFill.BackgroundColor3 = new Color3(0, 0, 0);
			cooldownFill.BackgroundTransparency = 0.35;
			cooldownFill.BorderSizePixel = 0;
			cooldownFill.ZIndex = 2;
			cooldownFill.Parent = frame;

			const cooldownText = label(frame, {
				Size: new UDim2(1, 0, 1, 0),
				Font: Enum.Font.GothamBlack,
				TextSize: 22,
				Text: "",
				ZIndex: 3,
			});

			slots.push({ id, frame, stroke, cooldownFill, cooldownText, chargesText });
		});
	};

	const rebuildIfChanged = () => {
		const key = `${AbilityState.owned().join(",")}|${AbilityState.resourceIds().join(",")}`;
		if (key !== shownKey) {
			shownKey = key;
			build();
		}
	};

	AbilityState.onChanged(rebuildIfChanged);
	Keybinds.OnChanged(build);

	RunService.RenderStepped.Connect(() => {
		for (const bar of bars) {
			const max = AbilityState.resourceMax(bar.id);
			bar.fill.Size = new UDim2(max > 0 ? math.clamp(AbilityState.resource(bar.id) / max, 0, 1) : 0, 0, 1, 0);
		}

		for (const slot of slots) {
			const def = getAbility(slot.id);
			const snap = AbilityState.snapshotOf(slot.id);
			if (!def || !snap) continue;

			const charges = AbilityState.charges(slot.id);
			const remaining = AbilityState.rechargeRemaining(slot.id);
			const empty = charges < 1;
			const fraction = empty && def.cooldown > 0 ? math.clamp(remaining / def.cooldown, 0, 1) : 0;

			slot.cooldownFill.Size = new UDim2(1, 0, fraction, 0);
			slot.cooldownText.Text = empty && remaining > 0 ? `${math.ceil(remaining)}` : "";
			slot.chargesText.Text = snap.maxCharges > 1 ? `${charges}` : "";
			slot.frame.BackgroundColor3 = AbilityState.canAfford(def.costs ?? []) ? NORMAL_BG : BROKE_BG;
			slot.stroke.Color = snap.active ? ACTIVE_COLOR : BINDING_COLOR[def.binding];
		}
	});
}
