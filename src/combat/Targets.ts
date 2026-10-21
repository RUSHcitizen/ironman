import type { V3 } from "./math3";

/** Something enemies can see, shoot and hurt: the suited player or the sentry suit. */
export interface CombatTarget {
  readonly center: V3;
  readonly vel: V3;
  /** Can enemies currently engage this target? */
  readonly targetable: boolean;
  /** Barrel-rolling: shots miss and missile locks break. */
  readonly evading: boolean;
  /** Returns false if the hit was evaded or ignored. */
  takeHit(damage: number): boolean;
  /** EMP: drains suit power (optional). */
  emp?(drain: number): void;
}

/** Nearest engageable target to a point, or null. */
export function nearestTarget(targets: readonly CombatTarget[], at: V3): CombatTarget | null {
  let best: CombatTarget | null = null;
  let bd = Infinity;
  for (const t of targets) {
    if (!t.targetable) continue;
    const c = t.center;
    const d = (c.x - at.x) ** 2 + (c.y - at.y) ** 2 + (c.z - at.z) ** 2;
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}
