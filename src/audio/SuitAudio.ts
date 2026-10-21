import type { EventBus, GameEvents } from "../core/EventBus";
import type { PlayerController } from "../player/PlayerController";

/**
 * Fully synthesised audio (no files): filtered noise for thrusters & wind and
 * short blips for ARIA alerts. Must be unlocked from a user gesture (iOS).
 */
export class SuitAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private thrustGain: GainNode | null = null;
  private thrustFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private volume = 0.6;

  constructor(bus: EventBus<GameEvents>) {
    bus.on("alert", (a) => this.blip(a.level === "critical" ? 330 : a.level === "warn" ? 520 : a.level === "success" ? 880 : 700));
    bus.on("impact", (e) => this.thud(Math.min(1, e.speed / 80)));
    bus.on("landed", (e) => this.thud(e.hard ? 0.8 : 0.3));
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

  update(p: PlayerController): void {
    const ctx = this.ctx;
    if (!ctx || !this.thrustGain || !this.thrustFilter || !this.windGain || !this.windFilter) return;
    const t = ctx.currentTime;
    const thrust = p.mode === "ground" ? 0 : p.thrust;
    this.thrustGain.gain.setTargetAtTime(thrust * 0.55, t, 0.08);
    this.thrustFilter.frequency.setTargetAtTime(220 + thrust * 900 + (p.afterburner ? 900 : 0), t, 0.1);
    const s = Math.min(1, p.speed / 125);
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
