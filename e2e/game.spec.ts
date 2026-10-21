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

  test("in the suit a fall from any height is survived (armour damaged); an unprotected fall is fatal and returns you to Avengers Tower", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 1500, -300, 0, "hover"));
    await page.keyboard.press("KeyH");
    const landed = await until(page, (st) => st.grounded && st.pos.y < 200, 150_000);
    expect(landed.dead).toBe(false);
    expect(landed.suited).toBe(true);
    expect(landed.integrity).toBeLessThan(100);
    // Eject high up and don't call the suit: that fall is fatal.
    await game(page, (g) => g.teleport(2.5, 500, -300, 0, "hover"));
    await page.keyboard.press("KeyG");
    await until(page, (st) => !st.suited);
    await until(page, (st) => st.dead, 120_000);
    await expect(page.locator("#hud")).toHaveClass(/dead/);
    const back = await until(page, (st) => !st.dead, 30_000);
    expect(Math.hypot(back.pos.x - 36, back.pos.z - 34)).toBeLessThan(3);
    expect(back.suited).toBe(true);
    expect(errors).toEqual([]);
  });

  test("full damage destroys the suit: you're left as a civilian and a new suit arrives after 15 s", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 0.15, -182, 0));
    await page.evaluate(() => (window as unknown as { __GAME: { player: { suit: { damage(n: number): void } } } }).__GAME.player.suit.damage(500));
    const gone = await until(page, (st) => !st.suited && (st as unknown as { newSuitIn: number }).newSuitIn > 0);
    expect(gone.dead).toBe(false);
    await expect(page.locator(".v-civ")).toContainText(/replacement in/);
    await until(page, (st) => st.suitState === "inbound", 120_000);
    const back = await until(page, (st) => st.suited && !st.transforming, 180_000);
    expect(back.integrity).toBeGreaterThan(95);
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

  test("Unibeam (Z) wipes out a line of drones; flares (J); the radar shows hostiles", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => {
      g.teleport(2.5, 40, -300, 0, "hover");
      g.player.viewPitch = 0;
    });
    await game(page, (g) => {
      g.spawnEnemy("drone", 50, 1.5, 0);
      g.spawnEnemy("drone", 90, 1.5, 0);
    });
    await expect(page.locator(".h-radar")).toBeVisible();
    const k0 = (await state(page)).kills;
    await page.keyboard.press("KeyZ");
    await until(page, (s) => s.kills >= k0 + 1);
    await page.keyboard.press("KeyJ");
    await expect(page.locator(".h-alerts")).toContainText(/Flares/);
    expect(errors).toEqual([]);
  });

  test("rescue: a civilian falls off a rooftop and you catch them mid-air", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => {
      const G = g as unknown as { events: { spawnNow(p: unknown, t: string): void }; player: unknown };
      G.events.spawnNow(G.player, "Civilian falling!");
    });
    const w = await until(page, (s) => s.rescue !== null);
    expect(w.rescue!.state).toBe("waiting");
    // Fly close: they slip and fall.
    await game(page, (g) => {
      const G = g as unknown as { events: { faller: { x: number; y: number; z: number } } };
      const f = G.events.faller;
      g.teleport(f.x + 30, f.y - 10, f.z, 0, "hover");
    });
    await until(page, (s) => s.rescue?.state === "falling");
    // Get under them and they're caught.
    await game(page, (g) => {
      const G = g as unknown as { events: { faller: { x: number; y: number; z: number } } };
      const f = G.events.faller;
      g.teleport(f.x, f.y - 6, f.z, 0, "hover");
    });
    await until(page, (s) => s.saved >= 1);
    await expect(page.locator(".h-alerts")).toContainText(/Civilian safe/);
    expect(errors).toEqual([]);
  });

  test("night time, armour schemes, cinematic mode (K) and the boss bar", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => (g as unknown as { settings: { update(p: object): void } }).settings.update({ timeOfDay: "night", suit: "warmachine" }));
    await until(page, (s) => s.timeOfDay === "night");
    await page.keyboard.press("KeyK");
    await until(page, (s) => !s.hudShown);
    await expect(page.locator("#hud")).toBeHidden();
    await page.keyboard.press("KeyK");
    await expect(page.locator("#hud")).toBeVisible();
    await game(page, (g) => {
      g.teleport(2.5, 30, -400, 0, "hover");
      g.spawnEnemy("warbot", 45, -40, 0);
    });
    await expect(page.locator(".h-boss")).toHaveClass(/on/, { timeout: 60_000 });
    await expect(page.locator(".h-boss")).toContainText("WARBOT");
    expect(errors).toEqual([]);
  });

  test("flight challenge: fly through every ring in order for boosts and a course time", async ({ page }) => {
    const errors = await boot(page);
    type G = { events: { spawnNow(p: unknown, t: string): void; course: { rings: { x: number; y: number; z: number; yaw: number; pitch: number }[]; next: number } | null }; player: unknown; teleport(...a: unknown[]): void };
    await page.evaluate(() => {
      const g = (window as unknown as { __GAME: G }).__GAME;
      g.events.spawnNow(g.player, "Flight challenge");
    });
    await until(page, (s) => (s as unknown as { course: unknown }).course !== null);
    for (let k = 0; k < 10; k++) {
      // Put the suit just before ring k, then just after it, so its path crosses the ring.
      for (const side of [-12, 12]) {
        await page.evaluate(
          ([k, side]) => {
            const g = (window as unknown as { __GAME: G }).__GAME;
            if (!g.events.course) return;
            const r = g.events.course.rings[k];
            const nx = Math.sin(r.yaw) * Math.cos(r.pitch), ny = Math.sin(r.pitch), nz = Math.cos(r.yaw) * Math.cos(r.pitch);
            g.teleport(r.x + nx * side, r.y + ny * side - 1, r.z + nz * side, r.yaw, "flight", 120);
          },
          [k, side],
        );
        await page.waitForFunction(() => true);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      }
      if (k < 9) await until(page, (s) => ((s as unknown as { course: { next: number } | null }).course?.next ?? 99) > k, 20_000);
    }
    await until(page, (s) => (s as unknown as { course: unknown }).course === null, 20_000);
    await expect(page.locator(".h-alerts")).toContainText(/Course complete/);
    expect(errors).toEqual([]);
  });

  test("hold the afterburner to go hypersonic past Mach 1", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 400, -300, 0, "flight", 200));
    await page.keyboard.down("KeyW");
    const s = await until(page, (st) => (st as unknown as { hypersonic: boolean }).hypersonic && st.speed > 343, 90_000);
    await page.keyboard.up("KeyW");
    expect(s.speed).toBeGreaterThan(343);
    await expect(page.locator(".v-mode")).toHaveText(/HYPERSONIC|AFTERBURNER|FLIGHT/);
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
      expect(box.width, sel).toBeGreaterThanOrEqual(44); // Apple HIG minimum touch target
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

  test("touch: SHARP turn buttons in flight, BEAM and FLARE", async ({ page }) => {
    const errors = await boot(page);
    await game(page, (g) => g.teleport(2.5, 200, -300, 0, "flight", 60));
    await expect(page.locator(".t-sharpR")).toBeVisible();
    await expect(page.locator(".t-sharpL")).toBeVisible();
    const y0 = (await state(page)).viewYaw;
    await tap(page, ".t-sharpR", 21);
    const turned = await until(page, (s) => Math.abs(Math.atan2(Math.sin(s.viewYaw - y0), Math.cos(s.viewYaw - y0))) > 1.4);
    expect(Math.atan2(Math.sin(turned.viewYaw - y0), Math.cos(turned.viewYaw - y0))).toBeGreaterThan(0);
    const e0 = (await state(page)).energy;
    await tap(page, ".t-beam", 22);
    await until(page, (s) => s.energy < e0 - 15);
    await tap(page, ".t-flare", 23);
    await expect(page.locator(".v-beam")).toContainText("s");
    expect(errors).toEqual([]);
  });

  test("phone: F.R.I.D.A.Y. alerts show one at a time and don't overlap the mission text or area banner", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __GAME: { events: { spawnNow(p: unknown, t: string): void }; player: unknown; bus: { emit(t: string, p: unknown): void } } }).__GAME;
      g.events.spawnNow(g.player, "Rogue drone swarm");
      for (const text of ["Thin air - switching to internal oxygen", "Flares! 2 missile locks broken", "EMP hit - power drained to 54%"]) g.bus.emit("alert", { text, level: "warn" });
      g.bus.emit("areaChanged", { name: "Riverside Point" });
    });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const vis = [...document.querySelectorAll<HTMLElement>(".h-alert")].filter((e) => getComputedStyle(e).display !== "none");
      const box = (e: Element | null) => (e ? e.getBoundingClientRect() : null);
      return { count: vis.length, alert: box(vis[0]), obj: box(document.querySelector(".h-objective")), area: box(document.querySelector(".h-area b")) };
    });
    expect(r.count).toBe(1);
    const hit = (a: DOMRect | null, b: DOMRect | null) => !!a && !!b && a.width > 0 && b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    expect(hit(r.alert, r.obj), "alert vs mission text").toBe(false);
    expect(hit(r.alert, r.area), "alert vs area banner").toBe(false);
    expect(hit(r.area, r.obj), "area banner vs mission text").toBe(false);
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

