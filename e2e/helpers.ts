import type { Page } from "@playwright/test";

export interface DebugState {
  mode: string;
  suited: boolean;
  transforming: boolean;
  integrity: number;
  viewYaw: number;
  viewPitch: number;
  enemies: number;
  kills: number;
  rockets: number;
  suitState: string;
  trick: string | null;
  styleCombo: number;
  oxygen: number;
  freefall: boolean;
  blackout: boolean;
  dead: boolean;
  inSpace: boolean;
  space: number;
  stepOut: boolean;
  suitPos: { x: number; y: number; z: number };
  mouseMode: boolean;
  pointerLocked: boolean;
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

export type GameHandle = {
  debugState(): DebugState;
  teleport(x: number, y: number, z: number, yaw: number, mode?: string, speed?: number): void;
  spawnEnemy(kind: string, forward: number, up: number, right?: number): void;
  player: { viewPitch: number };
};

/** Run a function against the game object in the page. */
export async function game<A>(page: Page, fn: (g: GameHandle, arg: A) => void, arg?: A): Promise<void> {
  await page.evaluate(
    ([src, a]) => {
      const f = new Function("g", "arg", `return (${src})(g, arg);`);
      f((window as unknown as { __GAME: unknown }).__GAME, a);
    },
    [fn.toString(), arg] as const,
  );
}

export async function state(page: Page): Promise<DebugState> {
  return page.evaluate(() => (window as unknown as { __GAME: GameHandle }).__GAME.debugState());
}

/**
 * Load the game, collect errors, and press Engage. By default forces the Low
 * preset (software rendering in CI is slow); pass keepSettings to test defaults.
 */
export async function boot(page: Page, opts: { keepSettings?: boolean } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  if (!opts.keepSettings) {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("e2e-init")) {
        sessionStorage.setItem("e2e-init", "1");
        localStorage.setItem("ironman.settings.v1", JSON.stringify({ quality: "low", autoQuality: false }));
      }
    });
  }
  await page.goto("/");
  await page.locator("#l-start:not([disabled])").waitFor({ timeout: 90_000 });
  await page.locator("#l-start").click();
  await page.waitForFunction(() => (window as unknown as { __GAME: GameHandle }).__GAME.debugState().started);
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
