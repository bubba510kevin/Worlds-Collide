/*
	players.ts  (server)

	The registry of Generic_Player wrappers. Kept in its own module (not in the
	entry script) so anything on the server can look a player up without a
	circular import.
*/

import { Players } from "@rbxts/services";
import { Generic_Player } from "./generic_player/generic_player";

export const activePlayers = new Map<Player, Generic_Player>();

export function getGenericPlayer(player: Player): Generic_Player | undefined {
	return activePlayers.get(player);
}

// The Generic_Player behind a character model, or undefined for NPCs.
export function getGenericPlayerFromCharacter(character: Model): Generic_Player | undefined {
	const player = Players.GetPlayerFromCharacter(character);
	return player ? activePlayers.get(player) : undefined;
}
