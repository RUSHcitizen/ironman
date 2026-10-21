import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import { nearestTarget, type CombatTarget } from "./Targets";
import { ENEMY_STATS, type Enemy, type EnemyManager, type EnemyWeapons } from "./Enemies";
import { dist, norm, segmentPointDistance, steer, type V3 } from "./math3";

export type ProjectileKind = "bolt" | "enemyBolt" | "rocket" | "missile";

export interface Projectile {
  kind: ProjectileKind;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  maxSpeed: number;
  accel: number;
  turn: number;
  life: number;
  damage: number;
  target: Enemy | null;
  /** Enemy missiles: the friendly target being homed on (null = lock lost). */
  homing: CombatTarget | null;
  trail: number;
  alive: boolean;
}

export type FxKind = "fire" | "shock" | "sonic" | "spark";

export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  z: number;
  size: number;
  t: number;
  life: number;
  /** Orientation for rings (yaw/pitch of the ring normal). */
  yaw: number;
  pitch: number;
}

export interface Beam {
  a: V3;
  b: V3;
  kind: "telegraph" | "laser";
  t: number;
  life: number;
}

export interface Puff {
  x: number;
  y: number;
  z: number;
  t: number;
  life: number;
  hot: boolean;
}

const MAX_PROJECTILES = 260;
const MAX_PUFFS = 320;

/**
 * All projectiles and impact effects. Pure simulation; ProjectileRenderer
 * draws the arrays each frame with thin instances.
 */
export class ProjectileSystem implements EnemyWeapons {
  readonly projectiles: Projectile[] = [];
  readonly fx: Fx[] = [];
  readonly beams: Beam[] = [];
  readonly puffs: Puff[] = [];
  /** Player hits this frame (for the HUD hit marker). */
  hitsThisFrame = 0;

  constructor(
    private world: CollisionWorld,
    private enemies: EnemyManager,
    /** Friendly targets enemies can hit (player, sentry suit). */
    readonly targets: CombatTarget[],
    private bus?: EventBus<GameEvents>,
  ) {
    enemies.weapons = this;
  }

  clearHostile(): void {
    for (const p of this.projectiles) if (p.kind === "enemyBolt" || p.kind === "missile") p.alive = false;
  }

  private add(p: Omit<Projectile, "alive" | "trail">): Projectile | null {
    if (this.projectiles.length >= MAX_PROJECTILES) return null;
    const proj = { ...p, alive: true, trail: 0 };
    this.projectiles.push(proj);
    return proj;
  }

  /** Player repulsor bolt. */
  playerBolt(from: V3, dir: V3): void {
    const d = norm(dir);
    this.add({ kind: "bolt", ...from, dx: d.x, dy: d.y, dz: d.z, speed: 240, maxSpeed: 240, accel: 0, turn: 0, life: 1.6, damage: 10, target: null, homing: null });
    this.fx.push({ kind: "spark", ...from, size: 0.9, t: 0, life: 0.08, yaw: 0, pitch: 0 });
  }

  /** Player arm-launched micro-rocket, homing on `target` if given. */
  playerRocket(from: V3, dir: V3, target: Enemy | null): void {
    const d = norm(dir);
    this.add({ kind: "rocket", ...from, dx: d.x, dy: d.y, dz: d.z, speed: 45, maxSpeed: 160, accel: 220, turn: 5.5, life: 4, damage: 40, target, homing: null });
  }

  // --- EnemyWeapons -------------------------------------------------------

  bolt(from: V3, dir: V3, speed: number, damage: number): void {
    const d = norm(dir);
    this.add({ kind: "enemyBolt", ...from, dx: d.x, dy: d.y, dz: d.z, speed, maxSpeed: speed, accel: 0, turn: 0, life: 4, damage, target: null, homing: null });
    this.bus?.emit("weapon", { kind: "enemyBolt", ...from });
  }

  missile(from: V3, dir: V3, damage: number): void {
    const d = norm(dir);
    const homing = nearestTarget(this.targets, from);
    this.add({ kind: "missile", ...from, dx: d.x, dy: d.y, dz: d.z, speed: 20, maxSpeed: 58, accel: 30, turn: 1.9, life: 7, damage, target: null, homing });
    this.bus?.emit("weapon", { kind: "missile", ...from });
  }

  explode(at: V3, size: number, damage: number, hurtsPlayer: boolean): void {
    this.fx.push({ kind: "fire", ...at, size, t: 0, life: 0.55 + size * 0.03, yaw: 0, pitch: 0 });
    this.bus?.emit("explosion", { ...at, size });
    if (damage <= 0) return;
    const radius = size * 1.4;
    if (hurtsPlayer) {
      for (const t of this.targets) {
        if (!t.targetable) continue;
        const d = dist(at, t.center);
        if (d < radius) t.takeHit(damage * (1 - (d / radius) * 0.6));
      }
    } else {
      for (const e of this.enemies.enemies) {
        if (!e.alive) continue;
        const d = dist(at, this.enemies.center(e)) - ENEMY_STATS[e.kind].radius;
        if (d < radius) this.enemies.damage(e, damage * (1 - Math.max(0, d / radius) * 0.6));
      }
    }
  }

  beam(from: V3, to: V3, kind: "telegraph" | "laser"): void {
    this.beams.push({ a: { ...from }, b: { ...to }, kind, t: 0, life: kind === "laser" ? 0.35 : 0 });
  }

  shockwave(at: V3, radius: number): void {
    this.fx.push({ kind: "shock", ...at, size: radius, t: 0, life: 0.6, yaw: 0, pitch: 0 });
    this.bus?.emit("explosion", { ...at, size: radius * 0.6 });
  }

