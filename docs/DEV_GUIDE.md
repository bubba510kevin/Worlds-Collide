# Worlds Collide: Developer Guide (TypeScript)

This guide is for people who **change the framework itself**: the TypeScript in `src/`.

If you only want to make abilities and content, you're in the wrong place. Read [USE_GUIDE.md](USE_GUIDE.md) (Luau).

You know some TypeScript. You do **not** need to know roblox-ts yet; section 3 covers what's different.
Read in order. Don't skip section 3.

---

## 0. The rule

> **The server decides. The client only asks.**

Concretely, that means:

* The client sends **intent** ("pressed V", "aiming here", "equip slot 3"). **Never** results ("did 50 damage", "I have a sword").
* **Every** value from a client is `unknown` until you've checked it with `typeIs`.
* Every client request goes through `onRemote()` (`src/server/network/remoteHandler.ts`). It rate-limits, catches errors, and pushes a fresh snapshot.
* The server tells clients what happened with **snapshots** (`StateChanged`) and **effects** (`CombatEffect`, `Projectile`). Clients only draw.

If you write code that trusts a client value without checking it, you've written a cheat.

---

## 1. Setup

```sh
npm install         # once
npm run build       # compile src/ → out/ (Luau)
npm run watch       # same, but keeps recompiling when you save
rojo serve          # sync out/ and content/ into Studio
```

In Studio: Rojo plugin → Connect → Play.
Output must say `[tests] N passed, 0 failed`.

**Git on this drive** complains about "dubious ownership". Fix it once:
`git config --global --add safe.directory D:/code/projects/worlds_collide`

---

## 2. Where things go

### Compiled layout (what Rojo makes)

