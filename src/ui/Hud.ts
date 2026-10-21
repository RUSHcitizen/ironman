import type { EventBus, GameEvents, AlertLevel } from "../core/EventBus";
import type { PlayerController } from "../player/PlayerController";
import { SUIT_PARTS } from "../player/SuitSystems";
import { wrapAngle } from "../core/math";

export interface HudMarker {
  id: string;
  label: string;
  x: number;
  z: number;
  kind: "poi" | "event";
}

const CARDINALS: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
const COMPASS_SPAN = 110; // degrees visible across the tape

function cardinal(deg: number): string {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round(deg / 22.5) % 16];
}

/**
 * ARIA heads-up display (DOM overlay). Per-frame work is limited to CSS
 * transforms; text readouts refresh at ~15 Hz to stay cheap on mobile.
 */
export class Hud {
  readonly el: HTMLElement;
  private q = <T extends HTMLElement = HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
  private tape: HTMLElement;
  private compassW = 0;
  private markersEl: HTMLElement;
  private markerEls = new Map<string, HTMLElement>();
  private markers: HudMarker[] = [];
  private textTimer = 0;
  private alertsEl: HTMLElement;
  private areaTimer: number | undefined;
  private fpsEl: HTMLElement;
  private frames = 0;
  private fpsTime = 0;
  fps = 60;
  onMenu: (() => void) | null = null;

  constructor(parent: HTMLElement, bus: EventBus<GameEvents>) {
    this.el = document.createElement("div");
    this.el.id = "hud";
    this.el.innerHTML = `
      <div class="h-vignette"></div>
      <div class="h-top">
        <div class="h-compass"><div class="h-tape"></div><div class="h-markers"></div><div class="h-needle"></div></div>
        <div class="h-heading"><b class="v-heading">000</b><span class="v-card">N</span></div>
      </div>
      <div class="h-area"><small>ARIA · ENTERING</small><b class="v-area"></b></div>
      <div class="h-reticle">
        <svg viewBox="-50 -50 100 100" aria-hidden="true">
          <circle r="30" class="r-ring"/>
          <g class="r-spin"><path d="M0,-40 A40,40 0 0,1 28,-28" /><path d="M0,40 A40,40 0 0,1 -28,28" /></g>
          <path d="M-46,0 h8 M38,0 h8 M0,-46 v6 M0,40 v6" class="r-tick"/>
          <circle r="2" class="r-dot"/>
        </svg>
      </div>
      <div class="h-left h-gauge">
        <small>SPD</small><b class="v-speed">0</b><span>KM/H</span>
        <div class="h-bar"><i class="v-speedbar"></i></div>
        <em class="v-mach">MACH 0.00</em>
      </div>
      <div class="h-right h-gauge">
        <small>ALT</small><b class="v-alt">0</b><span>M</span>
        <div class="h-bar"><i class="v-altbar"></i></div>
        <em class="v-agl">AGL 0 · VS 0</em>
      </div>
      <div class="h-diag">
        <svg viewBox="0 0 60 100" class="d-suit" aria-hidden="true">
          <circle cx="30" cy="10" r="7" data-p="helmet"/>
          <rect x="19" y="19" width="22" height="28" rx="4" data-p="chest"/>
          <rect x="8" y="20" width="8" height="30" rx="3" data-p="arms"/>
          <rect x="44" y="20" width="8" height="30" rx="3" data-p="arms"/>
          <rect x="20" y="50" width="9" height="36" rx="3" data-p="legs"/>
          <rect x="31" y="50" width="9" height="36" rx="3" data-p="legs"/>
          <rect x="19" y="89" width="22" height="5" rx="2" data-p="thrusters"/>
        </svg>
        <div class="d-stats">
          <small>SUIT INTEGRITY</small><b class="v-int">100%</b>
          <small>POWER</small>
          <div class="d-energy"><i class="v-energy"></i></div>
          <b class="v-energy-t">100%</b>
        </div>
      </div>
      <div class="h-mode"><b class="v-mode">GROUND</b><span class="v-hint"></span></div>
      <div class="h-objective"><small class="v-obj-t"></small><b class="v-obj"></b></div>
      <div class="h-alerts"></div>
      <div class="h-fps"></div>
      <button class="h-menu" aria-label="Open menu">☰</button>
    `;
    parent.appendChild(this.el);
    this.tape = this.q(".h-tape");
    this.markersEl = this.q(".h-markers");
    this.alertsEl = this.q(".h-alerts");
    this.fpsEl = this.q(".h-fps");
    this.q(".h-menu").addEventListener("click", () => this.onMenu?.());
    this.buildTape();
    window.addEventListener("resize", () => this.buildTape());

    bus.on("alert", (a) => this.alert(a.text, a.level, a.ttl));
    bus.on("areaChanged", (a) => this.showArea(a.name));
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? "" : "none";
  }

  setShowFps(v: boolean): void {
    this.fpsEl.style.display = v ? "" : "none";
  }

  setHint(text: string): void {
    this.q(".v-hint").textContent = text;
  }

  setMarkers(markers: HudMarker[]): void {
    this.markers = markers;
    for (const [id, el] of this.markerEls) {
      if (!markers.find((m) => m.id === id)) {
        el.remove();
        this.markerEls.delete(id);
      }
    }
    for (const m of markers) {
      if (this.markerEls.has(m.id)) continue;
      const el = document.createElement("div");
      el.className = `h-marker m-${m.kind}`;
      el.innerHTML = `<i></i><span></span>`;
      this.markersEl.appendChild(el);
      this.markerEls.set(m.id, el);
    }
  }

