# Iron Man (unofficial fan game)

A browser-native 3D open-world superhero flight game in the style of Iron Man. You fly a red-and-gold suit through a huge New York-style city, fight hostile machines, step out and walk the streets as a civilian, and call your suit back so it latches on piece by piece. F.R.I.D.A.Y. runs the HUD.

> **Unofficial fan project.** Not affiliated with, endorsed by or sponsored by Marvel, Disney or any rights holder. "Iron Man" and "F.R.I.D.A.Y." are trademarks of their respective owners, used here only to identify the fan tribute. All models, textures and sounds are generated procedurally by this code; no assets from films or games are included. Publishing it publicly under these names carries trademark risk, so consider an original title for a public release.

Built with **Babylon.js + TypeScript + Vite**. Every model, texture and sound is generated procedurally at runtime, so there are no downloaded or proprietary assets. It builds to static files for **Cloudflare** (Workers static assets or Pages), at $0.

| | |
|---|---|
| ![Flight challenge ring course](docs/screenshots/29-ring-course.png) | ![Hypersonic flight at Mach 1.2](docs/screenshots/30-hypersonic.png) |
| ![Mobile touch controls](docs/screenshots/09-mobile-touch-controls.png) | ![Phone controls faded when idle](docs/screenshots/28-mobile-controls-idle.png) |
| ![Titan, sentinels and a spider walker](docs/screenshots/27-titan-sentinels.png) | ![Flares](docs/screenshots/24-flares.png) |
| ![Night over the city](docs/screenshots/25-night.png) | ![Midas armour by day with a boss bar](docs/screenshots/26-day-midas-boss.png) |
| ![Unibeam](docs/screenshots/22-unibeam.png) | ![Clouds and contrails](docs/screenshots/23-clouds-contrails.png) |
| ![Banked turn](docs/screenshots/19-bank-turn.png) | ![Piloting the empty suit in sentry mode](docs/screenshots/21-sentry-remote.png) |
| ![Ejecting mid-air](docs/screenshots/20-eject.png) | ![In space](docs/screenshots/17-space.png) |
| ![Free fall after cutting thrust](docs/screenshots/18-freefall.png) | ![Busy street](docs/screenshots/10-busy-street.png) |
| ![Stepping out of the open armour](docs/screenshots/16-step-out.png) | ![City from 420 m](docs/screenshots/06-city-overview.png) |
| ![Suit pieces latching on](docs/screenshots/13-suit-up-latch.png) | ![Called suit latching on](docs/screenshots/15-called-suit-latching.png) |
| ![New enemy types](docs/screenshots/14-new-enemies.png) | ![Avengers Tower pad](docs/screenshots/02-avengers-tower-pad.png) |
| ![Drone fight](docs/screenshots/03-combat-drones.png) | ![Warbot](docs/screenshots/04-warbot.png) |
| ![Stepped out of the suit](docs/screenshots/07-civilian.png) | ![Sentry mode](docs/screenshots/11-sentry.png) |
| ![Afterburner flight](docs/screenshots/05-flight-afterburner.png) | ![Suit flying in](docs/screenshots/12-suit-inbound.png) |
| ![Title screen](docs/screenshots/01-title.png) | ![Settings menu](docs/screenshots/08-settings-menu.png) |

*These screenshots come from the real running game. They were captured in headless Chromium with software (SwiftShader) rendering via `npm run screenshots`. The mobile shot uses Chromium's iPhone emulation, not real Safari.*

## Milestone 17 – more enemies, more fun, missions, achievements, animations and graphics

**New enemies (five)**
- **Heavy bomber:** makes carpet-bombing passes over you, dropping a stick of bombs that keep their forward speed. A tail gunner covers its rear, and it extends and turns for another pass.
- **Air mines:** fields of spiked mines hang in the sky. They wake when you come close, drift after you blinking faster and faster, and detonate on contact. A shot mine still blows, so you can chain them.
- **Rooftop flak turret:** tracks flyers and fires air-burst shells around where you are heading. Keep jinking.
- **Rogue armour (mini-boss):** a rival suit that circle-strafes with paired repulsor blasts, fires four-missile salvos, makes boosted ramming dashes and barrel-rolls out of your fire.
- **Courier drone:** runs from you with stolen tech, weaving over the rooftops and surging when hit.
- New incidents: Bombing run, Minefield, Flak alley, ROGUE ARMOUR, and Blitz (all of the above at once).

