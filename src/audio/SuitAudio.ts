import type { EventBus, GameEvents } from "../core/EventBus";
import type { PlayerController } from "../player/PlayerController";

/**
 * Fully synthesised audio (no files): filtered noise for thrusters & wind and
 * short blips for F.R.I.D.A.Y. alerts. Must be unlocked from a user gesture (iOS).
 */
export class SuitAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private thrustGain: GainNode | null = null;
  private thrustFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private volume = 0.6;
  private listener = { x: 0, y: 0, z: 0 };
  private noiseBuf: AudioBuffer | null = null;

  constructor(bus: EventBus<GameEvents>) {
    bus.on("alert", (a) => this.blip(a.level === "critical" ? 330 : a.level === "warn" ? 520 : a.level === "success" ? 880 : 700));
    bus.on("impact", (e) => this.thud(Math.min(1, e.speed / 80)));
    bus.on("landed", (e) => this.thud(e.hard ? 0.8 : 0.3));
    bus.on("weapon", (w) => {
      const v = this.atten(w);
      if (w.kind === "repulsor") this.zap(1400, 380, 0.16, "sawtooth", 0.09);
      else if (w.kind === "rocket") this.noiseBurst(0.35, 2200, 0.25, false);
      else if (w.kind === "enemyBolt") this.zap(520, 180, 0.12, "square", 0.05 * v);
      else if (w.kind === "missile") this.noiseBurst(0.5, 900, 0.2 * v, false);
      else if (w.kind === "laser") this.zap(2400, 90, 0.5, "sawtooth", 0.3 * v);
    });
    bus.on("explosion", (e) => this.noiseBurst(0.5 + e.size * 0.08, 500 + e.size * 40, Math.min(0.9, 0.25 + e.size * 0.06) * this.atten(e), true));
    bus.on("playerHit", () => this.thud(0.45));
    bus.on("sonicBoom", () => {
      this.thud(1);
      this.noiseBurst(0.9, 300, 0.7, true);
    });
    bus.on("boost", () => this.noiseBurst(0.45, 1500, 0.3, false));
    bus.on("roll", () => this.zap(300, 900, 0.3, "sine", 0.06));
    bus.on("nearMiss", () => this.blip(1100));
    bus.on("suitTransform", (e) => {
      if (!e.toSuited) for (let k = 0; k < 4; k++) setTimeout(() => this.zap(700 - k * 80, 300, 0.08, "square", 0.04), k * 90);
    });
    // Metallic clank as each armour section clamps on.
    bus.on("suitLatch", () => {
      this.zap(320 + Math.random() * 80, 140, 0.09, "square", 0.08);
      this.noiseBurst(0.12, 3200, 0.12, false);
    });
    bus.on("trick", () => this.noiseBurst(0.5, 1200, 0.22, false));
    // Thunder: arrives after the flash (speed of sound), quieter far away.
    bus.on("thunder", (e) => {
      const v = Math.max(0.15, 1 - e.distance / 1500);
      setTimeout(() => {
        this.noiseBurst(2.2, 140, 0.55 * v, true);
        setTimeout(() => this.noiseBurst(1.6, 90, 0.4 * v, true), 260);
      }, (e.distance / 343) * 1000);
    });
    // F.R.I.D.A.Y. scan: a rising sweep, then a result ping (lower when hostiles are found).
    bus.on("scan", (e) => {
      this.zap(300, 2400, 0.9, "sine", 0.06);
      setTimeout(() => this.blip(e.found > 0 ? 660 : 990), 950);
    });
    bus.on("missileWarn", () => this.blip(1760));
    // Superhero landing: a deep slam with a rumble.
    bus.on("superLanding", () => {
      this.thud(1);
      this.noiseBurst(0.7, 260, 0.6, true);
    });
    // Pickups: a bright rising chime.
    bus.on("pickup", () => {
      this.blip(990);
      setTimeout(() => this.blip(1480), 70);
    });
    // Kill streak call-outs climb in pitch.
    bus.on("streak", (e) => this.zap(500 + e.chain * 90, 1400 + e.chain * 120, 0.18, "triangle", 0.07));
    // Unibeam: a rising whine while charging, then a deep blast.
    bus.on("unibeam", (e) => {
      if (e.charging) this.zap(200, 1800, 0.45, "sawtooth", 0.08);
      else {
        this.zap(900, 60, 0.9, "sawtooth", 0.25);
        this.noiseBurst(0.8, 600, 0.45, true);
      }
    });
    bus.on("flares", () => {
      for (let k = 0; k < 5; k++) setTimeout(() => this.noiseBurst(0.18, 2600, 0.12, false), k * 60);
    });
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Call from a user gesture handler. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) this.build();
      void this.ctx?.resume();
    } catch {
      this.ctx = null; // audio unsupported: stay silent
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.05);
  }

  private build(): void {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 0.8;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let k = 0; k < len; k++) {
      // Brown-ish noise: smoother and less harsh than white noise.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[k] = last * 3.5;
    }
    this.noiseBuf = buf;
    const mkNoise = () => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start();
      return src;
    };
    this.thrustFilter = ctx.createBiquadFilter();
    this.thrustFilter.type = "lowpass";
    this.thrustFilter.frequency.value = 300;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    mkNoise().connect(this.thrustFilter).connect(this.thrustGain).connect(this.master);

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    mkNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);
  }

  /** Distance attenuation relative to the player. */
  private atten(at: { x: number; y: number; z: number }): number {
    const d = Math.hypot(at.x - this.listener.x, at.y - this.listener.y, at.z - this.listener.z);
    return 1 / (1 + (d / 60) * (d / 60));
  }

  update(p: PlayerController): void {
    this.listener.x = p.pos.x;
    this.listener.y = p.pos.y;
    this.listener.z = p.pos.z;
    const ctx = this.ctx;
    if (!ctx || !this.thrustGain || !this.thrustFilter || !this.windGain || !this.windFilter) return;
    const t = ctx.currentTime;
    const thrust = p.mode === "ground" || !p.suited ? 0 : p.thrust;
    this.thrustGain.gain.setTargetAtTime(thrust * 0.55, t, 0.08);
    this.thrustFilter.frequency.setTargetAtTime(220 + thrust * 900 + (p.afterburner ? 900 : 0), t, 0.1);
    const s = Math.min(1, p.speed / 320);
    this.windGain.gain.setTargetAtTime(s * s * 0.45, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(400 + s * 1400, t, 0.2);
  }

  private blip(freq: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.12);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }

  private zap(f0: number, f1: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running" || gain < 0.002) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(t + dur + 0.02);
  }

  /** Filtered noise burst: explosions (lowpass, falling) or whooshes (bandpass). */
  private noiseBurst(dur: number, freq: number, gain: number, boom: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf || ctx.state !== "running" || gain < 0.003) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = boom ? "lowpass" : "bandpass";
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(boom ? 60 : freq * 0.3, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * 2.5, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private thud(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(90, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.3);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.5 * strength + 0.01, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  }
}
