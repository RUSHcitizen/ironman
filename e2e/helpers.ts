import type { Page } from "@playwright/test";

export interface DebugState {
  mode: string;
  pos: { x: number; y: number; z: number };
  speed: number;
  energy: number;
  fps: number;
  paused: boolean;
  started: boolean;
  quality: string;
  activeMeshes: number;
  chunks: number;
  props: number;
}

type GameHandle = { debugState(): DebugState };

export async function state(page: Page): Promise<DebugState> {
  return page.evaluate(() => (window as unknown as { __AEGIS: GameHandle }).__AEGIS.debugState());
}

/** Load the game, collect errors, and press Engage. */
export async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 90_000 });
  await page.locator("#l-start").click();
  await page.waitForFunction(() => (window as unknown as { __AEGIS: GameHandle }).__AEGIS.debugState().started);
  return errors;
}

/** Wait until a predicate on game state is true (software rendering is slow). */
export async function until(page: Page, fn: (s: DebugState) => boolean, timeout = 60_000): Promise<DebugState> {
  const t0 = Date.now();
  for (;;) {
    const s = await state(page);
    if (fn(s)) return s;
    if (Date.now() - t0 > timeout) throw new Error("Timed out; last state: " + JSON.stringify(s));
    await page.waitForTimeout(250);
  }
}
