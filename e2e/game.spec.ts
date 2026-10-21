import { test, expect, devices } from "@playwright/test";
import { boot, state, until, game } from "./helpers";

// Small viewport keeps SwiftShader (CPU rendering) fast enough to simulate.
test.use({ viewport: { width: 480, height: 270 } });

test.describe("desktop controls", () => {
  test.skip(({ isMobile }) => isMobile, "desktop only");

  test("boots without errors and shows the HUD", async ({ page }) => {
    const errors = await boot(page);
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#touch")).toBeHidden();
    const s = await state(page);
    expect(s.chunks).toBeGreaterThan(8);
    expect(s.props).toBeGreaterThan(200);
    expect(s.mode).toBe("ground");
    expect(s.mouseMode).toBe(true);
    expect(errors).toEqual([]);
  });

  test("mouse look: clicking captures or drag-looks, and moving the mouse turns the camera", async ({ page }) => {
    await boot(page);
    const before = await state(page);
    await page.mouse.move(240, 135);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(240 + k * 15, 135 - k * 3);
    await page.mouse.up();
    const after = await until(page, (s) => Math.abs(s.viewYaw - before.viewYaw) > 0.1);
    expect(Math.abs(after.viewYaw - before.viewYaw)).toBeGreaterThan(0.1);
  });

  test("take off, hover, fly with afterburner, brake and land", async ({ page }) => {
    await boot(page);
    const start = await state(page);
    await page.keyboard.down("Space");
    await until(page, (s) => s.mode === "hover" && s.pos.y > start.pos.y + 4);
    await page.keyboard.up("Space");

    await page.keyboard.press("Shift");
    await until(page, (s) => s.mode === "flight");
    await page.keyboard.down("KeyW");
    const fast = await until(page, (s) => s.speed > 80);
    await page.keyboard.up("KeyW");
    expect(fast.energy).toBeLessThan(100);

    await page.keyboard.down("KeyS");
    await until(page, (s) => s.mode === "hover");
    await page.keyboard.up("KeyS");

    await page.keyboard.down("KeyC");
    await until(page, (s) => s.mode === "ground", 120_000);
    await page.keyboard.up("KeyC");
  });

  test("mid-air tricks: hover flip and a flight loop build the style combo", async ({ page }) => {
    await boot(page);
    await game(page, (g) => g.teleport(2.5, 60, -300, 0, "hover"));
    await page.keyboard.press("KeyT");
    await until(page, (s) => s.trick === "flip");
    await until(page, (s) => s.trick === null && s.styleCombo >= 1);
    await game(page, (g) => g.teleport(2.5, 200, -300, 0, "flight", 48));
    await page.keyboard.press("KeyT");
    await until(page, (s) => s.trick === "loop");
    await until(page, (s) => s.trick === null, 90_000);
    await expect(page.locator(".h-popup")).toContainText(/LOOP|FLIP/);
  });

  test("space: oxygen drains, the sky turns black, H cuts thrust into a free fall", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 2750, -300, 0, "hover"));
    const s = await until(page, (st) => st.inSpace && st.space > 0.9 && st.oxygen < 99);
    expect(s.mode).toBe("hover");
    await expect(page.locator("#hud")).toHaveClass(/space/);
    await page.keyboard.press("KeyH");
    const f = await until(page, (st) => st.freefall);
    expect(f.mode).toBe("ground");
    await until(page, (st) => st.pos.y < 2700);
    // H again re-engages the thrusters.
    await page.keyboard.press("KeyH");
    await until(page, (st) => !st.freefall && st.mode === "hover");
    expect(errors).toEqual([]);
  });

  test("a fatal fall returns you to Avengers Tower", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 500, -300, 0, "hover"));
    await page.keyboard.press("KeyH");
    await until(page, (st) => st.freefall);
    await until(page, (st) => st.dead, 120_000);
    await expect(page.locator("#hud")).toHaveClass(/dead/);
    const back = await until(page, (st) => !st.dead, 30_000);
    expect(Math.hypot(back.pos.x - 36, back.pos.z - 34)).toBeLessThan(3);
    expect(back.pos.y).toBeGreaterThan(140);
    expect(back.suited).toBe(true);
    await expect(page.locator("#hud")).not.toHaveClass(/dead/);
    expect(errors).toEqual([]);
  });

  test("flight turns bank the body nearly sideways", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 250, -300, 0, "flight", 48));
    await page.keyboard.down("KeyD");
    await until(page, (st) => st.bank < -1.0);
    await page.keyboard.up("KeyD");
    await page.keyboard.down("KeyA");
    await until(page, (st) => st.bank > 1.0);
    await page.keyboard.up("KeyA");
    expect(errors).toEqual([]);
  });

  test("eject mid-air with G, then call the suit to catch you", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 260, -300, 0, "hover"));
    await page.keyboard.press("KeyG");
    const out = await until(page, (st) => !st.suited);
    expect(out.grounded).toBe(false);
    await page.keyboard.press("KeyG");
    await until(page, (st) => st.suitState === "inbound" || st.suited);
    const caught = await until(page, (st) => st.suited && !st.transforming, 90_000);
    expect(caught.dead).toBe(false);
    expect(caught.pos.y).toBeGreaterThan(5);
    expect(errors).toEqual([]);
  });

  test("sentry: pilot the empty suit with V, then G brings it back onto you", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 0, -182, 0));
    await until(page, (st) => st.grounded);
    await page.keyboard.press("KeyV");
    const r = await until(page, (st) => st.remote && st.suited);
    // Fly the suit up; your body stays on the street.
    await page.keyboard.down("Space");
    await until(page, (st) => st.pos.y > r.bodyPos.y + 15);
    await page.keyboard.up("Space");
    const s2 = await state(page);
    expect(Math.hypot(s2.bodyPos.x - r.bodyPos.x, s2.bodyPos.z - r.bodyPos.z)).toBeLessThan(0.01);
    await page.keyboard.press("KeyG");
    const back = await until(page, (st) => !st.remote && !st.suited);
    expect(Math.hypot(back.pos.x - r.bodyPos.x, back.pos.z - r.bodyPos.z)).toBeLessThan(0.5);
    await until(page, (st) => st.suited, 120_000);
    expect(errors).toEqual([]);
  });

  test("repulsors and rockets destroy hostiles", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => {
      g.teleport(2.5, 0, -300, 0);
      g.player.viewPitch = -0.02;
      g.spawnEnemy("trooper", 35, 0, 0);
    });
    await page.keyboard.press("KeyR");
    const fired = await until(page, (st) => st.rockets < 8);
    expect(fired.rockets).toBeLessThan(8);
    await page.keyboard.down("KeyX");
    const s = await until(page, (st) => st.kills >= 1, 90_000);
    await page.keyboard.up("KeyX");
    expect(s.kills).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test("take the suit off, walk as a civilian, and suit up again", async ({ page }) => {
    await boot(page);
    await game(page, (g) => g.teleport(2.5, 0, -182, 0));
    await page.keyboard.press("KeyG");
    // The armour opens and the civilian backs out of it.
    await until(page, (s) => !s.suited && s.stepOut);
    const done = await until(page, (s) => !s.suited && !s.transforming && !s.stepOut);
    expect(Math.hypot(done.suitPos.x - done.pos.x, done.suitPos.z - done.pos.z)).toBeGreaterThan(0.8);
    await expect(page.locator("#hud")).toHaveClass(/civ/);
    await page.waitForTimeout(300);
    const s0 = await until(page, (s) => s.speed === 0 || s.speed < 0.5);
    await page.keyboard.down("KeyW");
    await until(page, (s) => s.pos.z > s0.pos.z + 2, 90_000);
    await page.keyboard.up("KeyW");
    await page.keyboard.press("KeyG");
    await until(page, (s) => s.suited, 90_000);
  });

  test("step out, sentry mode fights, walk away and call the suit back", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 0, -182, 0));
    await page.keyboard.press("KeyG");
    const out = await until(page, (s) => !s.suited && s.suitState === "parked" && !s.transforming);
    expect(Math.hypot(out.suitPos.x - out.pos.x, out.suitPos.z - out.pos.z)).toBeLessThan(3);
    // Sentry: pilot the suit (V), then V again returns to the body and the
    // suit keeps guarding on its own.
    await page.keyboard.press("KeyV");
    await until(page, (s) => s.remote);
    await page.keyboard.press("KeyV");
    await until(page, (s) => s.suitState === "sentry" && !s.remote);
    await game(page, (g) => g.spawnEnemy("drone", 40, 15, 0));
    await until(page, (s) => s.kills >= 1, 120_000);
    // Walk away (teleport for speed), then call it: it flies over and docks.
    await game(page, (g) => g.teleport(2.5, 0, -330, 0));
    await page.keyboard.press("KeyG");
    await until(page, (s) => s.suitState === "inbound");
    await until(page, (s) => s.suited, 180_000);
    expect(errors).toEqual([]);
  });

  test("pause menu changes graphics quality and persists it", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#menu")).toBeVisible();
    expect((await state(page)).paused).toBe(true);
    await page.locator('[data-k="quality"] button[data-v="medium"]').click();
    expect((await state(page)).quality).toBe("medium");
    const stored = await page.evaluate(() => localStorage.getItem("ironman.settings.v1"));
    expect(stored).toContain('"quality":"medium"');
    await page.locator('[data-a="resume"]').click();
    await expect(page.locator("#menu")).toBeHidden();
    expect((await state(page)).paused).toBe(false);
  });
});