**More fun everywhere**
- **Kill streaks:** kills within 3.5 s chain into DOUBLE KILL, TRIPLE, QUAD, MULTI KILL, RAMPAGE, UNSTOPPABLE and GODLIKE. XP is multiplied by up to 3×, and a HUD chip shows the streak with a draining bar.
- **Salvage pickups:** wrecks drop repair kits (green), power cells (blue) and rocket packs (orange, a full rearm). Big enemies always drop two. Pickups settle above the ground with a light pillar, so you can spot them from afar, and are pulled in when you fly close.
- **Superhero landings:** a hard landing in the suit sends out a shockwave that damages and throws nearby hostiles.
- **Boss hero moments:** time slows briefly when a boss goes down.

**New objectives**
- **Bomb threat:** three bombs sit on different rooftops. Hover beside each one until its defuse bar fills, before the clock runs out. The warning lights blink faster as time runs low.
- **Stolen Stark tech:** fly through six glowing data cores, some on roofs and some high in the sky.
- **Catch the courier:** run the courier drone down before it gets 1.1 km away.
- **Protect the arc reactor:** four waves attack a rooftop reactor that enemies shoot at like they shoot at you. Don't let it fall.
- **Medevac escort:** a white helicopter with a red cross flies to a glowing hospital pad 450–650 m away, climbing over rooftops on the way. Three waves of attackers go for it, and it is lost if its hull reaches 0.
- **Rooftop run:** bank 12 s flying faster than 248 km/h within 30 m of the rooftops or street.
- **Skydive (low pull):** climb above 600 m, cut thrust, and re-engage below 80 m above the ground. Too early fails, and so does hitting the ground.
- The pause menu has buttons to start any mission right away. Special objectives come up more often among random incidents.
- **25 achievements** (First Blood, Rampage, Giant Slayer, Duelist, Bomb Squad, Superhero Landing, Sound Barrier and more). They are saved on the device, announced with a toast and listed in the pause menu with your progress.

**New animations**
- **Superhero landing pose:** knee and fist planted, head bowed, then a slow rise.
- **Victory pose:** a fist punched to the sky and pumping after objectives, incidents and boss kills.
- Hovering still, the head scans the city. Collecting a pickup flashes the reactor, eyes and palms.
- **Defusing:** the right palm is held out at the bomb with a scanner beam, and the torso turns toward it. The left hand reaches for a pickup as it is pulled in.
- **A badly damaged suit** (below 35%) throws sparks and trails smoke, and does so faster below 15%.
- **Crashing wrecks:** downed aircraft (drones, jets, gunships, bombers, the carrier, the rogue armour and others) spiral down burning with a smoke trail, then explode where they hit, hurting hostiles below.
- New enemy motion: the bomber wallows and banks, mines tumble and shiver, turret barrels kick back, the rogue armour leans and rolls like a suit, and the courier's cargo glows as it surges.
- **HUD:** the objective-complete banner sweeps in, and the achievement toast slides down with a gold glint.

**Graphics**
- **Sun lens flare** (Medium and High): a soft glare, an anamorphic streak and faint ghosts across the view. It hides behind buildings and fades at the screen edge.
  - It is drawn as a light screen overlay, because Babylon's built-in flare drew at the screen centre with large-world rendering on.
- **Explosion heat flash:** a warm flash over the view from big nearby blasts.
- **High preset:** sharpening, fine film grain, and chromatic aberration that pulses when you are hit and at hypersonic/RUSH speeds.

## Milestone 16 – cinematic suit-up

