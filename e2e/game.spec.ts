import { test, expect } from "@playwright/test";
import { boot, state, until } from "./helpers";

// Small viewport keeps SwiftShader (CPU rendering) fast enough to simulate.
test.use({ viewport: { width: 640, height: 360 } });

test.describe("desktop controls", () => {
  test.skip(({ isMobile }) => isMobile, "desktop only");

  test("boots without errors and shows the HUD", async ({ page }) => {
    const errors = await boot(page);
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#touch")).toBeHidden();
    const s = await state(page);
    expect(s.chunks).toBe(16);
    expect(s.props).toBeGreaterThan(200);
    expect(s.mode).toBe("ground");
    expect(errors).toEqual([]);
  });

  test("take off, hover, fly with afterburner, brake and land", async ({ page }) => {
    await boot(page);
    const start = await state(page);
    await page.keyboard.down("Space");
    const up = await until(page, (s) => s.mode === "hover" && s.pos.y > start.pos.y + 4);
    await page.keyboard.up("Space");
    expect(up.mode).toBe("hover");

    await page.keyboard.press("Shift");
    await until(page, (s) => s.mode === "flight");
    await page.keyboard.down("KeyW");
    const fast = await until(page, (s) => s.speed > 70);
    await page.keyboard.up("KeyW");
    expect(fast.energy).toBeLessThan(100);

    await page.keyboard.down("KeyS");
    await until(page, (s) => s.mode === "hover");
    await page.keyboard.up("KeyS");

    await page.keyboard.down("KeyC");
    await until(page, (s) => s.mode === "ground", 90_000);
    await page.keyboard.up("KeyC");
  });

  test("pause menu changes graphics quality and persists it", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#menu")).toBeVisible();
    expect((await state(page)).paused).toBe(true);
    await page.locator('[data-k="quality"] button[data-v="low"]').click();
    expect((await state(page)).quality).toBe("low");
    const stored = await page.evaluate(() => localStorage.getItem("aegis.settings.v1"));
    expect(stored).toContain('"quality":"low"');
    await page.locator('[data-a="resume"]').click();
    await expect(page.locator("#menu")).toBeHidden();
    expect((await state(page)).paused).toBe(false);
  });
});

test.describe("touch controls (emulated)", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile only");

  test("touch UI is shown and LIFT / FLY / stick work", async ({ page }) => {
    const errors = await boot(page);
    await expect(page.locator("#touch")).toBeVisible();
    const lift = page.locator(".t-up");
    const box = (await lift.boundingBox())!;
    // Buttons must be large enough for thumbs.
    expect(box.width).toBeGreaterThanOrEqual(60);

    await lift.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", isPrimary: true });
    const s0 = await state(page);
    await until(page, (s) => s.mode === "hover" && s.pos.y > s0.pos.y + 3);
    await lift.dispatchEvent("pointerup", { pointerId: 11, pointerType: "touch" });

    // Virtual stick: press on the left zone and drag up.
    const zone = page.locator(".t-left");
    const zb = (await zone.boundingBox())!;
    const x = zb.x + zb.width * 0.4, y = zb.y + zb.height * 0.7;
    await zone.dispatchEvent("pointerdown", { pointerId: 12, pointerType: "touch", clientX: x, clientY: y });
    await page.evaluate(([x, y]) => window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 12, pointerType: "touch", clientX: x, clientY: y - 60 })), [x, y]);
    const before = await state(page);
    await until(page, (s) => Math.hypot(s.pos.x - before.pos.x, s.pos.z - before.pos.z) > 3);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 12, pointerType: "touch" })));

    await page.locator(".t-fly").dispatchEvent("pointerdown", { pointerId: 13, pointerType: "touch" });
    await page.locator(".t-fly").dispatchEvent("pointerup", { pointerId: 13, pointerType: "touch" });
    await until(page, (s) => s.mode === "flight");
    await expect(page.locator(".t-fly small")).toHaveText("HOVER");

    // Menu button opens settings on touch.
    await page.locator(".h-menu").tap();
    await expect(page.locator("#menu")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("defaults to low quality on mobile", async ({ page }) => {
    await boot(page);
    expect((await state(page)).quality).toBe("low");
  });
});

test("shows a recoverable error when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (type: string, ...rest: unknown[]) => unknown };
    const orig = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl")) return null;
      return orig.call(this, type, ...rest);
    };
  });
  await page.goto("/");
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.locator("#e-message")).toContainText("WebGL");
  await expect(page.locator("#e-retry")).toBeVisible();
  await expect(page.locator("#loading")).toBeHidden();
});