test("phone held upright (e.g. rotation lock on): the game is drawn sideways in landscape and touch still works", async ({ browser }) => {
  const { defaultBrowserType: _d, ...phone } = devices["iPhone 13"];
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  // Upright: the stage is rotated so the game is landscape relative to the phone.
  await expect(page.locator("body")).toHaveClass(/rot/);
  const dims = await page.evaluate(() => {
    const c = document.getElementById("game") as HTMLCanvasElement;
    return { cw: c.clientWidth, ch: c.clientHeight, iw: innerWidth, ih: innerHeight };
  });
  expect(dims.cw).toBe(dims.ih);
  expect(dims.ch).toBe(dims.iw);
  // Engage is on screen and tappable through the rotation.
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 90_000 });
  const box = (await page.locator("#l-start").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(dims.ih);
  await page.locator("#l-start").tap();
  await page.waitForFunction(() => (window as unknown as { __GAME: { debugState(): { started: boolean } } }).__GAME.debugState().started);
  // LIFT works through the rotated layout.
  await page.locator(".t-up").dispatchEvent("pointerdown", { pointerId: 41, pointerType: "touch", isPrimary: true });
  await page.waitForFunction(() => (window as unknown as { __GAME: { debugState(): { mode: string } } }).__GAME.debugState().mode === "hover", null, { timeout: 60_000 });
  await page.locator(".t-up").dispatchEvent("pointerup", { pointerId: 41, pointerType: "touch" });
  // Turning the phone (browser goes landscape) switches back to normal.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("body")).not.toHaveClass(/rot/);
  const c2 = await page.evaluate(() => [document.getElementById("game")!.clientWidth, innerWidth]);
  expect(c2[0]).toBe(c2[1]);
  expect(errors).toEqual([]);
  await ctx.close();
});