- **The armour goes on one section at a time** whenever the suit docks with you on the ground, at the start of a game and on respawn:
  1. Chest and back plates.
  2. **Right arm.** He raises it out to the side and looks at it while the glove, forearm, upper arm and shoulder plates fly in, hand first. The fingers flex as the glove clamps.
  3. **Left arm**, the same way.
  4. **Right leg.** He lifts the knee, arms out for balance, eyes on the boot, as the boot, shin and thigh plates come in foot first.
  5. **Left leg**, the same way.
  6. **Helmet.** He stands tall, chin up.
  7. **Faceplate.** It slides down over the face and clamps with a small nod, the eyes and arc reactor flare on, and the fists clench.
- Plates waiting for their turn hover where the arriving suit broke apart, bobbing gently. Each section clanks and sparks as it locks on.
- The whole sequence takes 4.1 s, and control returns right after the faceplate. A mid-air catch is still the fast all-at-once snap, so you don't hit the ground waiting for it.
- The choreography (stage order, timings and poses) lives in `src/player/SuitUpChoreography.ts`, which is plain logic with unit tests.

## Milestone 15 – repulsor animations, alternating hands, 2 rockets a minute

- **Repulsors alternate hands on every shot** (right, left, right…), on the ground, in hover and in flight, and each bolt leaves from that hand.
- **New repulsor animations:**
  - The firing arm punches straight out with the palm open, and the off hand is held cocked at the ready.
  - The torso twists toward the firing hand, so it swings side to side as the hands alternate.
  - The firing elbow kicks back with a shoulder jolt, and the body rocks away from the blast.
  - Each shot throws a hot blast cone from that palm. While the repulsors are hot, both palms glow faintly.
- **Micro-rockets: two a minute.** The pod holds 2 rockets, one per arm, and fires both at once (to two locked targets when it has them). It then rearms 60 s later. The HUD shows the countdown next to MICRO-ROCKETS, and the touch MSL button shows it as "MSL 42s".

## Milestone 14 – a 50× bigger map, enemies out of walls, no see-through buildings

- **A 50× bigger map:** 382 × 382 chunks, about **122 km × 122 km (about 14,900 km²)**, against 299 km² before. There is a named skyscraper cluster roughly every 3.5 km, about 1,200 of them, and every 3×3-chunk region has its own district name.
  - Everything is generated lazily from hashes: city layout, colliders, district names and skyscraper clusters. Only chunks near the player exist in memory, and far ones are evicted.
  - Traffic finds the next stop line directly instead of scanning every road, since there are now about 1,500 road lines per axis.
  - The harbour water was widened to surround the bigger island.
- **Large-world rendering.** Babylon's `useLargeWorldRendering` is on: 64-bit matrices and a floating origin centred on the camera. This stops 32-bit float precision from shaking the suit and camera 60 km from the centre. Measured render cost in headless Chromium was within about 3% of having it off.
- **Enemies no longer spawn inside buildings.**
  - Every spawn is checked against the full body box of that enemy type. A blocked spawn moves to clear space nearby (walkers stay on the same surface) or onto the roof.
  - A flying enemy that ends up inside a building pops out over the top instead of being stuck forever.
- **No more black buildings you can fly through.** These were the "distant skyline": 520 dark backdrop boxes in the water around the island, with no colliders and no fog. They are removed. Past the shoreline is now open harbour.

## Milestone 13 – no white rings, 25% slower flight, more flight animation

- **No more white rings.** The sonic rings are gone: no vapour-cone rings at hypersonic and no ring on a sonic boom. The boom still shakes the camera, plays its sound and shows its popup.
- **Flight is 25% slower** than Milestone 11. Cruise is **90 m/s** (324 km/h) and the afterburner **234 m/s** (844 km/h). Hypersonic tops out around 316 m/s near the ground, so Mach 1 now needs thin air up high, a dive or RUSH. Accelerations, dive bonus and boosts (afterburner kick, hypersonic surge, ring boost) are cut by the same 25%. Hover speed is unchanged.
- **More flight animation.**
  - At cruise the legs paddle and the arms hang loose. Flat out, the arms tuck in and the legs lock straight.
  - Dives sweep the arms back with the legs pressed together. Climbs open the arms and drive the knees.
  - When the afterburner lights, the arms whip back, the chest pushes out and the legs snap together.
  - RUSH lifts the chin and chest. The afterburner and hypersonic stage add a fast buffeting shimmer.
  - Air-braking flares out: arms forward and spread, legs swung down.
  - Scraping a wall jolts the body away from it.