| Repo | Becomes in Studio |
|---|---|
| `src/server/` → `out/server/` | `ServerScriptService.TS` |
| `src/shared/` → `out/shared/` | `ReplicatedStorage.TS` |
| `src/client/` → `out/client/` | `StarterPlayer.StarterPlayerScripts.TS` |
| `content/shared/` | `ReplicatedStorage.WorldsCollide_Shared` (Luau users' definitions) |
| `content/server/` | `ServerScriptService.WorldsCollide_Server` (Luau users' ability code) |
| `content/client/` | `ReplicatedStorage.WorldsCollide_Client` (Luau users' visuals) |
| `node_modules/@rbxts` | `ReplicatedStorage.rbxts_include.node_modules` |

`*.server.ts` → Script. `*.client.ts` → LocalScript. Everything else → ModuleScript. `index.ts` → the folder's `init` module.

### The source tree

```
src/
  shared/
    api.ts                    WC for Luau Shared modules (definitions)
    contentLoader.ts          runs Luau content modules
    config.ts                 tuning + limits
    combatConfig.ts           M1 combo data
    forgeData.ts              sword parts
    types.ts                  stats + snapshot shapes
    remotes.ts                every RemoteEvent (server creates, client waits)
    combatUtil.ts             Push(), character helpers
    abilities/
      types.ts                AbilityDef, KitDef, ResourceDef, snapshots
      catalog.ts              built-in content (Flash Step, Energy)
      registry.ts             the live list + validation + registerAbility()
    projectiles/math.ts       kinematics + geometry, used by BOTH sides

  server/
    main.server.ts            entry: load Luau content → tests → start services
    api.ts                    WC for Luau Server modules
    players.ts                Player → Generic_Player
    generic_player/           Generic_Player: stats, modifiers, resources, abilities, inventory
    inventory/  item/         items and the hotbar
    combat/
      CalcHit.ts              calc_hit (hitbox), calc_damage (formula)
      combatService.ts        M1, blocking, movement locks, strike()  ← the damage door
    abilities/
      ability.ts              base class: hooks + helpers
      scriptedAbility.ts      ability whose hooks are a Luau table
      abilityService.ts       input routing, grants sync, ticking, ending
      abilityHolder.ts        grants, kits, charges, active instances (pure logic)
      resources.ts            resource pools
      events.ts               Signal + GameEvents + DamageHook
      library/                built-in ability classes (index.ts = LIBRARY)
    projectiles/              Projectile, Beam, projectileService
    stats/statModifiers.ts    (base + flat) × mult stacks
    network/                  onRemote, reject (violations/kick), RateLimiter
    services/playerService.ts join/leave, inventory + forge requests
    npc/  powers/             Verity, Stand Arrows
    tests.ts                  self-tests (run in Studio)

  client/
    main.client.ts            entry: load Luau content → start modules
    api.ts                    WC for Luau Client modules
    state.ts                  last snapshot
    abilities/                input modes, keybinds, prediction, handlers/ (index.ts = HANDLERS)
    projectiles/              drawing + renderer registry
    combat/  movement/  inventory/  ui/
```

---

## 3. roblox-ts: what bites you

roblox-ts compiles TypeScript to Luau. **It is not JavaScript.** These will waste your afternoon if you don't know them.

| Rule | Wrong | Right |
|---|---|---|
| Array length | `arr.length` | `arr.size()` |
| String length | `s.length` | `s.size()` |
| Type checks | `typeof x === "number"` | `typeIs(x, "number")`. For Roblox types: `typeIs(x, "Vector3")`, `x.IsA("Model")` |
| Vector math | `a + b` | `a.add(b)`, `a.sub(b)`, `a.mul(2)`, `cf.mul(other)` |
| `in` operator | `"active" in ctx` | don't. Use a separate parameter or field. |
| Holes in arrays | `[a, maybeUndefined, b]` | Check each one separately. Luau tables stop at the first `nil`. |
| Indexing | `hotbar[1]` is slot 1 | **TS arrays are 0-based.** Lua index = TS index + 1, but you never see that. Hotbar *slots* are 1-based by our convention, so `hotbar[slot - 1]`. |
| Multiple returns | return an array | `LuaTuple`: `return $tuple(a, b)` and `const [a, b] = f()` |
| `Map` / `Set` | — | compile to plain Luau tables. Iterate with `for (const [k, v] of map)` |
| Weak tables | — | `new WeakMap()` / `new WeakSet()` |
| `pcall` | — | `const [ok, err] = pcall(fn, ...args)` |

### ⚠️ The big one: methods vs function properties

roblox-ts compiles these **differently**:

```ts
interface A { foo(x: number): void }      // METHOD   → called as obj:foo(x)  (colon)
interface B { foo: (x: number) => void }  // PROPERTY → called as obj.foo(x)  (dot)
```

And it **refuses to mix them**: assigning an arrow function where a method is declared, or passing a method around without calling it, is a compile error.

**Our convention:**

| Kind of thing | Write it as | Luau sees |
|---|---|---|
| Class methods (`Generic_Player`, `item`, `Projectile`...) | methods | `obj:Method()` |
| **Anything a Luau user writes or calls from a table** (hooks, callbacks, ctx functions, renderers, client handlers) | **function properties** `name: (...) => ...` | `obj.name()` |

Why: Luau users write plain tables like `{ OnActivate = function(ctx) end }`. Those are dot-functions. If you declared them as methods, the compiled code would call them with `:` and pass an extra `self` argument. Everything shifts by one and nothing works.

So when you add a callback to *any* options interface: **function property. Always.**

---

## 4. Life of one ability press

Follow this once and the codebase makes sense.

1. **Client.** The player presses V. `client/abilities/abilityClient.ts` → `Keybinds.GetAbilityForKey(V)` → `press("Fireball")`.
2. **Client.** `press` runs the **local checks** (has it, charge ready, can afford, not stunned...) using predicted state from `abilityState.ts`. It fails fast, so there's no pointless request.
3. **Client.** `AbilityState.predictUse(def)` (the bar updates instantly). `AbilityInput:FireServer("Fireball", "press", payload)`. Then the handler's `OnPress` runs, if there is one.
4. **Server.** `onRemote("AbilityInput")` → rate limit → `abilityService.onInput()`.
5. **Server.** `onInput` checks the id is real (otherwise `reject` = a violation), checks the player has it, and routes by input mode and active state.
6. **Server.** `activate()`: blockedBy, Tool and weapon checks → `CanUse` (charge) → `CanAfford` → `CanActivate` → `StartActive` → `OnActivate`.
7. **Server.** If `OnActivate` didn't return `false`: spend resources, consume a charge, fire `GameEvents.AbilityActivated`. Instant abilities end right here.
8. **Server.** Every Heartbeat: `syncGrants`, `tickActives` (death, interrupt, expiry, `OnTick`), stats, and `push(gp)` if dirty.
9. **Client.** `StateChanged` → `state.ts` → `abilityState` resets predictions → the bar redraws.

Damage anywhere in that chain goes through **`strike()`** (`combatService.ts`), never `TakeDamage`.

---

## 5. The systems, one by one

For each: what it is, where it lives, and the **rules you must not break**.

### 5.1 Generic_Player (`server/generic_player/`)

One per player, in `activePlayers`. It holds stats, `modifiers`, `resources`, `abilities` (an AbilityHolder), the inventory, the held slot, and the network bookkeeping.

* **Read stats with `GetStat`.** It applies modifiers. `GetGenericPlayerStats` is the raw base.
* Changed something a client should see? `gp.MarkDirty()`. The ability service pushes dirty players every frame.
* Max health and speed go onto the Humanoid in `ApplyStatsToCharacter`. It **won't touch WalkSpeed** while `MovementLocked` or `Blocking` (combat owns it then).

### 5.2 strike() (`server/combat/combatService.ts`)

The only way damage happens. The order is: checks → wall → block (direction from `fromPosition`, or the attacker) → `calc_damage` → attacker `outgoingDamage` hooks → victim `incomingDamage` hooks → damage, wear, stun, knockback → `GameEvents.Hit` / `Damaged`.

* It works even if the attacker has died, as long as `fromPosition` is given (projectiles rely on this).
* Adding a new rule that should apply to every hit? It goes **here**.

### 5.3 Registry (`shared/abilities/registry.ts`)

The live list of abilities, kits and resources. It starts from `catalog.ts`; Luau content adds more at startup via `registerAbility` etc.

* **Every `register*` validates** and throws a human-readable error. Luau users depend on those messages. When you add a field to `AbilityDef`, **add its validation** in `validateAbility`.
* Getters take `unknown`, so they're safe on raw client input.
* `onRegistryChanged` exists because content may register after a module loaded (keybinds use it).

### 5.4 Abilities (`server/abilities/`)

| File | Job |
|---|---|
| `ability.ts` | the base class: hooks (all optional) + helpers (`strike`, `fireProjectile`, `listen`, `addDamageHook`, `broadcast`...) |
| `scriptedAbility.ts` | an `ability` whose hooks come from a Luau table |
| `abilityHolder.ts` | grants (by source, optionally timed), kits (one per group), charges, active instances. **No Instances, no networking**, so it's unit-testable. |
| `abilityService.ts` | input routing, activation order, grant diffing (`OnGranted`/`OnRevoked`, `def.modifiers`), ticking, ending, `registerBehaviour` |

Rules:

* **One `ability` object is shared by every player.** Never store per-player data in its fields. Per-use data goes in `ctx.active.state`. Per-player data goes in a `Map<Generic_Player, ...>`.
* Every hook call is wrapped in `safeCall`, so one broken ability can't take the server down. Keep it that way.
* Helpers that subscribe to something **must** register a cleanup (`track` / `activeConnections`), so it's released on revoke or end.
* `OnEnd` must run **exactly once** per activation. Only `endActive` removes actives.
* Bindings: `GetAll()` only lets `"player"`/`"any"` come from player sources and `"item"`/`"any"` from items. Don't bypass it.

### 5.5 Resources and modifiers

* `Resources`: pools from the registry. `Spend` is **all-or-nothing**. New pools appear lazily if a resource is registered later.
* `StatModifiers<K>`: `(base + Σflat) × Πmult`, keyed by `source/id` (same key = replace). `version` bumps on change; the service calls `OnStatsChanged` when it moves.

### 5.6 Projectiles (`server/projectiles/`)

* The **server simulates** and casts every frame (`Spherecast` / `Raycast`). The client only draws, using `shared/projectiles/math.ts`, timed with `Workspace.GetServerTimeNow()`.
* If you change motion on the server, **change the same math on the client**, or they drift. Anything unpredictable (bounce, homing, redirect) sets `needsSync`.
* Beams: `Step` runs after `stepStruggles`. While in a struggle, the service owns `direction` and `reach`.
* All hits go through the host's `strike` with `fromPosition` and `wallCheck: false` (the cast already checked walls).

### 5.7 Networking (`shared/remotes.ts`, `server/network/`)

* Every remote is listed in `CLIENT_TO_SERVER` or `SERVER_TO_CLIENT`. The server creates them; clients `WaitForChild`.
* **Client → server:** always use `onRemote(name, handler)`. Add a rate limit in `Config.RateLimits`.
* Use `reject(gp, name, reason)` only for things an **honest** client would never send (bad types, unknown ids). Latency misses (cooldown, out of range) are silently ignored. Otherwise honest players on bad wifi get kicked.

### 5.8 The Luau API (`shared/api.ts`, `server/api.ts`, `client/api.ts`, `shared/contentLoader.ts`)

This is the **public surface** for Luau users. Treat it like a public library:

* Every parameter is `unknown`. Validate it. Error with `error(message, 2)` that says **what was wrong and what to do**, e.g. `WC.Stun: use WC.Stun(characterModel, seconds)`.
* Names are `PascalCase`, and callable with a dot (exported functions are).
* Anything a Luau user passes as a callback **must be a function property** in the TS types (section 3).
* Things that belong in another folder get a stub that errors with the right folder (`sharedOnly`).
* `contentLoader` loads modules in a stable order and **never lets one bad module stop the rest**.
* **If you change the API, update [USE_GUIDE.md](USE_GUIDE.md) in the same change.** The Luau users have nothing else.

---

## 6. Recipes

### 6.1 Add a built-in ability in TypeScript

Content usually goes in Luau, but built-ins (like Flash Step) live in TS:

1. Add the `AbilityDef` to `ABILITIES` in `shared/abilities/catalog.ts`.
2. Make `server/abilities/library/myThing.ts`:

```ts
import { getAbility } from "shared/abilities/registry";
import { ability, ActiveContext } from "../ability";

export class MyThing extends ability {
	constructor() {
		super(getAbility("MyThing")!);
	}

	public OnActivate(ctx: ActiveContext, payload: unknown) {
		if (!typeIs(payload, "Vector3")) return false;
		this.fireProjectile(ctx, { origin: ctx.root.Position, direction: payload, speed: 100 });
	}
}
```

3. Add `new MyThing()` to `LIBRARY` in `library/index.ts`.
4. Optional: add a client handler to `HANDLERS` in `client/abilities/handlers/index.ts`.

### 6.2 Add a field to `AbilityDef`

1. Add it to `AbilityDef` in `shared/abilities/types.ts` (optional with `?`, and commented).
2. **Validate it** in `validateAbility` in `registry.ts`.
3. Use it (usually in `abilityService.ts`, and mirror it in the client's `passesLocalChecks` if it affects whether a press is allowed).
4. Document it in USE_GUIDE section 5.

### 6.3 Add a new hook

1. Add it to `ability` in `ability.ts` (default no-op) and document it in the header comment.
2. Call it from `abilityService.ts`, inside `safeCall`.
3. Add it to `AbilityScript`, `SCRIPT_HOOKS` and the forwarding method in `scriptedAbility.ts`, so Luau can use it.
4. Document it in USE_GUIDE section 7.

### 6.4 Add a GameEvent

1. Add a `Signal` to `GameEvents` in `events.ts`.
2. `Fire` it where it happens.
3. Add its name to `EVENT_NAMES` in `server/api.ts`.
4. Document it in USE_GUIDE section 15.

### 6.5 Add a remote

1. Add the name to `CLIENT_TO_SERVER` (or `SERVER_TO_CLIENT`) in `shared/remotes.ts`.
2. Client → server: add a rate limit to `Config.RateLimits`, then use `onRemote("Name", (gp, a, b) => { ...typeIs checks first... })`.
3. Server → client: `getRemote("Name").FireClient(...)`. Keep arguments **plain data** (no class instances).

### 6.6 Add a stat

1. Add it to `Generic_Player_stats` (`shared/types.ts`) and `DefaultPlayerStats` (`config.ts`).
2. Add it to `STATS` in `registry.ts` and to `GetEffectiveStats` in `generic_player.ts`.
3. Use it somewhere (`calc_damage`, `ApplyStatsToCharacter`...).
4. Update the stat lists in USE_GUIDE.

### 6.7 Add a WC function

1. Add an exported, `PascalCase` function to the right `api.ts`.
2. Validate every argument. Write a helpful error.
3. Add it to USE_GUIDE (its section **and** the list in section 20).

---

## 7. Tests

`src/server/tests.ts` runs in Studio on start (`Config.RunTestsInStudio`). It runs **after** Luau content loads, so it also catches bad content (e.g. a kit granting an item-only ability).

* `check("what should be true", condition, optionalDetail)`.
* Prefer testing **pure logic** (`AbilityHolder`, `StatModifiers`, `math.ts`, `Inventory`, `sword`). They need no Players.
* Anything new with logic in it gets a test.

---

## 8. Before you commit: checklist

- [ ] `npm run build` gives **zero** errors.
- [ ] Studio: `[tests] ... 0 failed`.
- [ ] Nothing trusts a client value without `typeIs`.
- [ ] New remotes go through `onRemote` and have a rate limit.
- [ ] Damage goes through `strike()`.
- [ ] No per-player state in shared objects (abilities, renderers).
- [ ] Callbacks in options types are **function properties**.
- [ ] Luau-facing changes are reflected in **USE_GUIDE.md**.
- [ ] Comments match the code you changed.

---

## 9. Not built yet (good next jobs)

* **Saving** (DataStore): grants, kits, items, resources.
* **Status effects**: DoT, slows, stacks, cleansing.
* **Equipment slots**, so worn items grant abilities.
* **NPC actors** that can own abilities and projectiles (summons, clones, independent Stands).
* **Flight** movement.
* **Per-viewer visibility** (e.g. only Stand users see Stands).
