# AEGIS: Skyline Protocol

An original, browser-native 3D open-world superhero flight game. You pilot a red-and-gold powered-armour suit through a compact New York–inspired district at dusk, guided by **ARIA**, the suit's onboard AI.

Built with **Babylon.js + TypeScript + Vite**. Every model, texture and sound is generated procedurally at runtime, so there are no downloaded or proprietary assets. It builds to static files for **Cloudflare** (Workers static assets or Pages), at $0.

| | |
|---|---|
| ![Drone fight](docs/screenshots/03-combat-drones.png) | ![Warbot](docs/screenshots/04-warbot.png) |
| ![Afterburner flight](docs/screenshots/05-flight-afterburner.png) | ![Civilian on foot](docs/screenshots/07-civilian.png) |
| ![City from 420 m](docs/screenshots/06-city-overview.png) | ![Mobile touch controls](docs/screenshots/09-mobile-touch-controls.png) |

*These screenshots come from the real running game. They were captured in headless Chromium with software (SwiftShader) rendering via `npm run screenshots`. The mobile shot uses Chromium's iPhone emulation, not real Safari.*

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
- **Incidents.** ARIA dispatches combat incidents (drone swarms, rooftop gangs, street robberies, kamikaze waves, missile nests, Warbot rampages) plus occasional rescue calls. Each is marked by a beam, a ring and a compass marker, and progress shows as "Hostiles 2/5". Clearing one repairs the suit, recharges power and reloads rockets. If integrity falls below 15%, the suit fails and ARIA flies you back to Apex Tower.
- **More fun flying:**
  - **Barrel rolls** (`Q`/`E`, double-tap `A`/`D`, or double-tap the right side of the touchscreen): a sideways dash with brief invulnerability that also **breaks missile locks**.
  - **Dives build speed and climbs bleed it.** The afterburner now has a kick and a higher top speed (about 590 km/h).
  - **Sonic boom** ring and shake when you pass about 540 km/h.
  - **Close-call bonuses** for skimming buildings at speed (power refill and streak counter).
  - Speed streaks, FOV punch, harder banking, and tighter low-speed turns.
- **Take off the suit.** Press `G` (or SUIT) while landed: the armour peels away piece by piece and you walk the streets as a civilian (jacket, jeans, sunglasses). Walk, sprint with `Shift`, jump with `Space`. The helmet HUD switches to a minimal on-foot view, and enemies ignore civilians. Press `G` again and the armour assembles around you.
- **Combat HUD:** target brackets with health bars, amber lock-on diamonds, a hit marker, damage flash, a weapons panel (rocket pips, kill count), and pop-ups for kills, close calls, evasions and sonic booms. All sounds are synthesised (repulsor zaps, rocket whooshes, explosions, laser).

## Milestone 1 – playable prototype (foundation)

- **City** (now expanded, see Milestone 2): an island grid with avenues, lane markings, crosswalks, raised sidewalks, modular skyscrapers with setbacks and cornices, glass towers, NYC-style rooftop water towers, AC units, antennas, a park, a plaza with a fountain, and the hero landmark **Apex Tower** with its landing pad. A distant skyline and harbour water surround it.
- **Street life**: traffic that follows lanes, keeps its distance and stops at signals (the signals change colour), plus pedestrians walking the sidewalks.
- **Armoured hero**: a procedurally modelled suit with a joint hierarchy. Poses blend between walk, hover, flight and a "superhero landing" crouch, with boot and palm thruster flames, an arc reactor glow, a suit-up assembly animation on start, and a blob shadow.
- **Movement**: walking in armour, takeoff, hover (strafe, ascend, descend, hold altitude), high-speed flight with banking, an afterburner, braking back into hover, and landing on streets or rooftops (hard landings at speed). Wall impacts damage the suit. Stabilisers catch you if you walk off a roof, hover engages automatically over water, and soft limits apply to the airspace boundary and altitude ceiling.
- **Third-person camera**: smoothed follow, shoulder offset, speed-based distance and FOV, banking roll, impact shake, and pull-in when buildings get in the way.
- **ARIA HUD**: compass tape with map markers, heading, speed (km/h + Mach), altitude, AGL and vertical speed, suit integrity diagnostics (per-part silhouette), power bar, mode indicator, area-name banners, and dynamically generated alerts.
- **Optional city incidents**: ARIA spawns incidents nearby, each with a beam and ring in the world and an amber compass marker. Reach one to resolve it.
- **Controls**: keyboard and mouse (drag-look, or click to pointer-lock), plus a touch layout with a floating virtual stick, a camera drag area, and large UP / DOWN / FLY buttons.
- **Settings menu**: graphics quality (low / medium / high), auto-reduce quality on low FPS, mouse and touch sensitivity, invert Y, volume, FPS counter, and return to Apex Tower. Settings persist in `localStorage`.
- **Robustness**: loading screen with progress, a recoverable error screen when WebGL is unavailable, a WebGL context-loss notice, a rotate-to-landscape hint on phones, safe-area insets, and no pinch-zoom or scroll hijack.
- **Audio**: synthesised WebAudio thrusters, wind and alert blips (no audio files), unlocked by the Engage tap so it works on iOS.

