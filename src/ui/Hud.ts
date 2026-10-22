import type { EventBus, GameEvents, AlertLevel } from "../core/EventBus";
import type { PlayerController } from "../player/PlayerController";
import { SUIT_PARTS } from "../player/SuitSystems";
import { wrapAngle } from "../core/math";

export interface HudTarget {
  x: number;
  y: number;
  z: number;
  hp: number;
  locked: boolean;
  assist: boolean;
  kind: string;
  scale: number;
  /** Tagged by an area scan (shown through walls). */
  tagged?: boolean;
}

/** F.R.I.D.A.Y. target analysis card. */
export interface ScanCard {
  x: number;
  y: number;
  /** Analysis progress 0..1 (details appear at 1). */
  progress: number;
  name: string;
  cls: string;
  threat: string;
  hull: number;
  dist: number;
  weakness: string;
}

export interface HudMarker {
  id: string;
  label: string;
  x: number;
  z: number;
  kind: "poi" | "event" | "suit";
}

const CARDINALS: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
const COMPASS_SPAN = 110; // degrees visible across the tape

function cardinal(deg: number): string {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round(deg / 22.5) % 16];
}

/**
 * F.R.I.D.A.Y. heads-up display (DOM overlay). Per-frame work is limited to CSS
 * transforms; text readouts refresh at ~15 Hz to stay cheap on mobile.
 */
export interface RadarBlip {
  x: number;
  z: number;
  kind: "hostile" | "air" | "event" | "suit" | "poi";
  big?: boolean;
}

export class Hud {
  readonly el: HTMLElement;
  /** Cached element lookup (the HUD's elements never change). */
  private qcache = new Map<string, HTMLElement>();
  private q = <T extends HTMLElement = HTMLElement>(sel: string): T => {
    let e = this.qcache.get(sel);
    if (!e) this.qcache.set(sel, (e = this.el.querySelector(sel) as HTMLElement));
    return e as T;
  };
  /** Write text only when it changed (avoids needless layout work). */
  private text(sel: string, v: string): void {
    const e = this.q(sel);
    if (e.textContent !== v) e.textContent = v;
  }
  private lastPips = -1;
  /** Extra performance info for the FPS counter (set by the game). */
  perfNote = "";
  private tape: HTMLElement;
  private compassW = 0;
  private markersEl: HTMLElement;
  private markerEls = new Map<string, HTMLElement>();
  markers: HudMarker[] = [];
  private textTimer = 0;
  private alertsEl: HTMLElement;
  private areaTimer: number | undefined;
  private fpsEl: HTMLElement;
  private frames = 0;
  private fpsTime = 0;
  fps = 60;
  onMenu: (() => void) | null = null;
  private targetEls: HTMLElement[] = [];
  private pipCount = -1;
  private popupTimer: number | undefined;

