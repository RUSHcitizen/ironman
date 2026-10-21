import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import { nearestTarget, type CombatTarget } from "./Targets";
import { ENEMY_STATS, type Enemy, type EnemyManager, type EnemyWeapons } from "./Enemies";
import { dist, norm, segmentPointDistance, steer, type V3 } from "./math3";

export type ProjectileKind = "bolt" | "enemyBolt" | "rocket" | "missile" | "shell";

const SHELL_GRAVITY = 14;

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
  /** Flare this missile has been decoyed onto. */
  decoy?: Particle | null;
  trail: number;
  alive: boolean;
}

export type FxKind = "fire" | "shock" | "sonic" | "spark" | "dust" | "charge";

/** Free-flying physical particles: wreckage, flares, dust and embers. */
export interface Particle {
  kind: "debris" | "flare" | "dust" | "ember" | "vapour";
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  size: number;
  /** Tumble (debris). */
  spin: number;
  smoke: number;
}

const MAX_PARTICLES = 420;

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
  kind: "telegraph" | "laser" | "unibeam";
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
  readonly particles: Particle[] = [];
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

  beam(from: V3, to: V3, kind: "telegraph" | "laser" | "unibeam"): void {
    this.beams.push({ a: { ...from }, b: { ...to }, kind, t: 0, life: kind === "laser" ? 0.35 : kind === "unibeam" ? 0.55 : 0 });
  }

  private particle(p: Omit<Particle, "t" | "spin" | "smoke">): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ ...p, t: 0, spin: Math.random() * 6, smoke: Math.random() * 0.1 });
  }

  /** Wreckage chunks and embers flung out of a destroyed unit. */
  wreck(at: V3, size: number): void {
    const n = Math.min(14, 4 + Math.round(size * 1.2));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, up = Math.random();
      const sp = 6 + Math.random() * (8 + size * 2);
      this.particle({ kind: "debris", ...at, vx: Math.cos(a) * sp, vy: 4 + up * sp, vz: Math.sin(a) * sp, life: 2.2 + Math.random() * 1.6, size: 0.15 + Math.random() * size * 0.07 });
    }
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 10 + Math.random() * 18;
      this.particle({ kind: "ember", ...at, vx: Math.cos(a) * sp, vy: Math.random() * sp, vz: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.6, size: 0.25 });
    }
  }

  /** One contrail puff (strength 0..1 sets its opacity). */
  vapour(at: V3, strength: number): void {
    this.particle({ kind: "vapour", ...at, vx: 0, vy: 0, vz: 0, life: 0.9, size: strength });
  }

  /** Ring of dust kicked up by a landing or take-off. */
  dust(at: V3, strength: number): void {
    const n = Math.round(6 + strength * 14);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 3 + strength * 9 * (0.6 + Math.random() * 0.6);
      this.particle({ kind: "dust", x: at.x + Math.cos(a) * 0.6, y: at.y + 0.2, z: at.z + Math.sin(a) * 0.6, vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 1.5, vz: Math.sin(a) * sp, life: 0.9 + strength * 0.8, size: 0.8 + strength * 1.2 });
    }
    if (strength > 0.6) this.fx.push({ kind: "dust", ...at, size: 6 + strength * 8, t: 0, life: 0.6, yaw: 0, pitch: 0 });
  }

  /**
   * Countermeasure flares: burning decoys spray out behind the target and
   * every missile homing on it within range chases one instead.
   */
  flares(from: V3, vel: V3, target: CombatTarget): number {
    const made: Particle[] = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const before = this.particles.length;
      this.particle({ kind: "flare", ...from, vx: vel.x * 0.4 + Math.cos(a) * 16, vy: vel.y * 0.4 + 4 + Math.random() * 6, vz: vel.z * 0.4 + Math.sin(a) * 16, life: 3.2, size: 0.35 });
      if (this.particles.length > before) made.push(this.particles[this.particles.length - 1]);
    }
    let broken = 0;
    for (const m of this.projectiles) {
      if (!m.alive || m.kind !== "missile" || m.homing !== target || made.length === 0) continue;
      if (dist(m, from) > 300) continue;
      m.homing = null;
      m.decoy = made[broken % made.length];
      broken++;
    }
    return broken;
  }

  shell(from: V3, vel: V3, damage: number): void {
    const speed = Math.hypot(vel.x, vel.y, vel.z) || 1;
    this.add({ kind: "shell", ...from, dx: vel.x / speed, dy: vel.y / speed, dz: vel.z / speed, speed, maxSpeed: 1e9, accel: 0, turn: 0, life: 7, damage, target: null, homing: null });
    this.fx.push({ kind: "spark", ...from, size: 2.2, t: 0, life: 0.2, yaw: 0, pitch: 0 });
    this.bus?.emit("weapon", { kind: "missile", ...from });
  }

  shockwave(at: V3, radius: number): void {
    this.fx.push({ kind: "shock", ...at, size: radius, t: 0, life: 0.6, yaw: 0, pitch: 0 });
    this.bus?.emit("explosion", { ...at, size: radius * 0.6 });
  }

  emp(at: V3, radius: number, drain: number, damage: number): void {
    this.fx.push({ kind: "shock", ...at, size: radius, t: 0, life: 0.5, yaw: 0, pitch: 0 });
    this.fx.push({ kind: "spark", ...at, size: 6, t: 0, life: 0.25, yaw: 0, pitch: 0 });
    this.bus?.emit("weapon", { kind: "laser", ...at });
    for (const t of this.targets) {
      if (!t.targetable || dist(at, t.center) > radius) continue;
      if (t.takeHit(damage)) t.emp?.(drain);
    }
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
        if (pr.kind === "rocket" || pr.kind === "missile" || pr.kind === "shell") this.detonate(pr);
        pr.alive = false;
        continue;
      }
      pr.speed = Math.min(pr.maxSpeed, pr.speed + pr.accel * dt);
      if (pr.kind === "shell") {
        // Ballistic arc.
        const vx = pr.dx * pr.speed, vy = pr.dy * pr.speed - SHELL_GRAVITY * dt, vz = pr.dz * pr.speed;
        pr.speed = Math.hypot(vx, vy, vz) || 1;
        pr.dx = vx / pr.speed;
        pr.dy = vy / pr.speed;
        pr.dz = vz / pr.speed;
      }
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
      } else if (pr.kind === "missile" && pr.decoy) {
        // Chasing a flare: blow up on it.
        const f = pr.decoy;
        if (f.t >= f.life) pr.decoy = null;
        else {
          const d = steer({ x: pr.dx, y: pr.dy, z: pr.dz }, norm({ x: f.x - pr.x, y: f.y - pr.y, z: f.z - pr.z }), pr.turn * 2 * dt);
          pr.dx = d.x;
          pr.dy = d.y;
          pr.dz = d.z;
          if (dist(pr, f) < 3) {
            this.detonate(pr);
            pr.alive = false;
            continue;
          }
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
      if (pr.kind === "rocket" || pr.kind === "missile" || pr.kind === "shell") {
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
    this.updateParticles(dt);
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.t += dt;
      const g = p.kind === "debris" ? 22 : p.kind === "flare" ? 9 : p.kind === "ember" ? 12 : p.kind === "vapour" ? 0 : -0.6;
      const drag = p.kind === "dust" ? 2.6 : p.kind === "flare" ? 0.9 : 0.25;
      p.vy -= g * dt;
      const k = Math.max(0, 1 - drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.vz *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.spin += dt * (4 + Math.hypot(p.vx, p.vz) * 0.3);
      if (p.kind === "debris" || p.kind === "flare") {
        // Smoke trail behind burning debris and flares.
        p.smoke -= dt;
        if (p.smoke <= 0 && this.puffs.length < MAX_PUFFS && p.t < p.life * 0.7) {
          p.smoke = p.kind === "flare" ? 0.05 : 0.12;
          this.puffs.push({ x: p.x, y: p.y, z: p.z, t: 0, life: p.kind === "flare" ? 0.9 : 0.7, hot: p.kind === "flare" });
        }
        const floor = this.world.terrainHeight(p.x, p.z);
        if (p.y < floor + p.size) {
          p.y = floor + p.size;
          p.vy = Math.abs(p.vy) * 0.3;
          p.vx *= 0.5;
          p.vz *= 0.5;
        }
      }
    }
    compact(this.particles, (p) => p.t < p.life);
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
        if (!m.alive || (m.kind !== "missile" && m.kind !== "shell")) continue;
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
        if (segmentPointDistance(from, to, t.center) < (pr.kind === "enemyBolt" ? 1.05 : 1.7)) {
          if (pr.kind !== "enemyBolt") this.detonate(pr, to);
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
      if (pr.kind !== "bolt" && pr.kind !== "enemyBolt") this.detonate(pr, at);
      else this.fx.push({ kind: "spark", ...at, size: pr.kind === "bolt" ? 1.4 : 0.9, t: 0, life: 0.12, yaw: 0, pitch: 0 });
      return true;
    }
    return false;
  }

  private detonate(pr: Projectile, at: V3 = pr): void {
    if (pr.kind === "rocket") this.explode(at, 4.5, pr.damage, false);
    else if (pr.kind === "shell") this.explode(at, 5.5, pr.damage, true);
    else this.explode(at, 3.5, pr.damage, true);
  }
}

function compact<T>(arr: T[], keep: (x: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < arr.length; r++) if (keep(arr[r])) arr[w++] = arr[r];
  arr.length = w;
}

