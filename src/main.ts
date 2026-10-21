import "./styles.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { detectDevice, checkWebGL } from "./core/device";
import { Settings } from "./core/Settings";
import { Game } from "./core/Game";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function showError(message: string): void {
  $("loading").hidden = true;
  $("e-message").textContent = message;
  $("error").hidden = false;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const TIPS = [
  "Tip: dive from rooftops — shallow approaches skim the street.",
  "Tip: the afterburner drains power fast. Land to recharge.",
  "Tip: follow the amber beam to respond to city incidents.",
  "Tip: lower the graphics quality in the menu if things stutter.",
];

/**
 * Phones: the game is always landscape. If the browser is upright (portrait,
 * e.g. because the system rotation lock is on, which a web page cannot
 * override on iPhone), the whole game is drawn sideways - so turning the
 * phone just works. When the browser itself rotates, it switches back.
 */
function setupOrientation(isMobile: boolean): void {
  if (!isMobile) return;
  const root = document.documentElement;
  let was: boolean | null = null;
  const check = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const rot = h > w;
    root.style.setProperty("--rot-w", `${h}px`);
    root.style.setProperty("--rot-h", `${w}px`);
    document.body.classList.toggle("rot", rot);
    root.classList.toggle("rotated", rot);
    if (rot !== was) {
      was = rot;
      // Let the engine and HUD re-measure the (now differently shaped) stage.
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
  };
  // Phones report the new size a little after rotating, so check again later.
  const recheck = () => {
    check();
    for (const ms of [100, 300, 700]) setTimeout(check, ms);
  };
  window.addEventListener("resize", check);
  window.addEventListener("orientationchange", recheck);
  screen.orientation?.addEventListener?.("change", recheck);
  window.visualViewport?.addEventListener("resize", check);
  check();
}

/** Android: go full-screen and lock to landscape (ignored where unsupported, e.g. iPhone). */
async function lockLandscape(): Promise<void> {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.("landscape");
  } catch {
    /* not supported here: the sideways fallback covers it */
  }
}

async function boot(): Promise<void> {
  $("e-retry").addEventListener("click", () => location.reload());
  // iOS: block pinch-zoom / double-tap gestures that would hijack the game.
  for (const ev of ["gesturestart", "gesturechange", "dblclick"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  // Prevent page scroll/bounce, except inside scrollable panels (settings menu).
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!(e.target instanceof Element && e.target.closest(".m-panel"))) e.preventDefault();
    },
    { passive: false },
  );

  const device = detectDevice();
  document.documentElement.classList.toggle("touch", device.isTouch);
  document.documentElement.classList.toggle("ios", device.isIOS);
  setupOrientation(device.isMobile);
  $("l-tip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

  const glError = checkWebGL();
  if (glError) return showError(glError);

  const settings = new Settings(device.isMobile);
  const canvas = $<HTMLCanvasElement>("game");
  let engine: Engine;
  try {
    engine = new Engine(
      canvas,
      settings.preset.antialias,
      { stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance", premultipliedAlpha: false, alpha: false, failIfMajorPerformanceCaveat: false },
      false,
    );
  } catch (e) {
    return showError("Graphics engine failed to start: " + (e instanceof Error ? e.message : String(e)));
  }
  engine.onContextLostObservable.add(() => {
    $("e-message").textContent = "The graphics context was lost (the GPU was reset or memory ran low). Trying to restore…";
    $("error").hidden = false;
  });
  engine.onContextRestoredObservable.add(() => {
    $("error").hidden = true;
  });

  const bar = $("l-progress");
  const status = $("l-status");
  const game = new Game(engine, canvas, $("ui"), settings, device);
  (window as unknown as { __GAME: Game }).__GAME = game;
  await game.init(async (f, label) => {
    bar.style.transform = `scaleX(${f})`;
    status.textContent = label;
    await nextFrame();
  });

  const start = $<HTMLButtonElement>("l-start");
  start.disabled = false;
  status.textContent = device.isTouch ? "Tap Engage to suit up" : "Click Engage to suit up";
  start.focus();
  start.addEventListener(
    "click",
    () => {
      $("loading").classList.add("out");
      setTimeout(() => ($("loading").hidden = true), 600);
      if (device.isMobile) void lockLandscape();
      game.start();
    },
    { once: true },
  );
}

boot().catch((e) => {
  console.error(e);
  showError("Startup failed: " + (e instanceof Error ? e.message : String(e)));
});