  constructor(parent: HTMLElement, bus: EventBus<GameEvents>) {
    this.el = document.createElement("div");
    this.el.id = "hud";
    this.el.innerHTML = `
      <div class="h-vignette"></div>
      <div class="h-frame" aria-hidden="true">
        <i class="f-hex f-l"></i><i class="f-hex f-r"></i>
        <svg class="f-c f-tl" viewBox="0 0 60 60"><path d="M2 40 V2 H40 M8 22 V8 H22"/></svg>
        <svg class="f-c f-tr" viewBox="0 0 60 60"><path d="M58 40 V2 H20 M52 22 V8 H38"/></svg>
        <svg class="f-c f-bl" viewBox="0 0 60 60"><path d="M2 20 V58 H40 M8 38 V52 H22"/></svg>
        <svg class="f-c f-br" viewBox="0 0 60 60"><path d="M58 20 V58 H20 M52 38 V52 H38"/></svg>
        <i class="f-scanline"></i>
      </div>
      <div class="h-sweep" aria-hidden="true"><i></i></div>
      <div class="h-scancard">
        <small class="sc-head">F.R.I.D.A.Y. · <span class="v-sc-state">ANALYSING</span></small>
        <div class="sc-bar"><i class="v-sc-prog"></i></div>
        <b class="v-sc-name"></b>
        <span class="v-sc-cls"></span>
        <div class="sc-row"><span>THREAT</span><b class="v-sc-threat"></b></div>
        <div class="sc-row"><span>HULL</span><b class="v-sc-hull"></b></div>
        <div class="sc-row"><span>RANGE</span><b class="v-sc-dist"></b></div>
        <em class="v-sc-weak"></em>
      </div>
      <div class="h-missile"><i class="v-msl-arrow">▲</i><b>MISSILE LOCK</b><span class="v-msl-d"></span></div>
      <div class="h-telemetry v-tele"></div>
      <div class="h-boot"><b>F.R.I.D.A.Y. ONLINE</b><span>ARC REACTOR · 100%</span><span>FLIGHT STABILISERS · OK</span><span>REPULSORS · OK</span><span>TARGETING · OK</span><span>THREAT ANALYSIS · ACTIVE</span></div>
      <div class="h-hypoxia"></div>
      <div class="h-top">
        <div class="h-compass"><div class="h-tape"></div><div class="h-markers"></div><div class="h-needle"></div></div>
        <div class="h-heading"><b class="v-heading">000</b><span class="v-card">N</span></div>
      </div>
      <div class="h-area"><small>F.R.I.D.A.Y. · ENTERING</small><b class="v-area"></b></div>
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
        <div class="h-rush"><i class="v-rush"></i></div>
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
          <small>OXYGEN</small>
          <div class="d-oxy"><i class="v-oxy"></i></div>
          <b class="v-oxy-t">100%</b>
        </div>
      </div>
      <div class="h-boss"><small class="v-boss-n"></small><div class="b-bar"><i class="v-boss"></i><u class="v-boss-lag"></u></div></div>
      <div class="h-radar"><canvas width="220" height="220"></canvas></div>
      <div class="h-targets"></div>
      <div class="h-dmg"></div>
      <div class="h-blast"></div>
      <div class="h-weap">
        <small>REPULSORS</small><b class="v-rpl">READY</b>
        <small>MICRO-ROCKETS <span class="v-rkt"></span></small><div class="v-pips"></div>
        <small>UNIBEAM · FLARES</small><b class="v-beam">READY · READY</b>
        <small>THREATS NEUTRALISED</small><b class="v-kills">0</b>
        <small class="v-rank-t">HERO RANK</small><b class="v-rank">ROOKIE</b>
        <div class="d-xp"><i class="v-xp"></i></div>
      </div>
      <div class="h-popup"></div>
      <div class="h-banner"><i></i><b class="v-banner"></b><i></i></div>
      <div class="h-toast"><small class="v-toast-t">ACHIEVEMENT UNLOCKED</small><b class="v-toast"></b></div>
      <div class="h-streak"><b class="v-streak"></b><span><i class="v-streakbar"></i></span></div>
      <div class="h-capture">CLICK TO CAPTURE MOUSE · LOOK AROUND</div>
      <div class="h-civ"><small>CIVILIAN · HELMET OFF</small><b class="v-civ">Suit parked</b></div>
      <div class="h-mode"><b class="v-mode">GROUND</b><span class="v-hint"></span></div>
      <div class="h-objective"><small class="v-obj-t"></small><b class="v-obj"></b></div>
      <div class="h-alerts"></div>
      <div class="h-fps"></div>
      <div class="h-dead"><b class="v-dead-t">SUIT DESTROYED</b><span class="v-dead">Returning to Avengers Tower</span></div>
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
    this.text(".v-hint", text);
  }

  /** Enemy brackets with health bars; red diamond = rocket lock. */
  updateTargets(items: HudTarget[], project: (x: number, y: number, z: number) => { x: number; y: number; ok: boolean }): void {
    const root = this.q(".h-targets");
    let n = 0;
    for (const it of items) {
      const p = project(it.x, it.y, it.z);
      if (!p.ok) continue;
      let el = this.targetEls[n];
      if (!el) {
        el = document.createElement("div");
        el.className = "h-target";
        el.innerHTML = "<i></i><b><u></u></b>";
        root.appendChild(el);
        this.targetEls.push(el);
      }
      if (el.style.display) el.style.display = "";
      el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) scale(${it.scale.toFixed(2)})`;
      const cls = `h-target k-${it.kind}${it.locked ? " locked" : ""}${it.assist ? " assist" : ""}${it.tagged ? " tagged" : ""}`;
      if (el.className !== cls) el.className = cls;
      const hp = `scaleX(${Math.max(0, it.hp).toFixed(3)})`;
      const u = el.firstElementChild!.nextElementSibling!.firstElementChild as HTMLElement;
      if (u.style.transform !== hp) u.style.transform = hp;
      n++;
    }
    for (let k = n; k < this.targetEls.length; k++) if (this.targetEls[k].style.display !== "none") this.targetEls[k].style.display = "none";
  }

  private cardShown = false;

  /** Target analysis card beside the primary target (null hides it). */
  setScanCard(c: ScanCard | null): void {
    const el = this.q(".h-scancard");
    if (!c) {
      if (this.cardShown) {
        this.cardShown = false;
        el.classList.remove("on");
      }
      return;
    }
    if (!this.cardShown) {
      this.cardShown = true;
      el.classList.add("on");
    }
    el.style.transform = `translate3d(${c.x.toFixed(0)}px,${c.y.toFixed(0)}px,0)`;
    const done = c.progress >= 1;
    el.classList.toggle("done", done);
    this.text(".v-sc-state", done ? "TARGET ANALYSED" : `ANALYSING ${Math.round(c.progress * 100)}%`);
    this.q(".v-sc-prog").style.transform = `scaleX(${Math.min(1, c.progress).toFixed(2)})`;
    this.text(".v-sc-name", done ? c.name : scramble(c.name, c.progress));
    this.text(".v-sc-cls", done ? c.cls : "· · ·");
    this.text(".v-sc-threat", done ? c.threat : "--");
    this.q(".v-sc-threat").className = `v-sc-threat t-${done ? c.threat.toLowerCase() : "na"}`;
    this.text(".v-sc-hull", `${Math.round(c.hull * 100)}%`);
    this.text(".v-sc-dist", `${Math.round(c.dist)} M`);
    this.text(".v-sc-weak", done ? c.weakness : "");
  }

  /** Area scan: a bright line sweeps down the visor over a grid flash. */
  scanSweep(): void {
    restart(this.q(".h-sweep"), "on");
  }

  /** Live telemetry ticker. */
  setTelemetry(text: string): void {
    this.text(".v-tele", text);
  }

  private missileOn = false;

  /** Incoming-missile warning; `angle` = bearing relative to view (0 = ahead, + = right). */
  setMissile(on: boolean, angle = 0, dist = 0): void {
    if (on !== this.missileOn) {
      this.missileOn = on;
      this.el.classList.toggle("missile", on);
    }
    if (!on) return;
    this.q(".v-msl-arrow").style.transform = `rotate(${((angle * 180) / Math.PI).toFixed(0)}deg)`;
    this.text(".v-msl-d", `${Math.round(dist)} M`);
  }

  /** HUD boot-up: panels flicker on in turn while F.R.I.D.A.Y. runs a systems check. */
  boot(): void {
    this.el.classList.remove("booting");
    requestAnimationFrame(() => {
      this.el.classList.add("booting");
      window.setTimeout(() => this.el.classList.remove("booting"), 2600);
    });
  }

  private bannerTimer: number | undefined;
  private toastTimer: number | undefined;

  /** Big centre banner that sweeps in (objective complete). */
  banner(text: string): void {
    this.text(".v-banner", text);
    const el = this.q(".h-banner");
    restart(el, "on");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => el.classList.remove("on"), 2600);
  }

  /** Toast sliding in at the top (achievements, contracts). */
  toast(name: string, title = "ACHIEVEMENT UNLOCKED"): void {
    this.text(".v-toast-t", title);
    this.text(".v-toast", `★ ${name}`);
    const el = this.q(".h-toast");
    restart(el, "on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove("on"), 3800);
  }

  /** Kill-streak chip: chain length and the fraction of the window left (0..1). */
  setStreak(chain: number, left: number): void {
    const on = chain > 1 && left > 0;
    this.el.classList.toggle("streaking", on);
    if (!on) return;
    this.text(".v-streak", `STREAK ×${chain}`);
    this.q(".v-streakbar").style.transform = `scaleX(${left.toFixed(2)})`;
  }

  /** `reload` = seconds until the rocket pod is rearmed (0 when full). */
  setWeapons(rockets: number, max: number, kills: number, repulsorReady: boolean, reload = 0): void {
    if (this.pipCount !== max) {
      this.pipCount = max;
      this.q(".v-pips").innerHTML = "<i></i>".repeat(max);
    }
    if (rockets !== this.lastPips) {
      this.lastPips = rockets;
      const pips = this.q(".v-pips").children;
      for (let k = 0; k < pips.length; k++) pips[k].classList.toggle("on", k < rockets);
    }
    this.text(".v-rkt", rockets < max ? `· ${Math.ceil(reload)} s` : "");
    this.text(".v-kills", String(kills));
    this.text(".v-rpl", repulsorReady ? "READY" : "LOW POWER");
  }

  /** Rank name and progress (0..1) toward the next rank. */
  setRank(name: string, progress: number): void {
    const el = this.q(".v-rank");
    if (el.textContent !== name) {
      el.textContent = name;
      restart(el, "pulse");
    }
    const xp = `scaleX(${Math.max(0, Math.min(1, progress)).toFixed(3)})`;
    const xe = this.q(".v-xp");
    if (xe.style.transform !== xp) xe.style.transform = xp;
  }

  private bossLag = 1;
  private bossName = "";
  /** Boss health bar (null hides it). The pale "lag" bar trails damage. */
  setBoss(name: string | null, hp: number, dt: number): void {
    const el = this.q(".h-boss");
    if (name === null) {
      el.classList.remove("on");
      this.bossName = "";
      return;
    }
    if (name !== this.bossName) {
      this.bossName = name;
      this.bossLag = hp;
      this.q(".v-boss-n").textContent = name;
    }
    el.classList.add("on");
    this.bossLag = Math.max(hp, this.bossLag - dt * 0.35);
    this.q(".v-boss").style.transform = `scaleX(${hp})`;
    this.q(".v-boss-lag").style.transform = `scaleX(${this.bossLag})`;
  }

  /** Unibeam / flare readiness (seconds of cooldown left, charging flag). */
  setSpecials(beamCooldown: number, charging: boolean, flareCooldown: number): void {
    const b = charging ? "CHARGING" : beamCooldown > 0 ? `${beamCooldown.toFixed(1)}s` : "READY";
    const f = flareCooldown > 0 ? `${flareCooldown.toFixed(1)}s` : "READY";
    const text = `${b} · ${f}`;
    const el = this.q(".v-beam");
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle("charging", charging);
  }

  /** Fade to black with a message (null clears it). */
  showDeath(title: string | null, detail = ""): void {
    this.el.classList.toggle("dead", title !== null);
    if (title !== null) {
      this.q(".v-dead-t").textContent = title;
      this.q(".v-dead").textContent = detail;
    }
  }

  private radarTimer = 0;
  private lastMode = "";

  /**
   * Radar: forward is up, 450 m range. Hostiles are red (triangles fly,
   * squares walk, big ones larger); markers clamp to the edge when far.
   */
  updateRadar(dt: number, p: { pos: { x: number; z: number }; viewYaw: number }, blips: RadarBlip[]): void {
    this.radarTimer -= dt;
    if (this.radarTimer > 0) return;
    this.radarTimer = 1 / 10;
    const canvas = this.q<HTMLCanvasElement>(".h-radar canvas") as unknown as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const S = canvas.width, c = S / 2, R = c - 6, range = 450;
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = "rgba(107,233,255,0.25)";
    ctx.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.arc(c, c, R * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(c, c - R);
    ctx.lineTo(c, c + R);
    ctx.moveTo(c - R, c);
    ctx.lineTo(c + R, c);
    ctx.stroke();
    const sy = Math.sin(p.viewYaw), cy = Math.cos(p.viewYaw);
    for (const b of blips) {
      const dx = b.x - p.pos.x, dz = b.z - p.pos.z;
      let rx = (dx * cy - dz * sy) / range, ry = (dx * sy + dz * cy) / range;
      const d = Math.hypot(rx, ry);
      if (d > 1) {
        if (b.kind === "hostile" || b.kind === "air") continue;
        rx /= d;
        ry /= d;
      }
      const x = c + rx * R, y = c - ry * R;
      const s = b.big ? 7 : 4;
      if (b.kind === "air" || b.kind === "hostile") {
        ctx.fillStyle = "#ff5148";
        ctx.beginPath();
        if (b.kind === "air") {
          ctx.moveTo(x, y - s);
          ctx.lineTo(x + s, y + s);
          ctx.lineTo(x - s, y + s);
        } else ctx.rect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6);
        ctx.fill();
      } else {
        ctx.strokeStyle = b.kind === "event" ? "#ffb547" : b.kind === "suit" ? "#ff8a80" : "#6be9ff";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // You: an arrow pointing up (forward).
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(c, c - 9);
    ctx.lineTo(c + 6, c + 7);
    ctx.lineTo(c, c + 3);
    ctx.lineTo(c - 6, c + 7);
    ctx.fill();
  }

  damageFlash(amount: number): void {
    const el = this.q(".h-dmg");
    // Web Animations: restarts without forcing a layout.
    el.animate([{ opacity: Math.min(0.85, 0.25 + amount / 25) }, { opacity: 0 }], { duration: 600, easing: "ease-out" });
  }

  /** Heat flash from a big nearby explosion (0..1). */
  blastFlash(amount: number): void {
    this.q(".h-blast").animate([{ opacity: Math.min(0.7, amount) }, { opacity: 0 }], { duration: 420, easing: "ease-out" });
  }

  hitMarker(): void {
    const r = this.q(".h-reticle");
    restart(r, "hit");
  }

  popup(text: string): void {
    const el = this.q(".h-popup");
    el.textContent = text;
    restart(el, "on");
    window.clearTimeout(this.popupTimer);
    this.popupTimer = window.setTimeout(() => el.classList.remove("on"), 1300);
  }

  setCapturePrompt(show: boolean): void {
    if (this.el.classList.contains("capture") !== show) this.el.classList.toggle("capture", show);
  }

  setCivilianHint(text: string): void {
    this.text(".v-civ", text);
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
    if (box.classList.contains("on") !== !!title) box.classList.toggle("on", !!title);
    this.text(".v-obj-t", title);
    this.text(".v-obj", detail);
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
    el.innerHTML = `<small>F.R.I.D.A.Y.</small><span></span>`;
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
      this.fpsEl.textContent = `${this.fps.toFixed(0)} FPS · ${this.perfNote}`;
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
    this.text(".v-mach", `MACH ${(p.speed / 343).toFixed(2)} · TOP ${Math.round(p.topSpeed * 3.6)}`);
    this.q(".v-speedbar").style.transform = `scaleY(${Math.min(1, kmh / 1300)})`;
    this.q(".v-rush").style.transform = `scaleX(${p.rush.toFixed(2)})`;
    this.el.classList.toggle("rushing", p.rush > 0.05);
    this.q(".v-alt").textContent = String(Math.round(p.pos.y));
    this.q(".v-altbar").style.transform = `scaleY(${Math.min(1, Math.max(0, p.pos.y) / 2600)})`;
    const vs = p.vel.y;
    this.q(".v-agl").textContent = `AGL ${Math.max(0, Math.round(p.agl))} · VS ${vs >= 0 ? "▲" : "▼"}${Math.abs(vs).toFixed(0)}`;

    const e = p.suit.energy;
    const energyEl = this.q(".v-energy");
    energyEl.style.transform = `scaleX(${e / 100})`;
    energyEl.className = `v-energy ${e < 20 ? "crit" : e < 40 ? "warn" : ""}`;
    this.q(".v-energy-t").textContent = `${Math.round(e)}%`;
    const o = p.suit.oxygen;
    const oxyEl = this.q(".v-oxy");
    oxyEl.style.transform = `scaleX(${o / 100})`;
    oxyEl.className = `v-oxy ${o < 25 ? "crit" : o < 50 ? "warn" : ""}`;
    this.q(".v-oxy-t").textContent = `${Math.round(o)}%`;
    this.q(".h-hypoxia").style.opacity = String(p.suited ? Math.min(1, Math.max(0, (30 - o) / 30)) : 0);
    this.el.classList.toggle("space", p.inSpace);
    this.el.classList.toggle("remote", p.remote);
    this.q(".v-int").textContent = `${Math.round(p.suit.overallIntegrity)}%`;
    for (const part of SUIT_PARTS) {
      const v = p.suit.integrity[part];
      const cls = v > 70 ? "ok" : v > 40 ? "warn" : "crit";
      for (const n of this.el.querySelectorAll(`[data-p="${part}"]`)) n.setAttribute("class", cls);
    }

    const modeText = p.transformTimer > 0 ? (p.transformToSuited ? "SUITING UP" : "ARMOUR OFF") : !p.suited ? (p.falling ? "FALLING" : "ON FOOT") : p.blackout ? "BLACKOUT" : p.freefall ? "FREE FALL" : p.rollTimer > 0 ? "EVADE" : p.mode === "ground" ? (p.landingTimer > 0 ? "TOUCHDOWN" : "GROUND") : p.mode === "hover" ? "HOVER" : p.hypersonic ? "HYPERSONIC" : p.afterburner ? "AFTERBURNER" : "FLIGHT";
    const modeEl = this.q(".v-mode");
    if (modeText !== this.lastMode) {
      this.lastMode = modeText;
      modeEl.textContent = modeText;
      restart(modeEl, "pulse");
    }
    this.el.dataset.mode = p.mode;
    this.el.classList.toggle("civ", !p.suited);
    this.el.classList.toggle("burn", p.afterburner);
    (this.q(".h-vignette") as HTMLElement).style.opacity = String(Math.min(1, Math.max(0, (p.speed - 50) / 80)));
  }
}

/**
 * Re-trigger a CSS animation class on the next frame. (The classic
 * "remove, read offsetWidth, re-add" trick forces a full page layout.)
 */
/** Name half-decoded during analysis: unresolved letters cycle through glyphs. */
function scramble(name: string, progress: number): string {
  const glyphs = "#%&@$*+=<>/\\[]01";
  const solved = Math.floor(name.length * progress);
  let out = "";
  for (let k = 0; k < name.length; k++) {
    const ch = name[k];
    out += k < solved || ch === " " ? ch : glyphs[(k * 7 + Math.floor(performance.now() / 70)) % glyphs.length];
  }
  return out;
}

function restart(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  requestAnimationFrame(() => el.classList.add(cls));
}
