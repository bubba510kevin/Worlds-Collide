/*
	remoteHandler.ts  (server)

	The trust boundary. Every client request is wired through onRemote(), which
	guarantees the same steps run in the same order for every remote:

		1. Lookup     - is this a registered Generic_Player?
		2. Rate limit - may they ask again yet?
		3. Handler    - type-check every argument, check authority, act.
		4. Replicate  - anything that changed state marks the player dirty;
		               start() sends one snapshot per dirty player per frame.

	A handler that throws is caught and logged; it cannot take the connection
	down, which would otherwise be a free denial of service.
*/

import { RunService } from "@rbxts/services";
import { Config } from "shared/config";
import { ClientToServerRemote, getRemote } from "shared/remotes";
import { Generic_Player } from "../generic_player/generic_player";
import { activePlayers, getGenericPlayer } from "../players";

const StateChanged = getRemote("StateChanged");

function push(gp: Generic_Player) {
	gp.dirty = false;
	StateChanged.FireClient(gp.GetInstance(), gp.ToSnapshot());
}

/*
	Record an invalid request. Violations decay at ViolationDecayRate per
	second, so this measures a *rate* of bad requests: an honest player who
	trips a check now and then never accumulates anything.

	Only call this for requests a legitimate client would not send. Ordinary
	misses caused by latency (cooldown, out of range) should just be ignored.
*/
export function reject(gp: Generic_Player, remoteName: string, reason: string) {
	const now = os.clock();
	const elapsed = math.max(0, now - gp.violationsUpdatedAt);
	gp.violationsUpdatedAt = now;
	gp.violations = math.max(0, gp.violations - elapsed * Config.ViolationDecayRate) + 1;

	if (RunService.IsStudio()) {
		const shown = math.floor(gp.violations * 10) / 10;
		warn(
			`[Remotes] rejected ${remoteName} from ${gp.GetInstance().Name}: ${reason} (violations ${shown}/${Config.MaxViolations})`,
		);
	}

	if (Config.MaxViolations > 0 && gp.violations >= Config.MaxViolations) {
		gp.GetInstance().Kick("Too many invalid requests.");
	}
}

export function onRemote(name: ClientToServerRemote, handler: (gp: Generic_Player, ...args: unknown[]) => void) {
	getRemote(name).OnServerEvent.Connect((player, ...args) => {
		const gp = getGenericPlayer(player);
		if (!gp) return; // arrived before setup or after teardown

		const limit = Config.RateLimits[name];
		if (limit && !gp.limiter.Consume(name, limit.burst, limit.refill)) {
			reject(gp, name, "rate limited");
			return;
		}

		const [ok, err] = pcall(handler, gp, ...args);
		if (!ok) warn(`[Remotes] handler ${name} errored for ${player.Name}: ${err}`);
	});
}

/*
	The one place snapshots are sent from: every frame, each player whose
	state changed (MarkDirty) gets a single fresh snapshot, no matter how many
	things changed that frame.
*/
export function start() {
	RunService.Heartbeat.Connect(() => {
		for (const [, gp] of activePlayers) if (gp.dirty) push(gp);
	});
}
