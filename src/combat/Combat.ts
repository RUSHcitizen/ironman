import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import type { PlayerController } from "../player/PlayerController";
import type { InputState } from "../input/InputState";
import { ENEMY_STATS, type Enemy, type EnemyManager } from "./Enemies";
import type { ProjectileSystem } from "./Projectiles";
import { dist, norm, type V3 } from "./math3";

export const MAX_ROCKETS = 8;
const LOCK_CONE = 0.4; // ~23 degrees
const LOCK_RANGE = 450;

/**
 * Player weapons: palm repulsors (hold) and arm-mounted homing micro-rockets
 * with multi-target lock-on. Aim comes from the camera ray with aim assist.
 */
export class Combat {
  rockets = MAX_ROCKETS;
  /** Enemies currently inside the lock-on cone (max 4), best first. */
  locks: Enemy[] = [];
  /** Enemy the repulsors will snap to (aim assist). */
  assistTarget: Enemy | null = null;
  private repulsorCooldown = 0;
  private rocketRegen = 0;
  private side = 1;
  private lockTimer = 0;
  aimAssist = 0.07; // radians; larger on touch

  constructor(
    private world: CollisionWorld,
    private enemies: EnemyManager,
    private projectiles: ProjectileSystem,
    private bus?: EventBus<GameEvents>,
  ) {}

  refill(): void {
    this.rockets = MAX_ROCKETS;
  }

  update(dt: number, input: InputState, p: PlayerController, camPos: V3): void {
    this.repulsorCooldown -= dt;
    this.rocketRegen += dt;
    if (this.rocketRegen > 1.4) {
      this.rocketRegen = 0;
      this.rockets = Math.min(MAX_ROCKETS, this.rockets + 1);
    }
    const armed = p.suited && p.transformTimer <= 0;
    const aim = aimDirection(p);

    this.lockTimer -= dt;
    if (this.lockTimer <= 0) {
      this.lockTimer = 0.1;
      this.locks = armed ? this.findLocks(camPos, aim) : [];
      this.assistTarget = this.locks.find((e) => this.angleTo(camPos, aim, e) < this.aimAssist) ?? null;
    }
    if (!armed) return;

    if (input.fire && this.repulsorCooldown <= 0 && p.suit.energy > 1) {
      this.repulsorCooldown = 0.15;
      p.suit.drain(0.6);
      p.aimTimer = 0.7;
      const from = this.muzzle(p, aim, this.side);
      this.side = p.mode === "flight" ? -this.side : 1;
      const target = this.assistTarget ? this.leadPoint(from, this.assistTarget, 240) : this.aimPoint(camPos, aim);
      this.projectiles.playerBolt(from, norm({ x: target.x - from.x, y: target.y - from.y, z: target.z - from.z }));
      if (this.assistTarget) this.enemies.threaten(this.assistTarget);
      this.bus?.emit("weapon", { kind: "repulsor", ...from });
    }

    if (input.rockets) {
      if (this.rockets <= 0) {
        this.bus?.emit("alert", { text: "Micro-rockets reloading", level: "warn", ttl: 2 });
      } else {
        const n = Math.min(this.rockets, this.locks.length > 0 ? 4 : 2);
        this.rockets -= n;
        p.rocketTimer = 0.8;
        p.aimTimer = Math.max(p.aimTimer, 0.5);
        const r = { x: Math.cos(p.viewYaw), y: 0, z: -Math.sin(p.viewYaw) };
        for (let k = 0; k < n; k++) {
          const side = k % 2 === 0 ? 1 : -1;
          const from = this.muzzle(p, aim, side);
          const target = this.locks.length > 0 ? this.locks[k % this.locks.length] : null;
          // Launch slightly up and outward, then the rockets curve in.
          const spread = 0.35 + 0.15 * Math.floor(k / 2);
          const dir = { x: aim.x + r.x * side * spread, y: aim.y + 0.3, z: aim.z + r.z * side * spread };
          this.projectiles.playerRocket(from, dir, target);
          if (target) this.enemies.threaten(target);
        }
        this.bus?.emit("weapon", { kind: "rocket", ...p.center });
      }
    }
  }

  private angleTo(camPos: V3, aim: V3, e: Enemy): number {
    const c = this.enemies.center(e);
    const d = norm({ x: c.x - camPos.x, y: c.y - camPos.y, z: c.z - camPos.z });
    return Math.acos(Math.max(-1, Math.min(1, d.x * aim.x + d.y * aim.y + d.z * aim.z)));
  }

  private findLocks(camPos: V3, aim: V3): Enemy[] {
    const cands: [number, Enemy][] = [];
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const c = this.enemies.center(e);
      const d = dist(c, camPos);
      if (d > LOCK_RANGE) continue;
      // Generous cone for small/far targets.
      const a = this.angleTo(camPos, aim, e) - Math.atan(ENEMY_STATS[e.kind].radius / Math.max(1, d));
      if (a < LOCK_CONE) cands.push([a, e]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const out: Enemy[] = [];
    for (const [, e] of cands) {
      if (out.length >= 4) break;
      const c = this.enemies.center(e);
      const d = dist(c, camPos);
      const dir = norm({ x: c.x - camPos.x, y: c.y - camPos.y, z: c.z - camPos.z });
      if (this.world.raycast(camPos.x, camPos.y, camPos.z, dir.x, dir.y, dir.z, d - 1) === Infinity) out.push(e);
    }
    return out;
  }

  /** Where the camera ray meets the world (or a far point). */
  private aimPoint(camPos: V3, aim: V3): V3 {
    const hit = this.world.raycast(camPos.x, camPos.y, camPos.z, aim.x, aim.y, aim.z, 400);
    const d = Math.min(hit, 400);
    return { x: camPos.x + aim.x * d, y: camPos.y + aim.y * d, z: camPos.z + aim.z * d };
  }

  private leadPoint(from: V3, e: Enemy, speed: number): V3 {
    const c = this.enemies.center(e);
    const t = dist(from, c) / speed;
    return { x: c.x + e.vx * t, y: c.y + e.vy * t, z: c.z + e.vz * t };
  }

  /** Approximate palm / forearm launcher position. */
  private muzzle(p: PlayerController, aim: V3, side: number): V3 {
    const c = p.center;
    const rx = Math.cos(p.viewYaw), rz = -Math.sin(p.viewYaw);
    const up = p.mode === "flight" ? 0 : 0.35;
    return { x: c.x + rx * 0.5 * side + aim.x * 0.9, y: c.y + up + aim.y * 0.9, z: c.z + rz * 0.5 * side + aim.z * 0.9 };
  }
}

/** Unit vector of the camera/aim direction. */
export function aimDirection(p: PlayerController): V3 {
  const cp = Math.cos(p.viewPitch);
  return { x: Math.sin(p.viewYaw) * cp, y: Math.sin(p.viewPitch), z: Math.cos(p.viewYaw) * cp };
}
