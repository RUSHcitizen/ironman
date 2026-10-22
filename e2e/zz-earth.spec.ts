import { test, expect, type Page } from "@playwright/test";
test.setTimeout(600_000);
async function frames(page: Page, n = 8): Promise<void> {
  await page.evaluate((n) => new Promise<void>((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
}
test("earth", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 120_000 });
  await page.locator("#l-start").click();
  await page.waitForFunction(() => !(window as any).__GAME.avatar.latching, null, { timeout: 120000 });
  for (const [name, y, pitch] of [["down3000", 3000, -1.1], ["fade2250", 2250, -0.9], ["horizon4000", 4000, -0.35]] as const) {
    await page.evaluate(([y, pitch]) => { const g = (window as any).__GAME; g.enemies.clear(); g.events.clear(); g.teleport(2.5, y, -300, 0.4, "hover"); g.player.viewPitch = pitch; }, [y, pitch]);
    await frames(page, 16);
    await page.screenshot({ path: "/tmp/claude-0/-home-user-ironman/be47c4da-d2e3-529f-b579-bc30357b86a6/scratchpad/earth/" + name + ".png" });
  }
  expect(errors).toEqual([]);
});