test("touch look/stick math maps screen to the sideways stage", async ({ browser }) => {
  const { defaultBrowserType: _d, ...phone } = devices["iPhone 13"];
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();

  await page.addInitScript(() => localStorage.setItem("ironman.settings.v1", JSON.stringify({ quality: "low", autoQuality: false })));
  await page.goto("/");
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 90_000 });
  await page.locator("#l-start").tap();
  await page.waitForFunction(() => (window as unknown as { __GAME: { debugState(): { started: boolean } } }).__GAME.debugState().started);
  const yaw0 = await page.evaluate(() => (window as unknown as { __GAME: { debugState(): { viewYaw: number } } }).__GAME.debugState().viewYaw);
  // Drag "right" in game terms: downward on the screen while drawn sideways.
  await page.waitForTimeout(800);
  const rot = await page.evaluate(() => document.body.classList.contains("rot"));
  const zone = page.locator(".t-right");
  const zb = (await zone.boundingBox())!;
  const x = zb.x + zb.width / 2, y = zb.y + zb.height / 2;
  await zone.dispatchEvent("pointerdown", { pointerId: 31, pointerType: "touch", clientX: x, clientY: y });
  for (let k = 1; k <= 6; k++) await page.evaluate(([x, y]) => window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 31, pointerType: "touch", clientX: x, clientY: y })), rot ? [x, y + k * 12] : [x + k * 12, y]);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 31, pointerType: "touch" })));
  // Software rendering here can be ~2 fps: wait for the next frames to apply the look.
  await page.waitForFunction(
    (y0) => {
      const y = (window as unknown as { __GAME: { debugState(): { viewYaw: number } } }).__GAME.debugState().viewYaw;
      return Math.abs(Math.atan2(Math.sin(y - y0), Math.cos(y - y0))) > 0.05;
    },
    yaw0,
    { timeout: 30_000 },
  );
  const yaw1 = await page.evaluate(() => (window as unknown as { __GAME: { debugState(): { viewYaw: number } } }).__GAME.debugState().viewYaw);
  expect(Math.atan2(Math.sin(yaw1 - yaw0), Math.cos(yaw1 - yaw0))).toBeGreaterThan(0.05);
  await ctx.close();
});


