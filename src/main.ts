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

function setupRotateHint(isMobile: boolean): void {
  if (!isMobile) return;
  const el = $("rotate");
  let dismissed = false;
  const check = () => {
    el.hidden = dismissed || window.innerWidth >= window.innerHeight;
  };
  $("r-continue").addEventListener("click", () => {
    dismissed = true;
    check();
  });
  window.addEventListener("resize", check);
  window.addEventListener("orientationchange", () => setTimeout(check, 200));
  check();
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
  setupRotateHint(device.isMobile);
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
      game.start();
    },
    { once: true },
  );
}

boot().catch((e) => {
  console.error(e);
  showError("Startup failed: " + (e instanceof Error ? e.message : String(e)));
});
