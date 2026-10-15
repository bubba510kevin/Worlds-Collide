# Worlds Collide: Use Guide (Luau)

This guide is for people who **use** the framework to make game content
(abilities, kits, items...) **in Luau**.

You do **not** need TypeScript. You never touch `src/`.
If you want to change the framework itself, read [DEV_GUIDE.md](DEV_GUIDE.md) instead.

Read this guide **in order**. Don't skip ahead. Every step depends on the one before it.

---

## 0. The rule that explains everything

> **The server decides. The player's computer only asks.**

The player's computer (the **client**) could be run by a cheater.
So the client never says "I hit him for 50". It says "I pressed V, I'm aiming *here*".
The **server** checks that, then decides what happens.

That is why your ability is split into a **server part** (what it does) and a **client part** (how it looks).

---

## 1. Getting the game running

Do this once. The steps are in [section 18](#18-running-the-game).
Come back here when you can press Play and see `[Worlds Collide] server online` in Output.

---

## 2. The three folders

All your Luau goes into **three folders**. Each one has one job.

| Folder (in Studio) | Folder (in the repo) | What goes in it |
|---|---|---|
| `ReplicatedStorage.WorldsCollide_Shared` | `content/shared/` | **Definitions.** The *name card* of each ability, kit and resource. |
| `ServerScriptService.WorldsCollide_Server` | `content/server/` | **What abilities DO.** Damage, projectiles, buffs. |
| `ReplicatedStorage.WorldsCollide_Client` | `content/client/` | **How abilities LOOK.** Animations, aiming, effects. |

**Use the repo folders** (`content/...`) if you work with Rojo. Each `.luau` file there becomes a ModuleScript in Studio by itself.
**Or** make the folders and ModuleScripts by hand in Studio. That works too, but then they only live in your place file.

Each folder already has a `_ReadMe` module in it. Leave it, ignore it.

### Every module you put in these folders must look EXACTLY like this

```lua
return function(WC)
	-- your stuff goes here
end
```

* It must be a **ModuleScript**. Not a Script, not a LocalScript.
* It must **return a function**.
* That function gets **`WC`**: the toolbox. Everything you do goes through `WC`.

The framework finds your modules and runs them **when the game starts, before any player can do anything**.

You may put modules inside **Folders** inside these folders, to stay organized.
A ModuleScript *inside another ModuleScript* is **not** loaded automatically. Use that for helper modules you `require` yourself.

### Which `WC` you get depends on the folder

| Folder | `WC` can... |
|---|---|
| Shared | `AddAbility`, `AddKit`, `AddResource`, `AddDefaultAbility` |
| Server | `AbilityCode`, give and take abilities, hit things, projectiles, beams, items, stats, events |
| Client | `AbilityLook`, `ProjectileLook`, `BeamLook`, keybinds, `Press` |

If you call something in the wrong folder, you get an error telling you the right folder.

---

## 3. ⚠️ Dot or colon? (READ THIS)

You will get this wrong. Everyone does. Here is the rule:

| Thing | Use | Example |
|---|---|---|
| Anything on **`WC`** | **dot** `.` | `WC.GiveAbility(player, "Fireball")` |
| Anything on **`ctx`** | **dot** `.` | `ctx.End()`, `ctx.Elapsed()` |
| The client `ctx` | **dot** `.` | `ctx.send(target)` |
| **Objects**: players (`ctx.caster`), items, projectiles, beams, events | **colon** `:` | `ctx.caster:GetStat("strength")`, `p:Redirect(dir)`, `WC.Events.Hit:Connect(fn)` |
| Disconnecting something you got from `:Connect` | **dot** `.` | `connection.Disconnect()` |

If you see `attempt to call a nil value` or "missing argument", you probably used the wrong one.

---

## 4. Your first ability: Fireball 🔥

Goal: press **V**, a fireball flies where your mouse points, and it hurts whoever it hits.

You need **three files**. Make them exactly like this.

### File 1: the name card (Shared)

`content/shared/Fireball.luau` (or a ModuleScript named `Fireball` in `ReplicatedStorage.WorldsCollide_Shared`):

```lua
return function(WC)
	WC.AddAbility({
		id = "Fireball",                  -- unique name. Used everywhere else.
		name = "Fireball",                -- what players see
		description = "Throw a ball of fire where you aim.",
		binding = "player",               -- it belongs to the player (see section 6)
		input = "press",                  -- tap the key to use it
		defaultKey = Enum.KeyCode.V,
		cooldown = 3,                     -- seconds before you can use it again
		costs = {
			{ resource = "Energy", amount = 20 },
		},
	})

	-- everyone gets it when they join
	WC.AddDefaultAbility("Fireball")
end
```

### File 2: what it does (Server)

`content/server/Fireball.luau` (or a ModuleScript in `ServerScriptService.WorldsCollide_Server`):

```lua
return function(WC)
	WC.AbilityCode("Fireball", {
		-- runs on the SERVER when the player presses V
		-- `aim` is whatever the client sent (see File 3). NEVER trust it blindly.
		OnActivate = function(ctx, aim)
			-- check it's really a direction. If not, say no.
			if typeof(aim) ~= "Vector3" or aim.Magnitude < 0.5 then
				return false -- false = "refused". It costs nothing and doesn't go on cooldown.
			end

			WC.FireProjectile(ctx, {
				origin = ctx.root.Position + aim.Unit * 3, -- start a bit in front of you
				direction = aim,
				speed = 100,
				radius = 1,
				strike = { base = 20, stun = 0.3, knockback = 5 },
				visualData = { color = Color3.fromRGB(255, 120, 40) },
			})
		end,
	})
end
```

### File 3: where you're aiming (Client)

`content/client/Fireball.luau` (or a ModuleScript in `ReplicatedStorage.WorldsCollide_Client`):

```lua
return function(WC)
	WC.AbilityLook("Fireball", {
		-- whatever this returns is sent to the server as `aim`
		GetPressPayload = function(ctx)
			local mouse = game.Players.LocalPlayer:GetMouse()
			return mouse.Hit.Position - ctx.root.Position
		end,
	})
end
```

### Try it

1. Save. If you use Rojo, make sure `rojo serve` is running.
2. Press **Play**.
3. Look at the bottom of the screen: there's a **Fireball** box with **V** on it.
4. Press **V**.

Doesn't work? Go to [section 17](#17-it-doesnt-work).

---

## 5. Everything a name card (`WC.AddAbility`) can have

Only the ones marked **required** are required.

| Field | Required | What it is | Example |
|---|---|---|---|
| `id` | **yes** | unique name | `"Fireball"` |
| `name` | **yes** | shown to players | `"Fireball"` |
| `description` | no | shown to players | `"Throws fire."` |
| `binding` | **yes** | who it belongs to: `"player"`, `"item"` or `"any"` | `"player"` |
| `input` | **yes** | how the key works: `"press"`, `"hold"`, `"toggle"` or `"passive"` | `"press"` |
| `cooldown` | **yes** | seconds per use to recharge. Use `0` for none. | `3` |
| `defaultKey` | no | the key. Not allowed on passives. | `Enum.KeyCode.V` |
| `charges` | no | uses saved up (default 1) | `3` |
| `costs` | no | what it uses up | `{ { resource = "Energy", amount = 20 } }` |
| `maxDuration` | no | max seconds it stays "active" | `5` |
| `cooldownStartsOnEnd` | no | `true` = the cooldown only starts when it *ends* | `true` |
| `blockedBy` | no | can't use it while the character has any of these attributes | `{ "Stunned" }` |
| `interruptedBy` | no | it stops if the character gets any of these | `{ "Stunned" }` |
| `allowWithTool` | no | can use it while holding a Roblox Tool (default `false`) | `true` |
| `requiresWeapon` | no | must be holding a (not broken) weapon | `true` |
| `modifiers` | no | stat changes while you *have* it (passives!) | `{ { stat = "defense", flat = 10 } }` |
| `tags` | no | labels for your own use | `{ "fire", "projectile" }` |
| `data` | no | any numbers or settings you want, readable on both sides | `{ damage = 20 }` |

Defaults if you leave them out: `blockedBy = { "Stunned", "Blocking" }`, `interruptedBy = { "Stunned" }`.

If you make a mistake, the Output tells you **which field** and **what it should be**.

### The four input types

| `input` | What the key does | Use it for |
|---|---|---|
| `"press"` | Tap = use it. Tap **again while it's still going** = `OnRecast`. | Fireball, combos, dashes |
| `"hold"` | Hold the key = starts. Let go = `OnRelease`. | Charge attacks, channelled beams |
| `"toggle"` | Tap = on. Tap again = off (`OnRelease`). | Transformations, masks, auras |
| `"passive"` | No key. It's "on" as long as you have it. | Stat bonuses, "when I get hit..." |

A `"press"` ability is over **instantly** unless you give it a `maxDuration`.
Flash Step uses `maxDuration = 1` so it stays active long enough to grab someone.

---

## 6. Who owns an ability: `binding`

| `binding` | Means | Example |
|---|---|---|
| `"player"` | It's **yours**, whatever you hold. | A Stand, a clan power, Flash Step |
| `"item"` | It belongs to an **item**. Only works while you **hold** that item. | A sword's special move |
| `"any"` | Can come from either. | A passive that rings *and* races could give |

The framework **refuses** to give an ability the wrong way.
`WC.GiveAbility(player, "SwordMove")` on an `"item"` ability gives a warning and does nothing.

---

## 7. Server code: `WC.AbilityCode` hooks

You give `WC.AbilityCode` a table of functions. **Every one is optional.** Only write the ones you need.

| Hook | Runs when | Return |
|---|---|---|
| `CanActivate(ctx, payload)` | before it's used | `false` to say no (anything else = yes) |
| `OnActivate(ctx, payload)` | it's being used! | `false` to cancel (no cost, no cooldown) |
| `OnRecast(ctx, payload)` | pressed again while still going (`press`) | nothing |
| `OnRelease(ctx, payload)` | key let go (`hold`) or tapped off (`toggle`) | nothing |
| `OnInput(ctx, payload)` | the client sent extra info with `ctx.send(...)` | nothing |
| `OnTick(ctx, dt)` | every frame while it's going | nothing |
| `OnEnd(ctx, reason)` | it stopped. Always runs once. | nothing |
| `OnGranted(ctx)` | the player just got this ability | nothing |
| `OnRevoked(ctx)` | the player just lost this ability | nothing |
| `GetCooldown(ctx)` | to change the cooldown on the fly | a number |
| `GetCosts(ctx)` | to change the cost on the fly | a costs table |

> If you write `OnRelease` yourself, the ability does **not** end by itself any more. Call `ctx.End()` in it when you want it to stop.

`reason` in `OnEnd` is one of: `"released"`, `"expired"` (ran out of `maxDuration`), `"completed"`, `"cancelled"`, `"interrupted"` (got stunned), `"revoked"` (lost the ability) or `"died"`.

**Order when a player presses the key:**
1. The framework checks: do they have it? Alive? Not stunned or blocking? Not holding a Tool? Has a charge? Can afford it?
2. Your `CanActivate`.
3. Your `OnActivate`.
4. **Only now** is the cost paid and the cooldown started.

### What's in `ctx`

| Field | What | Dot or colon |
|---|---|---|
| `ctx.player` | the Roblox `Player` | |
| `ctx.caster` | the framework's player object | **colon**: `ctx.caster:GetStat("strength")` |
| `ctx.character` | their character Model | |
| `ctx.humanoid` | their Humanoid | |
| `ctx.root` | their HumanoidRootPart | |
| `ctx.def` | the name card you wrote | `ctx.def.data.damage` |
| `ctx.source` | who gave it: `"innate"`, `"kit:MyStand"`, `"item:..."` | |

**Only while it's active** (`OnActivate`, `OnTick`, `OnInput`, `OnRecast`, `OnRelease`, `OnEnd`):

| Field | What |
|---|---|
| `ctx.active.state` | **your scratch table** for this one use. Store anything: `ctx.active.state.charge = 5` |
| `ctx.End()` | stop it now. Optionally `ctx.End("cancelled")` |
| `ctx.Elapsed()` | seconds since it started |
| `ctx.SetRemaining(seconds)` | change how long it has left. `nil` = no limit. |

> ⚠️ **Never** store per-player stuff in a variable outside the hook functions. Every player shares the same hook table. Use `ctx.active.state`.

> `OnGranted` and `OnRevoked` get a smaller `ctx` with **no** `character`, `root` or `active`. The player might not even have spawned yet.

### Example: a hold-to-charge attack

```lua
-- Shared: input = "hold", maxDuration = 3, cooldown = 5
WC.AbilityCode("ChargePunch", {
	OnRelease = function(ctx)
		local seconds = math.min(ctx.Elapsed(), 3)
		ctx.active.state.power = 10 + seconds * 15
		ctx.End("released")
	end,
	OnEnd = function(ctx, reason)
		-- also fires if it hit maxDuration ("expired") or you got stunned ("interrupted")
		if reason == "interrupted" then return end
		local power = ctx.active.state.power or 55
		-- hit whoever is in front, using WC.Strike (section 10)
	end,
})
```

---

## 8. Client code: `WC.AbilityLook`

Everything here is **optional**, and it's all **just for looks and aiming**. It cannot cheat.

| Field | What it does |
|---|---|
| `exclusive = true` | no other ability can start while `OnPress` is still running |
| `CanPress(ctx)` | return `false` to not even ask the server (e.g. no target in range) |
| `GetPressPayload(ctx)` | return data to send with the press (aim, target...) → server's `payload` |
| `GetReleasePayload(ctx)` | same, for letting go |
| `OnPress(ctx)` | runs when you press. Animations, camera, moving yourself. It can `task.wait`. |
| `OnRelease(ctx)` | runs when you let go |
| `OnRecast(ctx)` | pressed again while active |
| `OnActiveChanged(active)` | the server says it started (`true`) or ended (`false`) |
| `Effect(character, ...)` | an effect the **server** sent with `WC.Broadcast`. Runs on everyone nearby. |

Client `ctx` (**all dots**):

| Field | What |
|---|---|
| `ctx.character`, `ctx.humanoid`, `ctx.root` | **your** character |
| `ctx.def` | the name card |
| `ctx.send(anything)` | send extra info to the server → server `OnInput` |
| `ctx.isActive()` | does the server say it's running? |
| `ctx.heldFor()` | seconds the key has been held (`hold` abilities) |

> The key is sent to the server **for you**. Don't send the press yourself.

> Your **own** character's movement belongs to **your** client. Dashes and lunges go in `OnPress` (client), not on the server.

---

## 9. Giving and taking things (server)

```lua
WC.GiveAbility(player, "Fireball")                  -- forever (source "innate")
WC.GiveAbility(player, "Fireball", "quest:dragon")  -- forever, from a quest
WC.GiveAbility(player, "Fireball", "potion", 30)    -- only 30 seconds
WC.TakeAbility(player, "Fireball", "quest:dragon")  -- take back what the quest gave
WC.TakeAbilitiesFrom(player, "quest:dragon")        -- take back EVERYTHING the quest gave
WC.HasAbility(player, "Fireball")                   -- true / false
WC.ResetCooldown(player, "Fireball")                -- ready again now
WC.CancelAbility(player, "Fireball")                -- stop it if it's running
```

**Sources:** if two sources give the same ability, the player keeps it until **both** take it back.
Pick a source name that says where it came from (`"quest:dragon"`, `"buff:rage"`). It makes taking things back easy.

### Kits (a Stand, a clan, a race, a form)

A kit is a **bundle** of player abilities. Define it in **Shared**:

```lua
WC.AddKit({
	id = "StarFist",
	name = "Star Fist",
	description = "A fast close-range Stand.",
	group = "stand",                         -- only ONE kit per group at a time
	abilities = { "Barrage", "StandPresence" },
})
```

Give and take it on the **server**:

```lua
WC.GiveKit(player, "StarFist")  -- giving another "stand" kit removes this one
WC.TakeKit(player, "StarFist")
```

**Stand Arrows** (from Verity) give a **random kit from the `"stand"` group**. Add a kit with `group = "stand"` and the arrow starts working.

---

## 10. Stats, passives and resources

### A passive with NO server code

In **Shared**:

```lua
WC.AddAbility({
	id = "Toughness",
	name = "Toughness",
	description = "+20 defense.",
	binding = "any",
	input = "passive",
	cooldown = 0,
	modifiers = { { stat = "defense", flat = 20 } },
})
```

Give it like any ability. Done. No `AbilityCode` needed.

### Stats

Stats are: `health`, `defense`, `energy`, `speed`, `strength`, `critChance`, `critDamage`.

```
final stat = (base + every flat) × every mult
```

```lua
WC.AddStatBonus(player, { id = "potion", stat = "strength", flat = 10 })               -- until removed
WC.AddStatBonus(player, { id = "rage", stat = "strength", mult = 1.5, seconds = 10 })  -- ×1.5 for 10 s
WC.RemoveStatBonuses(player, "potion")
print(WC.GetStat(player, "strength"))
```

Same `id` again = **replaces**, doesn't stack. Want stacking? Use a different `id` each time.

### Resources (Energy, Mana, Stamina...)

Energy exists already. Add more in **Shared**:

```lua
WC.AddResource({
	id = "Mana",
	name = "Mana",
	max = 50,               -- or a stat name, like "energy"
	regen = 5,              -- per second (negative = drains)
	regenDelay = 1,         -- seconds after spending before it refills
	color = Color3.fromRGB(160, 80, 255),
})
```

A Mana bar appears by itself. Use it with `costs = { { resource = "Mana", amount = 10 } }`.

On the **server**:

```lua
WC.GetResource(player, "Mana")
WC.GiveResource(player, "Mana", 10)   -- negative takes away
```

---

## 11. Hitting people

**Never** do `humanoid:TakeDamage()` yourself.
Always use `WC.Strike` / `WC.Hit`. They handle blocking, defense, crits, invulnerability, walls, stun and knockback for you.

Inside an ability:

```lua
local result = WC.Strike(ctx, victimModel, {
	base = 15,                -- damage before strength / crits / defense
	stun = 0.4,               -- seconds stunned (0 = none)
	knockback = { direction = ctx.root.CFrame.LookVector, distance = 8, duration = 0.25 },
	canCrit = true,           -- default true
	wallCheck = true,         -- default true. Can't hit through walls.
	tags = { "fire" },        -- labels for damage hooks
})
if result and not result.blocked then
	WC.ConfirmHit(ctx, victimModel, result.victimRoot.Position, result.crit)
end
```

`result` is `nil` if the hit didn't connect at all (dead, invulnerable, behind a wall).
Otherwise it has: `amount`, `crit`, `blocked`, `victimRoot`.

Anywhere else (a trap, a quest script):

```lua
WC.Hit(attackingPlayer, victimModel, { base = 10, stun = 0 })
WC.Stun(characterModel, 2)
WC.MakeInvulnerable(characterModel, 1)
```

**Finding people in front of you**: use normal Roblox (`workspace:GetPartBoundsInBox`, etc.), then `WC.Strike` each one.

---

## 12. Projectiles (things that fly) 🏐

```lua
local p = WC.FireProjectile(ctx, {
	origin = ctx.root.Position + ctx.root.CFrame.LookVector * 3,   -- REQUIRED
	direction = ctx.root.CFrame.LookVector,                        -- REQUIRED
	speed = 80,                                                    -- REQUIRED, studs per second

	radius = 1,          -- how fat (0 = thin laser)
	gravity = 30,        -- > 0 = falls in an arc
	lifetime = 5,        -- seconds
	maxDistance = 600,
	pierce = 2,          -- goes through 2 people before stopping
	bounces = 1,         -- bounces off 1 wall
	bounciness = 0.8,    -- speed kept per bounce
	hitsWorld = true,    -- false = flies through walls
	homing = { target = someModelOrPart, turnRate = 180 },  -- degrees per second
	clash = { power = 10 },  -- hits an enemy clash projectile: the stronger survives
	strike = { base = 20, stun = 0.3, knockback = 5 },       -- auto-damage on hit
	visual = "default",      -- which look (section 14)
	visualData = { color = Color3.fromRGB(255, 80, 40) },

	OnHitCharacter = function(p, victim, position, result)
		return "stop"   -- or "pierce", "bounce", "pass"
	end,
	OnHitWorld = function(p, raycastResult)
		return "stop"   -- or "bounce", "pass"
	end,
	OnTick = function(p, dt) end,
	OnEnd = function(p, reason, position) end,
})
```

> Spawn it a little **in front** of the caster. If it starts *inside* someone, it won't hit them.

The projectile `p` (**colon** for its functions):

| | |
|---|---|
| `p.position`, `p.velocity`, `p.age` | where it is, how fast, how old |
| `p.state` | your scratch table |
| `p:Redirect(direction)` | same speed, new direction |
| `p:SetVelocity(v)` | new speed and direction |
| `p:Teleport(position)` | move it |
| `p:End()` | destroy it |

From a normal script (not an ability): `WC.ShootProjectile(player, { ... })`.

---

## 13. Beams 🚿

```lua
WC.FireBeamWhileActive(ctx, {
	origin = function() return ctx.root.Position end,            -- a function = it follows you
	direction = function() return ctx.root.CFrame.LookVector end,
	width = 4,
	maxLength = 150,
	extendSpeed = 200,       -- studs per second it grows. Leave out = instant.
	tickInterval = 0.2,      -- hits the same person every 0.2 s
	pierce = false,          -- false = stops at the first person
	clash = { power = 10 },  -- touches another clash beam = BEAM STRUGGLE
	strike = { base = 6, stun = 0.25 },
	visualData = { color = Color3.fromRGB(80, 160, 255) },
})
```

* `WC.FireBeamWhileActive` stops when the ability stops. Use it with `hold` or `toggle` abilities.
* `WC.FireBeam` keeps going until its `duration` runs out, or you call `beam:End()`.

**Beam struggle:** two clash beams touch → they push.
`power` can be a **function**, so it can change during the struggle (charging, mashing, spending mana):

```lua
clash = { power = function() return ctx.active.state.power or 10 end },
```

The weaker one gets pushed back. When it's pushed all the way, it loses.

---

## 14. How projectiles and beams look (client)

Leave `visual` out to get the default glowing ball or cylinder.
Make your own in a **Client** module:

```lua
WC.ProjectileLook("Fireball", {
	Create = function(args)   -- args.radius, args.owner, args.data (your visualData)
		local part = Instance.new("Part")
		part.Shape = Enum.PartType.Ball
		part.Anchored = true
		part.CanCollide = false
		part.CanQuery = false
		part.Size = Vector3.one * (args.radius * 2)
		part.Material = Enum.Material.Neon
		part.Color = Color3.fromRGB(255, 120, 40)
		part.Parent = workspace

		return {
			Update = function(cframe, velocity)   -- every frame
				part.CFrame = cframe
			end,
			Destroy = function(position, reason)  -- once, at the end
				part:Destroy()
			end,
		}
	end,
})
```

Then use `visual = "Fireball"` on the server. `WC.BeamLook` works the same way, but its `Update` gets `(origin, direction, length, width, clashing)` and its `Destroy` gets `(reason)`.

---

## 15. Events and damage hooks

### Events: "tell me when..."

| Event | Gives you |
|---|---|
| `Hit` | `attacker` (framework player), `victim` (Model), `result` |
| `Damaged` | `victim` (framework player), `amount`, `attacker` |
| `AbilityActivated` | `player` (framework), `abilityId` |
| `AbilityEnded` | `player`, `abilityId`, `reason` |
| `AbilityGranted` / `AbilityRevoked` | `player`, `abilityId` |

"Framework player" means the object from `WC.GetPlayer`. Get the real `Player` with `:GetInstance()`.

From an ability (it cleans itself up when the ability is lost):

```lua
OnGranted = function(ctx)
	WC.Listen(ctx, "Hit", function(attacker, victim, result)
		if attacker == ctx.caster and result.crit then
			print("crit!")
		end
	end)
end,
```

`WC.ListenWhileActive(ctx, ...)` is the same, but it only lasts while the ability is active.

From anywhere (you must disconnect it yourself):

```lua
local connection = WC.Events.Hit:Connect(function(attacker, victim, result) end)
connection.Disconnect()   -- DOT, not colon
```

### Damage hooks: change damage before it lands

```lua
-- a passive: take half damage from fire
OnGranted = function(ctx)
	WC.AddDamageHook(ctx, "incoming", function(info)
		for _, tag in info.tags do
			if tag == "fire" then
				return info.amount * 0.5
			end
		end
		return info.amount   -- ALWAYS return a number. Return info.amount to change nothing.
	end)
end,
```

* `"outgoing"` = damage **you deal**. `"incoming"` = damage **you take**.
* `info` has: `attacker`, `victim`, `victimPlayer`, `amount`, `crit`, `tags`.
* `WC.AddDamageHookWhileActive` only lasts while the ability is active (a shield!).

---

## 16. Items

```lua
local sword = WC.CreateSword("Zangetsu")
sword:BindAbility("Getsuga")      -- COLON. The ability must be binding "item" or "any".
WC.GiveItem(player, sword, 2)     -- into their inventory AND hotbar slot 2

local rock = WC.CreateItem("Rock")
WC.GiveItem(player, rock)         -- inventory only
```

An ability bound to an item works for **whoever holds that exact item**. It stays bound forever.

---

## 17. It doesn't work

**First: look at the Output window.** Most problems print a message there.

| Message in Output | Means | Fix |
|---|---|---|
| `[WorldsCollide] Shared/X crashed while loading` | your module has an error | read the rest of the message |
| `[WorldsCollide] X must "return function(WC) ... end"` | your module doesn't return a function | wrap everything in `return function(WC) ... end` |
| `[WorldsCollide] X errored: AddAbility("Y"): "cooldown" must be a number` | a field is wrong | do what it says |
| `WC.AbilityCode: no ability called "X"` | there's no name card, or the id is spelled differently | check the Shared module, and check the spelling |
| `WC.AddAbility only works in a module inside ...Shared` | wrong folder | move it |
| `[abilities] X.OnActivate errored: ...` | your hook crashed | read the line number |
| `"Foo" isn't a hook and will never run` | typo in a hook name | check the spelling (`OnActivate`, not `onActivate`) |
| `attempt to call a nil value` | dot vs colon, or a typo | [section 3](#3-️-dot-or-colon-read-this) |

| What happens | Check |
|---|---|
| No box on the ability bar | Does the player **have** it? Use `WC.AddDefaultAbility` or `WC.GiveAbility`. Passives never get a box. |
| Box is there, the key does nothing | Is the key used by something else? (F = block, Q = Flash Step, R = use item, E = talk.) Enough energy? On cooldown? Stunned? Holding a Tool? |
| It does nothing on the server | Did `OnActivate` `return false`? Is your payload check too strict? Add `print`s. |
| The projectile hits nobody | Did you spawn it **in front of** the caster? Is `speed` big enough? Is `strike` set? |
| It works for me but stops working after respawn | You stored something outside the hooks. Use `ctx.active.state`. |
| Everything is gone after rejoining | Normal. The game doesn't save yet. |

---

## 18. Running the game

You need: **Node.js**, **Git**, **Roblox Studio**, and **Rojo** (rojo.space: the program *and* the Studio plugin).

In a terminal, in the project folder (`D:\code\projects\worlds_collide`):

```sh
npm install        # first time only
npm run build      # turn the framework into Luau. Or: npm run watch (keeps doing it)
rojo serve         # leave this running
```

In Studio: open your place → **Rojo** plugin → **Connect** → **Play**.

Output should show `[tests] ... 0 failed` and `[Worlds Collide] server online`.

> Your `content/*.luau` files do **not** need `npm run build`. Rojo syncs them directly. Only the framework (`src/`) needs building.

### Place things the game expects

| Thing | Where |
|---|---|
| NPC Model named `Verity` with a `HumanoidRootPart` and a `ProximityPrompt` | `Workspace` |
| Tool named `StandArrow` | `ServerStorage` |

### Default controls

| Key | Does |
|---|---|
| Left mouse (hold = keep going) | punch combo |
| F (hold) | block |
| Left Shift (hold) | run |
| Q | Flash Step |
| 1 to 9 | hold that hotbar slot (same number again = put away) |
| R | use the held item |
| E | talk to Verity |

---

## 19. Using `WC` from a normal Script or LocalScript

You don't have to use the content folders for everything. Any script can grab `WC`:

```lua
-- in a Script (server)
local WC = require(game.ServerScriptService.TS.api)

-- in a LocalScript (client)
local WC = require(game.Players.LocalPlayer.PlayerScripts.TS.api)
```

**Definitions** (`AddAbility`, `AddKit`, `AddResource`) should still go in the **Shared** folder, so the server and every client get them at the same time.

---

## 20. Every `WC` function

**Shared folder:** `AddAbility(def)`, `AddKit(def)`, `AddResource(def)`, `AddDefaultAbility(id)`, `GetAbility(id)`, `GetKit(id)`, `GetResourceInfo(id)`

**Server folder:**

| Group | Functions |
|---|---|
| ability code | `AbilityCode(id, hooks)` |
| players | `GetPlayer(player)`, `GetPlayerFromCharacter(model)`, `GetAllPlayers()` |
| abilities | `GiveAbility(player, id, source?, seconds?)`, `TakeAbility(player, id, source?)`, `TakeAbilitiesFrom(player, source)`, `HasAbility(player, id)`, `GiveKit(player, kit)`, `TakeKit(player, kit)`, `ResetCooldown(player, id)`, `CancelAbility(player, id)` |
| stats | `AddStatBonus(player, bonus)`, `RemoveStatBonuses(player, source)`, `GetStat(player, stat)` |
| resources | `GetResource(player, id)`, `GiveResource(player, id, amount)` |
| items | `CreateItem(name)`, `CreateSword(name)`, `GiveItem(player, item, slot?)` |
| hitting | `Strike(ctx, victim, opts)`, `Hit(player, victim, opts)`, `Stun(model, seconds)`, `MakeInvulnerable(model, seconds)`, `ConfirmHit(ctx, victim, position, crit)` |
| flying things | `FireProjectile(ctx, opts)`, `FireBeam(ctx, opts)`, `FireBeamWhileActive(ctx, opts)`, `ShootProjectile(player, opts)`, `ShootBeam(player, opts)` |
| events | `Events`, `Listen(ctx, name, fn)`, `ListenWhileActive(ctx, name, fn)`, `AddDamageHook(ctx, dir, fn)`, `AddDamageHookWhileActive(ctx, dir, fn)` |
| effects | `Broadcast(ctx, position, ...)`, `Tell(ctx, ...)` |
| lookups | `GetAbility(id)`, `GetKit(id)`, `GetResourceInfo(id)` |

**Client folder:** `AbilityLook(id, handler)`, `ProjectileLook(id, renderer)`, `BeamLook(id, renderer)`, `Press(id)`, `Release(id)`, `SetKey(id, key)`, `GetKey(id)`, `GetMyState()`, `GetMyAbilities()`, `GetCooldown(id)`, `GetMyResource(id)`, `GetAbility(id)`, `GetKit(id)`, `GetResourceInfo(id)`

---

## 21. Not built yet

Don't go looking for these:

* **Saving.** Everything resets when a player leaves.
* **Status effects** like poison, burn and bleed. Make them yourself with `OnTick` and `WC.Strike` for now.
* **Worn gear.** Only the **held** item gives abilities.
* **NPCs that use abilities.** Only players own abilities and projectiles.
* **Flying.**