  setObjective(title: string, detail: string): void {
    const box = this.q(".h-objective");
    box.classList.toggle("on", !!title);
    this.q(".v-obj-t").textContent = title;
    this.q(".v-obj").textContent = detail;
  }

  private buildTape(): void {
    const compass = this.q(".h-compass");
    this.compassW = compass.clientWidth || 300;
    const ppd = this.compassW / COMPASS_SPAN;
    let html = "";
    for (let d = -180; d <= 540; d += 5) {
      const deg = ((d % 360) + 360) % 360;
      const x = (d + 180) * ppd;
      const label = CARDINALS[deg];
      if (label) html += `<b style="left:${x}px" class="${label.length === 1 ? "c-main" : ""}">${label}</b>`;
      else if (deg % 15 === 0) html += `<em style="left:${x}px">${deg}</em>`;
      else html += `<i style="left:${x}px"></i>`;
    }
    this.tape.innerHTML = html;
  }

  alert(text: string, level: AlertLevel = "info", ttl = 4.5): void {
    const el = document.createElement("div");
    el.className = `h-alert a-${level}`;
    el.innerHTML = `<small>ARIA</small><span></span>`;
    el.querySelector("span")!.textContent = text;
    this.alertsEl.prepend(el);
    while (this.alertsEl.children.length > 4) this.alertsEl.lastElementChild!.remove();
    window.setTimeout(() => el.classList.add("out"), ttl * 1000);
    window.setTimeout(() => el.remove(), ttl * 1000 + 600);
  }

  private showArea(name: string): void {
    const el = this.q(".h-area");
    this.q(".v-area").textContent = name.toUpperCase();
    el.classList.add("on");
    window.clearTimeout(this.areaTimer);
    this.areaTimer = window.setTimeout(() => el.classList.remove("on"), 3200);
  }

  update(dt: number, p: PlayerController): void {
    // FPS meter.
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frames / this.fpsTime;
      this.fpsEl.textContent = `${this.fps.toFixed(0)} FPS`;
      this.frames = 0;
      this.fpsTime = 0;
    }

    // Compass every frame (transform only).
    const heading = ((p.viewYaw * 180) / Math.PI + 360) % 360;
    const ppd = this.compassW / COMPASS_SPAN;
    this.tape.style.transform = `translate3d(${-(heading + 180) * ppd + this.compassW / 2}px,0,0)`;
    for (const m of this.markers) {
      const el = this.markerEls.get(m.id)!;
      const dx = m.x - p.pos.x, dz = m.z - p.pos.z;
      const bearing = Math.atan2(dx, dz);
      const rel = (wrapAngle(bearing - p.viewYaw) * 180) / Math.PI;
      const clamped = Math.max(-COMPASS_SPAN / 2 + 4, Math.min(COMPASS_SPAN / 2 - 4, rel));
      el.style.transform = `translate3d(${this.compassW / 2 + clamped * ppd}px,0,0)`;
      el.classList.toggle("edge", clamped !== rel);
    }

    this.textTimer -= dt;
    if (this.textTimer > 0) return;
    this.textTimer = 1 / 15;

    this.q(".v-heading").textContent = String(Math.round(heading) % 360).padStart(3, "0");
    this.q(".v-card").textContent = cardinal(heading);
    for (const m of this.markers) {
      const el = this.markerEls.get(m.id)!;
      const d = Math.hypot(m.x - p.pos.x, m.z - p.pos.z);
      el.querySelector("span")!.textContent = `${m.label} ${d < 1000 ? Math.round(d) + "m" : (d / 1000).toFixed(1) + "km"}`;
    }

    const kmh = p.speed * 3.6;
    this.q(".v-speed").textContent = String(Math.round(kmh));
    this.q(".v-mach").textContent = `MACH ${(p.speed / 343).toFixed(2)}`;
    this.q(".v-speedbar").style.transform = `scaleY(${Math.min(1, kmh / 460)})`;
    this.q(".v-alt").textContent = String(Math.round(p.pos.y));
    this.q(".v-altbar").style.transform = `scaleY(${Math.min(1, Math.max(0, p.pos.y) / 650)})`;
    const vs = p.vel.y;
    this.q(".v-agl").textContent = `AGL ${Math.max(0, Math.round(p.agl))} · VS ${vs >= 0 ? "▲" : "▼"}${Math.abs(vs).toFixed(0)}`;

    const e = p.suit.energy;
    const energyEl = this.q(".v-energy");
    energyEl.style.transform = `scaleX(${e / 100})`;
    energyEl.className = `v-energy ${e < 20 ? "crit" : e < 40 ? "warn" : ""}`;
    this.q(".v-energy-t").textContent = `${Math.round(e)}%`;
    this.q(".v-int").textContent = `${Math.round(p.suit.overallIntegrity)}%`;
    for (const part of SUIT_PARTS) {
      const v = p.suit.integrity[part];
      const cls = v > 70 ? "ok" : v > 40 ? "warn" : "crit";
      for (const n of this.el.querySelectorAll(`[data-p="${part}"]`)) n.setAttribute("class", cls);
    }

    const modeText = p.mode === "ground" ? (p.landingTimer > 0 ? "TOUCHDOWN" : "GROUND") : p.mode === "hover" ? "HOVER" : p.afterburner ? "AFTERBURNER" : "FLIGHT";
    this.q(".v-mode").textContent = modeText;
    this.el.dataset.mode = p.mode;
    this.el.classList.toggle("burn", p.afterburner);
    (this.q(".h-vignette") as HTMLElement).style.opacity = String(Math.min(1, Math.max(0, (p.speed - 50) / 80)));
  }
}
