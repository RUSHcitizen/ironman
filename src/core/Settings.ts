export type Quality = "low" | "medium" | "high";

export interface QualityPreset {
  /** Max render pixel ratio (render resolution = CSS px * this, capped by devicePixelRatio). */
  pixelRatio: number;
  /** Distance at which building chunks stop rendering. */
  viewDistance: number;
  /** Distance at which props (street furniture) stop rendering. */
  propDistance: number;
  shadows: boolean;
  particles: number;
  cars: number;
  pedestrians: number;
  antialias: boolean;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 1, viewDistance: 520, propDistance: 140, shadows: false, particles: 0, cars: 18, pedestrians: 16, antialias: false },
  medium: { pixelRatio: 1.5, viewDistance: 800, propDistance: 220, shadows: false, particles: 120, cars: 32, pedestrians: 36, antialias: true },
  high: { pixelRatio: 2, viewDistance: 1100, propDistance: 320, shadows: true, particles: 260, cars: 48, pedestrians: 64, antialias: true },
};

export interface SettingsData {
  quality: Quality;
  autoQuality: boolean;
  lookSensitivity: number; // 0.25 .. 3
  touchSensitivity: number; // 0.25 .. 3
  invertY: boolean;
  volume: number; // 0..1
  showFps: boolean;
}

const KEY = "aegis.settings.v1";

export function defaultSettings(isMobile: boolean): SettingsData {
  return {
    quality: isMobile ? "low" : "medium",
    autoQuality: true,
    lookSensitivity: 1,
    touchSensitivity: 1,
    invertY: false,
    volume: 0.6,
    showFps: false,
  };
}

export class Settings {
  data: SettingsData;
  private listeners = new Set<(s: SettingsData) => void>();

  constructor(isMobile: boolean) {
    const defaults = defaultSettings(isMobile);
    this.data = { ...defaults, ...Settings.load() };
    if (!(this.data.quality in QUALITY_PRESETS)) this.data.quality = defaults.quality;
  }

  private static load(): Partial<SettingsData> {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Partial<SettingsData>) : {};
    } catch {
      return {};
    }
  }

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.data.quality];
  }

  update(patch: Partial<SettingsData>): void {
    this.data = { ...this.data, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable (private mode) - settings stay in memory */
    }
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn: (s: SettingsData) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