## Milestone 12 – more fun, more fluid flying

- **Scraping instead of stopping.** A glancing hit on a wall no longer stops you dead. You grind along it in a shower of sparks, lose about 12% speed, take light damage to the arms and legs, and your heading turns to follow the wall. Only head-on crashes stop the flight.
- **RUSH meter.** Flying faster than 75 m/s close to rooftops, the ground or past buildings fills an amber bar under the speed gauge, worth up to +30% top speed. Popups read "RUSH" at half and "MAX RUSH" when full, with a FOV kick. The meter fades slowly while you fly and quickly once you stop.
- **Smoother handling.** Steering responds a little faster. At low speed the flight path follows your heading more tightly, and at high speed it keeps more momentum, so fast turns carve.
- **Livelier camera.** In turns the camera swings to the outside and looks slightly into the curve. The view also widens with rush.

## Milestone 11 – 150% faster flight, hypersonic, ring challenges, new suit & power rules

- **Falls in the suit are always survivable.** Hit the ground from any height (even from space) and you walk away. The armour takes the hit instead: damage scales with impact speed, capped at 45% per fall. Unprotected falls (as a civilian, or after ejecting) can still kill you.
- **Suit destruction.**
  - When hits, building crashes or hard falls take the armour to 0%, it blows apart into wreckage.
  - You're left standing as a civilian. If it happens in the air, the suit's last act is an emergency descent, so you drift down safely.
  - **15 seconds later** a replacement suit is launched from a few hundred metres away, flies in and latches on, fully repaired. The countdown shows on screen, and `G`/`V` are locked until it arrives.
  - This replaces the old "suit failure → respawn at the tower".
- **New power rules.**
  - Power drains only **1% per minute** while the suit is airborne. Flying, afterburner, hypersonic, repulsors, rolls, tricks and sharp turns no longer cost power. The Unibeam (25%) and enemy EMPs still take a chunk.
  - At 0% the thrusters can't hold you up: you drop out of flight and sink to the ground.
  - **Touching the ground recharges power to 100% instantly.**

- **Flight is 150% faster (2.5×):**
  - Cruise goes from 48 to **120 m/s** (430 km/h). The afterburner goes from 125 to **312.5 m/s** (1,125 km/h).
  - Dives, climbs, acceleration and the afterburner kick all scale up to match, and turning keeps its bite at the new speeds.
  - In thin air you go faster still (up to about 2.6× more near space).
  - Hover is 1.5× faster (27 m/s) so it stays precise.
- **The sound barrier is real now:** the sonic boom fires at Mach 1 (343 m/s), and the HUD shows Mach and your top speed.
- **Hypersonic stage:**
  - Hold the afterburner for 1.5 s and you surge to 1.35× top speed (about Mach 1.2, roughly 1,500 km/h).
  - It brings a "HYPERSONIC" call-out, a sonic ring, a pulsing vapour cone around the suit, extra camera buffeting and a wider field of view. It uses a little more power.
- **Flight challenges:**
  - A new mission type, plus a "Start flight challenge" button in the menu. Fly through 10 rings in order against the clock.
  - The next ring blazes gold and the rest of the course is traced in cyan. Every leg is guaranteed to clear the buildings along it.
  - Each ring is a boost: +35 m/s, +6% power and a speed kick. The clock starts at ring 1.
  - You get XP per ring plus 400 for finishing, and your best time is saved.
- **Built for the speed:**
  - Collision is checked in finer steps, so hypersonic flight can't tunnel through walls.
  - City streaming looks ahead along your path and gets more build time when you're fast.
  - The speed lines, wind sound, camera distance and field of view, and the HUD speed bar are all rescaled for the new range.

