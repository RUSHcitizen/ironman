import type { EventBus, GameEvents } from "../core/EventBus";

/** Hero ranks and the XP needed to reach each. */
export const RANKS: [number, string][] = [
  [0, "ROOKIE"],
  [1500, "VIGILANTE"],
  [5000, "DEFENDER"],
  [12000, "AVENGER"],
  [25000, "GUARDIAN"],
  [50000, "LEGEND"],
  [100000, "INVINCIBLE"],
];

const KEY = "ironman.progress.v1";

export function rankFor(xp: number): { index: number; name: string; next: number | null } {
  let index = 0;
  for (let k = 0; k < RANKS.length; k++) if (xp >= RANKS[k][0]) index = k;
  return { index, name: RANKS[index][1], next: index + 1 < RANKS.length ? RANKS[index + 1][0] : null };
}

/**
 * Persistent hero XP: kills score points, missions give a bonus. Ranking up
 * gets a F.R.I.D.A.Y. call-out. Saved in localStorage (fails soft).
 */
export class Progress {
  xp = 0;

  constructor(private bus?: EventBus<GameEvents>) {
    try {
      const v = Number(JSON.parse(localStorage.getItem(KEY) ?? "{}").xp);
      if (Number.isFinite(v) && v > 0) this.xp = v;
    } catch {
      /* storage unavailable: progress lasts for this session only */
    }
  }

  get rank(): ReturnType<typeof rankFor> {
    return rankFor(this.xp);
  }

  add(points: number): void {
    const before = this.rank.index;
    this.xp += points;
    const r = this.rank;
    if (r.index > before) {
      this.bus?.emit("alert", { text: `Rank up, boss: ${r.name}`, level: "success", ttl: 5 });
      this.bus?.emit("rankUp", { name: r.name });
    }
    try {
      localStorage.setItem(KEY, JSON.stringify({ xp: this.xp }));
    } catch {
      /* ignore */
    }
  }
}
