type ButtonName = "up" | "down" | "fly" | "fire" | "msl" | "suit" | "sentry";

/**
 * On-screen touch controls built from DOM elements and Pointer Events
 * (supported by iOS Safari 13+). Multi-touch aware: each pointer is routed to
 * the stick, a button, or the camera look area. Mouse pointers pass through
 * so hybrid laptops (touchscreen Chromebooks) can still use mouse look.
 */
export class TouchControls {
  readonly el: HTMLElement;
  moveX = 0;
  moveY = 0;
  lookDX = 0;
  lookDY = 0;
  ascend = false;
  descend = false;
  fire = false;
  private edges = new Set<ButtonName>();
  private roll = 0;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookIds = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  private lastTap = { t: 0, x: 0 };
  private radius = 60;
  private buttons = {} as Record<ButtonName, HTMLElement>;
  /** Fires when a touch is used, so the UI can switch from mouse to touch mode. */
  onTouchUsed: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "touch";
    this.el.innerHTML = `
      <div class="t-zone t-left"></div>
      <div class="t-zone t-right"></div>
      <div class="t-stick"><div class="t-knob"></div></div>
      <button class="t-btn t-up" data-b="up" aria-label="Ascend / take off"><span>▲</span><small>UP</small></button>
      <button class="t-btn t-down" data-b="down" aria-label="Descend"><span>▼</span><small>DOWN</small></button>
      <button class="t-btn t-fly" data-b="fly" aria-label="Toggle flight"><span>✈</span><small>FLY</small></button>
      <button class="t-btn t-fire" data-b="fire" aria-label="Repulsor blast (hold)"><span>✺</span><small>BLAST</small></button>
      <button class="t-btn t-msl" data-b="msl" aria-label="Fire micro-rockets"><span>➶</span><small>MSL</small></button>
      <button class="t-btn t-suit" data-b="suit" aria-label="Exit or call the suit"><span>⛨</span><small>SUIT</small></button>
      <button class="t-btn t-sentry" data-b="sentry" aria-label="Toggle sentry mode"><span>⛯</span><small>SENTRY</small></button>
    `;
    parent.appendChild(this.el);
    this.stickBase = this.el.querySelector(".t-stick")!;
    this.stickKnob = this.el.querySelector(".t-knob")!;
    for (const b of this.el.querySelectorAll<HTMLElement>(".t-btn")) this.buttons[b.dataset.b as ButtonName] = b;

