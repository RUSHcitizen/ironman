# Iron Man (unofficial fan game)

A browser-native 3D open-world superhero flight game in the style of Iron Man. You fly a red-and-gold suit through a huge New York-style city, fight hostile machines, step out and walk the streets as a civilian, and call your suit back so it latches on piece by piece. F.R.I.D.A.Y. runs the HUD.

> **Unofficial fan project.** Not affiliated with, endorsed by or sponsored by Marvel, Disney or any rights holder. "Iron Man" and "F.R.I.D.A.Y." are trademarks of their respective owners, used here only to identify the fan tribute. All models, textures and sounds are generated procedurally by this code; no assets from films or games are included. Publishing it publicly under these names carries trademark risk, so consider an original title for a public release.

Built with **Babylon.js + TypeScript + Vite**. Every model, texture and sound is generated procedurally at runtime, so there are no downloaded or proprietary assets. It builds to static files for **Cloudflare** (Workers static assets or Pages), at $0.

| | |
|---|---|
| ![Banked turn](docs/screenshots/19-bank-turn.png) | ![Piloting the empty suit in sentry mode](docs/screenshots/21-sentry-remote.png) |
| ![Ejecting mid-air](docs/screenshots/20-eject.png) | ![In space](docs/screenshots/17-space.png) |
| ![Free fall after cutting thrust](docs/screenshots/18-freefall.png) | ![Busy street](docs/screenshots/10-busy-street.png) |
| ![Stepping out of the open armour](docs/screenshots/16-step-out.png) | ![City from 420 m](docs/screenshots/06-city-overview.png) |
| ![Suit pieces latching on](docs/screenshots/13-suit-up-latch.png) | ![Called suit latching on](docs/screenshots/15-called-suit-latching.png) |
| ![New enemy types](docs/screenshots/14-new-enemies.png) | ![Avengers Tower pad](docs/screenshots/02-avengers-tower-pad.png) |
| ![Drone fight](docs/screenshots/03-combat-drones.png) | ![Warbot](docs/screenshots/04-warbot.png) |
| ![Stepped out of the suit](docs/screenshots/07-civilian.png) | ![Sentry mode](docs/screenshots/11-sentry.png) |
| ![Afterburner flight](docs/screenshots/05-flight-afterburner.png) | ![Suit flying in](docs/screenshots/12-suit-inbound.png) |
| ![Title screen](docs/screenshots/01-title.png) | ![Mobile touch controls](docs/screenshots/09-mobile-touch-controls.png) |

*These screenshots come from the real running game. They were captured in headless Chromium with software (SwiftShader) rendering via `npm run screenshots`. The mobile shot uses Chromium's iPhone emulation, not real Safari.*

## Milestone 7 – more enemies, a 59 km² city, faster rescues, sharp turns, phone rotation fix

- **Four new enemy types:**
  - **Interceptor jet:** makes strafing runs at about 330 km/h, firing as it closes. It blows past you, extends a few hundred metres, then turns in for another pass.
  - **Swarmer:** a tiny, fast seeker that comes in packs. It buzzes around you in tight circles and pecks at you, and pops in one hit.
  - **EMP jammer:** closes to about 20 m, then charges with a growing blue glow and pulses. The pulse drains about 28% of your suit power within 32 m, so break away when it lights up.
  - **Dreadnought carrier (boss):** a huge armoured airship that circles high above. It launches swarmers from its belly (up to 9 at a time), fires 4-missile salvos and flak. It has 1,400 HP, so bring rockets.
  - New incidents: interceptor squadron, hunter swarm, EMP strike, air superiority (jets escorting a gunship), and **DREADNOUGHT INBOUND**.
