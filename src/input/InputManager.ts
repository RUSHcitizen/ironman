import type { InputState } from "./InputState";
import { emptyInput } from "./InputState";
import { TouchControls } from "./TouchControls";
import type { Settings } from "../core/Settings";

const MOUSE_SCALE = 0.0022;
const TOUCH_SCALE = 0.0058;

/** Merges keyboard, mouse and touch into a single InputState per frame. */
export class InputManager {
  readonly touch: TouchControls;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private dragging = false;
  private pointerLocked = false;
  private state: InputState = emptyInput();
  enabled = true;

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private settings: Settings,
    private isTouch: boolean,
  ) {
    this.touch = new TouchControls(uiRoot);
    this.touch.setVisible(isTouch);

    window.addEventListener("keydown", (e) => {
      if (isEditable(e.target)) return;
      const k = e.code;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(k)) e.preventDefault();
      // A key press on a touch-capable laptop: show keyboard UX, hide touch UI.
      if (this.isTouch && /^Key|Space|Arrow/.test(k)) this.touch.setVisible(false);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.reset());
    document.addEventListener("visibilitychange", () => document.hidden && this.reset());

    // Mouse: drag to look, or click to pointer-lock on desktop.
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return;
      this.dragging = true;
      if (!this.isTouch && !this.pointerLocked && canvas.requestPointerLock) {
        try {
          const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
          r?.catch?.(() => {});
        } catch {
          /* pointer lock unavailable - drag-look still works */
        }
      }
    });
    window.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") this.dragging = false;
    });
    window.addEventListener("mousemove", (e) => {
      if (this.pointerLocked || this.dragging) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  releasePointer(): void {
    if (this.pointerLocked) document.exitPointerLock?.();
    this.dragging = false;
  }

  reset(): void {
    this.keys.clear();
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.dragging = false;
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

    s.ascend = this.down("Space", "KeyE") || t.ascend;
    s.descend = this.down("KeyC", "ControlLeft", "KeyQ") || t.descend;
    s.takeoff = this.hit("Space");
    s.toggleFlight = this.hit("ShiftLeft", "ShiftRight", "KeyF") || t.consumeFly();
    s.menu = this.hit("Escape", "KeyP");
    this.pressed.clear();

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
