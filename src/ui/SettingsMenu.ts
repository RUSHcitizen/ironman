import type { Settings, Quality } from "../core/Settings";

export interface MenuActions {
  onResume: () => void;
  onRespawn: () => void;
}

/** Pause / settings overlay. Large touch targets, no hover-dependent UI. */
export class SettingsMenu {
  readonly el: HTMLElement;
  private open = false;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private actions: MenuActions,
    isTouch: boolean,
  ) {
    this.el = document.createElement("div");
    this.el.id = "menu";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Settings");
    this.el.innerHTML = `
      <div class="m-panel">
        <header><small>F.R.I.D.A.Y. · SYSTEMS</small><h2>Paused</h2></header>
        <button class="m-primary" data-a="resume">Resume</button>
        <section>
          <label>Graphics quality</label>
          <div class="m-seg" data-k="quality">
            <button data-v="low">Low</button><button data-v="medium">Medium</button><button data-v="high">High</button>
          </div>
          <p class="m-note">Anti-aliasing changes apply after a reload. Low is recommended on phones.</p>
          <label class="m-toggle"><input type="checkbox" data-k="autoQuality"/><span>Auto-reduce quality if FPS drops</span></label>
        </section>
        <section>
          <label>Mouse sensitivity <output data-o="lookSensitivity"></output></label>
          <input type="range" min="0.25" max="3" step="0.05" data-k="lookSensitivity"/>
          <label>Touch sensitivity <output data-o="touchSensitivity"></output></label>
          <input type="range" min="0.25" max="3" step="0.05" data-k="touchSensitivity"/>
          <label class="m-toggle"><input type="checkbox" data-k="invertY"/><span>Invert vertical look</span></label>
        </section>
        <section>
          <label>Volume <output data-o="volume"></output></label>
          <input type="range" min="0" max="1" step="0.05" data-k="volume"/>
          <label class="m-toggle"><input type="checkbox" data-k="showFps"/><span>Show FPS counter</span></label>
        </section>
        <button data-a="respawn">Return to Apex Tower</button>
        <details ${isTouch ? "" : "open"}>
          <summary>Controls</summary>
          <div class="m-controls">
            <div><h4>Keyboard &amp; mouse</h4><ul>
              <li><kbd>W A S D</kbd> move / throttle &amp; turn in flight</li>
              <li><kbd>Mouse</kbd> look &amp; steer (click to lock, Esc to release)</li>
              <li><kbd>Space</kbd> take off / ascend · <kbd>C</kbd> descend</li>
              <li><kbd>Shift</kbd> or <kbd>F</kbd> toggle flight · <kbd>W</kbd> afterburner · <kbd>S</kbd> brake</li>
              <li><kbd>Esc</kbd> / <kbd>P</kbd> pause</li></ul></div>
            <div><h4>Touch</h4><ul>
              <li>Left thumb: move stick (push up in flight = afterburner)</li>
              <li>Right side drag: look &amp; steer</li>
              <li>▲ / ▼ ascend &amp; descend (climb / dive in flight)</li>
              <li>FLY toggles high-speed flight</li></ul></div>
          </div>
        </details>
      </div>`;
    parent.appendChild(this.el);

    this.el.querySelector('[data-a="resume"]')!.addEventListener("click", () => this.actions.onResume());
    this.el.querySelector('[data-a="respawn"]')!.addEventListener("click", () => {
      this.actions.onRespawn();
      this.actions.onResume();
    });
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-k="quality"] button')) {
      b.addEventListener("click", () => this.settings.update({ quality: b.dataset.v as Quality }));
    }
    for (const input of this.el.querySelectorAll<HTMLInputElement>("input[data-k]")) {
      const key = input.dataset.k as keyof Settings["data"];
      input.addEventListener("input", () => {
        const value = input.type === "checkbox" ? input.checked : parseFloat(input.value);
        this.settings.update({ [key]: value } as Partial<Settings["data"]>);
      });
    }
    // Clicking the backdrop resumes.
    this.el.addEventListener("pointerdown", (e) => {
      if (e.target === this.el) this.actions.onResume();
    });
    settings.onChange(() => this.sync());
    this.sync();
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(v: boolean): void {
    this.open = v;
    this.el.classList.toggle("on", v);
    if (v) this.sync();
  }

  private sync(): void {
    const d = this.settings.data;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-k="quality"] button')) b.classList.toggle("sel", b.dataset.v === d.quality);
    for (const input of this.el.querySelectorAll<HTMLInputElement>("input[data-k]")) {
      const v = d[input.dataset.k as keyof typeof d];
      if (input.type === "checkbox") input.checked = Boolean(v);
      else input.value = String(v);
    }
    for (const o of this.el.querySelectorAll<HTMLOutputElement>("output[data-o]")) {
      const v = d[o.dataset.o as keyof typeof d] as number;
      o.textContent = o.dataset.o === "volume" ? `${Math.round(v * 100)}%` : `${v.toFixed(2)}×`;
    }
  }
}