  sonicBoom(at: V3, yaw: number, pitch: number): void {
    this.fx.push({ kind: "sonic", ...at, size: 14, t: 0, life: 0.7, yaw, pitch });
  }

  // ------------------------------------------------------------------------

  update(dt: number): void {
    this.hitsThisFrame = 0;
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.life -= dt;
      if (pr.life <= 0) {
        if (pr.kind === "rocket" || pr.kind === "missile") this.detonate(pr);
        pr.alive = false;
        continue;
      }
      pr.speed = Math.min(pr.maxSpeed, pr.speed + pr.accel * dt);
      // Homing.
      if (pr.kind === "rocket" && pr.target) {
        if (!pr.target.alive) pr.target = null;
        else {
          const c = this.enemies.center(pr.target);
          const d = steer({ x: pr.dx, y: pr.dy, z: pr.dz }, norm({ x: c.x - pr.x, y: c.y - pr.y, z: c.z - pr.z }), pr.turn * dt);
          pr.dx = d.x;
          pr.dy = d.y;
          pr.dz = d.z;
        }
      } else if (pr.kind === "missile" && pr.homing) {
        const h = pr.homing;
        if (h.evading || !h.targetable) {
          // Barrel roll (or leaving the fight) breaks the lock.
          pr.homing = null;
          if (h.evading) this.bus?.emit("alert", { text: "Missile lock broken", level: "success", ttl: 2 });
        } else {
          const pc = h.center;
          const d = steer({ x: pr.dx, y: pr.dy, z: pr.dz }, norm({ x: pc.x - pr.x, y: pc.y - pr.y, z: pc.z - pr.z }), pr.turn * dt);
          pr.dx = d.x;
          pr.dy = d.y;
          pr.dz = d.z;
        }
      }
      const step = pr.speed * dt;
      const from = { x: pr.x, y: pr.y, z: pr.z };
      const to = { x: pr.x + pr.dx * step, y: pr.y + pr.dy * step, z: pr.z + pr.dz * step };

      // Smoke / plasma trails for rockets.
      if (pr.kind === "rocket" || pr.kind === "missile") {
        pr.trail -= dt;
        if (pr.trail <= 0 && this.puffs.length < MAX_PUFFS) {
          pr.trail = 0.04;
          this.puffs.push({ ...from, t: 0, life: pr.kind === "rocket" ? 0.5 : 0.8, hot: pr.kind === "rocket" });
        }
      }

      if (this.collide(pr, from, to, step)) {
        pr.alive = false;
        continue;
      }
      pr.x = to.x;
      pr.y = to.y;
      pr.z = to.z;
    }
    compact(this.projectiles, (x) => x.alive);

    for (const f of this.fx) f.t += dt;
    compact(this.fx, (f) => f.t < f.life);
    for (const b of this.beams) b.t += dt;
    compact(this.beams, (b) => b.t < b.life || (b.kind === "telegraph" && b.t === dt));
    for (const pf of this.puffs) pf.t += dt;
    compact(this.puffs, (pf) => pf.t < pf.life);
  }

  /** Returns true if the projectile was consumed. */
  private collide(pr: Projectile, from: V3, to: V3, step: number): boolean {
    if (pr.kind === "bolt" || pr.kind === "rocket") {
      // Enemies.
      for (const e of this.enemies.enemies) {
        if (!e.alive) continue;
        const c = this.enemies.center(e);
        const r = ENEMY_STATS[e.kind].radius + (pr.kind === "rocket" ? 0.6 : 0.25);
        if (segmentPointDistance(from, to, c) < r) {
          this.hitsThisFrame++;
          if (pr.kind === "rocket") this.detonate(pr, to);
          else {
            this.enemies.damage(e, pr.damage);
            this.fx.push({ kind: "spark", ...to, size: 1.6, t: 0, life: 0.15, yaw: 0, pitch: 0 });
          }
          return true;
        }
      }
      // Shoot down hostile missiles.
      for (const m of this.projectiles) {
        if (!m.alive || m.kind !== "missile") continue;
        if (segmentPointDistance(from, to, m) < 1.3) {
          m.alive = false;
          this.hitsThisFrame++;
          this.explode({ x: m.x, y: m.y, z: m.z }, 3, 0, false);
          if (pr.kind === "rocket") this.detonate(pr, to);
          return true;
        }
      }
    } else {
      for (const t of this.targets) {
        if (!t.targetable) continue;
        if (segmentPointDistance(from, to, t.center) < (pr.kind === "missile" ? 1.6 : 1.05)) {
          if (pr.kind === "missile") this.detonate(pr, to);
          else t.takeHit(pr.damage);
          return true;
        }
      }
    }
    // World geometry.
    const len0 = Math.max(1e-6, step);
    const hit = this.world.raycast(from.x, from.y, from.z, pr.dx, pr.dy, pr.dz, len0);
    if (hit < len0) {
      const at = { x: from.x + pr.dx * hit, y: from.y + pr.dy * hit, z: from.z + pr.dz * hit };
      if (pr.kind === "rocket" || pr.kind === "missile") this.detonate(pr, at);
      else this.fx.push({ kind: "spark", ...at, size: pr.kind === "bolt" ? 1.4 : 0.9, t: 0, life: 0.12, yaw: 0, pitch: 0 });
      return true;
    }
    return false;
  }

  private detonate(pr: Projectile, at: V3 = pr): void {
    if (pr.kind === "rocket") this.explode(at, 4.5, pr.damage, false);
    else this.explode(at, 3.5, pr.damage, true);
  }
}

function compact<T>(arr: T[], keep: (x: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < arr.length; r++) if (keep(arr[r])) arr[w++] = arr[r];
  arr.length = w;
}

