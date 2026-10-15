/*
	remotes.ts  (shared)

	The only wire between client and server.

		Client -> Server : requests carry intent only - never a damage number,
		                   a stat or an item object. The server decides.
		Server -> Client : StateChanged (authoritative snapshot) and
		                   CombatEffect (cosmetic: animations, sounds, FX).

	The server creates every RemoteEvent; the client only waits for them, so a
	client cannot invent a channel.
*/

import { ReplicatedStorage, RunService } from "@rbxts/services";

const FOLDER_NAME = "Remotes";

export const CLIENT_TO_SERVER = [
	"CombatInput",
	"AbilityInput",
	"GiveStandArrow",
	"RequestEquip",
	"RequestSetHotbar",
	"RequestUseItem",
	"RequestForge",
] as const;

export const SERVER_TO_CLIENT = ["StateChanged", "CombatEffect", "Projectile"] as const;

export type ClientToServerRemote = (typeof CLIENT_TO_SERVER)[number];
export type ServerToClientRemote = (typeof SERVER_TO_CLIENT)[number];
export type RemoteName = ClientToServerRemote | ServerToClientRemote;

function getFolder(): Folder {
	if (RunService.IsServer()) {
		let folder = ReplicatedStorage.FindFirstChild(FOLDER_NAME);
		if (!folder || !folder.IsA("Folder")) {
			folder = new Instance("Folder");
			folder.Name = FOLDER_NAME;
			folder.Parent = ReplicatedStorage;
		}
		for (const name of [...CLIENT_TO_SERVER, ...SERVER_TO_CLIENT]) {
			if (!folder.FindFirstChild(name)) {
				const remote = new Instance("RemoteEvent");
				remote.Name = name;
				remote.Parent = folder;
			}
		}
		return folder as Folder;
	}

	const folder = ReplicatedStorage.WaitForChild(FOLDER_NAME, 30);
	assert(folder && folder.IsA("Folder"), "Remotes: server never created the remote folder");
	return folder;
}

const folder = getFolder();

export function getRemote(name: RemoteName): RemoteEvent {
	const remote = folder.WaitForChild(name, 30);
	assert(remote && remote.IsA("RemoteEvent"), `Remotes: missing RemoteEvent "${name}"`);
	return remote;
}
