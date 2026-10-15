# Worlds Collide

📘 **Making content in Luau?** Read the **[Use Guide](docs/USE_GUIDE.md)**.
🛠️ **Changing the framework in TypeScript?** Read the **[Developer Guide](docs/DEV_GUIDE.md)**.

A Roblox game written in TypeScript with [roblox-ts](https://roblox-ts.com) and synced into Studio with [Rojo](https://rojo.space).

## Setup

```sh
npm install
npm run build      # or: npm run watch
rojo serve         # then connect from the Rojo plugin in Studio
```

Rojo maps `out/server` to ServerScriptService, `out/shared` to ReplicatedStorage and `out/client` to StarterPlayerScripts (see `default.project.json`).

## Layout

```
content/                  Luau content (synced by Rojo, no build step)
  shared/                 -> ReplicatedStorage.WorldsCollide_Shared   ability/kit/resource definitions
  server/                 -> ServerScriptService.WorldsCollide_Server ability code
  client/                 -> ReplicatedStorage.WorldsCollide_Client   ability looks

src/
  shared/                 used by both server and client
    types.ts              stat blocks + snapshot types
    config.ts             tuning and server validation limits
    combatConfig.ts       the M1 combo (damage, timings, hitboxes)
    abilities/            ability data: catalog.ts (content), registry.ts, types.ts
    forgeData.ts          forge part database
    remotes.ts            every RemoteEvent, created by the server
    combatUtil.ts         Push (knockback/lunges), character helpers
    projectiles/math.ts   kinematics + geometry shared by server sim and client drawing

  server/
    main.server.ts        entry point, starts every service
    players.ts            activePlayers: Player -> Generic_Player
    generic_player/       Generic_Player: stats, inventory, held item
    inventory/            Inventory: items + 9-slot hotbar (by uid)
    item/                 item -> weapon -> sword (forged)
    combat/CalcHit.ts     calc_hit (hitbox) and calc_damage (damage formula)
    combat/combatService  M1 combos, blocking, stun, knockback
    abilities/            ability base class, service, holder, resources, events, library/
    stats/                StatModifiers (players and weapons)
    projectiles/          server-simulated projectiles and beams (clashes, struggles)
    powers/stands.ts      Stand Arrow -> random kit from the "stand" group
    npc/verity.ts         Verity hands out the Stand Arrow
    services/playerService join/leave, inventory and forge requests
    network/              remote wrapper (rate limit, validation, kick), rate limiter
    tests.ts              framework self-tests, run in Studio on start

  client/
    main.client.ts        entry point
    state.ts              cached snapshot from the server
    abilities/            input modes, keybinds, prediction, handlers/
    combat/               combat input, procedural punch animator, hit FX
    movement/             sprint (Shift), rig poses
    projectiles/          draws projectiles/beams; renderer registry
    inventory/            hotbar keys
    ui/abilityBar.ts      ability slots with cooldowns + energy bar
    ui/npcDialogue.ts     Verity's dialogue box
```

## How the framework fits together

- **The server owns all state.** Clients send intent only ("M1", "equip slot 3", "forge Blade part 2"). Every request goes through `onRemote()` in `network/remoteHandler.ts`, which rate-limits it, catches errors, and re-sends the player's snapshot when something changed. Repeated invalid requests get the player kicked.
- **`Generic_Player`** wraps each Roblox `Player`: stats (`health`, `defense`, `energy`, `speed`, `strength`, `critChance`, `critDamage`), an `Inventory`, and which hotbar slot is held. `health` and `speed` are pushed onto the Humanoid on spawn.
- **Items:** `item` → `weapon` (stats: `damage`, `attack_speed`, `range`, `cc`, `cd`, plus durability) → `sword` (stats come from its 10 forge parts). A broken weapon fights like bare hands.
- **Combat:** `combatService` handles timing. `weapon.hit()` / `calc_hit()` finds targets, and `calc_damage()` computes damage:
  `(attack + weapon.damage × 0.25) × (1 + strength/50)`, × crit multiplier on a crit, × `100 / (100 + defense)`.
  The weapon's `attack_speed` shortens recovery and its `range` stretches the hitbox.

## Ability system

Content-free by design. The only ability shipped is **Flash Step** (Q), as a worked example. Everything else is engine.

### Adding content

1. **Data:** add an `AbilityDef` to `ABILITIES` in `src/shared/abilities/catalog.ts`. Kits and resources go in the same file.
2. **Server behaviour (optional):** add a class extending `ability` in `src/server/abilities/library/` and list it in `library/index.ts`. Without one, the ability is pure data, which is enough for stat passives.
3. **Client side (optional):** add a `ClientAbility` in `src/client/abilities/handlers/` and list it in `handlers/index.ts`. Use it for movement, animation and FX. Without one, the key just sends the request.

### What an `AbilityDef` can say

| Field | Meaning |
| --- | --- |
| `binding` | `"player"`, `"item"` or `"any"`: which sources may grant it |
| `input` | `"press"`, `"hold"`, `"toggle"` or `"passive"` |
| `defaultKey` | default keybind (players can rebind via `client/abilities/keybinds.ts`) |
| `cooldown`, `charges` | seconds per charge, and how many charges are stored |
| `cooldownStartsOnEnd` | recharge waits until the ability ends (channels, toggles) |
| `costs` | any number of `{ resource, amount }`, paid all-or-nothing |
| `maxDuration` | how long it may stay active (press defaults to 0, meaning instant) |
| `blockedBy` / `interruptedBy` | character attributes that stop or end it (defaults: Stunned, Blocking / Stunned) |
| `allowWithTool`, `requiresWeapon` | equipment rules |
| `modifiers` | stat changes applied for as long as it is granted (passives) |
| `tags`, `data` | free-form labels and tuning, readable on both sides |

### Server hooks (`src/server/abilities/ability.ts`)

All of these are optional:

- **Activation:** `CanActivate`, then `OnActivate` (return `false` to refuse and charge nothing).
- **While active:** `OnRecast` (pressed again), `OnRelease` (hold released or toggle off), `OnInput` (any extra client message: aim, target, stage), `OnTick`, and `OnEnd(reason)`. The reason is one of `released`, `expired`, `completed`, `cancelled`, `interrupted`, `revoked` or `died`.
- **Lifetime:** `OnGranted` / `OnRevoked`.
- **Dynamic numbers:** `GetCooldown`, `GetCosts`.

The context gives `caster`, `character`, `root`, `source`, and per-activation `active.state`, plus `End()`, `SetRemaining()` and `Elapsed()`.

Helpers that clean up after themselves:
- `listen(ctx, GameEvents.Hit, fn)` and `addDamageHook(ctx, "incoming", fn)` last while the ability is granted.
- `listenWhileActive` and `addDamageHookWhileActive` last for one activation.
- `strike()` hits through the shared combat rules.
- `broadcast()` and `tell()` send cosmetic effects; `confirmHit()` shows hit FX.

### Where abilities come from (`Generic_Player.abilities`)

| Source | How |
| --- | --- |
| innate / quests / anything | `gp.abilities.Grant(id, source, duration?)` and `Revoke` / `RevokeSource` |
| kits (Stand, class, race, form...) | `gp.abilities.AddKit(id)`: one kit per `group` |
| the held item's parts | forge parts' `abilities` |
| one specific item | `item.BindAbility(id)`: travels with that item |

Each source only grants abilities whose `binding` allows it. Cooldown control: `ResetCooldown`, `ReduceCooldown`. Interrupt from anywhere: `cancelAbility(gp, id)`.

### Supporting systems

- **Resources** (`RESOURCES` in the catalog): max from a number or a player stat, regen per second, delay after spending. Energy is defined by default.
- **Stat modifiers:** `gp.modifiers` and `weapon.modifiers`, as `(base + flat) × mult`. Each modifier has an id and a source and can be timed.
- **Events** (`GameEvents`): `Hit`, `Damaged`, `AbilityActivated`, `AbilityEnded`, `AbilityGranted`, `AbilityRevoked`.
- **Damage hooks:** `gp.outgoingDamage` and `gp.incomingDamage` can change any strike's damage before it lands.
- **Stand Arrows** give a random kit from the `"stand"` group. None are defined yet, so the arrow currently does nothing.

### Client

- `abilityClient` maps keys to `press` / `release` per input mode, checks charges, costs and blockers locally, and predicts cooldowns and resources.
- Handlers get `CanPress`, `GetPressPayload`, `GetReleasePayload`, `OnPress`, `OnRelease`, `OnRecast`, `OnActiveChanged` and `Effect`. `exclusive` handlers block other abilities while they run.
- `press(id)` and `release(id)` are exported for touch buttons.
- The ability bar shows resources, charges, cooldowns, active state, and binding by border color.

## Projectiles and beams

All simulation and hit detection happens on the server (`src/server/projectiles/`). Clients only draw, using the same kinematics and the shared server clock, so what you see matches what hits. Every hit goes through `strike()`, so blocking, i-frames, defense, damage hooks and `GameEvents` all apply.

**Projectiles** (`fireProjectile` / `this.fireProjectile(ctx, ...)` in an ability):

```ts
this.fireProjectile(ctx, {
	origin: ctx.root.Position,
	direction: aim,              // e.g. from the client's press payload, validated
	speed: 120,
	radius: 1,                   // sphere-cast; 0 = thin ray
	gravity: 0,                  // > 0 arcs
	pierce: 2, bounces: 1,       // characters to pass through / walls to bounce off
	homing: { target: someModel, turnRate: 180 },
	clash: { power: 10 },        // meets enemy clash projectiles: stronger survives
	strike: { base: 20, stun: 0.3, knockback: 6 },
	visual: "default", visualData: { color: Color3.fromRGB(255, 80, 40) },
	OnHitCharacter: (p, victim, pos, result) => "pierce", // or "stop" / "bounce" / "pass"
	OnHitWorld: (p, hit) => "stop",
	OnTick: (p, dt) => {},       // p.Redirect(), p.SetVelocity(), p.Teleport(), p.End()
	OnEnd: (p, reason, pos) => {},
});
```

**Beams** (`fireBeam`, or `this.fireBeamWhileActive(ctx, ...)` so it ends with a held or toggled ability):

```ts
this.fireBeamWhileActive(ctx, {
	origin: () => ctx.root.Position,          // functions follow the caster
	direction: () => ctx.root.CFrame.LookVector,
	width: 4, maxLength: 150, extendSpeed: 200,
	tickInterval: 0.2, pierce: false,
	clash: { power: () => chargeLevel },     // beam struggle
	strike: { base: 6, stun: 0.25 },
	visual: "default",
});
```

When two clashing beams touch, they lock into a **struggle**. The meeting point slides toward the weaker side by power difference, and the loser ends `"overpowered"`. Clashing beams also destroy enemy projectiles that fly into them.

**Looks:** `registerProjectileRenderer(id, ...)` / `registerBeamRenderer(id, ...)` in `src/client/projectiles/renderers.ts`. The server picks one with `visual`. Unknown ids fall back to the default orb and cylinder.

**Limits:** `Config.Projectiles` sets per-owner caps (past the cap, the oldest is removed), default lifetime and range, and the sync rate.

Callbacks are function *properties* (`OnHitCharacter: (p, victim) => ...`), not method shorthand. roblox-ts treats the two differently.

## Controls

| Key | Action |
| --- | --- |
| Mouse1 / R2 | punch combo (hold to keep swinging) |
| F | block |
| Left Shift | sprint |
| Q | Flash Step |
| 1–9 | hold hotbar slot (press again to unequip) |
| R | use held item |
| T | print held item |

## Place assets the code expects

- `Workspace.Verity`: an NPC model with a `HumanoidRootPart` and a `ProximityPrompt`
- `ServerStorage.StandArrow`: the Tool Verity gives out
