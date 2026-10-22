/**
 * Kill streaks: kills in quick succession chain into a streak with a call-out
 * and an XP multiplier. Pure logic (times are passed in).
 */
export const STREAK_WINDOW = 3.5;

const LABELS: [number, string][] = [
  [15, "GODLIKE"],
  [10, "UNSTOPPABLE"],
  [7, "RAMPAGE"],
  [5, "MULTI KILL"],
  [4, "QUAD KILL"],
  [3, "TRIPLE KILL"],
  [2, "DOUBLE KILL"],
];

export interface StreakResult {
  chain: number;
  /** Call-out for this kill, or null when the streak did not grow to a new label. */
  label: string | null;
  /** XP multiplier for this kill (1 = no bonus, up to 3). */
  multiplier: number;
}

export class KillStreak {
  chain = 0;
  best = 0;
  private last = -Infinity;

  /** Register a kill at time `now` (seconds). */
  kill(now: number): StreakResult {
    this.chain = now - this.last <= STREAK_WINDOW ? this.chain + 1 : 1;
    this.last = now;
    this.best = Math.max(this.best, this.chain);
    const hit = LABELS.find(([n]) => n === this.chain);
    return { chain: this.chain, label: hit ? hit[1] : null, multiplier: 1 + Math.min(2, (this.chain - 1) * 0.25) };
  }

  /** Seconds left before the streak lapses (0 when none). */
  remaining(now: number): number {
    return this.chain > 1 ? Math.max(0, STREAK_WINDOW - (now - this.last)) : 0;
  }
}
