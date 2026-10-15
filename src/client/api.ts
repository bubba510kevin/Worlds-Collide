/*
	api.ts  (client)  -  the `WC` table given to modules in WorldsCollide_Client

	How abilities look and feel on the player's screen: client handlers,
	projectile and beam visuals, keybinds, and pressing abilities from UI.
	Ordinary LocalScripts can use it too:

		local WC = require(game.Players.LocalPlayer.PlayerScripts.TS.api)

	Nothing here can cheat: the server re-checks everything.
*/

import { getAbility } from "shared/abilities/registry";
import { PlayerSnapshot } from "shared/types";
import { press, registerHandler, release } from "./abilities/abilityClient";
import * as AbilityState from "./abilities/abilityState";
import { ClientAbility } from "./abilities/clientAbility";
import * as Keybinds from "./abilities/keybinds";
import { BeamRenderer, ProjectileRenderer, registerBeamRenderer, registerProjectileRenderer } from "./projectiles/renderers";
import { getSnapshot } from "./state";

export { GetAbility, GetKit, GetResourceInfo } from "shared/api";

const HANDLER_FIELDS = [
	"exclusive",
	"CanPress",
	"GetPressPayload",
	"GetReleasePayload",
	"OnPress",
	"OnRelease",
	"OnRecast",
	"OnActiveChanged",
	"Effect",
];

// Definitions belong in the Shared folder; these stubs say so if called here.
export { AddAbility, AddDefaultAbility, AddKit, AddResource } from "shared/apiStubs";

/*
	Give an ability its client side: a table of optional functions.
	WC.AbilityLook("Fireball", { GetPressPayload = function(ctx) ... end })
*/
export function AbilityLook(id: unknown, handler: unknown) {
	if (!getAbility(id)) error(`WC.AbilityLook: no ability called "${tostring(id)}". Add it with WC.AddAbility in the Shared folder first`, 2);
	if (!typeIs(handler, "table")) error(`WC.AbilityLook("${tostring(id)}"): the second argument must be a table`, 2);
	for (const [key] of pairs(handler as object)) {
		if (!HANDLER_FIELDS.includes(key as string)) {
			warn(`WC.AbilityLook("${tostring(id)}"): "${tostring(key)}" isn't used. Fields are: ${HANDLER_FIELDS.join(", ")}`);
		}
	}
	registerHandler({ ...(handler as object), id: id as string } as ClientAbility);
}

// A look for projectiles: { Create = function(args) return { Update = ..., Destroy = ... } end }
export function ProjectileLook(id: unknown, renderer: unknown) {
	if (!typeIs(id, "string") || !typeIs(renderer, "table") || !typeIs((renderer as ProjectileRenderer).Create, "function")) {
		error(`WC.ProjectileLook: use WC.ProjectileLook("name", { Create = function(args) ... end })`, 2);
	}
	registerProjectileRenderer(id, renderer as ProjectileRenderer);
}

// A look for beams: { Create = function(args) return { Update = ..., Destroy = ... } end }
export function BeamLook(id: unknown, renderer: unknown) {
	if (!typeIs(id, "string") || !typeIs(renderer, "table") || !typeIs((renderer as BeamRenderer).Create, "function")) {
		error(`WC.BeamLook: use WC.BeamLook("name", { Create = function(args) ... end })`, 2);
	}
	registerBeamRenderer(id, renderer as BeamRenderer);
}

// Press / let go of an ability, e.g. from a touch button.
export function Press(id: unknown): boolean {
	return press(tostring(id));
}

export function Release(id: unknown) {
	release(tostring(id));
}

// Change an ability's key. Pass nil to unbind.
export function SetKey(id: unknown, key: unknown) {
	if (key !== undefined && !typeIs(key, "EnumItem")) error(`WC.SetKey: the key must be like Enum.KeyCode.G, or nil`, 2);
	Keybinds.SetKey(tostring(id), key as Enum.KeyCode | undefined);
}

export function GetKey(id: unknown): Enum.KeyCode | undefined {
	return Keybinds.GetKey(tostring(id));
}

// What the server last told us about ourselves (stats, items, abilities). Read-only.
export function GetMyState(): PlayerSnapshot | undefined {
	return getSnapshot();
}

// Ability ids we have right now.
export function GetMyAbilities(): string[] {
	return AbilityState.owned();
}

export function GetCooldown(id: unknown): number {
	return AbilityState.rechargeRemaining(tostring(id));
}

export function GetMyResource(id: unknown): number {
	return AbilityState.resource(tostring(id));
}
