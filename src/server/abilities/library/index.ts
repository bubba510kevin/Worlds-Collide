/*
	library/index.ts  (server)

	Every ability behaviour class. Add yours here after adding its entry to
	shared/abilities/catalog.ts. Abilities with no class (pure stat passives,
	client-only abilities) need nothing here.
*/

import { ability } from "../ability";
import { FlashStep } from "./flashStep";

export const LIBRARY: readonly ability[] = [new FlashStep()];