    const left = this.el.querySelector<HTMLElement>(".t-left")!;
    const right = this.el.querySelector<HTMLElement>(".t-right")!;
    left.addEventListener("pointerdown", (e) => this.stickStart(e));
    right.addEventListener("pointerdown", (e) => this.lookStart(e));
    window.addEventListener("pointermove", (e) => this.onMove(e), { passive: false });
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e));

    for (const [name, b] of Object.entries(this.buttons) as [ButtonName, HTMLElement][]) {
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onTouchUsed?.();
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort; release still arrives via pointerup */
        }
        b.classList.add("on");
        if (name === "up") this.ascend = true;
        else if (name === "down") this.descend = true;
        else if (name === "fire") this.fire = true;
        else this.edges.add(name);
      });
      const release = () => {
        b.classList.remove("on");
        if (name === "up") this.ascend = false;
        if (name === "down") this.descend = false;
        if (name === "fire") this.fire = false;
      };
      b.addEventListener("pointerup", release);
      b.addEventListener("pointercancel", release);
      b.addEventListener("lostpointercapture", release);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    this.resetStick();
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? "" : "none";
    if (!v) this.releaseAll();
  }

  get visible(): boolean {
    return this.el.style.display !== "none";
  }

  /** Show the suit's state on the civilian buttons. */
  setSuitState(state: string): void {
    this.buttons.sentry.querySelector("small")!.textContent = state === "sentry" ? "SENTRY ON" : "SENTRY";
    this.buttons.sentry.classList.toggle("active", state === "sentry");
  }

  /** Update buttons to match the current flight mode / identity. */
  setMode(mode: string, suited = true): void {
    const label = (b: ButtonName, t: string) => (this.buttons[b].querySelector("small")!.textContent = t);
    label("up", !suited ? "JUMP" : mode === "ground" ? "LIFT" : mode === "flight" ? "CLIMB" : "UP");
    label("down", mode === "flight" ? "DIVE" : "DOWN");
    label("fly", mode === "flight" ? "HOVER" : "FLY");
    label("suit", suited ? "SUIT OFF" : "CALL SUIT");
    this.buttons.fly.classList.toggle("active", mode === "flight");
    this.el.classList.toggle("civ", !suited);
    this.el.dataset.mode = mode;
  }

  setRockets(n: number): void {
    this.buttons.msl.querySelector("small")!.textContent = `MSL ${n}`;
  }

  consume(name: ButtonName): boolean {
    return this.edges.delete(name);
  }

  consumeRoll(): number {
    const r = this.roll;
    this.roll = 0;
    return r;
  }

  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }

  releaseAll(): void {
    this.stickId = null;
    this.lookIds.clear();
    this.ascend = this.descend = this.fire = false;
    this.moveX = this.moveY = 0;
    this.edges.clear();
    for (const b of Object.values(this.buttons)) b.classList.remove("on");
    this.resetStick();
  }

  private stickStart(e: PointerEvent): void {
    if (e.pointerType === "mouse") return;
    e.preventDefault();
    this.onTouchUsed?.();
    if (this.stickId !== null) return;
    this.stickId = e.pointerId;
    this.radius = Math.max(48, Math.min(75, window.innerHeight * 0.13));
    this.stickOrigin = { x: e.clientX, y: e.clientY };
    this.stickBase.classList.add("active");
    this.stickBase.style.left = `${e.clientX}px`;
    this.stickBase.style.top = `${e.clientY}px`;
    this.stickBase.style.bottom = "auto";
    this.setKnob(0, 0);
  }

  private lookStart(e: PointerEvent): void {
    if (e.pointerType === "mouse") return;
    e.preventDefault();
    this.onTouchUsed?.();
    this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      e.preventDefault();
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > this.radius) {
        dx *= this.radius / d;
        dy *= this.radius / d;
      }
      this.setKnob(dx, dy);
      // Small dead zone, then rescale so full deflection reaches 1.
      const nx = dx / this.radius, ny = -dy / this.radius;
      const m = Math.hypot(nx, ny);
      const dead = 0.12;
      const k = m < dead ? 0 : (m - dead) / (1 - dead) / m;
      this.moveX = nx * k;
      this.moveY = ny * k;
      return;
    }
    const look = this.lookIds.get(e.pointerId);
    if (look) {
      e.preventDefault();
      this.lookDX += e.clientX - look.x;
      this.lookDY += e.clientY - look.y;
      look.x = e.clientX;
      look.y = e.clientY;
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.moveX = this.moveY = 0;
      this.resetStick();
    }
    const look = this.lookIds.get(e.pointerId);
    if (look) {
      // Double-tap on the look area = barrel roll toward that side.
      const now = performance.now();
      const isTap = now - look.t0 < 250 && Math.hypot(e.clientX - look.x0, e.clientY - look.y0) < 14;
      if (isTap) {
        if (now - this.lastTap.t < 320 && Math.abs(e.clientX - this.lastTap.x) < 80) {
          this.roll = e.clientX < window.innerWidth * 0.72 ? -1 : 1;
          this.lastTap.t = 0;
        } else this.lastTap = { t: now, x: e.clientX };
      }
      this.lookIds.delete(e.pointerId);
    }
  }

  private setKnob(dx: number, dy: number): void {
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private resetStick(): void {
    this.stickBase.classList.remove("active");
    this.stickBase.style.left = "";
    this.stickBase.style.top = "";
    this.stickBase.style.bottom = "";
    this.setKnob(0, 0);
  }
}
