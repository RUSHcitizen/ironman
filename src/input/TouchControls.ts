/**
 * On-screen touch controls built from DOM elements and Pointer Events
 * (supported by iOS Safari 13+). Multi-touch aware: each pointer is routed to
 * the stick, a button, or the camera look area.
 */
export class TouchControls {
  readonly el: HTMLElement;
  moveX = 0;
  moveY = 0;
  lookDX = 0;
  lookDY = 0;
  ascend = false;
  descend = false;
  private flyPressed = false;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookIds = new Map<number, { x: number; y: number }>();
  private radius = 60;
  private buttons: Record<string, HTMLElement> = {};

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
    `;
    parent.appendChild(this.el);
    this.stickBase = this.el.querySelector(".t-stick")!;
    this.stickKnob = this.el.querySelector(".t-knob")!;
    for (const b of this.el.querySelectorAll<HTMLElement>(".t-btn")) this.buttons[b.dataset.b!] = b;

    const left = this.el.querySelector<HTMLElement>(".t-left")!;
    const right = this.el.querySelector<HTMLElement>(".t-right")!;
    left.addEventListener("pointerdown", (e) => this.stickStart(e));
    right.addEventListener("pointerdown", (e) => this.lookStart(e));
    window.addEventListener("pointermove", (e) => this.onMove(e), { passive: false });
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e));

    for (const [name, b] of Object.entries(this.buttons)) {
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort; release still arrives via pointerup */
        }
        b.classList.add("on");
        if (name === "up") this.ascend = true;
        if (name === "down") this.descend = true;
        if (name === "fly") this.flyPressed = true;
      });
      const release = () => {
        b.classList.remove("on");
        if (name === "up") this.ascend = false;
        if (name === "down") this.descend = false;
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
  }

  /** Update button labels to match the current flight mode. */
  setMode(mode: string): void {
    const up = this.buttons.up.querySelector("small")!;
    const down = this.buttons.down.querySelector("small")!;
    const fly = this.buttons.fly.querySelector("small")!;
    up.textContent = mode === "ground" ? "LIFT" : mode === "flight" ? "CLIMB" : "UP";
    down.textContent = mode === "flight" ? "DIVE" : mode === "ground" ? "—" : "DOWN";
    fly.textContent = mode === "flight" ? "HOVER" : "FLY";
    this.buttons.fly.classList.toggle("active", mode === "flight");
  }

  consumeFly(): boolean {
    const v = this.flyPressed;
    this.flyPressed = false;
    return v;
  }

  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }

  releaseAll(): void {
    this.stickId = null;
    this.lookIds.clear();
    this.ascend = this.descend = false;
    for (const b of Object.values(this.buttons)) b.classList.remove("on");
    this.resetStick();
  }

  private stickStart(e: PointerEvent): void {
    e.preventDefault();
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
    e.preventDefault();
    this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    this.lookIds.delete(e.pointerId);
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