for (const [name, size] of [
  ["iPhone X", { width: 812, height: 375 }],
  ["iPhone 15", { width: 852, height: 393 }],
] as const) {
  test(`${name} (landscape, emulated): boots, Low preset, touch buttons on screen and not overlapping`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1" });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.locator("#l-start:not([disabled])").waitFor({ timeout: 90_000 });
    await page.locator("#l-start").tap();
    await page.waitForFunction(() => (window as unknown as { __GAME: { debugState(): { started: boolean } } }).__GAME.debugState().started);
    const q = await page.evaluate(() => (window as unknown as { __GAME: { debugState(): { quality: string } } }).__GAME.debugState().quality);
    expect(q).toBe("low");
    // Fly so the flight-only buttons show too.
    await page.evaluate(() => (window as unknown as { __GAME: { teleport(...a: unknown[]): void } }).__GAME.teleport(2.5, 60, -300, 0, "hover"));
    await page.waitForTimeout(400);
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("#touch .t-btn")]
        .filter((b) => getComputedStyle(b).display !== "none")
        .map((b) => {
          const r = b.getBoundingClientRect();
          return { n: b.className, x: r.x, y: r.y, w: r.width, h: r.height };
        }),
    );
    expect(boxes.length).toBeGreaterThan(8);
    for (const b of boxes) {
      expect(b.x, b.n).toBeGreaterThanOrEqual(0);
      expect(b.y, b.n).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, b.n).toBeLessThanOrEqual(size.width + 1);
      expect(b.y + b.h, b.n).toBeLessThanOrEqual(size.height + 1);
      expect(b.w, b.n).toBeGreaterThanOrEqual(44);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        const overlap = a.x < c.x + c.w - 1 && c.x < a.x + a.w - 1 && a.y < c.y + c.h - 1 && c.y < a.y + a.h - 1;
        expect(overlap, `${a.n} overlaps ${c.n}`).toBe(false);
      }
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });
}

test("Chromebook (emulated UA): starts on Low; flying across the 299 km² map keeps collider memory bounded", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 90_000 });
  await page.locator("#l-start").click();
  type G = { __GAME: { teleport(...a: unknown[]): void; debugState(): { quality: string; colliderChunks: number; specChunks: number; pos: { x: number } } } };
  await page.waitForFunction(() => (window as unknown as G).__GAME.debugState().quality !== undefined);
  expect(await page.evaluate(() => (window as unknown as G).__GAME.debugState().quality)).toBe("low");
  // Hop to the far corners of the city; old areas are evicted.
  for (const [x, z] of [[7000, 7000], [-7000, 7000], [-7000, -7000], [7000, -7000], [0, 0]]) {
    await page.evaluate(([x, z]) => (window as unknown as G).__GAME.teleport(x, 300, z, 0, "hover"), [x, z]);
    await page.waitForTimeout(5600);
  }
  const s = await page.evaluate(() => (window as unknown as G).__GAME.debugState());
  expect(s.colliderChunks).toBeLessThan(200);
  expect(s.specChunks).toBeLessThan(260);
  expect(errors).toEqual([]);
  await ctx.close();
});

test("performance budget on a slow device (iPhone X layout, Low, 4x CPU throttle, mid-fight flight)", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "CPU throttling needs Chromium's DevTools protocol");
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 812, height: 375 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("ironman.settings.v1", JSON.stringify({ quality: "low", autoQuality: false })));
  await page.goto("/");
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 120_000 });
  await page.locator("#l-start").tap();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    const g = (window as unknown as { __GAME: { teleport(...a: unknown[]): void; spawnEnemy(k: string, f: number, u: number, r: number): void } }).__GAME;
    g.teleport(2.5, 60, -300, 0, "flight", 90);
    for (const k of ["drone", "drone", "jet", "gunship", "sentinel", "swarmer", "swarmer", "swarmer"]) g.spawnEnemy(k, 80 + Math.random() * 60, 10, (Math.random() - 0.5) * 60);
  });
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(15_000);
  await page.keyboard.up("KeyW");
  const s = await page.evaluate(() => (window as unknown as { __GAME: { debugState(): { updateMs: number; updateMsMax: number; heapMB: number } } }).__GAME.debugState());
  console.log(`perf @4x: update ${s.updateMs.toFixed(2)} ms avg, ${s.updateMsMax.toFixed(1)} ms peak, heap ${s.heapMB.toFixed(0)} MB`);
  console.log("prof", JSON.stringify(await page.evaluate(() => { const p = (window as any).__GAME.prof; const o: Record<string, string> = {}; for (const k in p) o[k] = p[k].avg.toFixed(2) + "/" + p[k].max.toFixed(1); return o; })), "speed", (await page.evaluate(() => (window as any).__GAME.debugState().speed)).toFixed(0));
  // Simulation (CPU) cost per frame must leave room for rendering at 30-60 fps.
  expect(s.updateMs).toBeLessThan(16);
  expect(s.updateMsMax).toBeLessThan(80);
  expect(s.heapMB).toBeLessThan(250);
  await ctx.close();
});
