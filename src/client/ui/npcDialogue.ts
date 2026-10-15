/*
	npcDialogue.ts  (client)

	Dialogue box for Verity. Opens when her ProximityPrompt is triggered and
	closes when you walk away. Asking for a Stand Arrow fires GiveStandArrow;
	the server checks you are actually next to her (server/npc/verity.ts).
*/

import { Players, ProximityPromptService, RunService } from "@rbxts/services";
import { getRemote } from "shared/remotes";

const player = Players.LocalPlayer;
const giveArrowEvent = getRemote("GiveStandArrow");

const NPC_NAME = "Verity";
const GREETING = "Hello! I'm Verity, your personal helper friend.. Ask me anything.";
const MAX_DISTANCE = 15;

interface DialogueOption {
	text: string;
	reply: string;
	action?: () => void;
}

const OPTIONS: DialogueOption[] = [
	{
		text: "Give me a stand arrow.",
		reply: "Sure, here's your stand arrow.",
		action: () => giveArrowEvent.FireServer(),
	},
	{
		text: "What's the capital of France",
		reply: "Oui oui oui, it is Maddox Stephens.",
	},
	{
		text: "Show me my quests.",
		reply: "...",
	},
];

function corner(parent: GuiObject, radius: UDim) {
	const c = new Instance("UICorner");
	c.CornerRadius = radius;
	c.Parent = parent;
}

export function start() {
	const gui = new Instance("ScreenGui");
	gui.Name = "NPCDialogueGui";
	gui.ResetOnSpawn = false;
	gui.Enabled = false;
	gui.Parent = player.WaitForChild("PlayerGui");

	const frame = new Instance("Frame");
	frame.AnchorPoint = new Vector2(0.5, 1);
	frame.Position = new UDim2(0.5, 0, 0.95, 0);
	frame.Size = new UDim2(0.5, 0, 0, 260);
	frame.BackgroundColor3 = Color3.fromRGB(25, 15, 40);
	frame.BorderSizePixel = 0;
	frame.Parent = gui;
	corner(frame, new UDim(0, 12));

	const stroke = new Instance("UIStroke");
	stroke.Color = Color3.fromRGB(190, 120, 255);
	stroke.Thickness = 2;
	stroke.Parent = frame;

	// NPC speech
	const topBar = new Instance("TextLabel");
	topBar.Size = new UDim2(1, -20, 0, 80);
	topBar.Position = new UDim2(0, 10, 0, 10);
	topBar.BackgroundColor3 = Color3.fromRGB(50, 30, 80);
	topBar.TextColor3 = new Color3(1, 1, 1);
	topBar.Font = Enum.Font.GothamBold;
	topBar.TextSize = 20;
	topBar.TextWrapped = true;
	topBar.Text = "";
	topBar.Parent = frame;
	corner(topBar, new UDim(0, 8));

	const closeBtn = new Instance("TextButton");
	closeBtn.Size = new UDim2(0, 28, 0, 28);
	closeBtn.Position = new UDim2(1, -34, 0, -14);
	closeBtn.BackgroundColor3 = Color3.fromRGB(200, 60, 60);
	closeBtn.Text = "X";
	closeBtn.TextColor3 = new Color3(1, 1, 1);
	closeBtn.Font = Enum.Font.GothamBold;
	closeBtn.TextSize = 16;
	closeBtn.Parent = frame;
	corner(closeBtn, new UDim(1, 0));

	const optionsFrame = new Instance("Frame");
	optionsFrame.Size = new UDim2(1, -20, 1, -110);
	optionsFrame.Position = new UDim2(0, 10, 0, 100);
	optionsFrame.BackgroundTransparency = 1;
	optionsFrame.Parent = frame;

	const layout = new Instance("UIListLayout");
	layout.Padding = new UDim(0, 8);
	layout.Parent = optionsFrame;

	let currentNPC: Instance | undefined;
	let currentPrompt: ProximityPrompt | undefined;
	let typeToken = 0;

	const typeText = (text: string) => {
		typeToken += 1;
		const myToken = typeToken;
		topBar.Text = text;
		topBar.MaxVisibleGraphemes = 0;
		// utf8.len returns false for invalid UTF-8; fall back to the byte count.
		const [graphemes] = utf8.len(text);
		const length = typeIs(graphemes, "number") ? graphemes : text.size();
		for (let i = 1; i <= length; i++) {
			if (myToken !== typeToken) return;
			topBar.MaxVisibleGraphemes = i;
			task.wait(0.02);
		}
		topBar.MaxVisibleGraphemes = -1;
	};

	const closeDialogue = () => {
		typeToken += 1;
		gui.Enabled = false;
		if (currentPrompt) currentPrompt.Enabled = true;
		currentNPC = undefined;
		currentPrompt = undefined;
	};

	for (const option of OPTIONS) {
		const btn = new Instance("TextButton");
		btn.Size = new UDim2(1, 0, 0, 40);
		btn.BackgroundColor3 = Color3.fromRGB(90, 50, 140);
		btn.TextColor3 = new Color3(1, 1, 1);
		btn.Font = Enum.Font.Gotham;
		btn.TextSize = 18;
		btn.Text = option.text;
		btn.AutoButtonColor = true;
		btn.Parent = optionsFrame;
		corner(btn, new UDim(0, 8));

		btn.MouseButton1Click.Connect(() => {
			task.spawn(typeText, option.reply);
			option.action?.();
		});
	}

	closeBtn.MouseButton1Click.Connect(closeDialogue);

	ProximityPromptService.PromptTriggered.Connect((prompt, triggeringPlayer) => {
		if (triggeringPlayer !== player) return;
		const npc = prompt.FindFirstAncestor(NPC_NAME);
		if (!npc) return;

		currentNPC = npc;
		currentPrompt = prompt;
		prompt.Enabled = false;
		gui.Enabled = true;
		task.spawn(typeText, GREETING);
	});

	// Auto-close when the player walks away.
	RunService.Heartbeat.Connect(() => {
		if (!currentNPC) return;
		const root = player.Character?.FindFirstChild("HumanoidRootPart");
		const npcRoot = currentNPC.FindFirstChild("HumanoidRootPart");
		if (
			!root ||
			!root.IsA("BasePart") ||
			!npcRoot ||
			!npcRoot.IsA("BasePart") ||
			root.Position.sub(npcRoot.Position).Magnitude > MAX_DISTANCE
		) {
			closeDialogue();
		}
	});
}