## Controls

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Look / steer | **Click to capture the mouse**, then move it (`Esc` releases) | Drag on the right side |
| Move / strafe | `W A S D` / arrows | Left-thumb stick |
| Take off / ascend (climb in flight) | `Space` | ▲ |
| Descend (dive in flight) | `C` or `Ctrl` | ▼ |
| Toggle flight / hover | `Shift` or `F` | FLY |
| Afterburner / brake (in flight) | `W` / `S` | Stick up / down |
| Barrel roll / dodge | `Q` / `E`, or double-tap `A` / `D` | Double-tap the right side |
| Repulsors (hold) | Left mouse or `X` | BLAST |
| Micro-rockets (lock-on) | Right mouse or `R` | MSL |
| Suit off / on (when landed) | `G` | SUIT |
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
  player/                 PlayerController (pure flight/walk physics, suit toggle, rolls), ArmorModel (armour +
                          civilian rig, poses, transformation), SuitSystems, SpeedFx
  camera/                 ThirdPersonCamera
  input/                  InputManager (keyboard/mouse/touch → InputState), TouchControls
  ui/                     Hud (ARIA HUD), SettingsMenu
  combat/                 Enemies (AI), Projectiles (bolts, rockets, missiles, explosions), Combat (player weapons,
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
- Production build and TypeScript strict checks pass. **28 unit tests** pass, covering:
  - City generation and collision: the analytic sidewalk/road heights and the landing-pad collider.
  - Flight physics: civilian walk/sprint, the suit toggle, barrel-roll invulnerability, and dive speed.
  - Combat: repulsors kill a trooper; rockets lock on and kill an off-centre drone; drones damage a suited player but ignore a civilian; a roll breaks missile lock; kamikazes dive in and explode; the Warbot laser only fires after its telegraph.
- **Browser tests** (11 pass on the desktop and emulated-mobile projects):
  - The game boots with no console errors.
  - **Mouse drag-look turns the camera.**
  - The full takeoff → hover → flight → afterburner → brake → landing sequence works.
  - **Rockets fire and repulsors kill a trooper.**
  - **Suit off → walk as a civilian → suit on** works.
  - The settings menu works.
  - Touch (Chromium iPhone emulation): LIFT, stick, MSL, FLY, menu, and the SUIT button to civilian and back. Low quality is the default on mobile.
  - The WebGL-unavailable error screen appears.
- Shaders for all enemies, effects and the civilian are compiled during loading, so nothing hitches when they first appear.

**Not yet tested:**
- **Real iPhone Safari**, a real Chromebook, or any physical GPU.
- **Real frame rates.** SwiftShader renders on the CPU, so on-screen frame rates here are meaningless. Measured in the browser, the game's own JavaScript costs about 1 ms per frame and render submission about 4 ms. The scene draws about 350k triangles in about 120 draw calls at Medium. This should be comfortable on integrated GPUs and modern iPhones, but it needs on-device profiling.
- **Real pointer-lock behaviour.** It wasn't observed in headless Chromium; the drag-look fallback was what got tested.
- Audio output (nobody has listened to it), gamepads (not supported), and WebGL context-loss recovery.
- Cloudflare deployment from this repo. `wrangler deploy --dry-run` passes; the real deploy runs in your account.

## Roadmap (next milestones)

1. On-device profiling (iPhone Safari, Chromebook) and tuning of the quality presets.
2. More abilities: a charged chest beam, scanner mode that highlights hostiles through walls, and flares.
3. Civilian life: enter buildings, NPC reactions to combat (pedestrians flee), police and traffic responding to incidents.
4. Story missions and boss fights built on the incident system, with a minimap and mission log.
5. Gamepad support, PWA offline caching, and save data for progress and unlocks.

## License

MIT for the code. All assets are generated at runtime by this code. This is an original work: no trademarked characters, names, logos or assets are used.
