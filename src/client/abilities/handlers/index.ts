/*
	handlers/index.ts  (client)

	Every client ability handler. Add yours here after adding the ability to
	shared/abilities/catalog.ts. Abilities without a handler still work: the
	key just sends the request.
*/

import { ClientAbility } from "../clientAbility";
import { FlashStep } from "./flashStep";

export const HANDLERS: readonly ClientAbility[] = [FlashStep];