## Milestone 10 – a 5× bigger city, more enemies, cleaner phone controls, animation everywhere, device tuning

- **A 5× bigger map:** 54 × 54 chunks, about **17.3 km × 17.3 km (299 km²)**, with 20 more named skyscraper districts spread over the outer city.
  - Collision boxes and layout are now generated **lazily, per chunk**, the first time anything touches that area (you, the suit, enemies, raycasts).
  - Areas more than 2.6 km away are evicted and regenerate on demand, so load time and memory don't grow with the map.
  - Streaming only scans nearby chunks.
- **Four more enemy types (20 in total):**
  - **Sentinel:** an Ultron-style flying robot. It glows as it winds up, then rams you at about 220 km/h, peels away, and fires hand blasts in between. Dodge the dash.
  - **Spider walker:** a six-legged street walker that lobs fans of three mortar shells.
  - **Cloaker:** a stealth drone that's invisible (no lock-on, no radar blip, no target marker) until it shimmers into view to fire, or you hit it.
  - **Titan:** a super-heavy boss mech, a 1.8× warbot with a bigger laser, stomp and missiles. It gets a boss bar.
  - New incidents: Ultron sentinels, spider walkers, ghost squadron, and **TITAN AWAKENS**.
- **Cleaner, see-through phone controls:**
  - Icon-only buttons with thin outlines and almost no fill, about 60% opaque, glowing only while pressed. Secondary actions (trick, cut, sharp turns, flares, rockets) are smaller and fainter.
  - The buttons sit in a compact right-thumb grid, all at least 44 pt. The top row (beam, sentry, suit) is small, and only buttons that change meaning keep a tiny label.
  - After 4 seconds without a touch, the controls fade almost away and the stick hides, so the city is unobstructed. Touch anywhere and they're back.
  - **Phone alerts no longer pile up or overlap:** only the newest F.R.I.D.A.Y. alert shows, as one compact line under the compass (long text is cut off with "…"). The mission text keeps to a narrow two-line column on the right, and the area banner sits between them. A browser test checks the three never overlap.
- **Animation for (almost) every move:**
  - **Take-off:** a crouch-and-spring.
  - **Repulsors:** recoil on every shot.
  - **Taking a hit:** a flinch away from the impact.
  - **Death:** the body slumps to the ground.
  - **Idle:** weight shifts between legs.
  - **Enemies:** hits make them swell briefly and knock light ones about.
  - **Cars:** the nose dips under braking, squats when pulling away, and the car bounces slightly on the road.
  - Also new: a knees-tucked, arms-up jump pose (civilian jumps and short drops), a push-off pose when climbing in hover and knees bending when sinking, arms flung wide when popping flares, a limp unconscious fall during an oxygen blackout, shuffling feet when turning on the spot, a full piece-by-piece suit-up at the tower after a respawn, and rocket pips popping as they reload.
  - These add to the existing animation (walk/run cycles, landing crouch, hover sway, banking and steering arms, tricks, barrel rolls, suit latch / step-out / eject, skydive, Unibeam pose, head tracking, enemy warp-in and wreckage, pedestrian panic, and HUD / menu motion).
