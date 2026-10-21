import { test, devices, type Page } from "@playwright/test";
import { boot } from "./helpers";

// Captures README screenshots from the real running game (rendered with
// SwiftShader in CI/headless). Opt-in: npm run screenshots
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture screenshots");
test.setTimeout(900_000);

const OUT = "docs/screenshots";

type G = {
  player: { viewPitch: number; viewYaw: number; suited: boolean; pos: { x: number; y: number; z: number } };
  suitUnit: { pos: { x: number; y: number; z: number } };
  avatar: { armorT: number; startTransform(on: boolean): void };
  enemies: { clear(): void };
  teleport(x: number, y: number, z: number, yaw: number, mode?: string, speed?: number): void;
  spawnEnemy(kind: string, forward: number, up: number, right?: number): void;
  hud: { setVisible(v: boolean): void };
};

async function frames(page: Page, n = 8): Promise<void> {
  await page.evaluate(
    (n) => new Promise<void>((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }),
    n,
  );
}

async function run(page: Page, src: string): Promise<void> {
  await page.evaluate((src) => new Function("g", src)((window as unknown as { __GAME: G }).__GAME), src);
}

test("desktop screenshots", async ({ page, isMobile }) => {
  test.skip(isMobile);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 120_000 });
  await frames(page, 4);
  await page.screenshot({ path: `${OUT}/01-title.png` });

  await page.locator("#l-start").click();
  await page.locator("#loading").waitFor({ state: "hidden" });
  await frames(page, 14);
  await page.screenshot({ path: `${OUT}/13-suit-up-latch.png` });
  await frames(page, 50);
  await page.screenshot({ path: `${OUT}/02-avengers-tower-pad.png` });

  // Repulsor fight with a drone swarm above an avenue.
  await run(page, `g.teleport(2.5, 32, -300, 0, "hover"); g.player.viewPitch = 0.04;
    g.spawnEnemy("drone", 45, 7, -8); g.spawnEnemy("drone", 55, 11, 9); g.spawnEnemy("drone", 70, 4, 2); g.spawnEnemy("trooper", 40, -40, 6);`);
  await page.keyboard.down("KeyX");
  await frames(page, 6);
  await page.keyboard.press("KeyR");
  await frames(page, 7);
  await page.screenshot({ path: `${OUT}/03-combat-drones.png` });
  await page.keyboard.up("KeyX");

  // New enemy types: gunship, shield drone (bubble), tank and sniper.
  await run(page, `g.enemies.clear(); g.teleport(2.5, 40, -500, 0, "hover"); g.player.viewPitch = 0.05;
    g.spawnEnemy("gunship", 90, 20, 0); g.spawnEnemy("shielder", 50, 5, -10); g.spawnEnemy("drone", 55, 3, -14); g.spawnEnemy("tank", 70, -40, 4); g.spawnEnemy("sniper", 60, -40, 20);`);
  await frames(page, 30);
  await page.screenshot({ path: `${OUT}/14-new-enemies.png` });

  // Warbot on the street.
  await run(page, `g.enemies.clear(); g.teleport(2.5, 14, -520, 0, "hover"); g.player.viewPitch = -0.08; g.spawnEnemy("warbot", 45, 0, 0); g.spawnEnemy("drone", 40, 10, 12);`);
  await frames(page, 40);
  await page.keyboard.press("KeyR");
  await frames(page, 8);
  await page.screenshot({ path: `${OUT}/04-warbot.png` });

  // Afterburner flight down an avenue with speed streaks.
  await run(page, `g.enemies.clear(); g.teleport(0, 45, -700, 0, "flight", 150); g.player.viewPitch = 0.02;`);
  await page.keyboard.down("KeyW");
  await frames(page, 14);
  await page.screenshot({ path: `${OUT}/05-flight-afterburner.png` });
  await page.keyboard.up("KeyW");

  // High above the much bigger city.
  await run(page, `g.teleport(-200, 420, -900, 0.5, "hover"); g.player.viewPitch = -0.35;`);
  await frames(page, 40);
  await page.screenshot({ path: `${OUT}/06-city-overview.png` });

  // Busy avenue: traffic, buses and crowds.
  await run(page, `g.teleport(-77.5, 0, 260, 0); g.player.viewPitch = 0.02;`);
  await frames(page, 30);
  await page.screenshot({ path: `${OUT}/10-busy-street.png` });

  // Step out of the suit: the empty armour stays behind.
  await run(page, `g.teleport(11, 0.15, -182, Math.PI); g.player.viewPitch = -0.05;`);
  await frames(page, 4);
  await page.keyboard.press("KeyG");
  // The armour splits open and the civilian backs out of it.
  await frames(page, 5);
  await run(page, `g.player.viewYaw = Math.PI + 1.25; g.player.viewPitch = -0.1;`);
  await frames(page, 4);
  await page.screenshot({ path: `${OUT}/16-step-out.png` });
  await frames(page, 10);
  await run(page, `g.player.viewYaw = 0.55; g.player.viewPitch = -0.05;`);
  await frames(page, 12);
  await page.screenshot({ path: `${OUT}/07-civilian.png` });

  // Sentry mode: the empty suit fights on its own.
  await page.keyboard.press("KeyV");
  await run(page, `g.player.viewYaw = 0; g.spawnEnemy("drone", 45, 14, 8); g.spawnEnemy("drone", 55, 18, -6);`);
  await frames(page, 24);
  // Look at the suit while it fights.
  await run(page, `const u = g.suitUnit, p = g.player; const dx = u.pos.x - p.pos.x, dz = u.pos.z - p.pos.z;
    p.viewYaw = Math.atan2(dx, dz) - 0.25; p.viewPitch = Math.atan2(u.pos.y - p.pos.y - 1, Math.hypot(dx, dz)) * 0.8;`);
  await frames(page, 6);
  await page.screenshot({ path: `${OUT}/11-sentry.png` });

  // Call the suit from across the city - pieces latch on one by one.
  await page.keyboard.press("KeyV");
  await frames(page, 3);
  await run(page, `g.enemies.clear(); g.teleport(11, 0.15, -300, 0); g.player.viewYaw = 0; g.player.viewPitch = 0.18;`);
  await page.keyboard.press("KeyG");
  await frames(page, 26);
  await page.screenshot({ path: `${OUT}/12-suit-inbound.png` });
  for (let k = 0; k < 60; k++) {
    await frames(page, 2);
    if (await page.evaluate(() => (window as unknown as { __GAME: { avatar: { latching: boolean } } }).__GAME.avatar.latching)) break;
  }
  await frames(page, 10);
  await run(page, `g.player.viewYaw += Math.PI * 0.8;`);
  await frames(page, 3);
  await page.screenshot({ path: `${OUT}/15-called-suit-latching.png` });
  await frames(page, 60);

  // Space: black sky, stars, the city far below. Then cut thrust (H) and fall.
  await run(page, `g.enemies.clear(); g.teleport(2.5, 2900, -300, 0.4, "hover"); g.player.viewPitch = -0.32;`);
  await frames(page, 30);
  await page.screenshot({ path: `${OUT}/17-space.png` });
  await page.keyboard.press("KeyH");
  await frames(page, 40);
  await run(page, `g.player.viewPitch = -0.5;`);
  await frames(page, 6);
  await page.screenshot({ path: `${OUT}/18-freefall.png` });
  await page.keyboard.press("KeyH");
  await frames(page, 20);

  // Banked turn: the whole body rolls nearly sideways into the turn.
  await run(page, `g.enemies.clear(); g.teleport(2.5, 220, -300, 0, "flight", 48); g.player.viewPitch = 0;`);
  await page.keyboard.down("KeyD");
  await frames(page, 45);
  await page.screenshot({ path: `${OUT}/19-bank-turn.png` });
  await page.keyboard.up("KeyD");

  // Eject mid-air (G), then call the suit back before hitting the ground.
  await run(page, `g.teleport(2.5, 240, -300, 0, "hover"); g.player.viewPitch = -0.3;`);
  await frames(page, 4);
  await page.keyboard.press("KeyG");
  await frames(page, 14);
  await page.screenshot({ path: `${OUT}/20-eject.png` });
  await page.keyboard.press("KeyG");
  for (let k = 0; k < 120; k++) {
    await frames(page, 4);
    if (await page.evaluate(() => (window as unknown as { __GAME: { player: { suited: boolean } } }).__GAME.player.suited)) break;
  }
  await frames(page, 40);

  // Sentry: pilot the empty suit while your body waits on the street.
  await run(page, `g.teleport(11, 0.15, -182, 0); g.player.viewPitch = -0.1;`);
  await frames(page, 6);
  await page.keyboard.press("KeyV");
  await frames(page, 30);
  await page.keyboard.down("Space");
  await frames(page, 12);
  await page.keyboard.up("Space");
  await run(page, `g.player.viewYaw = Math.PI; g.player.viewPitch = -0.35;`);
  await frames(page, 16);
  await page.screenshot({ path: `${OUT}/21-sentry-remote.png` });
  await page.keyboard.press("KeyG");
  await frames(page, 80);

  // Unibeam: charge, then fire down a line of drones.
  await run(page, `g.enemies.clear(); g.teleport(2.5, 45, -420, 0, "hover"); g.player.viewPitch = 0.02;
    g.spawnEnemy("drone", 60, 1.5, 0); g.spawnEnemy("jammer", 95, 2, 1); g.spawnEnemy("gunship", 150, 12, -10); g.spawnEnemy("jet", 220, 30, 30);`);
  await frames(page, 24);
  await page.keyboard.press("KeyZ");
  await frames(page, 10);
  await run(page, `g.player.viewYaw = 0.5;`);
  await frames(page, 2);
  await page.screenshot({ path: `${OUT}/22-unibeam.png` });
  // Flares spraying out behind you.
  await frames(page, 30);
  await page.keyboard.press("KeyJ");
  await frames(page, 7);
  await page.screenshot({ path: `${OUT}/24-flares.png` });

  // Flying through the cloud layer with contrails.
  await run(page, `g.enemies.clear(); g.teleport(2.5, 950, -300, 0.3, "flight", 110); g.player.viewPitch = 0.04;`);
  await page.keyboard.down("KeyW");
  await frames(page, 40);
  await page.screenshot({ path: `${OUT}/23-clouds-contrails.png` });
  await page.keyboard.up("KeyW");

  // New enemies: a titan with sentinels and a spider walker.
  await run(page, `g.enemies.clear(); g.events.clear(); g.teleport(2.5, 14, -420, 0, "hover"); g.player.viewPitch = 0.12;
    g.spawnEnemy("titan", 75, -30, 4); g.spawnEnemy("sentinel", 30, 6, -7); g.spawnEnemy("sentinel", 38, 10, 8); g.spawnEnemy("spider", 45, -30, -5);`);
  await frames(page, 36);
  await page.screenshot({ path: `${OUT}/27-titan-sentinels.png` });
  await run(page, `g.enemies.clear();`);

  // Night over the city, then a sunny day in the Midas armour with a boss bar.
  await run(page, `g.settings.update({ timeOfDay: "night" }); g.teleport(2.5, 120, -300, 0.4, "hover"); g.player.viewPitch = -0.12;`);
  await frames(page, 30);
  await page.screenshot({ path: `${OUT}/25-night.png` });
  await run(page, `g.settings.update({ timeOfDay: "day", suit: "midas" }); g.teleport(2.5, 60, -400, 0, "hover"); g.spawnEnemy("warbot", 45, -40, 0); g.player.viewPitch = -0.1;`);
  await frames(page, 40);
  await page.screenshot({ path: `${OUT}/26-day-midas-boss.png` });
  await run(page, `g.enemies.clear(); g.settings.update({ timeOfDay: "sunset", suit: "classic" });`);
  await frames(page, 4);

  await page.keyboard.press("Escape");
  await frames(page, 3);
  await page.screenshot({ path: `${OUT}/08-settings-menu.png` });
});

test("mobile screenshot (emulated iPhone landscape in Chromium)", async ({ browser, isMobile }) => {
  test.skip(isMobile);
  const ctx = await browser.newContext({ ...devices["iPhone 13 landscape"], baseURL: "http://localhost:4173" });
  const page = await ctx.newPage();
  await boot(page, { keepSettings: true });
  await run(page, `g.avatar.armorT = 99; g.teleport(0, 40, -120, 0.25, "hover"); g.player.viewPitch = -0.05; g.spawnEnemy("drone", 40, 6, -5); g.spawnEnemy("drone", 50, 9, 6);`);
  await frames(page, 10);
  // Touch the screen so the controls are awake (they fade when idle).
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", pointerId: 99 })));
  await frames(page, 4);
  await page.screenshot({ path: `${OUT}/09-mobile-touch-controls.png` });
  // ...and after 4 s untouched they fade almost away.
  await page.evaluate(() => document.getElementById("touch")!.classList.add("idle"));
  await frames(page, 12);
  await page.screenshot({ path: `${OUT}/28-mobile-controls-idle.png` });
  await ctx.close();
});