test.describe("touch controls (emulated)", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile only");

  const tap = async (page: import("@playwright/test").Page, sel: string, id: number) => {
    await page.locator(sel).dispatchEvent("pointerdown", { pointerId: id, pointerType: "touch" });
    await page.locator(sel).dispatchEvent("pointerup", { pointerId: id, pointerType: "touch" });
  };

  test("touch UI: LIFT, stick, FLY, BLAST, MSL and menu", async ({ page }) => {
    const errors = await boot(page);
    await expect(page.locator("#touch")).toBeVisible();
    for (const sel of [".t-up", ".t-fly", ".t-fire", ".t-msl", ".t-suit"]) {
      const box = (await page.locator(sel).boundingBox())!;
      expect(box.width, sel).toBeGreaterThanOrEqual(48);
    }
    const lift = page.locator(".t-up");
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

    // Rockets via MSL.
    await tap(page, ".t-msl", 14);
    await until(page, (s) => s.rockets < 8);

    await tap(page, ".t-fly", 13);
    await until(page, (s) => s.mode === "flight");
    await expect(page.locator(".t-fly small")).toHaveText("HOVER");

    await page.locator(".h-menu").tap();
    await expect(page.locator("#menu")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("SUIT button switches to the civilian and back", async ({ page }) => {
    await boot(page);
    await tap(page, ".t-suit", 21);
    await until(page, (s) => !s.suited && !s.transforming);
    await expect(page.locator(".t-suit small")).toHaveText("CALL SUIT");
    await expect(page.locator(".t-sentry")).toBeVisible();
    await expect(page.locator(".t-fire")).toBeHidden();
    await tap(page, ".t-suit", 22);
    await until(page, (s) => s.suited, 90_000);
  });

  test("defaults to low quality on mobile", async ({ page }) => {
    await boot(page, { keepSettings: true });
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

test("phone: nothing overflows in portrait, and rotating to landscape clears the rotate hint", async ({ browser }) => {
  const { defaultBrowserType: _d, ...phone } = devices["iPhone SE"];
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("#rotate")).toBeVisible();
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll("#rotate *, #loading *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.tagName),
  );
  expect(overflow).toEqual([]);
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(page.locator("#rotate")).toBeHidden();
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 90_000 });
  await expect(page.locator("#l-start")).toBeInViewport();
  await ctx.close();
});