- **A bigger map:** 24 × 24 chunks, about **7.7 km × 7.7 km (59 km²)**, with 144 districts and three new skyscraper clusters (Southpoint, Ironworks, Eastbridge).
- **The suit catches you when you fall.**
  - Before, the called suit aimed for a speed based only on how far away you were, so it settled about 40 m behind someone falling at full speed and never closed the gap.
  - Now it matches your fall speed and closes in on top of that, diving at up to 260 m/s (faster if you're falling faster) with an instant launch. Mid-air it latches on within 10 m.
  - In simulation it catches you within about 0.6–1.7 s of calling, even after a 12-second fall from space.
- **Sharp turns: `Shift`+`A` / `Shift`+`D`.**
  - In flight: snap the heading about 90° in 0.6 s with a hard bank just past vertical; the flight path really follows. It costs a little speed and power.
  - In hover: a quick 90° pivot.
  - `Shift` on its own still toggles flight, but now on release, and only if you didn't use it for a sharp turn. Keyboard only for now.
- **Phone rotation fix.**
  - In portrait on small phones, the "Rotate your device" and title text was wider than the screen (414 px on a 320 px iPhone SE). On iPhone, content wider than the screen widens Safari's page layout, which then breaks rotating to landscape.
  - Titles now wrap and fit, the rotate screen is opaque, and the orientation check and canvas resize run again a moment after rotating (phones report the new size late).

## Milestone 6 – banked turns, mid-air eject, piloted sentry

- **Banked turns, like the films.**
  - In flight the whole body rolls about its long axis into a turn: turn right and the right arm drops while the left arm points up.
  - The bank builds gradually, up to about 86° (nearly sideways) in a hard turn, and levels out when you straighten up.
  - The more you're banked, the tighter the turn bites. Barrel rolls and corkscrews now spin about the same axis, and the camera tilts slightly with the bank.
- **Eject mid-air.**
  - `G` in hover or flight (EJECT on touch) throws you clear of the suit. You fall as a civilian, and the empty suit drifts down where you left it.
  - Press `G` again to call it. It chases you down, leading your fall at up to about 500 km/h, and the pieces latch on in under a second.
  - Once suited, the stabilisers catch you. If it doesn't reach you in time, the fall is fatal (anything over about 95 km/h as a civilian) and you go back to Avengers Tower.
- **Sentry mode: pilot the empty suit.**
  - `V` (SENTRY on touch) steps you out of the suit and gives you direct control of the empty armour: fly, fight, do tricks, even go to space. Your body waits where you left it, with a YOU marker on the compass.
  - With nobody inside, a fatal fall only damages the suit and oxygen isn't used. If the suit is wrecked it drops offline and you're back in your body.
  - `G` sends the suit back to you: you're back in your body, it flies over and latches on, and then you're flying it with you inside.
  - `V` again returns you to your body, and the suit keeps guarding you on its own (the old AI sentry). On foot, `V` takes control of the suit wherever it is.

## Milestone 5 – space, oxygen, free fall and the step-out

- **Fly to space.** The old 900 m ceiling is gone.
  - Above **1,100 m** the air is too thin and the suit switches to internal **oxygen** (new OXYGEN gauge under POWER).
  - Above **2,600 m** you are in space: the sky fades to black, stars come out, and the city stays visible far below. The hard limit is 4,200 m.
  - Thin air means less drag, so the suit flies up to about 2.6× faster up high.
- **Oxygen runs out.**
  - It drains slowly in thin air and faster in space (about 40 s of supply at full), and refills quickly once you are back below 1,100 m.
  - F.R.I.D.A.Y. warns at 50%, 25% and 10%, and the view closes in as it gets low.
  - At 0% you **black out**: the thrusters die and you fall. You come to once you have dropped back into breathable air and the tank reaches 30%, with a few hundred metres to re-engage. If you don't, see below.
- **Cut thrust with `H`.**
  - In hover or flight, `H` kills all thrust and you drop into a **free fall** (skydiving pose, momentum kept, `WASD` steers a little).
  - Re-engage with `H` or `Space` (hover), or `Shift` (flight). Touch: a CUT button appears in flight; LIFT re-engages.
  - The automatic stabilisers stay off while thrust is cut, so a fall from space is a real fall.
- **Falls can kill you.** Drag sets a terminal velocity of about 96 m/s at sea level (faster in thin air).
  - Hitting the ground or water unpowered faster than **62 m/s** in the armour (about 220 km/h), or **26 m/s** as a civilian, is fatal.
  - The screen fades to black with the impact speed, and F.R.I.D.A.Y. brings you back, suited and repaired, to the **Avengers Tower** landing pad (renamed from Apex Tower).
- **Step-out animation.** Pressing `G` while landed now splits the armour open: the helmet first, then the front plates swing forward, the side plates move out and the back pack lifts. You back out of it, and the plates clamp shut again with a clank per section.
- The spin / corkscrew trick moved from `H` to `Y`.

## Milestone 4 – latch-on suit-up, new enemies, fluid flight and tricks, 33 km²

- **Suit-up, piece by piece.**
  - When the called suit gets within about 7 m, it breaks apart in mid-air.
  - Each armour piece starts exactly where it was on the flying suit and flies onto your body in sequence: boots, shins, thighs, pelvis, torso, arms and gloves, helmet last.
  - Each piece overshoots and snaps into place with a spark and a metallic clank.
  - The opening suit-up on Engage swirls pieces in from all around you.
- **Four new enemy types:**
  - **Gunship:** a heavy VTOL with ducted fans. It circle-strafes at 70–95 m, fires 8-round chaingun bursts and launches twin missiles.
  - **Sniper:** a hooded rooftop marksman. It paints you with a red laser that lags behind your movement, fires a heavy shot after 2 s, then often jet-hops to a new perch.
  - **Shield drone:** projects a purple bubble that cuts damage to every hostile within 22 m by 75%. It hangs back behind its squad, so kill it first.
  - **Hover tank:** stalks along the streets and lobs arcing explosive shells with a lead-aimed ballistic solution. The turret glows before each shot. You can shoot shells down mid-air.
  - New incidents: sniper nest, shielded strike team, gunship assault, armoured convoy, and an all-out assault.
- **More fluid, slightly slower flight.**
  - Cruise 48 m/s, afterburner 125 m/s (about 450 km/h).
  - Steering rates ease in and out, and velocity carries momentum, so turns carve.
  - Banking follows your actual turn, and the camera trails the aim a little in flight.
  - Hover is a touch floatier.
- **Mid-air tricks**, chained into a style combo that refills power:
  - `T`: front flip in hover / loop-the-loop in flight (the flight path really loops).
  - `B`: backflip.
  - `H` (now `Y`, see Milestone 5): 360° spin in hover / corkscrew in flight (a double roll that also dodges fire).
  - `Q` / `E`: barrel rolls, as before.
  - Touch: a TRICK button appears while airborne.
- **Even bigger map:** 18 × 18 chunks, about **5.8 km × 5.8 km (33 km²)**, with 81 districts and a fifth skyscraper cluster (Harbor Heights).
- Renamed to **Iron Man**, with **F.R.I.D.A.Y.** as the suit AI.

## Milestone 3 – the suit has a mind of its own, a 20 km² city

- **The suit is its own unit.**
  - **Step out** (`G` while landed): the empty armour stays standing exactly where you were, and you step back out of it as the civilian.
  - **Call the suit** (`G` / CALL SUIT on foot): it lifts off, climbs over buildings in its way, flies across the city to you (up to about 290 km/h), and docks: the armour assembles around you. It tracks you if you keep walking. A red compass marker shows where it is.
  - **Sentry mode** (`V` / SENTRY): the empty suit, with nobody inside, guards you. It hovers ahead of you on whichever side is not a wall, engages any hostile within 200 m on its own with repulsors and homing rockets, weaves while fighting, and barrel-rolls away from incoming missiles. Enemies fight the suit and leave the civilian alone. Its armour is the same suit, so damage carries over. If integrity drops below 15% it goes offline until self-repair brings it back. Pressing `V` while suited (and landed) steps out and leaves the suit on guard.
- **A bigger, denser city:** 14 × 14 chunks, about **4.5 km × 4.5 km (20 km²)** with 49 named districts.
  - Four skyscraper clusters, and the rest is dense low/mid-rise.
  - Rowhouse blocks (narrow 3–7 storey brownstones wrapped around courtyards) and 3×3 mid-rise grids.
  - Street trees between the lamps and more street furniture.
  - A longer central park.
- **Much busier streets:** about 2.5× the cars and 3× the pedestrians at each quality level (Medium: 80 vehicles, 120 people).
  - Vehicles are cars (lots of yellow cabs), box vans and city buses. Spacing accounts for vehicle length, and cars brake for you if you stand in the road.
  - Pedestrians vary in skin tone and height.
  - They **run away from explosions and gunfire.**
  - Traffic and crowds fill in around you immediately after spawning.

## Milestone 2 – combat, a much bigger city, civilian mode

- **A 3.2 km × 3.2 km city.** That's about 10 km² and 25× the first district: 1,600 blocks across 25 named districts, a midtown skyscraper core plus a taller financial-district core, low-rise neighbourhoods, a large central park, pocket parks and plazas, all on an island with a distant skyline across the water. Layout and collision exist for the whole city from the start, while meshes and props **stream in and out around the camera** (two chunks per frame in fast flight), so memory and draw calls stay bounded. Traffic and pedestrians follow you around.
- **Mouse look that just works.** Click the game to capture the mouse, then move it to look around (Esc releases it). If pointer lock is unavailable, dragging still looks around. Touchscreen laptops such as Chromebooks switch automatically between mouse and touch layouts depending on what you last used. Previously, on a touch-capable laptop the touch layer swallowed mouse clicks.
- **Weapons:**
  - **Repulsors** (hold left mouse / `X` / BLAST): rapid palm blasts with aim assist that leads moving targets.
  - **Arm micro-rockets** (right mouse / `R` / MSL): up to 4 rockets at once that lock onto separate targets in the reticle cone, home in, and explode with splash damage. 8 rockets that regenerate.
  - You can shoot down incoming missiles.
- **Bad guys with real moves:**
  - **Attack drones:** orbit-strafe around you, flip direction, fire 3-round bursts, **dodge** when you aim at them, and retreat to regroup when badly damaged.
  - **Kamikaze drones:** weaving dives that explode on contact. Shoot them first or roll away.
  - **Jet-pack troopers:** strafe along rooftops and streets without falling off, **jet-hop** to new positions (sometimes to dodge your fire), fire bursts, and launch **homing missiles**.
  - **Warbot** (unlocks after three incidents): a walking assault mech that stomps toward you firing bursts, launches 4-missile salvos, charges a **telegraphed laser** (the red aiming line lags behind you, so keep moving), and **ground-slams a shockwave** if you get close at street level.
- **Incidents.** F.R.I.D.A.Y. dispatches combat incidents (drone swarms, rooftop gangs, street robberies, kamikaze waves, missile nests, Warbot rampages) plus occasional rescue calls. Each is marked by a beam, a ring and a compass marker, and progress shows as "Hostiles 2/5". Clearing one repairs the suit, recharges power and reloads rockets. If integrity falls below 15%, the suit fails and F.R.I.D.A.Y. flies you back to Avengers Tower.
- **More fun flying:**
  - **Barrel rolls** (`Q`/`E`, double-tap `A`/`D`, or double-tap the right side of the touchscreen): a sideways dash with brief invulnerability that also **breaks missile locks**.
  - **Dives build speed and climbs bleed it.** The afterburner now has a kick and a higher top speed (about 590 km/h).
  - **Sonic boom** ring and shake when you pass about 540 km/h.
  - **Close-call bonuses** for skimming buildings at speed (power refill and streak counter).
  - Speed streaks, FOV punch, harder banking, and tighter low-speed turns.
- **Take off the suit** and walk the streets as a civilian (jacket, jeans, sunglasses): walk, sprint with `Shift`, jump with `Space`. The helmet HUD switches to a minimal on-foot view, and enemies ignore civilians. Milestone 3 turns the empty suit into its own unit (see above).
- **Combat HUD:** target brackets with health bars, amber lock-on diamonds, a hit marker, damage flash, a weapons panel (rocket pips, kill count), and pop-ups for kills, close calls, evasions and sonic booms. All sounds are synthesised (repulsor zaps, rocket whooshes, explosions, laser).

## Milestone 1 – playable prototype (foundation)

- **City** (now expanded, see Milestone 2): an island grid with avenues, lane markings, crosswalks, raised sidewalks, modular skyscrapers with setbacks and cornices, glass towers, NYC-style rooftop water towers, AC units, antennas, a park, a plaza with a fountain, and the hero landmark **Avengers Tower** with its landing pad. A distant skyline and harbour water surround it.
- **Street life**: traffic that follows lanes, keeps its distance and stops at signals (the signals change colour), plus pedestrians walking the sidewalks.
- **Armoured hero**: a procedurally modelled suit with a joint hierarchy. Poses blend between walk, hover, flight and a "superhero landing" crouch, with boot and palm thruster flames, an arc reactor glow, a suit-up assembly animation on start, and a blob shadow.
- **Movement**: walking in armour, takeoff, hover (strafe, ascend, descend, hold altitude), high-speed flight with banking, an afterburner, braking back into hover, and landing on streets or rooftops (hard landings at speed). Wall impacts damage the suit. Stabilisers catch you if you walk off a roof, hover engages automatically over water, and soft limits apply to the airspace boundary and altitude ceiling.
- **Third-person camera**: smoothed follow, shoulder offset, speed-based distance and FOV, banking roll, impact shake, and pull-in when buildings get in the way.
- **F.R.I.D.A.Y. HUD**: compass tape with map markers, heading, speed (km/h + Mach), altitude, AGL and vertical speed, suit integrity diagnostics (per-part silhouette), power bar, mode indicator, area-name banners, and dynamically generated alerts.
- **Optional city incidents**: F.R.I.D.A.Y. spawns incidents nearby, each with a beam and ring in the world and an amber compass marker. Reach one to resolve it.
- **Controls**: keyboard and mouse (drag-look, or click to pointer-lock), plus a touch layout with a floating virtual stick, a camera drag area, and large UP / DOWN / FLY buttons.
- **Settings menu**: graphics quality (low / medium / high), auto-reduce quality on low FPS, mouse and touch sensitivity, invert Y, volume, FPS counter, and return to Avengers Tower. Settings persist in `localStorage`.
- **Robustness**: loading screen with progress, a recoverable error screen when WebGL is unavailable, a WebGL context-loss notice, a rotate-to-landscape hint on phones, safe-area insets, and no pinch-zoom or scroll hijack.
- **Audio**: synthesised WebAudio thrusters, wind and alert blips (no audio files), unlocked by the Engage tap so it works on iOS.

## Controls

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Look / steer | **Click to capture the mouse**, then move it (`Esc` releases) | Drag on the right side |
| Move / strafe | `W A S D` / arrows | Left-thumb stick |
| Take off / ascend (climb in flight) | `Space` | ▲ |
| Descend (dive in flight) | `C` or `Ctrl` | ▼ |
| Toggle flight / hover | Tap `Shift` (on release), or `F` | FLY |
| Afterburner / brake (in flight) | `W` / `S` | Stick up / down |
| Barrel roll / dodge | `Q` / `E`, or double-tap `A` / `D` | Double-tap the right side |
| Tricks: flip or loop / backflip / spin or corkscrew | `T` / `B` / `Y` | TRICK (flip in hover, loop in flight) |
| Cut all thrust (free fall) / re-engage | `H` (re-engage: `H` or `Space`) | CUT / LIFT |
| Repulsors (hold) | Left mouse or `X` | BLAST |
| Micro-rockets (lock-on) | Right mouse or `R` | MSL |
| Step out (landed) / eject (in the air) / call the suit back / recall a piloted suit | `G` | SUIT OFF · EJECT · CALL SUIT · RECALL |
| Sentry: pilot the empty suit / back to your body (suit guards you) | `V` | SENTRY · BODY |
| Bank and turn in flight | `A` / `D` (or mouse) | Stick left / right |
| Sharp 90° turn (flight / hover) | `Shift`+`A` / `Shift`+`D` | — |
| Civilian: sprint / jump | `Shift` / `Space` | — / ▲ |
| Pause & settings | `Esc` or `P` | ☰ |

## Getting started

Requirements: Node.js 20+ (developed on Node 22).

```bash
npm install
npm run dev        # dev server with hot reload (http://localhost:5173, also on your LAN)
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173 (add --host to test from a phone on your Wi-Fi)
```

To test on a phone during development, run `npm run dev` and open the printed network URL on the phone (same Wi-Fi).

### Tests

```bash
npm test               # unit tests (Vitest): city generation, collision, flight physics
npm run test:e2e       # browser tests (Playwright + Chromium): boot, flight sequence, menu, touch, WebGL error
npm run screenshots    # regenerate docs/screenshots (SCREENSHOTS=1)
npm run typecheck      # app + test TypeScript projects
```

The e2e tests run the production build through `vite preview`. If Playwright has no browser installed, run `npx playwright install chromium` once.

## Deploying to Cloudflare (free)

The game is a fully static site: build command `npm run build`, output directory `dist`. Both Cloudflare options below are free.

**Option A: Workers with Git integration (Cloudflare's current default flow)**
1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository** and pick this repo.
2. Build command: `npm run build`. Deploy command: `npx wrangler deploy` (the default).
3. Deploy. `wrangler.jsonc` in the repo tells Wrangler to serve `dist/` as static assets, so it does not try to auto-configure the Vite project. The Worker name in `wrangler.jsonc` (`ironman`) must match the Worker name in the dashboard; change one of them if you renamed the project.

**Option B: Pages with Git integration**
1. Go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repo.
2. Framework preset **None** (or Vite), build command `npm run build`, build output directory `dist`. Optionally set the environment variable `NODE_VERSION=22`.

**Option C: Direct upload from your machine**
```bash
npm run build
npx wrangler deploy      # Workers static assets, using wrangler.jsonc
```
(Wrangler asks you to log in to your own Cloudflare account. No credentials are stored in this repo.)

`public/_headers` sets long-lived immutable caching for hashed assets and a few security headers (both Workers static assets and Pages honour it). Paths are relative (`base: "./"`), so the build also works from a sub-path.

## Architecture

```
src/
  main.ts                 boot: WebGL check, engine, loading/error UI
  core/                   Game loop & orchestration, Settings + quality presets, EventBus, math/RNG, device detection
  world/
    WorldConfig.ts        grid/chunk constants (grow the city by widening DISTRICT)
    CityGenerator.ts      pure, deterministic per-chunk layout data (buildings, props, colliders)
    ChunkManager.ts       registers colliders for the whole city; streams chunk meshes/props around the camera
    RoadMarkings.ts       per-chunk lane lines, stop lines and crosswalks
    GeometryBatch.ts      merges boxes into one vertex buffer per material per chunk
    Materials.ts          shared materials with canvas-generated textures
    Props.ts              thin-instanced street furniture, rebuilt for chunks near the camera
    Traffic.ts / Pedestrians.ts   thin-instanced ambient life
    Environment.ts        lights, sky dome, fog, island, water, road markings, skyline
    Collision.ts          AABB spatial hash, ground heights, ray casts
  player/                 PlayerController (pure flight/walk physics, suit exit/entry, rolls), SuitUnit (the
                          empty suit: parked / sentry AI / flying in to dock), ArmorModel (armour + civilian
                          rig, poses, transformation), SuitSystems, SpeedFx
  camera/                 ThirdPersonCamera
  input/                  InputManager (keyboard/mouse/touch → InputState), TouchControls
  ui/                     Hud (F.R.I.D.A.Y. HUD), SettingsMenu
  combat/                 Targets (anything enemies can attack: player or sentry suit), Enemies (AI), Projectiles (bolts, rockets, missiles, explosions), Combat (player weapons,
                          lock-on, aim assist) - all pure logic, unit-tested - plus EnemyRenderer/ProjectileRenderer
  gameplay/               CityEvents (combat incidents, rescue calls, markers)
  audio/                  SuitAudio (synthesised)
```

Design notes for expansion:

- **Chunked, deterministic world.** `generateChunk(cx, cz)` is pure and seeded by coordinates. `ChunkManager.load/unload` already exist, so streaming a larger city means loading chunks by radius around the player. The collision world is a spatial hash, so its cost does not grow with city size.
- **Gameplay is decoupled from rendering.** `PlayerController`, `CityGenerator` and `CollisionWorld` have no rendering dependencies and are unit-tested in Node. Systems talk through a typed `EventBus` (alerts, mode changes, impacts, landings, area changes), which is where missions, abilities and the civilian alter ego will plug in.
- **The input abstraction** (`InputState`) is device-agnostic, so new abilities only need new fields and bindings.

### Performance approach

- Buildings merged into 3 draw calls per chunk. Props, cars and pedestrians use thin instances (1 draw call per part).
- Chunk meshes hidden beyond the view distance, and props only instanced within the prop distance. Opaque geometry is drawn front to back, with ground, water and sky last, to cut overdraw.
- Small canvas textures (512² facades, 256² others) with mipmaps. No post-processing. Transparency is limited to small additive effects.
- Real-time shadows only on **High** (player only). A blob shadow is used everywhere else.
- Quality presets control render resolution (pixel ratio), view and prop distances, shadows, particles, and car/pedestrian counts. Touch devices default to **Low**, desktops to **Medium**, and auto-reduce drops a level if FPS stays below about 26.

## Verification status

Verified in this environment (automated, headless Chromium 141 with SwiftShader software WebGL):
- Production build and TypeScript strict checks pass. **55 unit tests** pass, covering:
  - City generation and collision.
  - Flight physics:
    - Civilian movement.
    - **The loop-the-loop returns to about its starting altitude.**
    - **Hover flips reset cleanly and chained tricks build the combo.**
    - **A corkscrew dodges fire.**
  - Combat and every enemy type:
    - **Shield drones cut ally damage until destroyed.**
    - **Snipers always telegraph before firing.**
    - **Tank shells arc and hurt.**
    - **Gunships circle-strafe at range.**
  - The autonomous suit (call, dock, sentry, offline).
  - Milestone 7: jets make passes and come back, swarmers close in and pop in one hit, the EMP jammer charges and drains power, the carrier launches a capped swarm outside its incident group, the 7.68 km map, and the Shift sharp turn (heading ~90° and the flight path follows).
  - Milestones 5–6: free fall and re-engage, fatal vs. survivable falls, oxygen drain and blackout recovery, climbing past the edge of space, the step-out walk, the bank direction (right turn = right arm down), a mid-air eject that kills you if nobody catches you, and a quick call catching you, plus the remotely piloted suit surviving crashes.
- **20 browser tests** pass on the desktop and emulated-mobile projects, including:
  - **Phone rotation: nothing overflows the screen in portrait, and rotating to landscape clears the rotate hint and keeps Engage on screen.**
  - **Banked turns both ways, a mid-air eject caught by the called suit, and piloting the empty suit (V) then recalling it (G).**
  - **Space (oxygen drain, black sky), cutting thrust with `H`, and a fatal fall that returns you to Avengers Tower.**
  - Hover flip and flight loop in the real game.
  - Mouse drag-look, the flight sequence, and weapons.
  - Suit off/on and the full step-out → sentry → call → dock flow (now with the piece-by-piece latch).
  - The touch layout and the WebGL error screen.
- The 59 km² city loads in about 1.7–4.6 s here (layout data and about 102k colliders up front, which take about 0.25 s to generate; meshes stream in around the camera).

**Not yet tested:**
- **Real iPhone Safari**, a real Chromebook, or any physical GPU.
- **Real frame rates.** SwiftShader renders on the CPU, so on-screen frame rates here are meaningless. The denser city raised the triangle count, so on-device profiling is the top priority. If it struggles, the Low preset or a lower view distance will help.
- **Real pointer-lock behaviour.** The drag-look fallback is what got tested.
- Audio output (nobody has listened to it), gamepads (not supported), and WebGL context-loss recovery.
- Cloudflare deployment from this repo. `wrangler deploy --dry-run` passes; the real deploy runs in your account.

## Roadmap (next milestones)

1. On-device profiling (iPhone Safari, Chromebook) and tuning of the quality presets (prop LODs, merged far-chunk meshes).
2. More abilities: a charged chest beam, scanner mode that highlights hostiles through walls, and flares. Sentry commands such as "guard this spot" and "attack my target".
3. Civilian life: enter buildings, NPC reactions to combat (pedestrians flee), police and traffic responding to incidents.
4. Story missions and boss fights built on the incident system, with a minimap and mission log.
5. Gamepad support, PWA offline caching, and save data for progress and unlocks.

## License

MIT for the code. All assets are generated at runtime by this code. The names "Iron Man" and "F.R.I.D.A.Y." belong to their owners and are not covered by the MIT licence; this is an unofficial, non-commercial fan project.
