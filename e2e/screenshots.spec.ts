import { test, devices, type Page } from "@playwright/test";
import { boot } from "./helpers";

// Captures README screenshots from the real running game (rendered with
// SwiftShader in CI/headless). Opt-in: npm run screenshots
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture screenshots");
test.setTimeout(900_000);

const OUT = "docs/screenshots";

type G = {
  player: { viewPitch: number; viewYaw: number; suited: boolean };
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
  await page.evaluate((src) => new Function("g", src)((window as unknown as { __AEGIS: G }).__AEGIS), src);
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
  await run(page, "g.avatar.armorT = 99;");
  await frames(page, 6);
  await page.screenshot({ path: `${OUT}/02-apex-tower-pad.png` });

  // Repulsor fight with a drone swarm above an avenue.
  await run(page, `g.teleport(2.5, 32, -300, 0, "hover"); g.player.viewPitch = 0.04;
    g.spawnEnemy("drone", 45, 7, -8); g.spawnEnemy("drone", 55, 11, 9); g.spawnEnemy("drone", 70, 4, 2); g.spawnEnemy("trooper", 40, -40, 6);`);
  await page.keyboard.down("KeyX");
  await frames(page, 6);
  await page.keyboard.press("KeyR");
  await frames(page, 7);
  await page.screenshot({ path: `${OUT}/03-combat-drones.png` });
  await page.keyboard.up("KeyX");

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

  // Civilian on the street.
  await run(page, `g.teleport(2.5, 0, -182, 0);`);
  await page.keyboard.press("KeyG");
  await frames(page, 45);
  await page.keyboard.down("KeyW");
  await frames(page, 14);
  await page.screenshot({ path: `${OUT}/07-civilian.png` });
  await page.keyboard.up("KeyW");

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
  await page.screenshot({ path: `${OUT}/09-mobile-touch-controls.png` });
  await ctx.close();
});
