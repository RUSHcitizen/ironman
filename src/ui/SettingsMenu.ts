import type { Settings, Quality } from "../core/Settings";

export interface MenuActions {
  onResume: () => void;
  onRespawn: () => void;
  /** Start a ring-course flight challenge now. */
  onChallenge?: () => void;
  /** Start a named incident / special objective now. */
  onMission?: (title: string) => void;
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
          <label>Armour</label>
          <div class="m-seg m-wrap" data-k="suit">
            <button data-v="classic">Classic</button><button data-v="silver">Mark II</button><button data-v="warmachine">War Machine</button><button data-v="stealth">Stealth</button><button data-v="midas">Midas</button>
          </div>
          <label>Time of day</label>
          <div class="m-seg" data-k="timeOfDay">
            <button data-v="sunset">Sunset</button><button data-v="day">Day</button><button data-v="night">Night</button>
          </div>
          <div class="m-seg" data-k="weather">
            <button data-v="clear">Clear</button><button data-v="rain">Rain</button><button data-v="storm">Storm</button>
          </div>
          <label class="m-toggle"><input type="checkbox" data-k="hud"/><span>Show HUD (K toggles cinematic mode)</span></label>
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
          <label class="m-toggle"><input type="checkbox" data-k="showFps"/><span>Show FPS / performance counter</span></label>
          <p class="m-note m-device"></p>
        </section>
        <button data-a="challenge">Start flight challenge (ring course)</button>
        <section>
          <label>Start a mission now</label>
          <div class="m-seg m-wrap m-missions">
            <button data-m="Bomb threat">Bomb threat</button><button data-m="Stolen Stark tech">Data cores</button>
            <button data-m="Catch the courier">Courier chase</button><button data-m="Protect the arc reactor">Defend reactor</button>
            <button data-m="ROGUE ARMOUR">Rogue Armour</button><button data-m="Bombing run">Bombing run</button>
            <button data-m="Medevac escort">Medevac escort</button><button data-m="Rooftop run">Rooftop run</button>
            <button data-m="Skydive: low pull">Skydive</button><button data-m="Rooftop fires">Rooftop fires</button><button data-m="Pylon race">Pylon race</button>
          </div>
        </section>
        <section class="m-contracts">
          <label>Contracts</label>
          <ul class="m-conlist"></ul>
        </section>
        <details class="m-ach">
          <summary>Achievements <output class="m-achcount"></output></summary>
          <ul class="m-achlist"></ul>
        </details>
        <button data-a="respawn">Return to Avengers Tower</button>
        <details ${isTouch ? "" : "open"}>
          <summary>Controls</summary>
          <div class="m-controls">
            <div><h4>Keyboard &amp; mouse</h4><ul>
              <li><kbd>W A S D</kbd> move / throttle &amp; turn in flight</li>
              <li><kbd>Mouse</kbd> look &amp; steer (click to lock, Esc to release)</li>
              <li><kbd>Space</kbd> take off / ascend · <kbd>C</kbd> descend</li>
              <li><kbd>Shift</kbd> or <kbd>F</kbd> toggle flight · <kbd>W</kbd> afterburner · <kbd>S</kbd> brake</li>
              <li><kbd>H</kbd> cut all thrust and free-fall (<kbd>H</kbd> / <kbd>Space</kbd> to re-engage)</li>
              <li><kbd>LMB</kbd> / <kbd>X</kbd> repulsors · <kbd>RMB</kbd> / <kbd>R</kbd> rockets</li>
              <li><kbd>Q</kbd> / <kbd>E</kbd> barrel roll · <kbd>Shift</kbd>+<kbd>A</kbd>/<kbd>D</kbd> sharp turn · <kbd>T</kbd> <kbd>B</kbd> <kbd>Y</kbd> tricks</li>
              <li><kbd>Z</kbd> Unibeam · <kbd>J</kbd> flares</li>
              <li><kbd>G</kbd> step out / call suit · <kbd>V</kbd> sentry</li>
              <li><kbd>Esc</kbd> / <kbd>P</kbd> pause</li></ul></div>
            <div><h4>Touch</h4><ul>
              <li>Left thumb: move stick (push up in flight = afterburner)</li>
              <li>Right side drag: look &amp; steer</li>
              <li>▲ / ▼ ascend &amp; descend (climb / dive in flight)</li>
              <li>FLY toggles high-speed flight · CUT drops all thrust (LIFT re-engages)</li></ul></div>
          </div>
        </details>
      </div>`;
    parent.appendChild(this.el);

    this.el.querySelector('[data-a="resume"]')!.addEventListener("click", () => this.actions.onResume());
    this.el.querySelector('[data-a="challenge"]')!.addEventListener("click", () => {
      this.actions.onChallenge?.();
      this.actions.onResume();
    });
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-m]")) {
      b.addEventListener("click", () => {
        this.actions.onMission?.(b.dataset.m!);
        this.actions.onResume();
      });
    }
    this.el.querySelector('[data-a="respawn"]')!.addEventListener("click", () => {
      this.actions.onRespawn();
      this.actions.onResume();
    });
    for (const seg of this.el.querySelectorAll<HTMLElement>(".m-seg[data-k]")) {
      const key = seg.dataset.k as keyof Settings["data"];
      for (const b of seg.querySelectorAll<HTMLButtonElement>("button")) {
        b.addEventListener("click", () =>
          this.settings.update({ [key]: b.dataset.v as Quality, ...(key === "quality" ? { qualityPicked: true } : {}) } as Partial<Settings["data"]>),
        );
      }
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

  /** Active contracts with progress bars. */
  setContracts(list: { text: string; progress: number; goal: number; reward: number }[]): void {
    this.el.querySelector(".m-conlist")!.replaceChildren(
      ...list.map((c) => {
        const li = document.createElement("li");
        li.innerHTML = `<b></b><span></span><i><i></i></i>`;
        li.querySelector("b")!.textContent = c.text;
        li.querySelector("span")!.textContent = `${c.progress}/${c.goal} · +${c.reward} XP`;
        (li.querySelector("i > i") as HTMLElement).style.width = `${Math.round((c.progress / c.goal) * 100)}%`;
        return li;
      }),
    );
  }

  /** Achievement list (shown when the menu opens). */
  setAchievements(list: { name: string; desc: string; done: boolean }[]): void {
    const n = list.filter((a) => a.done).length;
    this.el.querySelector(".m-achcount")!.textContent = `${n}/${list.length}`;
    const ul = this.el.querySelector(".m-achlist")!;
    ul.replaceChildren(
      ...list.map((a) => {
        const li = document.createElement("li");
        li.className = a.done ? "done" : "";
        li.innerHTML = `<b></b><span></span>`;
        li.querySelector("b")!.textContent = `${a.done ? "★" : "☆"} ${a.name}`;
        li.querySelector("span")!.textContent = a.desc;
        return li;
      }),
    );
  }

  /** Device line: GPU and browser engine (to check real-device support). */
  setDeviceInfo(text: string): void {
    this.el.querySelector(".m-device")!.textContent = text;
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
    for (const seg of this.el.querySelectorAll<HTMLElement>(".m-seg[data-k]")) {
      const v = d[seg.dataset.k as keyof typeof d];
      for (const b of seg.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("sel", b.dataset.v === v);
    }
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
