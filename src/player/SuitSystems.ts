import { clamp } from "../core/math";

export type SuitPart = "helmet" | "chest" | "arms" | "legs" | "thrusters";
export const SUIT_PARTS: SuitPart[] = ["helmet", "chest", "arms", "legs", "thrusters"];

/** Suit energy and per-part integrity with passive self-repair. */
export class SuitSystems {
  energy = 100;
  integrity: Record<SuitPart, number> = { helmet: 100, chest: 100, arms: 100, legs: 100, thrusters: 100 };
  private repairDelay = 0;

  get overallIntegrity(): number {
    let s = 0;
    for (const p of SUIT_PARTS) s += this.integrity[p];
    return s / SUIT_PARTS.length;
  }

  drain(amount: number): boolean {
    if (this.energy <= 0) return false;
    this.energy = clamp(this.energy - amount, 0, 100);
    return true;
  }

  charge(amount: number): void {
    this.energy = clamp(this.energy + amount, 0, 100);
  }

  damage(amount: number, focus: SuitPart[] = SUIT_PARTS): void {
    for (const p of focus) this.integrity[p] = clamp(this.integrity[p] - amount, 5, 100);
    this.repairDelay = 5;
  }

  update(dt: number): void {
    if (this.repairDelay > 0) {
      this.repairDelay -= dt;
      return;
    }
    for (const p of SUIT_PARTS) this.integrity[p] = Math.min(100, this.integrity[p] + 1.5 * dt);
  }
}
