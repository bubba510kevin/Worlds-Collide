/*
	apiStubs.ts  (shared)

	Definitions only make sense in the Shared folder (both sides must agree on
	them). The server and client WC tables export these stubs under the same
	names, so a Luau user calling one in the wrong folder gets told where it
	belongs instead of "attempt to call a nil value".
*/

function sharedOnly(fnName: string) {
	return () => error(`WC.${fnName} only works in a module inside ReplicatedStorage.WorldsCollide_Shared`, 2);
}

export const AddAbility = sharedOnly("AddAbility");
export const AddKit = sharedOnly("AddKit");
export const AddResource = sharedOnly("AddResource");
export const AddDefaultAbility = sharedOnly("AddDefaultAbility");