- **Device tuning (Chromebook, iPhone 15, iPhone X):**
  - Phones and Chromebooks (detected by "CrOS") start on Low.
  - If a device holds about 57+ fps on Low for about 12 s, as an iPhone 15 or a fast Chromebook should, it steps up to Medium automatically. This never happens after a downgrade, or if you picked a quality yourself.
  - Slow devices still step down.
  - The bundle is compiled to ES2020 and checked for syntax newer than Safari 16. The iPhone X maxes out at iOS 16, and nothing needs newer.
  - Memory is bounded as described above.
  - **Frame-time work:**
    - Building a newly visible chunk is now spread over several frames (about 3 ms per frame) instead of done in one go.
    - The HUD caches its element lookups and only writes to the page when a value actually changes.
    - Measured on the emulated iPhone X layout at Low during a flying fight, the simulation's CPU cost is about 2.2 ms per frame on average, with the worst frame down from about 25 ms to 11 ms. At **4× CPU throttling** (to approximate a slow phone or Chromebook CPU) it's about 10 ms on average, with a peak around 38 ms (from 62 ms). The JS heap stays around 60–75 MB.
    - A new browser test enforces a budget at 4× throttling: under 16 ms average and 80 ms peak, and under 250 MB heap. After the 2.5× speed-up (Milestone 11) this test flies at about 230 m/s.
    - Fixes that keep it inside budget:
      - The target brackets no longer read the canvas size each update, which forced a full page layout. The size is now cached on resize.
      - HUD animations restart on the next frame instead of with the "read offsetWidth" trick.
      - Slow-changing HUD values update at 10 Hz, the radar at 10 Hz and sound parameters at 20 Hz.
      - Result: the HUD's cost dropped from about 3.6 ms to 1.3 ms, and the total is about 9–12 ms per frame at 4× throttling.
    - GPU cost can't be measured here (software rendering), so real-device frame rates still need checking on the hardware.
  - **Checking on your own device:** turn on menu → "Show FPS / performance counter" to see live FPS, per-frame simulation time and the active preset. The menu also shows the GPU, WebGL version and browser the device reports.

## Milestone 9 – phone rotation that always works, armour schemes, time of day, rescues

- **Phones: playing sideways now always works.**
  - If your phone's browser stays upright (most often because the system rotation lock is on, which a web page can't override on iPhone), the whole game is now drawn sideways in landscape. You just turn the phone and play.
  - Touch controls are mapped into the rotated screen, and the notch and home-bar safe areas are swapped to match.
  - If the browser does rotate, it switches back to a normal landscape layout automatically.
  - (Milestone 10 removed the full-screen + landscape-lock request on Android: in testing it could stop rendering, and the sideways mode already covers rotation lock.)
  - The HUD now measures the game area rather than the browser window, so it sizes correctly either way. This uses CSS container queries, with the old rules kept as a fallback for older browsers.
  - This replaces the old "Rotate your device" screen.
- **Armour schemes** (menu → Armour): Classic red & gold, Mark II silver, War Machine gunmetal, Stealth black, and Midas gold, each with matching eye and reactor glow.
- **Time of day** (menu): Sunset (default), Day (high sun, blue sky) or Night (moonlight, stars, and city windows lit up).
- **Rescue missions:** "Civilian falling!" Someone teeters on a rooftop edge and slips off as you approach. Fly into them in the suit to catch them (+600 XP), carry them for a moment, and they're set down safe. Too slow, and they're lost.
- **Boss health bar** under the compass for the toughest engaged heavy unit nearby (Dreadnought, Warbot, Gunship or Hover Tank), with a trailing damage bar.
- **Cinematic mode:** `K` (or the menu) hides the HUD for clean views. The death screen still shows.

## Milestone 8 – Unibeam, flares, radar, hero ranks, and a big polish pass

- **Touch sharp turns:** ↰ / ↱ SHARP buttons sit above the move stick while you're hovering or flying (the touch version of `Shift`+`A` / `Shift`+`D`).
- **New abilities:**
  - **Unibeam** (`Z` / BEAM): the arc reactor charges for about half a second (rising whine, glowing chest), then fires a beam up to 700 m along your aim. It deals 180 damage to everything on the line and also burns missiles and shells out of the air. It costs 25% power and has a 4 s cooldown. The suit throws its chest forward and its arms back while firing.
  - **Flares** (`J` / FLARE): burning decoys spray out behind you. Every missile tracking you within 300 m chases a flare instead and blows up on it. 6 s cooldown.
