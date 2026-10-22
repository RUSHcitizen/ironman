import type { CollisionWorld } from "../world/Collision";
import type { EnemyKind, EnemyManager } from "../combat/Enemies";
import type { CombatTarget } from "../combat/Targets";
import type { V3 } from "../combat/math3";
import type { Rng } from "../core/math";

/**
 * Special objectives beyond "clear the hostiles":
 *  - bombs:   defuse bombs on several rooftops (hover close until the
 *             defuse completes) before the timer runs out;
 *  - cores:   fly through every stolen data core scattered over roofs and sky;
 *  - courier: chase down a fleeing courier drone before it escapes;
 *  - defend:  protect an arc reactor from waves of attackers;
 *  - escort:  shepherd a medevac helicopter across the city under attack;
 *  - stunt:   rack up seconds flying flat out and low over the rooftops;
 *  - skydive: climb high, cut thrust, and pull out as low as you dare.
 * Pure simulation; placement uses collision-world queries only.
 */
export type MissionKind = "bombs" | "cores" | "courier" | "defend" | "escort" | "stunt" | "skydive";

export interface MissionPoint {
  x: number;
  y: number;
  z: number;
  done: boolean;
  /** Defuse progress 0..1 (bombs). */
  progress: number;
}

export const BOMB_DEFUSE_TIME = 2.5;
export const BOMB_RANGE = 7;
export const CORE_RANGE = 5;
export const COURIER_ESCAPE = 1100;
/** Rooftop run: fly faster than this (m/s) within STUNT_AGL m of the surface. */
export const STUNT_SPEED = 69;
export const STUNT_AGL = 30;
export const STUNT_NEEDED = 12;
/** Skydive: free-fall from above this height, re-engage below SKYDIVE_PULL (AGL). */
export const SKYDIVE_TOP = 600;
export const SKYDIVE_PULL = 80;
const ESCORT_SPEED = 16;
const ESCORT_WAVES: EnemyKind[][] = [
  ["drone", "drone", "kamikaze"],
  ["jet", "kamikaze", "kamikaze", "swarmer", "swarmer"],
  ["gunship", "drone", "kamikaze"],
];
const REACTOR_HP = 100;
const WAVES: EnemyKind[][] = [
  ["drone", "drone", "kamikaze"],
  ["kamikaze", "kamikaze", "swarmer", "swarmer", "swarmer"],
  ["drone", "jet", "kamikaze", "kamikaze"],
  ["gunship", "kamikaze", "kamikaze", "swarmer", "swarmer"],
];

/** The arc reactor you defend: enemies target and shoot it like they would you. */
export class ReactorTarget implements CombatTarget {
  readonly center: V3;
  /** Moves with the escorted helicopter (stays zero for the reactor). */
  readonly vel: V3 = { x: 0, y: 0, z: 0 };
  hp = REACTOR_HP;
  active = true;
  readonly evading = false;
  /** Seconds since the last hit (HUD flash). */
  hitAgo = 99;

  constructor(x: number, y: number, z: number) {
    this.center = { x, y: y + 2, z };
  }

  get targetable(): boolean {
    return this.active && this.hp > 0;
  }

  takeHit(damage: number): boolean {
    if (!this.targetable) return false;
    this.hp = Math.max(0, this.hp - damage * 0.6);
    this.hitAgo = 0;
    return true;
  }
}

export interface MissionContext {
  /** Player (suit) centre. */
  px: number;
  py: number;
  pz: number;
  suited: boolean;
  enemies: EnemyManager;
  /** Optional flight state (stunt / skydive objectives). */
  speed?: number;
  agl?: number;
  freefall?: boolean;
  grounded?: boolean;
  world?: CollisionWorld;
}

export class Mission {
  status: "active" | "won" | "lost" = "active";
  timeLeft: number;
  readonly points: MissionPoint[];
  reactor: ReactorTarget | null = null;
  /** Enemy group used by courier / defend waves. */
  group = 0;
  wave = 0;
  waveTimer = 3;
  /** Why it was lost (HUD text). */
  failReason = "";
  /** Stunt: seconds banked flying fast and low. Skydive: stage. */
  stuntTime = 0;
  skyStage: "climb" | "fall" = "climb";
  /** Lowest altitude above ground reached before pulling out (skydive score). */
  pullAgl = Infinity;

