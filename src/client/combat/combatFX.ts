/*
	combatFX.ts  (client)

	Cosmetic hit effects: hit flash, impact sparks, camera shake, combo popup.
*/

import { Debris, Players, RunService, TweenService, Workspace } from "@rbxts/services";

const SETTINGS = {
	HitEffectLifetime: 0.22,
	HitSparkCount: 12,
	CameraShakeTime: 0.12,
	CameraShakeStrength: 0.35,
	HeavyShakeMultiplier: 1.6,
	ComboDisplayTime: 0.55,
};

const player = Players.LocalPlayer;

export function CameraShake(strength = SETTINGS.CameraShakeStrength, duration = SETTINGS.CameraShakeTime) {
	const camera = Workspace.CurrentCamera;
	if (!camera) return;

	const start = os.clock();
	const connection = RunService.RenderStepped.Connect(() => {
		const elapsed = os.clock() - start;
		if (elapsed >= duration) {
			connection.Disconnect();
			return;
		}
		const fade = 1 - elapsed / duration;
		const x = (math.random() - 0.5) * 2 * strength * fade;
		const y = (math.random() - 0.5) * 2 * strength * fade;
		camera.CFrame = camera.CFrame.mul(CFrame.Angles(math.rad(y), math.rad(x), 0));
	});
}

export function HitFlash(character: Model) {
	const highlight = new Instance("Highlight");
	highlight.Name = "CombatHitFlash";
	highlight.FillColor = Color3.fromRGB(255, 255, 255);
	highlight.OutlineColor = Color3.fromRGB(255, 80, 80);
	highlight.FillTransparency = 0.15;
	highlight.OutlineTransparency = 0;
	highlight.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop;
	highlight.Parent = character;

	TweenService.Create(highlight, new TweenInfo(SETTINGS.HitEffectLifetime, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		FillTransparency: 1,
		OutlineTransparency: 1,
	}).Play();
	Debris.AddItem(highlight, SETTINGS.HitEffectLifetime + 0.05);
}

export function Impact(position: Vector3) {
	const holder = new Instance("Part");
	holder.Name = "CombatImpact";
	holder.Anchored = true;
	holder.CanCollide = false;
	holder.CanTouch = false;
	holder.CanQuery = false;
	holder.Transparency = 1;
	holder.Size = new Vector3(0.2, 0.2, 0.2);
	holder.Position = position;
	holder.Parent = Workspace;

	const attachment = new Instance("Attachment");
	attachment.Parent = holder;

	const sparks = new Instance("ParticleEmitter");
	sparks.Name = "HitSparks";
	sparks.Rate = 0;
	sparks.Lifetime = new NumberRange(0.08, 0.18);
	sparks.Speed = new NumberRange(12, 24);
	sparks.SpreadAngle = new Vector2(180, 180);
	sparks.Rotation = new NumberRange(0, 360);
	sparks.RotSpeed = new NumberRange(-360, 360);
	sparks.Drag = 8;
	sparks.LightEmission = 1;
	sparks.LightInfluence = 0;
	sparks.Size = new NumberSequence([
		new NumberSequenceKeypoint(0, 0.35),
		new NumberSequenceKeypoint(0.25, 0.18),
		new NumberSequenceKeypoint(1, 0),
	]);
	sparks.Transparency = new NumberSequence([new NumberSequenceKeypoint(0, 0), new NumberSequenceKeypoint(1, 1)]);
	sparks.Color = new ColorSequence(Color3.fromRGB(255, 220, 80));
	sparks.Parent = attachment;
	sparks.Emit(SETTINGS.HitSparkCount);

	const flash = new Instance("Part");
	flash.Name = "ImpactFlash";
	flash.Shape = Enum.PartType.Ball;
	flash.Material = Enum.Material.Neon;
	flash.Color = Color3.fromRGB(255, 230, 120);
	flash.Anchored = true;
	flash.CanCollide = false;
	flash.CanTouch = false;
	flash.CanQuery = false;
	flash.Transparency = 0.15;
	flash.Size = new Vector3(0.35, 0.35, 0.35);
	flash.Position = position;
	flash.Parent = Workspace;

	TweenService.Create(flash, new TweenInfo(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Size: new Vector3(1.8, 1.8, 1.8),
		Transparency: 1,
	}).Play();

	Debris.AddItem(flash, 0.15);
	Debris.AddItem(holder, 0.35);
}

// Flash + sparks + shake. `heavy` for finishers and crits.
export function Hit(character: Model, position: Vector3, heavy: boolean) {
	HitFlash(character);
	Impact(position);
	if (heavy) {
		CameraShake(SETTINGS.CameraShakeStrength * SETTINGS.HeavyShakeMultiplier, SETTINGS.CameraShakeTime * 1.25);
	} else {
		CameraShake();
	}
}

let comboLabel: TextLabel | undefined;

function getComboLabel(): TextLabel {
	if (comboLabel && comboLabel.Parent && comboLabel.Parent.Parent) return comboLabel;

	const gui = new Instance("ScreenGui");
	gui.Name = "CombatComboGui";
	gui.ResetOnSpawn = false;
	gui.IgnoreGuiInset = true;
	gui.Parent = player.WaitForChild("PlayerGui");

	const label = new Instance("TextLabel");
	label.Name = "Combo";
	label.AnchorPoint = new Vector2(0.5, 0.5);
	label.Position = UDim2.fromScale(0.5, 0.72);
	label.Size = UDim2.fromOffset(260, 70);
	label.BackgroundTransparency = 1;
	label.TextColor3 = Color3.fromRGB(255, 255, 255);
	label.TextStrokeTransparency = 0.25;
	label.TextStrokeColor3 = Color3.fromRGB(0, 0, 0);
	label.Font = Enum.Font.GothamBlack;
	label.TextScaled = true;
	label.TextTransparency = 1;
	label.Parent = gui;

	comboLabel = label;
	return label;
}

let comboToken = 0;

export function ShowCombo(combo: number) {
	const label = getComboLabel();
	comboToken += 1;
	const token = comboToken;

	label.Text = `${combo} HIT COMBO`;
	label.TextTransparency = 0;
	label.TextStrokeTransparency = 0.25;
	label.Size = UDim2.fromOffset(310, 85);

	TweenService.Create(label, new TweenInfo(0.12, Enum.EasingStyle.Back, Enum.EasingDirection.Out), {
		Size: UDim2.fromOffset(260, 70),
	}).Play();

	task.delay(SETTINGS.ComboDisplayTime, () => {
		// A newer hit restarted the popup; let it run.
		if (token !== comboToken) return;
		TweenService.Create(label, new TweenInfo(0.2, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			TextTransparency: 1,
			TextStrokeTransparency: 1,
		}).Play();
	});
}
