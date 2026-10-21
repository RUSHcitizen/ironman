import { test, devices } from "@playwright/test";
import { boot } from "./helpers";

// Captures README screenshots from the real running game (rendered with
// SwiftShader in CI/headless). Opt-in: SCREENSHOTS=1 npm run screenshots
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture screenshots");
test.setTimeout(600_000);

const OUT = "docs/screenshots";

type G = {
  player: { viewPitch: number };
  avatar: { suitUpT: number };
  teleport(x: number, y: number, z: number, yaw: number, mode?: string, speed?: number): void;
};

async function settle(page: import("@playwright/test").Page, frames = 8): Promise<void> {
  await page.evaluate(
    (n) => new Promise<void>((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }),
    frames,
  );
}

async function finishSuitUp(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => ((window as unknown as { __AEGIS: G }).__AEGIS.avatar.suitUpT = 99));
  await settle(page, 3);
}

test("desktop screenshots", async ({ page, isMobile }) => {
  test.skip(isMobile);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 90_000 });
  await settle(page, 4);
  await page.screenshot({ path: `${OUT}/01-title.png` });

  await page.locator("#l-start").click();
  await page.locator("#loading").waitFor({ state: "hidden" });
  await finishSuitUp(page);
  await settle(page, 6);
  await page.screenshot({ path: `${OUT}/02-apex-tower-pad.png` });

  // Street level on an avenue.
  await page.evaluate(() => {
    const g = (window as unknown as { __AEGIS: G }).__AEGIS;
    g.teleport(2.5, 0, -182, 0);
    g.player.viewPitch = 0.05;
  });
  await page.keyboard.down("KeyW");
  await settle(page, 10);
  await page.screenshot({ path: `${OUT}/03-street-level.png` });
  await page.keyboard.up("KeyW");

  // Hovering above the rooftops.
  await page.evaluate(() => {
    const g = (window as unknown as { __AEGIS: G }).__AEGIS;
    g.teleport(0, 70, -230, 0.35, "hover");
    g.player.viewPitch = -0.18;
  });
  await settle(page, 14);
  await page.screenshot({ path: `${OUT}/04-hover.png` });

  // Afterburner flight down an avenue.
  await page.evaluate(() => {
    const g = (window as unknown as { __AEGIS: G }).__AEGIS;
    g.teleport(0, 45, -300, 0, "flight", 110);
    g.player.viewPitch = 0.02;
  });
  await page.keyboard.down("KeyW");
  await settle(page, 12);
  await page.screenshot({ path: `${OUT}/05-flight-afterburner.png` });
  await page.keyboard.up("KeyW");

  await page.keyboard.press("Escape");
  await settle(page, 3);
  await page.screenshot({ path: `${OUT}/06-settings-menu.png` });
});

test("mobile screenshot (emulated iPhone landscape in Chromium)", async ({ browser, isMobile }) => {
  test.skip(isMobile);
  const ctx = await browser.newContext({ ...devices["iPhone 13 landscape"], baseURL: "http://localhost:4173" });
  const page = await ctx.newPage();
  await boot(page);
  await finishSuitUp(page);
  await page.evaluate(() => {
    const g = (window as unknown as { __AEGIS: G }).__AEGIS;
    g.teleport(0, 40, -120, 0.25, "hover");
    g.player.viewPitch = -0.12;
  });
  await settle(page, 10);
  await page.screenshot({ path: `${OUT}/07-mobile-touch-controls.png` });
  await ctx.close();
});
