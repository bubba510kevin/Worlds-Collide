/*
	flashStep.ts  (server)

	Flash Step. A "press" ability that stays active for maxDuration (the grab
	window) while the client dashes - the client owns its character's
	physics, so the dash itself happens there. If the dash runs into someone,
	the client sends an "input" naming them (OnInput); the server re-checks
	the grab, ends the activation, and lifts the target overhead and slams
	them into the ground.

	Tuning (damage, grabRange) lives in the catalog entry's `data`.

	The slam goes through calc_damage (strength and defense apply) and never
	crits. It ignores blocking: it is a grab. The damage goes through
	strike(), so damage hooks and GameEvents see it like any other hit.
*/

import { TweenService, Workspace } from "@rbxts/services";
import { abilityData, getAbility } from "shared/abilities/registry";
import { GetHumanoidAndRoot } from "shared/combatUtil";
import { applyStun, canBeHit } from "../../combat/combatService";
import { ability, ActiveContext } from "../ability";

const DEF = getAbility("FlashStep")!;
const DAMAGE = abilityData(DEF, "damage", 15);
const MAX_DISTANCE = abilityData(DEF, "grabRange", 15);
// lift (0.35) + slam (0.15) + time on the ground (0.8)
const SLAM_TIME = 1.3;

function tweenRoot(root: BasePart, cf: CFrame, time: number, style: Enum.EasingStyle, direction: Enum.EasingDirection) {
	const tween = TweenService.Create(root, new TweenInfo(time, style, direction), { CFrame: cf });
	tween.Play();
	tween.Completed.Wait();
}

// Lift the target overhead and slam it down; `onImpact` runs as it hits the ground.
function slam(attacker: Model, attackerRoot: BasePart, target: Model, victimRoot: BasePart, victimHumanoid: Humanoid, onImpact: () => void) {
	let flatDirection = victimRoot.Position.sub(attackerRoot.Position);
	flatDirection = new Vector3(flatDirection.X, 0, flatDirection.Z);
	if (flatDirection.Magnitude < 0.1) flatDirection = attackerRoot.CFrame.LookVector;

	const origin = attackerRoot.Position;
	const base = CFrame.lookAt(origin, origin.add(flatDirection.Unit));

	const rayParams = new RaycastParams();
	rayParams.FilterDescendantsInstances = [attacker, target];
	rayParams.FilterType = Enum.RaycastFilterType.Exclude;
	const ground = Workspace.Raycast(origin, new Vector3(0, -15, 0), rayParams);
	const groundY = ground ? ground.Position.Y : origin.Y - 3;

	const originalPlatformStand = victimHumanoid.PlatformStand;
	victimHumanoid.PlatformStand = true;
	victimRoot.AssemblyLinearVelocity = Vector3.zero;
	victimRoot.Anchored = true;

	pcall(() => {
		const overheadPos = base.mul(new CFrame(0, 3.5, -2.5)).Position;
		const overheadCF = new CFrame(overheadPos).mul(base.Rotation).mul(CFrame.Angles(math.rad(-160), 0, 0));
		tweenRoot(victimRoot, overheadCF, 0.35, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);

		const slamPos = base.mul(new CFrame(0, 0, -3.5)).Position;
		const groundCF = new CFrame(slamPos.X, groundY + 1, slamPos.Z).mul(base.Rotation).mul(CFrame.Angles(math.rad(-90), 0, 0));
		tweenRoot(victimRoot, groundCF, 0.15, Enum.EasingStyle.Quad, Enum.EasingDirection.In);

		onImpact();
		task.wait(0.8);

		victimRoot.CFrame = new CFrame(slamPos.X, groundY + 3, slamPos.Z).mul(base.Rotation);
	});

	if (victimRoot.Parent) victimRoot.Anchored = false;
	if (victimHumanoid.Parent) {
		victimHumanoid.PlatformStand = originalPlatformStand;
		if (victimHumanoid.Health > 0) victimHumanoid.ChangeState(Enum.HumanoidStateType.GettingUp);
	}
}

export class FlashStep extends ability {
	private readonly beingSlammed = new Set<Model>();

	constructor() {
		super(DEF);
	}

	// Nothing to do up front: activation just opens the grab window.

	// The client reports who the dash ran into.
	public OnInput(ctx: ActiveContext, target: unknown) {
		if (!typeIs(target, "Instance") || !target.IsA("Model") || target === ctx.character) return;
		if (this.beingSlammed.has(target) || !canBeHit(target)) return;

		const [victimHumanoid, victimRoot] = GetHumanoidAndRoot(target);
		if (!victimHumanoid || !victimRoot) return;
		if (ctx.root.Position.sub(victimRoot.Position).Magnitude > MAX_DISTANCE) return;

		// One grab per activation.
		ctx.End("completed");
		this.beingSlammed.add(target);
		applyStun(target, SLAM_TIME);

		const onImpact = () => {
			const result = this.strike(ctx, target, {
				base: DAMAGE,
				canCrit: false,
				stun: 0, // already stunned for the whole slam
				ignoreBlock: true,
				wallCheck: false,
				fromPosition: ctx.root.Position,
			});
			if (result) this.confirmHit(ctx, target, result.victimRoot.Position, false);
		};

		// The tweens yield, so run outside the remote handler. Always release
		// the target, even if the slam errors.
		task.spawn(() => {
			const [ok, err] = pcall(slam, ctx.character, ctx.root, target, victimRoot, victimHumanoid, onImpact);
			if (!ok) warn(`[FlashStep] slam errored: ${err}`);
			this.beingSlammed.delete(target);
		});
	}
}