  constructor(
    readonly kind: MissionKind,
    points: MissionPoint[],
    timeLimit: number,
    private rng: Rng,
  ) {
    this.points = points;
    this.timeLeft = timeLimit;
  }

  get remaining(): number {
    return this.points.filter((p) => !p.done).length;
  }

  /** Where the HUD marker should point: the nearest unfinished point, the courier or the reactor. */
  marker(ctx: MissionContext): V3 | null {
    if (this.kind === "courier") {
      const c = ctx.enemies.enemies.find((e) => e.alive && e.group === this.group);
      return c ? { x: c.x, y: c.y, z: c.z } : null;
    }
    if (this.kind === "defend" && this.reactor) return this.reactor.center;
    if (this.kind === "escort" && this.reactor) return this.reactor.center;
    if (this.kind === "stunt" || this.kind === "skydive") return null;
    let best: MissionPoint | null = null;
    let bd = Infinity;
    for (const p of this.points) {
      if (p.done) continue;
      const d = Math.hypot(p.x - ctx.px, p.y - ctx.py, p.z - ctx.pz);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** One-line objective text for the HUD. */
  text(ctx: MissionContext): string {
    const clock = `${Math.max(0, this.timeLeft).toFixed(0)} s`;
    switch (this.kind) {
      case "bombs": {
        const active = this.points.find((p) => !p.done && p.progress > 0);
        const prog = active ? ` · defusing ${Math.round(active.progress * 100)}%` : "";
        return `Bombs defused ${this.points.length - this.remaining}/${this.points.length} · ${clock}${prog} · hover close to defuse`;
      }
      case "cores":
        return `Data cores ${this.points.length - this.remaining}/${this.points.length} · ${clock} · fly through them`;
      case "courier": {
        const c = ctx.enemies.enemies.find((e) => e.alive && e.group === this.group);
        const d = c ? Math.hypot(c.x - ctx.px, c.y - ctx.py, c.z - ctx.pz) : 0;
        return `Courier ${Math.round(d)} m away · escapes at ${COURIER_ESCAPE} m · ${clock}`;
      }
      case "defend":
        return `Reactor ${Math.round(this.reactor?.hp ?? 0)}% · wave ${Math.min(this.wave, WAVES.length)}/${WAVES.length} · ${clock}`;
      case "escort": {
        const d = this.points[0] && this.reactor ? Math.hypot(this.points[0].x - this.reactor.center.x, this.points[0].z - this.reactor.center.z) : 0;
        return `Medevac hull ${Math.round(this.reactor?.hp ?? 0)}% · ${Math.round(d)} m to the hospital · keep the attackers off it`;
      }
      case "stunt":
        return `Rooftop run ${this.stuntTime.toFixed(1)}/${STUNT_NEEDED} s · over ${Math.round(STUNT_SPEED * 3.6)} km/h below ${STUNT_AGL} m · ${clock}`;
      case "skydive":
        return this.skyStage === "climb"
          ? `Climb above ${SKYDIVE_TOP} m, then cut thrust (H / CUT) · ${clock}`
          : `Free-falling · re-engage below ${SKYDIVE_PULL} m above the ground - but not too late!`;
    }
  }

  update(dt: number, ctx: MissionContext): void {
    if (this.status !== "active") return;
    this.timeLeft -= dt;
    switch (this.kind) {
      case "bombs":
        for (const b of this.points) {
          if (b.done) continue;
          const near = ctx.suited && Math.hypot(b.x - ctx.px, b.y - ctx.py, b.z - ctx.pz) < BOMB_RANGE;
          b.progress = near ? Math.min(1, b.progress + dt / BOMB_DEFUSE_TIME) : Math.max(0, b.progress - dt * 0.5);
          if (b.progress >= 1) b.done = true;
        }
        if (this.remaining === 0) this.status = "won";
        else if (this.timeLeft <= 0) this.fail("The bombs went off");
        break;
      case "cores":
        for (const c of this.points) {
          if (!c.done && ctx.suited && Math.hypot(c.x - ctx.px, c.y - ctx.py, c.z - ctx.pz) < CORE_RANGE) c.done = true;
        }
        if (this.remaining === 0) this.status = "won";
        else if (this.timeLeft <= 0) this.fail("The data cores self-destructed");
        break;
      case "courier": {
        const c = ctx.enemies.enemies.find((e) => e.alive && e.group === this.group);
        if (!c) this.status = "won";
        else if (Math.hypot(c.x - ctx.px, c.z - ctx.pz) > COURIER_ESCAPE) this.fail("The courier got away");
        else if (this.timeLeft <= 0) this.fail("The courier got away");
        break;
      }
      case "escort": {
        const h = this.reactor!;
        h.hitAgo += dt;
        if (h.hp <= 0) {
          this.fail("The medevac went down");
          break;
        }
        // Fly toward the hospital pad, climbing over anything in the way.
        const dest = this.points[0];
        const dx = dest.x - h.center.x, dz = dest.z - h.center.z;
        const d = Math.hypot(dx, dz);
        if (d < 8) {
          this.status = "won";
          break;
        }
        const roof = ctx.world ? ctx.world.surfaceBelow(h.center.x + (dx / d) * 30, 1000, h.center.z + (dz / d) * 30, 6, 0) : 0;
        const wantY = Math.max(roof + 30, dest.y + (d < 80 ? 6 : 30));
        h.vel.x = (dx / d) * ESCORT_SPEED;
        h.vel.z = (dz / d) * ESCORT_SPEED;
        h.vel.y = Math.max(-6, Math.min(8, (wantY - h.center.y) * 0.8));
        h.center.x += h.vel.x * dt;
        h.center.y += h.vel.y * dt;
        h.center.z += h.vel.z * dt;
        this.waveTimer -= dt;
        if (this.wave < ESCORT_WAVES.length && this.waveTimer <= 0) {
          this.spawnAround(ctx.enemies, h.center, ESCORT_WAVES[this.wave]);
          this.wave++;
          this.waveTimer = 14;
        }
        if (this.timeLeft <= 0) this.fail("The medevac ran out of fuel");
        break;
      }
      case "stunt": {
        const fast = ctx.suited && (ctx.speed ?? 0) > STUNT_SPEED && (ctx.agl ?? 999) < STUNT_AGL && !ctx.grounded;
        if (fast) this.stuntTime += dt;
        if (this.stuntTime >= STUNT_NEEDED) this.status = "won";
        else if (this.timeLeft <= 0) this.fail("Not enough time on the deck");
        break;
      }
      case "skydive": {
        if (this.skyStage === "climb") {
          if (ctx.freefall && ctx.py > SKYDIVE_TOP) {
            this.skyStage = "fall";
            this.pullAgl = Infinity;
          }
        } else {
          const agl = ctx.agl ?? 999;
          if (ctx.grounded) this.fail("Pulled too late - you hit the ground");
          else if (!ctx.freefall) {
            this.pullAgl = agl;
            if (agl <= SKYDIVE_PULL) this.status = "won";
            else this.fail(`Pulled at ${Math.round(agl)} m - too early`);
          }
        }
        if (this.status === "active" && this.timeLeft <= 0) this.fail("Out of time");
        break;
      }
      case "defend": {
        const r = this.reactor!;
        r.hitAgo += dt;
        if (r.hp <= 0) {
          this.fail("The reactor was destroyed");
          break;
        }
        this.waveTimer -= dt;
        const alive = ctx.enemies.aliveInGroup(this.group);
        // Next wave on a timer, or as soon as the last one is cleared.
        if (this.wave < WAVES.length && (this.waveTimer <= 0 || (alive === 0 && this.wave > 0))) {
          this.spawnWave(ctx.enemies);
        } else if (this.wave >= WAVES.length && alive === 0) {
          this.status = "won";
        } else if (this.timeLeft <= 0) {
          // Held out: the reactor survived until help arrived.
          this.status = "won";
        }
        break;
      }
    }
    if (this.status !== "active" && this.reactor) this.reactor.active = false;
  }

  private spawnAround(enemies: EnemyManager, at: V3, kinds: EnemyKind[]): void {
    const a0 = this.rng.range(0, Math.PI * 2);
    for (const k of kinds) {
      const a = a0 + this.rng.range(-0.7, 0.7);
      const d = this.rng.range(150, 200);
      const e = enemies.spawn(k, at.x + Math.cos(a) * d, at.y + this.rng.range(10, 35), at.z + Math.sin(a) * d, this.group);
      e.aware = true;
    }
  }

  private spawnWave(enemies: EnemyManager): void {
    const r = this.reactor!;
    const kinds = WAVES[this.wave];
    const a0 = this.rng.range(0, Math.PI * 2);
    for (let k = 0; k < kinds.length; k++) {
      const a = a0 + this.rng.range(-0.6, 0.6);
      const d = this.rng.range(140, 190);
      const e = enemies.spawn(kinds[k], r.center.x + Math.cos(a) * d, r.center.y + this.rng.range(25, 50), r.center.z + Math.sin(a) * d, this.group);
      e.aware = true;
    }
    this.wave++;
    this.waveTimer = 16;
  }

  private fail(reason: string): void {
    this.status = "lost";
    this.failReason = reason;
  }
}

/** Find `n` rooftop spots (at least `minTop` m high) around (x, z), spread apart. */
export function findRoofs(world: CollisionWorld, rng: Rng, x: number, z: number, n: number, minR: number, maxR: number, minTop = 14): V3[] {
  const out: V3[] = [];
  for (let tries = 0; tries < 200 && out.length < n; tries++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(minR, maxR);
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const top = world.surfaceBelow(px, 1000, pz, 1.5, 0);
    if (top < minTop) continue;
    if (out.some((o) => Math.hypot(o.x - px, o.z - pz) < 60)) continue;
    out.push({ x: px, y: top, z: pz });
  }
  return out;
}

/** Lay out a mission of the given kind around (x, z). Returns null if no layout fits here. */
export function planMission(kind: MissionKind, world: CollisionWorld, rng: Rng, x: number, z: number, enemies: EnemyManager, group: number): Mission | null {
  switch (kind) {
    case "bombs": {
      const roofs = findRoofs(world, rng, x, z, 3, 40, 260);
      if (roofs.length < 3) return null;
      return new Mission(kind, roofs.map((r) => ({ x: r.x, y: r.y + 0.6, z: r.z, done: false, progress: 0 })), 80, rng);
    }
    case "cores": {
      const roofs = findRoofs(world, rng, x, z, 6, 30, 320, 8);
      if (roofs.length < 6) return null;
      // Half sit on the roofs, half hang in the sky above them.
      const pts = roofs.map((r, k) => ({ x: r.x, y: r.y + (k % 2 === 0 ? 2.5 : rng.range(25, 60)), z: r.z, done: false, progress: 0 }));
      return new Mission(kind, pts, 90, rng);
    }
    case "courier": {
      const top = world.surfaceBelow(x, 1000, z, 2, 0);
      const m = new Mission(kind, [], 75, rng);
      m.group = group;
      enemies.spawn("courier", x, top + 25, z, group);
      return m;
    }
    case "escort": {
      // Pick up near (x, z); the hospital pad is a rooftop 450-650 m away.
      const pads = findRoofs(world, rng, x, z, 1, 450, 650, 12);
      if (pads.length === 0) return null;
      const pad = pads[0];
      const start = world.surfaceBelow(x, 1000, z, 6, 0) + 35;
      const m = new Mission(kind, [{ x: pad.x, y: pad.y, z: pad.z, done: false, progress: 0 }], 120, rng);
      m.group = group;
      m.reactor = new ReactorTarget(x, start - 2, z);
      m.waveTimer = 4;
      return m;
    }
    case "stunt":
      return new Mission(kind, [], 70, rng);
    case "skydive":
      return new Mission(kind, [], 120, rng);
    case "defend": {
      const roofs = findRoofs(world, rng, x, z, 1, 0, 120, 10);
      const at = roofs[0] ?? { x, y: world.surfaceBelow(x, 1000, z, 2, 0), z };
      const m = new Mission(kind, [{ x: at.x, y: at.y, z: at.z, done: false, progress: 0 }], 75, rng);
      m.group = group;
      m.reactor = new ReactorTarget(at.x, at.y, at.z);
      return m;
    }
  }
}
