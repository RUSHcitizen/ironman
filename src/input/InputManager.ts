import type { InputState } from "./InputState";
import { emptyInput } from "./InputState";
import { TouchControls } from "./TouchControls";
import type { Settings } from "../core/Settings";

const MOUSE_SCALE = 0.0022;
const TOUCH_SCALE = 0.0058;
const DOUBLE_TAP_MS = 260;

/**
 * Merges keyboard, mouse and touch into a single InputState per frame.
 *
 * Mouse: click the game to capture the mouse (pointer lock) for free look;
 * then left button = repulsors, right button = micro-rockets. If pointer lock
 * is unavailable, dragging with any button still looks around. Works on
 * touchscreen laptops too: whichever input was used last decides whether the
 * on-screen touch controls are shown.
 */
export class InputManager {
  readonly touch: TouchControls;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private lastKeyTime = new Map<string, number>();
  private mouseDX = 0;
  private mouseDY = 0;
  private mouseButtons = 0;
  private dragging = false;
  private pointerLocked = false;
  private rocketClick = false;
  private keyRoll = 0;
  private touchUpWas = false;
  private state: InputState = emptyInput();
  /** True while the last-used pointing device was a mouse. */
  mouseMode: boolean;
  enabled = true;
  onModeChange: ((mouse: boolean) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private settings: Settings,
    isTouch: boolean,
  ) {
    this.mouseMode = !isTouch;
    this.touch = new TouchControls(uiRoot);
    this.touch.setVisible(isTouch);
    this.touch.onTouchUsed = () => this.setMouseMode(false);

    window.addEventListener("keydown", (e) => {
      if (isEditable(e.target)) return;
      const k = e.code;
      if (!this.keys.has(k)) {
        this.pressed.add(k);
        // Double-tap A / D = barrel roll.
        if (k === "KeyA" || k === "KeyD") {
          const now = performance.now();
          if (now - (this.lastKeyTime.get(k) ?? 0) < DOUBLE_TAP_MS) this.keyRoll = k === "KeyA" ? -1 : 1;
          this.lastKeyTime.set(k, now);
        }
      }
      this.keys.add(k);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "AltLeft"].includes(k)) e.preventDefault();
      if (/^Key|Space|Arrow/.test(k)) this.setMouseMode(true);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.reset());
    document.addEventListener("visibilitychange", () => document.hidden && this.reset());

    // Mouse handling at window level: the touch layer may sit above the canvas.
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || !this.enabled || !this.isGameSurface(e.target)) return;
      this.setMouseMode(true);
      if (!this.pointerLocked) {
        this.dragging = true;
        this.requestLock();
      }
    });
    window.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") this.dragging = false;
    });
    // Buttons via mouse events: chorded presses (right while holding left) do
    // not produce extra pointerdown events.
    window.addEventListener("mousedown", (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      this.mouseButtons = e.buttons;
      if (e.button === 2) this.rocketClick = true;
    });
    window.addEventListener("mouseup", (e) => {
      this.mouseButtons = e.buttons;
    });
    window.addEventListener("mousemove", (e) => {
      if (this.pointerLocked || this.dragging) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) this.mouseButtons = 0;
    });
    window.addEventListener("contextmenu", (e) => {
      if (this.isGameSurface(e.target)) e.preventDefault();
    });
  }

  private isGameSurface(t: EventTarget | null): boolean {
    if (!(t instanceof Element)) return false;
    if (t === this.canvas) return true;
    return !!t.closest("#touch") && !t.closest(".t-btn");
  }

  private requestLock(): void {
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* pointer lock unavailable - drag-look still works */
    }
  }

  private setMouseMode(mouse: boolean): void {
    if (mouse === this.mouseMode) return;
    this.mouseMode = mouse;
    this.touch.setVisible(!mouse);
    this.onModeChange?.(mouse);
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** Show the "click to look" hint: mouse in use but not captured. */
  get needsCapture(): boolean {
    return this.mouseMode && !this.pointerLocked;
  }

  releasePointer(): void {
    if (this.pointerLocked) document.exitPointerLock?.();
    this.dragging = false;
  }

  reset(): void {
    this.keys.clear();
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.mouseButtons = 0;
    this.dragging = false;
    this.rocketClick = false;
    this.keyRoll = 0;
    this.touch.releaseAll();
  }

  private down(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  private hit(...codes: string[]): boolean {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  poll(): InputState {
    const s = this.state;
    const t = this.touch;
    const kx = (this.down("KeyD", "ArrowRight") ? 1 : 0) - (this.down("KeyA", "ArrowLeft") ? 1 : 0);
    const ky = (this.down("KeyW", "ArrowUp") ? 1 : 0) - (this.down("KeyS", "ArrowDown") ? 1 : 0);
    s.moveX = Math.max(-1, Math.min(1, kx + t.moveX));
    s.moveY = Math.max(-1, Math.min(1, ky + t.moveY));

    const cfg = this.settings.data;
    const inv = cfg.invertY ? -1 : 1;
    const [tdx, tdy] = t.consumeLook();
    s.lookX = this.mouseDX * MOUSE_SCALE * cfg.lookSensitivity + tdx * TOUCH_SCALE * cfg.touchSensitivity;
    s.lookY = -(this.mouseDY * MOUSE_SCALE * cfg.lookSensitivity + tdy * TOUCH_SCALE * cfg.touchSensitivity) * inv;
    this.mouseDX = this.mouseDY = 0;

    s.ascend = this.down("Space") || t.ascend;
    s.descend = this.down("KeyC", "ControlLeft", "ControlRight") || t.descend;
    const touchUp = t.ascend && !this.touchUpWas;
    this.touchUpWas = t.ascend;
    s.takeoff = this.hit("Space") || touchUp;
    s.sprint = this.down("ShiftLeft", "ShiftRight");
    s.toggleFlight = this.hit("ShiftLeft", "ShiftRight", "KeyF") || t.consume("fly");
    s.fire = (this.pointerLocked && (this.mouseButtons & 1) !== 0) || this.down("KeyX") || t.fire;
    s.rockets = this.rocketClick || this.hit("KeyR") || t.consume("msl");
    s.toggleSuit = this.hit("KeyG") || t.consume("suit");
    s.sentry = this.hit("KeyV") || t.consume("sentry");
    s.roll = this.hit("KeyQ") ? -1 : this.hit("KeyE") ? 1 : this.keyRoll || t.consumeRoll();
    s.menu = this.hit("Escape", "KeyP");
    this.pressed.clear();
    this.rocketClick = false;
    this.keyRoll = 0;

    if (!this.enabled) {
      const menu = s.menu;
      Object.assign(s, emptyInput());
      s.menu = menu;
    }
    return s;
  }
}

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
