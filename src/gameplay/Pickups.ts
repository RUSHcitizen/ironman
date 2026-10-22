import type { CollisionWorld } from "../world/Collision";
import type { EnemyKind } from "../combat/Enemies";
import { Rng } from "../core/math";

export type PickupKind = "repair" | "power" | "rockets";

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  vy: number;
  /** Height it settles at (just above the surface where it landed). */
  rest: number;
  age: number;
}

/** Seconds a pickup lasts before fading out. */
export const PICKUP_LIFE = 35;
const MAGNET = 11;
const COLLECT = 2.4;
const MAX = 24;

/** Big units always drop loot; small ones sometimes do. */
const BIG: ReadonlySet<string> = new Set(["warbot", "gunship", "tank", "carrier", "spider", "titan", "bomber", "rival", "turret", "courier"]);

/**
 * Salvage dropped by destroyed enemies: repair kits, power cells and rocket
 * packs. They pop out of the wreck, settle just above the surface, bob, and
 * are pulled in once you fly close. Pure simulation.
 */
export class Pickups {
  readonly items: Pickup[] = [];
  private rng = new Rng(4242);

  constructor(private world: CollisionWorld) {}

  drop(kind: PickupKind, x: number, y: number, z: number): Pickup {
    const rest = this.world.surfaceBelow(x, y, z, 0.5, 0) + 1.3;
    const p: Pickup = { kind, x, y, z, vy: 6, rest, age: 0 };
    this.items.push(p);
    if (this.items.length > MAX) this.items.shift();
    return p;
  }

  /** Roll loot for a destroyed enemy. */
  onKill(kind: EnemyKind, x: number, y: number, z: number): void {
    const big = BIG.has(kind);
    const n = big ? 2 : this.rng.chance(kind === "swarmer" || kind === "mine" ? 0.08 : 0.22) ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const r = this.rng.next();
      const type: PickupKind = r < 0.45 ? "repair" : r < 0.8 ? "power" : "rockets";
      this.drop(type, x + this.rng.range(-2, 2), y, z + this.rng.range(-2, 2));
    }
  }

  /**
   * Advance; returns the pickups collected this frame by a collector at
   * (px, py, pz) (null = nobody can collect, e.g. out of the suit).
   */
  update(dt: number, px: number, py: number, pz: number, canCollect: boolean): Pickup[] {
    const got: Pickup[] = [];
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      if (p.age > PICKUP_LIFE) {
        this.items.splice(i, 1);
        continue;
      }
      const dx = px - p.x, dy = py - p.y, dz = pz - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (canCollect && d < MAGNET) {
        // Pulled in, faster the closer it gets.
        const pull = Math.min(d, (18 + (MAGNET - d) * 6) * dt);
        p.x += (dx / (d || 1)) * pull;
        p.y += (dy / (d || 1)) * pull;
        p.z += (dz / (d || 1)) * pull;
        if (d - pull < COLLECT) {
          got.push(p);
          this.items.splice(i, 1);
        }
        continue;
      }
      // Pop up out of the wreck, fall, then settle and hover at rest height.
      if (p.y > p.rest || p.vy > 0) {
        p.vy -= 18 * dt;
        p.y += p.vy * dt;
        if (p.y <= p.rest && p.vy < 0) {
          p.y = p.rest;
          p.vy = 0;
        }
      }
    }
    return got;
  }

  clear(): void {
    this.items.length = 0;
  }
}