- **Radar minimap** (top left): forward is up, 450 m range, with a sweeping scan line. Flying hostiles show as triangles and ground units as squares (big ones larger). Mission, suit and tower markers sit on the edge when they're out of range.
- **Hero rank:** kills and missions earn XP toward ROOKIE → VIGILANTE → DEFENDER → AVENGER → GUARDIAN → LEGEND → INVINCIBLE. A progress bar sits in the weapons panel, F.R.I.D.A.Y. calls out each rank-up, and your XP is saved between sessions.
- **Graphics:**
  - **Colour grading** (ACES tone mapping, a touch more contrast, a soft vignette) on every quality level.
  - **Bloom + FXAA** on High: thrusters, beams, windows and the pad ring glow.
  - **Cloud layer:** sunlit billboard clouds between 600 and 1,400 m that drift slowly and fade as you fly through them (50 / 110 / 180 clouds by quality).
  - **Contrails:** white vapour streams from the boots at high speed and in thin air (Medium and High).
- **Animation and effects:**
  - Destroyed enemies throw tumbling, glowing wreckage that bounces on the street, plus showers of embers.
  - Enemies warp in: they grow from nothing with a slight overshoot and a bright flash, instead of popping in.
  - Landings and take-offs kick up a ring of dust. A hard landing adds a dust shockwave, and hovering low blasts dust off the ground below you.
  - The head and torso turn toward where you're looking.
  - In a banked turn the lower arm tucks in, the upper arm flares out like a wing, and the legs trail outward.
  - The camera eases between modes (height, shoulder offset, look point) instead of snapping.
  - HUD: mode changes pulse, gauges slide smoothly, the menu fades and pops in, the reticle eases into its flight size, and touch buttons glow when pressed.

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
  - `Shift` on its own still toggles flight, but now on release, and only if you didn't use it for a sharp turn. On touch, use the SHARP buttons (Milestone 8).
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
  - **Arm micro-rockets** (right mouse / `R` / MSL): a pair of rockets that lock onto separate targets in the reticle cone, home in, and explode with splash damage. The pod rearms 60 s after firing, so it's 2 rockets a minute (since Milestone 15).
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
| Sharp 90° turn (flight / hover) | `Shift`+`A` / `Shift`+`D` | ↰ / ↱ SHARP |
| Unibeam (chest laser) | `Z` | BEAM |
| Countermeasure flares | `J` | FLARE |
| Hide / show the HUD (cinematic) | `K` | Menu → Show HUD |
| Go hypersonic | Hold `W` (afterburner) for 1.5 s | Stick up |
| Flight challenge (ring course) | Menu → Start flight challenge | Same |
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
    Environment.ts        lights, sky dome, fog, island, water, road markings
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
- Production build and TypeScript strict checks pass. **93 unit tests** pass, covering:
  - Milestone 17 (cont.): the medevac flies to its pad clear of the roofs while waves attack it (and is lost if shot down), the rooftop run only counts fast-and-low seconds, and the skydive wins only for a low pull.
  - Milestone 17:
    - The bomber drops a stick of bombs near its target. Mines wake, chase and detonate (and blow when shot). Flak bursts around the target. The rogue armour strafes, fires missiles, dashes and dodges. The courier flees.
    - Kill streaks and their multiplier. Pickups settle, get pulled in and collected, can't be collected out of the suit, and expire. A hard landing flags a superhero landing.
    - Bomb defusal (win and timeout), data cores, the courier escaping or being caught, and reactor defence (waves, win and loss).
    - Achievements unlock once each. Shot-down aircraft crash and explode on impact, hurting hostiles below.
  - Milestone 16: the suit-up runs chest, right arm, left arm, right leg, left leg, helmet, then faceplate, every plate lands inside its own section's window, control returns only after the faceplate, and the poses raise each arm out and lift each knee while looking at that limb.
  - Milestone 15: repulsor shots alternate hands every shot, and the rocket pod fires its pair and stays empty until it rearms 60 s later.
  - Milestone 14: the 122 km district (50× the old area) with lazy colliders at 55 km out, skyscraper clusters and names across the whole map, buildings checked on a sample of chunks right up to the edges, and enemies of every size spawned inside a tower ending up in clear space or on its roof (a flyer forced inside pops out over the top).
  - Milestone 13: cruise and afterburner are exactly 75% of the Milestone 11 values, and the hypersonic stage breaks Mach 1 only in thin air.
  - Milestone 12: a glancing wall hit scrapes along the wall and keeps you flying with most of your speed, and skimming low and fast builds RUSH, raises your speed past cruise, then fades once you climb high.
  - The new suit and power rules: falls from 30 m, 400 m and 3 km are all survived with armour damage; repeated hard falls destroy the suit and the pilot drifts down safely; power drains exactly 1% per minute in the air, at 0% you sink even holding climb, and landing recharges to 100% instantly.
  - Milestone 11: cruise and afterburner are exactly 2.5× the old values, holding the afterburner goes hypersonic past Mach 1 (with a sonic boom and the top-speed record), and the faster hover still settles precisely.
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
  - Milestone 10: the 17.28 km map with lazy collider generation and eviction (and regeneration on demand), the sentinel's wind-up and ram, spider mortar fans, cloakers hidden from lock-on until they fire or are hit, and the titan.
  - Milestone 8: the Unibeam charges then kills everything on the aim line (and spares targets off it), flares break a missile lock so it misses, wreckage lands on the ground, and hero rank thresholds.
  - Milestone 7: jets make passes and come back, swarmers close in and pop in one hit, the EMP jammer charges and drains power, the carrier launches a capped swarm outside its incident group, the 7.68 km map, and the Shift sharp turn (heading ~90° and the flight path follows).
  - Milestones 5–6: free fall and re-engage, fatal vs. survivable falls, oxygen drain and blackout recovery, climbing past the edge of space, the step-out walk, the bank direction (right turn = right arm down), a mid-air eject that kills you if nobody catches you, and a quick call catching you, plus the remotely piloted suit surviving crashes.
