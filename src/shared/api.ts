/*
	api.ts  (shared)  -  the `WC` table given to modules in WorldsCollide_Shared

	Defining things both sides need to know about: abilities, kits and
	resources. These must be defined in the Shared folder so the server and
	every client agree on them. The server and client APIs re-use
	GetAbility/GetKit/GetResource from here.
*/

import {
	addDefaultAbility,
	getAbility,
	getKit,
	getResource,
	registerAbility,
	registerKit,
	registerResource,
} from "./abilities/registry";
import { AbilityDef, KitDef, ResourceDef } from "./abilities/types";

// Define a new ability. See the Use Guide for every field.
export function AddAbility(def: unknown): AbilityDef {
	return registerAbility(def);
}

// Define a kit: a bundle of abilities (a Stand, a clan, a race, a form...).
export function AddKit(def: unknown): KitDef {
	return registerKit(def);
}

// Define a resource pool, like Mana or Stamina.
export function AddResource(def: unknown): ResourceDef {
	return registerResource(def);
}

// Every player gets this ability when they join.
export function AddDefaultAbility(id: unknown) {
	addDefaultAbility(id);
}

export function GetAbility(id: unknown): AbilityDef | undefined {
	return getAbility(id);
}

export function GetKit(id: unknown): KitDef | undefined {
	return getKit(id);
}

// The definition of a resource (not a player's amount).
export function GetResourceInfo(id: unknown): ResourceDef | undefined {
	return getResource(id);
}