- **43 browser tests** pass on the desktop and emulated-mobile projects, including:
  - **Medevac escort, rooftop run and skydive start from the pause menu with their objective text.**
  - **Missions started from the pause menu: all three bombs defused by hovering beside them, then all six data cores collected. The achievement list is shown.**
  - **The courier is shot down and drops salvage; reactor defence starts its first wave.**
  - **A triple kill shows the streak, a dropped power cell is collected, and a dive with the thrusters cut ends in a SUPERHERO LANDING.**
  - **Hypersonic past Mach 1 high up, with no white sonic rings drawn.**
  - **RUSH: a full meter pops MAX RUSH, shows the HUD bar and then decays.**
  - **Touch SHARP turn buttons turn you about 90° in flight, and BEAM / FLARE work; on desktop, the Unibeam (`Z`) kills a drone in line, flares (`J`) deploy, and the radar shows.**
  - **Emulated iPhone X (812×375) and iPhone 15 (852×393) in landscape: boot without errors on Low, and every visible touch button is on screen, at least 44 pt and not overlapping another. Emulated Chromebook (CrOS UA): starts on Low, and hopping between the far corners of the 122 km map (±58 km) keeps collider and layout memory bounded.**
  - **Phone held upright: the game is drawn sideways in landscape, Engage and LIFT work through the rotation, look-drags map correctly, and it switches back when the browser rotates.**
  - **A falling civilian caught mid-air; night time, armour schemes, `K` cinematic mode and the boss bar.**
  - **Banked turns both ways, a mid-air eject caught by the called suit, and piloting the empty suit (V) then recalling it (G).**
  - **Space (oxygen drain, black sky), cutting thrust with `H`, and a fatal fall that returns you to Avengers Tower.**
  - Hover flip and flight loop in the real game.
  - Mouse drag-look, the flight sequence, and weapons.
  - Suit off/on and the full step-out → sentry → call → dock flow (now with the piece-by-piece latch).
  - The touch layout and the WebGL error screen.
- The city loads in about 1.7–4.6 s here (layout data and about 102k colliders up front, which take about 0.25 s to generate; meshes stream in around the camera).

**Not yet tested:**
- **Real iPhone Safari** (iPhone X / iPhone 15), a real Chromebook, or any physical GPU. iPhone and Chromebook support is designed for and tested in Chromium emulation (screen sizes, touch, user agent), not on the devices. Emulation can't reproduce Safari's WebGL quirks, real thermal throttling or real memory limits.
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
