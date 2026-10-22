import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import { nearestTarget, type CombatTarget } from "./Targets";
import { Rng } from "../core/math";
import { dist, len, norm, type V3 } from "./math3";

export type EnemyKind =
  | "drone"
  | "kamikaze"
  | "trooper"
  | "warbot"
  | "gunship"
  | "sniper"
  | "shielder"
  | "tank"
  | "jet"
  | "swarmer"
  | "jammer"
  | "carrier"
  | "sentinel"
  | "spider"
  | "cloaker"
  | "titan"
  | "bomber"
  | "mine"
  | "turret"
  | "rival";

/** Flying kinds (spawned in the air, not on a surface). */
export const AIR_KINDS: ReadonlySet<EnemyKind> = new Set(["drone", "kamikaze", "gunship", "shielder", "jet", "swarmer", "jammer", "carrier", "sentinel", "cloaker", "bomber", "mine", "rival"]);

/** Air mines detonate within this distance of a target. */
export const MINE_TRIGGER = 4.5;

/** EMP pulse radius of the jammer drone. */
export const EMP_RADIUS = 32;
/** The Dreadnought keeps at most this many swarmers of its own alive. */
export const CARRIER_MAX_SWARM = 9;

/** Allies within this range of a shield drone take reduced damage. */
export const SHIELD_RADIUS = 22;

export interface EnemyStats {
  hp: number;
  radius: number;
  /** Height of the hit centre above the enemy origin. */
  centerY: number;
  range: number;
  score: number;
}

export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  drone: { hp: 30, radius: 1.1, centerY: 0, range: 280, score: 100 },
  kamikaze: { hp: 14, radius: 0.9, centerY: 0, range: 300, score: 75 },
  trooper: { hp: 45, radius: 1.0, centerY: 1.1, range: 230, score: 150 },
  warbot: { hp: 340, radius: 2.9, centerY: 3.2, range: 340, score: 1000 },
  gunship: { hp: 220, radius: 3.2, centerY: 0, range: 330, score: 600 },
  sniper: { hp: 35, radius: 1.0, centerY: 1.1, range: 380, score: 250 },
  shielder: { hp: 60, radius: 1.3, centerY: 0, range: 260, score: 300 },
  tank: { hp: 280, radius: 2.9, centerY: 1.4, range: 300, score: 700 },
  jet: { hp: 90, radius: 2.4, centerY: 0, range: 420, score: 450 },
  swarmer: { hp: 8, radius: 0.6, centerY: 0, range: 230, score: 40 },
  jammer: { hp: 70, radius: 1.4, centerY: 0, range: 260, score: 350 },
  carrier: { hp: 1400, radius: 10, centerY: 0, range: 460, score: 3000 },
  sentinel: { hp: 70, radius: 1.2, centerY: 0, range: 300, score: 300 },
  spider: { hp: 170, radius: 2.6, centerY: 1.6, range: 320, score: 550 },
  cloaker: { hp: 40, radius: 1.1, centerY: 0, range: 260, score: 400 },
  titan: { hp: 950, radius: 5, centerY: 5.8, range: 420, score: 2500 },
  bomber: { hp: 320, radius: 4.2, centerY: 0, range: 520, score: 900 },
  mine: { hp: 10, radius: 0.9, centerY: 0, range: 110, score: 60 },
  turret: { hp: 150, radius: 1.8, centerY: 1.3, range: 400, score: 450 },
  rival: { hp: 600, radius: 1.2, centerY: 0, range: 420, score: 2200 },
};

/** Is this enemy currently invisible (cloaked)? */
export function isCloaked(e: { kind: string; charge: number; flash: number; state: string }): boolean {
  return e.kind === "cloaker" && e.state !== "engage" && e.flash < 0.05;
}

/** Placeholder target when nothing is engageable: enemies just patrol. */
const IDLE_TARGET: CombatTarget = {
  center: { x: 0, y: -1e5, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  targetable: false,
  evading: false,
  takeHit: () => false,
};

export type EnemyState = "patrol" | "engage" | "hop" | "salvo" | "charge" | "slam" | "retreat";

export interface Enemy {
  id: number;
  kind: EnemyKind;
  group: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  anchor: V3;
  /** Standing surface height for ground units. */
  ground: number;
  aware: boolean;
  los: boolean;
  losTimer: number;
  fireTimer: number;
  burstLeft: number;
  burstTimer: number;
  moveTimer: number;
  strafe: number;
  orbit: number;
  dodgeCooldown: number;
  missileTimer: number;
  state: EnemyState;
  stateTimer: number;
  /** 0..1 visual helpers. */
  flash: number;
  jet: number;
  charge: number;
  phase: number;
  /** Laser aim point while charging (lags behind the player). */
  aimX: number;
  aimY: number;
  aimZ: number;
  /** Protected by a nearby shield drone this frame. */
  shielded: boolean;
  /** Seconds since spawning (warp-in animation). */
  age: number;
}

/** How enemies hurt things - implemented by the projectile system. */
export interface EnemyWeapons {
  bolt(from: V3, dir: V3, speed: number, damage: number): void;
  missile(from: V3, dir: V3, damage: number): void;
  explode(at: V3, size: number, damage: number, hurtsPlayer: boolean): void;
  beam(from: V3, to: V3, kind: "telegraph" | "laser"): void;
  /** Ballistic explosive shell (tank). */
  shell(from: V3, vel: V3, damage: number): void;
  shockwave(at: V3, radius: number): void;
  /** Wreckage chunks flying off a destroyed unit. */
  wreck(at: V3, size: number): void;
  /** Electromagnetic pulse: drains suit power within the radius. */
  emp(at: V3, radius: number, drain: number, damage: number): void;
}

/**
 * Hostile units and their behaviours. Pure simulation (no rendering) so it can
 * be unit-tested headlessly. Enemies ignore the player while out of the suit.
 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  kills = 0;
  private nextId = 1;
  private rng = new Rng(777);
  weapons: EnemyWeapons | null = null;
  /** Units spawned mid-update (carrier launches), added after the loop. */
  private launched: Enemy[] = [];

  constructor(
    private world: CollisionWorld,
    private bus?: EventBus<GameEvents>,
  ) {}

  get alive(): Enemy[] {
    return this.enemies.filter((e) => e.alive);
  }

  aliveInGroup(group: number): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive && e.group === group) n++;
    return n;
  }

  spawn(kind: EnemyKind, x: number, y: number, z: number, group = 0): Enemy {
    const s = ENEMY_STATS[kind];
    const r = this.rng;
    // Never start inside a building: shift to clear space nearby (or onto the roof).
    const at = { x, y, z };
    this.unstick(kind, at);
    ({ x, y, z } = at);
    const e: Enemy = {
      id: this.nextId++,
      kind,
      group,
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: r.range(0, Math.PI * 2),
      hp: s.hp,
      maxHp: s.hp,
      alive: true,
      anchor: { x, y, z },
      ground: y,
      aware: false,
      los: false,
      losTimer: r.range(0, 0.3),
      fireTimer: r.range(1, 2.5),
      burstLeft: 0,
      burstTimer: 0,
      moveTimer: r.range(1, 3),
      strafe: r.chance(0.5) ? 1 : -1,
      orbit: r.range(0, Math.PI * 2),
      dodgeCooldown: 0,
      missileTimer: r.range(4, 9),
      state: "patrol",
      stateTimer: r.range(2, 4),
      flash: 0,
      jet: 0,
      charge: 0,
      phase: r.range(0, 10),
      aimX: x,
      aimY: y,
      aimZ: z,
      shielded: false,
      age: 0,
    };
    this.enemies.push(e);
    return e;
  }

  /** A unit's body box: half-width and bottom/top relative to its origin. */
  private body(kind: EnemyKind): { r: number; y0: number; y1: number } {
    const s = ENEMY_STATS[kind];
    if (AIR_KINDS.has(kind)) return { r: s.radius, y0: -s.radius, y1: s.radius };
    return { r: s.radius * 0.8, y0: 0.4, y1: Math.max(1.8, s.centerY * 2) };
  }

  /** Would a unit of this kind at (x, y, z) be inside a building? */
  blockedAt(kind: EnemyKind, x: number, y: number, z: number): boolean {
    const b = this.body(kind);
    return this.world.overlaps(x - b.r, y + b.y0, z - b.r, x + b.r, y + b.y1, z + b.r) !== null;
  }

  /**
   * Move a spawn point out of any building: search outward for clear space at
   * the same height (ground units: on the same surface), else put the unit on
   * top of whatever is there.
   */
  private unstick(kind: EnemyKind, p: V3): void {
    if (!this.blockedAt(kind, p.x, p.y, p.z)) return;
    const air = AIR_KINDS.has(kind);
    for (let ring = 1; ring <= 8; ring++) {
      const d = ring * 6;
      for (let k = 0; k < 8; k++) {
        const a = ((k + ring * 0.5) / 8) * Math.PI * 2;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        const y = air ? p.y : this.world.surfaceBelow(x, p.y + 1, z, 0.4);
        if (!air && Math.abs(y - p.y) > 1) continue;
        if (!this.blockedAt(kind, x, y, z)) {
          p.x = x;
          p.y = y;
          p.z = z;
          return;
        }
      }
    }
    const b = this.body(kind);
    p.y = this.world.surfaceBelow(p.x, 5000, p.z, b.r, 0) + (air ? b.r + 4 : 0);
  }

  /** Spawn during update without disturbing iteration. */
  private launch(kind: EnemyKind, x: number, y: number, z: number, group: number): Enemy {
    const e = this.spawn(kind, x, y, z, group);
    this.enemies.pop();
    this.launched.push(e);
    e.aware = true;
    return e;
  }

  clear(): void {
    this.enemies.length = 0;
    this.launched.length = 0;
  }

  center(e: Enemy): V3 {
    return { x: e.x, y: e.y + ENEMY_STATS[e.kind].centerY, z: e.z };
  }

  /** Called when the player shoots at this enemy - nimble units may dodge. */
  threaten(e: Enemy): void {
    if (!e.alive || e.dodgeCooldown > 0) return;
    if (e.kind === "drone" && this.rng.chance(0.45)) {
      const s = this.rng.chance(0.5) ? 1 : -1;
      // Sidestep perpendicular to the line of fire, with a little lift.
      e.vx += Math.cos(e.yaw) * s * 24;
      e.vz += -Math.sin(e.yaw) * s * 24;
      e.vy += this.rng.range(-4, 8);
      e.dodgeCooldown = 2.2;
    } else if (e.kind === "cloaker" && e.state !== "engage" && this.rng.chance(0.6)) {
      // Senses the lock and slips sideways while still invisible.
      e.strafe *= -1;
      e.dodgeCooldown = 2;
    } else if (e.kind === "rival" && e.state !== "charge" && this.rng.chance(0.55)) {
      // The rogue armour barrel-rolls out of the line of fire.
      const s = this.rng.chance(0.5) ? 1 : -1;
      e.vx += Math.cos(e.yaw) * s * 45;
      e.vz += -Math.sin(e.yaw) * s * 45;
      e.vy += this.rng.range(-6, 10);
      e.jet = 1;
      e.dodgeCooldown = 1.6;
    } else if ((e.kind === "trooper" || e.kind === "sniper") && e.state !== "hop" && this.rng.chance(0.25)) {
      this.startHop(e);
      e.dodgeCooldown = 3;
    }
  }

  damage(e: Enemy, amount: number): void {
    if (!e.alive) return;
    if (e.shielded) amount *= 0.25;
    e.hp -= amount;
    e.flash = 1;
    e.aware = true;
    // Light units get knocked about by hits.
    if (AIR_KINDS.has(e.kind) && ENEMY_STATS[e.kind].hp < 200) {
      const k = Math.min(10, amount * 0.4);
      e.vx += this.rng.range(-k, k);
      e.vy += this.rng.range(0, k * 0.6);
      e.vz += this.rng.range(-k, k);
    }
    if (e.kind === "cloaker") {
      // Hit: the cloak drops for a moment.
      e.state = "engage";
      e.stateTimer = Math.max(e.stateTimer, 2);
    }
    if (e.hp <= 0) {
      e.alive = false;
      this.kills++;
      const c = this.center(e);
      const big = e.kind === "warbot" || e.kind === "gunship" || e.kind === "tank" || e.kind === "jet" || e.kind === "spider" || e.kind === "bomber" || e.kind === "rival" || e.kind === "turret";
      const size = e.kind === "carrier" || e.kind === "titan" ? 16 : big ? 9 : e.kind === "kamikaze" || e.kind === "mine" ? 5 : e.kind === "swarmer" ? 1.6 : 3.2;
      // Shot mines still go off (chain reactions through a minefield).
      this.weapons?.explode(c, size, e.kind === "kamikaze" ? 8 : e.kind === "mine" ? 14 : 0, true);
      this.weapons?.wreck(c, size);
      this.bus?.emit("kill", { kind: e.kind, total: this.kills });
    } else if (e.kind === "drone" && e.hp < e.maxHp * 0.35 && e.state !== "retreat") {
      e.state = "retreat";
      e.stateTimer = 2.2;
    }
  }

  /** Each enemy engages the nearest targetable target (player in the suit, or the sentry suit). */
  update(dt: number, targets: readonly CombatTarget[]): void {
    // Shield drones protect every other hostile near them.
    const shields = this.enemies.filter((e) => e.alive && e.kind === "shielder");
    for (const e of this.enemies) {
      e.shielded = shields.some((s) => s !== e && Math.hypot(s.x - e.x, s.y - e.y, s.z - e.z) < SHIELD_RADIUS);
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const p = nearestTarget(targets, e) ?? IDLE_TARGET;
      const target = p.center;
      const hostile = p.targetable;
      e.phase += dt;
      e.age += dt;
      e.flash = Math.max(0, e.flash - dt * 5);
      e.dodgeCooldown -= dt;
      const d = dist(this.center(e), target);
      const range = ENEMY_STATS[e.kind].range;
      e.losTimer -= dt;
      if (e.losTimer <= 0) {
        e.losTimer = 0.35;
        e.los = hostile && d < range * 1.6 && this.lineOfSight(this.center(e), target, d);
      }
      if (!hostile) e.aware = false;
      else if (!e.aware && d < range && e.los) e.aware = true;
      else if (e.aware && d > range * 1.7) e.aware = false;

      switch (e.kind) {
        case "drone":
          this.updateDrone(e, dt, p, d);
          break;
        case "kamikaze":
          this.updateKamikaze(e, dt, p, d);
          break;
        case "trooper":
          this.updateTrooper(e, dt, p, d);
          break;
        case "warbot":
          this.updateWarbot(e, dt, p, d);
          break;
        case "gunship":
          this.updateGunship(e, dt, p, d);
          break;
        case "sniper":
          this.updateSniper(e, dt, p, d);
          break;
        case "shielder":
          this.updateShielder(e, dt, p, d);
          break;
        case "tank":
          this.updateTank(e, dt, p, d);
          break;
        case "jet":
          this.updateJet(e, dt, p, d);
          break;
        case "swarmer":
          this.updateSwarmer(e, dt, p, d);
          break;
        case "jammer":
          this.updateJammer(e, dt, p, d);
          break;
        case "carrier":
          this.updateCarrier(e, dt, p, d);
          break;
        case "sentinel":
          this.updateSentinel(e, dt, p, d);
          break;
        case "spider":
          this.updateSpider(e, dt, p, d);
          break;
        case "cloaker":
          this.updateCloaker(e, dt, p, d);
          break;
        case "titan":
          this.updateWarbot(e, dt, p, d);
          break;
        case "bomber":
          this.updateBomber(e, dt, p, d);
          break;
        case "mine":
          this.updateMine(e, dt, p, d);
          break;
        case "turret":
          this.updateTurret(e, dt, p, d);
          break;
        case "rival":
          this.updateRival(e, dt, p, d);
          break;
      }
    }
    // Drop long-dead entries (and add units launched this frame).
    for (const e of this.launched) this.enemies.push(e);
    this.launched.length = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) if (!this.enemies[i].alive) this.enemies.splice(i, 1);
  }

  private lineOfSight(a: V3, b: V3, d: number): boolean {
    const dir = norm({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    return this.world.raycast(a.x, a.y, a.z, dir.x, dir.y, dir.z, d - 1.5) === Infinity;
  }

  private faceTowards(e: Enemy, t: V3, dt: number, rate = 6): void {
    const want = Math.atan2(t.x - e.x, t.z - e.z);
    let diff = want - e.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    e.yaw += diff * Math.min(1, rate * dt);
  }

  /** Aim at the player with lead and spread. */
  private aimAt(from: V3, p: CombatTarget, speed: number, spread: number): V3 {
    const t = p.center;
    const tof = dist(from, t) / speed;
    const lead = 0.6; // imperfect leading leaves room to dodge
    const aim = { x: t.x + p.vel.x * tof * lead, y: t.y + p.vel.y * tof * lead, z: t.z + p.vel.z * tof * lead };
    const dir = norm({ x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z });
    const r = this.rng;
    return norm({ x: dir.x + r.range(-spread, spread), y: dir.y + r.range(-spread, spread), z: dir.z + r.range(-spread, spread) });
  }

  /** Move a flying unit, bouncing off buildings and staying above rooftops. */
  private flyMove(e: Enemy, dt: number, clearance: number): boolean {
    const nx = e.x + e.vx * dt, ny = e.y + e.vy * dt, nz = e.z + e.vz * dt;
    const r = ENEMY_STATS[e.kind].radius * 0.8;
    const hit = this.world.overlaps(nx - r, ny - r, nz - r, nx + r, ny + r, nz + r);
    if (hit) {
      // Already inside a building (e.g. it grew around us): pop out over the top.
      const inside = this.world.overlaps(e.x - r, e.y - r, e.z - r, e.x + r, e.y + r, e.z + r);
      if (inside) {
        e.y = inside.maxY + r + 1;
        e.vy = Math.max(e.vy, 0);
        return true;
      }
      e.vx *= -0.4;
      e.vz *= -0.4;
      e.vy = Math.max(e.vy, 6);
      e.strafe *= -1;
      return true;
    }
    e.x = nx;
    e.y = ny;
    e.z = nz;
    const floor = this.world.surfaceBelow(e.x, e.y, e.z, r, 0) + clearance;
    if (e.y < floor) {
      e.y += (floor - e.y) * Math.min(1, dt * 4);
      e.vy = Math.max(e.vy, 0);
    }
    return false;
  }

  private steerTo(e: Enemy, tx: number, ty: number, tz: number, speed: number, dt: number, responsiveness = 2): void {
    let dx = (tx - e.x) * 1.2, dy = (ty - e.y) * 1.2, dz = (tz - e.z) * 1.2;
    const l = len(dx, dy, dz);
    if (l > speed) {
      dx *= speed / l;
      dy *= speed / l;
      dz *= speed / l;
    }
    const k = Math.min(1, responsiveness * dt);
    e.vx += (dx - e.vx) * k;
    e.vy += (dy - e.vy) * k;
    e.vz += (dz - e.vz) * k;
  }

  private updateDrone(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    if (!e.aware) {
      e.orbit += dt * 0.5;
      this.steerTo(e, e.anchor.x + Math.cos(e.orbit) * 18, e.anchor.y + Math.sin(e.phase) * 2, e.anchor.z + Math.sin(e.orbit) * 18, 9, dt);
      this.faceTowards(e, { x: e.x + e.vx, y: 0, z: e.z + e.vz }, dt, 3);
      this.flyMove(e, dt, 4);
      return;
    }
    // Orbit-strafe around the player, flip direction now and then.
    e.moveTimer -= dt;
    if (e.moveTimer <= 0) {
      e.moveTimer = this.rng.range(1.8, 3.8);
      if (this.rng.chance(0.6)) e.strafe *= -1;
    }
    let radius = 34 + Math.sin(e.phase * 0.7) * 8;
    let height = 7 + Math.sin(e.phase * 1.3) * 5;
    if (e.state === "retreat") {
      e.stateTimer -= dt;
      radius = 75;
      height = 22;
      if (e.stateTimer <= 0) e.state = "engage";
    }
    e.orbit += e.strafe * dt * (0.55 + 10 / Math.max(20, radius));
    this.steerTo(e, t.x + Math.cos(e.orbit) * radius, t.y + height, t.z + Math.sin(e.orbit) * radius, 26, dt, 2.5);
    this.faceTowards(e, t, dt, 8);
    this.flyMove(e, dt, 4);

    // Three-round bursts.
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && e.los && d < ENEMY_STATS.drone.range && e.state !== "retreat") {
      e.burstLeft = 3;
      e.fireTimer = this.rng.range(2.0, 3.4);
    }
    this.burst(e, dt, p, 75, 4, 0.14, 0.03);
  }

  private burst(e: Enemy, dt: number, p: CombatTarget, speed: number, damage: number, interval: number, spread: number): void {
    if (e.burstLeft <= 0) return;
    e.burstTimer -= dt;
    if (e.burstTimer > 0) return;
    e.burstTimer = interval;
    e.burstLeft--;
    const from = this.center(e);
    from.y += e.kind === "trooper" ? 0.3 : e.kind === "warbot" ? 1.2 : e.kind === "gunship" ? -1 : e.kind === "carrier" ? -5 : e.kind === "bomber" ? -1.5 : 0;
    this.weapons?.bolt(from, this.aimAt(from, p, speed, spread), speed, damage);
  }

  private updateKamikaze(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    if (!e.aware) {
      this.steerTo(e, e.anchor.x, e.anchor.y + Math.sin(e.phase * 2) * 1.5, e.anchor.z, 6, dt);
      this.flyMove(e, dt, 4);
      return;
    }
    // Weaving dive straight at the player.
    const dir = norm({ x: t.x - e.x, y: t.y - e.y, z: t.z - e.z });
    const side = Math.sin(e.phase * 5) * 9;
    const tx = t.x + dir.z * side, tz = t.z - dir.x * side;
    this.steerTo(e, tx, t.y, tz, 46, dt, 3);
    this.faceTowards(e, t, dt, 10);
    this.flyMove(e, dt, 2);
    if (d < 3.4) {
      e.alive = false;
      this.weapons?.explode(this.center(e), 5, 18, true);
    }
  }

  private startHop(e: Enemy): void {
    e.state = "hop";
    const a = this.rng.range(0, Math.PI * 2);
    e.vx = Math.cos(a) * 7;
    e.vz = Math.sin(a) * 7;
    e.vy = 11;
    e.jet = 1;
  }

  private updateTrooper(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    e.jet = Math.max(0, e.jet - dt * 1.5);
    if (e.state === "hop") {
      // Jet-pack hop: slow fall, land on whatever surface is below.
      e.vy -= 14 * dt;
      e.jet = Math.max(e.jet, e.vy > 0 ? 1 : 0.5);
      const nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
      if (!this.world.overlaps(nx - 0.4, e.y + 0.4, nz - 0.4, nx + 0.4, e.y + 1.8, nz + 0.4)) {
        e.x = nx;
        e.z = nz;
      } else {
        e.vx = e.vz = 0;
      }
      e.y += e.vy * dt;
      const floor = this.world.surfaceBelow(e.x, e.y + 0.5, e.z, 0.4);
      if (e.y <= floor && e.vy <= 0) {
        e.y = e.ground = floor;
        e.vx = e.vz = e.vy = 0;
        e.state = "engage";
      }
      if (e.aware) this.faceTowards(e, t, dt, 8);
      return;
    }
    if (!e.aware) {
      e.yaw += Math.sin(e.phase * 0.5) * dt * 0.4;
      return;
    }
    this.faceTowards(e, t, dt, 7);
    // Strafe sideways in short runs without walking off the roof.
    e.moveTimer -= dt;
    if (e.moveTimer <= 0) {
      e.moveTimer = this.rng.range(0.8, 2.2);
      e.strafe = this.rng.pick([-1, 0, 1]);
      if (this.rng.chance(0.18)) this.startHop(e);
    }
    if (e.strafe !== 0) {
      const sx = Math.cos(e.yaw) * e.strafe * 4 * dt, sz = -Math.sin(e.yaw) * e.strafe * 4 * dt;
      const nx = e.x + sx, nz = e.z + sz;
      const floor = this.world.surfaceBelow(nx, e.ground + 0.5, nz, 0.3);
      const blocked = this.world.overlaps(nx - 0.4, e.ground + 0.4, nz - 0.4, nx + 0.4, e.ground + 1.8, nz + 0.4);
      if (!blocked && Math.abs(floor - e.ground) < 0.6) {
        e.x = nx;
        e.z = nz;
      } else e.strafe *= -1;
    }
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && e.los) {
      e.burstLeft = 3;
      e.fireTimer = this.rng.range(1.6, 2.6);
    }
    this.burst(e, dt, p, 80, 4, 0.12, 0.025);
    // Shoulder-launched homing missile.
    e.missileTimer -= dt;
    if (e.missileTimer <= 0 && e.los && d > 35) {
      e.missileTimer = this.rng.range(7, 11);
      const from = this.center(e);
      from.y += 0.6;
      this.weapons?.missile(from, norm({ x: t.x - from.x, y: t.y - from.y + 8, z: t.z - from.z }), 14);
    }
  }

  private updateWarbot(e: Enemy, dt: number, p: CombatTarget, _d: number): void {
    const t = p.center;
    // The titan is the same machine scaled up 1.8x: bigger reach, bigger hits.
    const S = e.kind === "titan" ? 1.8 : 1;
    if (!e.aware) {
      e.yaw += dt * 0.2;
      return;
    }
    this.faceTowards(e, t, dt, e.state === "charge" ? 1.5 : 3);
    e.stateTimer -= dt;
    const flat = Math.hypot(t.x - e.x, t.z - e.z);
    switch (e.state) {
      case "patrol":
      case "engage": {
        // Stomp towards the player; machine-gun bolts while walking.
        if (flat > 40) {
          const sp = 3.5 * dt;
          const fx = Math.sin(e.yaw) * sp, fz = Math.cos(e.yaw) * sp;
          const tryMove = (mx: number, mz: number) => {
            const nx = e.x + mx, nz = e.z + mz;
            if (this.world.overlaps(nx - 2.2 * S, e.ground + 0.5, nz - 2.2 * S, nx + 2.2 * S, e.ground + 5 * S, nz + 2.2 * S)) return false;
            if (Math.abs(this.world.surfaceBelow(nx, e.ground + 0.5, nz, 1) - e.ground) > 0.6) return false;
            e.x = nx;
            e.z = nz;
            return true;
          };
          if (!tryMove(fx, fz)) tryMove(fz * e.strafe, -fx * e.strafe) || (e.strafe *= -1);
        }
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && e.los) {
          e.burstLeft = 5;
          e.fireTimer = this.rng.range(2.5, 3.5);
        }
        this.burst(e, dt, p, 85, 3, 0.1, 0.04);
        if (e.stateTimer <= 0) {
          const low = t.y - e.ground < 10 * S;
          const roll = this.rng.next();
          if (low && flat < 22 * S) {
            e.state = "slam";
            e.stateTimer = 0.9;
          } else if (roll < 0.5 && e.los) {
            e.state = "charge";
            e.stateTimer = 1.5;
            e.aimX = t.x;
            e.aimY = t.y;
            e.aimZ = t.z;
          } else {
            e.state = "salvo";
            e.stateTimer = 1.2;
            e.burstLeft = 0;
            e.missileTimer = 0;
          }
        }
        break;
      }
      case "salvo": {
        // Four homing missiles from the shoulder pods.
        e.missileTimer -= dt;
        if (e.missileTimer <= 0 && e.stateTimer > 0.1) {
          e.missileTimer = 0.25;
          const side = Math.floor(e.stateTimer / 0.25) % 2 === 0 ? 1 : -1;
          const from = { x: e.x + Math.cos(e.yaw) * side * 1.8 * S, y: e.y + 5.2 * S, z: e.z - Math.sin(e.yaw) * side * 1.8 * S };
          this.weapons?.missile(from, norm({ x: (t.x - from.x) * 0.3, y: 1, z: (t.z - from.z) * 0.3 }), 12);
        }
        if (e.stateTimer <= 0) this.toWalk(e);
        break;
      }
      case "charge": {
        // Telegraphed laser: the aim point lags the player, so keep moving!
        e.charge = 1 - e.stateTimer / 1.5;
        const k = Math.min(1, dt * 2.2);
        e.aimX += (t.x - e.aimX) * k;
        e.aimY += (t.y - e.aimY) * k;
        e.aimZ += (t.z - e.aimZ) * k;
        const eye = { x: e.x + Math.sin(e.yaw) * 1.4 * S, y: e.y + 4.4 * S, z: e.z + Math.cos(e.yaw) * 1.4 * S };
        this.weapons?.beam(eye, { x: e.aimX, y: e.aimY, z: e.aimZ }, "telegraph");
        if (e.stateTimer <= 0) {
          const dir = norm({ x: e.aimX - eye.x, y: e.aimY - eye.y, z: e.aimZ - eye.z });
          const reach = 400;
          const wall = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, reach);
          const len = Math.min(reach, wall);
          const end = { x: eye.x + dir.x * len, y: eye.y + dir.y * len, z: eye.z + dir.z * len };
          this.weapons?.beam(eye, end, "laser");
          // Hit if the player is close to the beam line.
          const c = p.center;
          const tt = Math.max(0, (c.x - eye.x) * dir.x + (c.y - eye.y) * dir.y + (c.z - eye.z) * dir.z);
          const px = eye.x + dir.x * tt - c.x, py = eye.y + dir.y * tt - c.y, pz = eye.z + dir.z * tt - c.z;
          if (tt < len && Math.hypot(px, py, pz) < 1.8 * S) p.takeHit(22 * S);
          this.bus?.emit("weapon", { kind: "laser", x: eye.x, y: eye.y, z: eye.z });
          e.charge = 0;
          this.toWalk(e);
        }
        break;
      }
      case "slam": {
        e.charge = 1 - e.stateTimer / 0.9;
        if (e.stateTimer <= 0) {
          e.charge = 0;
          this.weapons?.shockwave({ x: e.x, y: e.ground + 0.3, z: e.z }, 22 * S);
          if (flat < 22 * S && t.y - e.ground < 6 * S) p.takeHit(16 * S);
          this.toWalk(e);
        }
        break;
      }
      default:
        this.toWalk(e);
    }
  }

  /** Heavy VTOL gunship: wide circle-strafe, chaingun bursts and missile salvos. */
  private updateGunship(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    if (!e.aware) {
      e.orbit += dt * 0.15;
      this.steerTo(e, e.anchor.x + Math.cos(e.orbit) * 40, e.anchor.y + Math.sin(e.phase * 0.4) * 3, e.anchor.z + Math.sin(e.orbit) * 40, 10, dt, 1);
      this.faceTowards(e, { x: e.x + e.vx, y: 0, z: e.z + e.vz }, dt, 1.5);
      this.flyMove(e, dt, 10);
      return;
    }
    e.moveTimer -= dt;
    if (e.moveTimer <= 0) {
      e.moveTimer = this.rng.range(5, 9);
      if (this.rng.chance(0.4)) e.strafe *= -1;
    }
    e.orbit += e.strafe * dt * 0.22;
    const radius = 80 + Math.sin(e.phase * 0.3) * 15;
    this.steerTo(e, t.x + Math.cos(e.orbit) * radius, t.y + 22 + Math.sin(e.phase * 0.5) * 6, t.z + Math.sin(e.orbit) * radius, 18, dt, 1.2);
    this.faceTowards(e, t, dt, 2);
    this.flyMove(e, dt, 10);
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && e.los) {
      e.burstLeft = 8;
      e.fireTimer = this.rng.range(2.6, 3.6);
    }
    this.burst(e, dt, p, 95, 3, 0.07, 0.045);
    e.missileTimer -= dt;
    if (e.missileTimer <= 0 && e.los && d > 40) {
      e.missileTimer = this.rng.range(8, 11);
      for (const side of [-1, 1]) {
        const from = { x: e.x + Math.cos(e.yaw) * side * 3, y: e.y - 0.5, z: e.z - Math.sin(e.yaw) * side * 3 };
        this.weapons?.missile(from, norm({ x: t.x - from.x, y: t.y - from.y, z: t.z - from.z }), 12);
      }
    }
  }

  /** Rooftop sniper: paints you with a lagging laser, then one heavy shot. */
  private updateSniper(e: Enemy, dt: number, p: CombatTarget, _d: number): void {
    const t = p.center;
    if (e.state === "hop" || !e.aware) {
      // Shares the trooper's jet-hop and idle behaviour.
      if (e.state !== "charge") this.updateTrooperMotion(e, dt, t);
      if (!e.aware) e.charge = 0;
      return;
    }
    this.faceTowards(e, t, dt, 5);
    const eye = { x: e.x, y: e.y + 1.6, z: e.z };
    if (e.state !== "charge") {
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.los) {
        e.state = "charge";
        e.stateTimer = 2.0;
        e.aimX = t.x;
        e.aimY = t.y;
        e.aimZ = t.z;
      }
      return;
    }
    e.stateTimer -= dt;
    e.charge = 1 - e.stateTimer / 2.0;
    const k = Math.min(1, dt * 1.6);
    e.aimX += (t.x - e.aimX) * k;
    e.aimY += (t.y - e.aimY) * k;
    e.aimZ += (t.z - e.aimZ) * k;
    this.weapons?.beam(eye, { x: e.aimX, y: e.aimY, z: e.aimZ }, "telegraph");
    if (e.stateTimer <= 0) {
      this.weapons?.bolt(eye, norm({ x: e.aimX - eye.x, y: e.aimY - eye.y, z: e.aimZ - eye.z }), 260, 16);
      e.charge = 0;
      e.state = "engage";
      e.fireTimer = this.rng.range(2.5, 4);
      if (this.rng.chance(0.35)) this.startHop(e);
    }
  }

  /** Trooper-style idle sway / jet-hop physics, reused by snipers. */
  private updateTrooperMotion(e: Enemy, dt: number, t: V3): void {
    e.jet = Math.max(0, e.jet - dt * 1.5);
    if (e.state === "hop") {
      e.vy -= 14 * dt;
      e.jet = Math.max(e.jet, e.vy > 0 ? 1 : 0.5);
      const nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
      if (!this.world.overlaps(nx - 0.4, e.y + 0.4, nz - 0.4, nx + 0.4, e.y + 1.8, nz + 0.4)) {
        e.x = nx;
        e.z = nz;
      } else e.vx = e.vz = 0;
      e.y += e.vy * dt;
      const floor = this.world.surfaceBelow(e.x, e.y + 0.5, e.z, 0.4);
      if (e.y <= floor && e.vy <= 0) {
        e.y = e.ground = floor;
        e.vx = e.vz = e.vy = 0;
        e.state = "engage";
      }
      if (e.aware) this.faceTowards(e, t, dt, 8);
    } else e.yaw += Math.sin(e.phase * 0.5) * dt * 0.4;
  }

  /** Shield drone: hangs back near its allies and projects a damage-reducing bubble. */
  private updateShielder(e: Enemy, dt: number, p: CombatTarget, _d: number): void {
    const t = p.center;
    // Centre of the other members of its squad (or its anchor).
    let n = 0, cx = 0, cy = 0, cz = 0;
    for (const o of this.enemies) {
      if (!o.alive || o === e || o.group !== e.group || o.kind === "shielder") continue;
      n++;
      cx += o.x;
      cy += o.y + ENEMY_STATS[o.kind].centerY;
      cz += o.z;
    }
    const hx = n ? cx / n : e.anchor.x, hy = n ? cy / n + 6 : e.anchor.y, hz = n ? cz / n : e.anchor.z;
    // Stay on the far side of the squad from the attacker.
    let gx = hx, gz = hz;
    if (e.aware) {
      const away = norm({ x: hx - t.x, y: 0, z: hz - t.z });
      gx += away.x * 10;
      gz += away.z * 10;
    }
    this.steerTo(e, gx + Math.cos(e.phase) * 3, hy + Math.sin(e.phase * 1.3) * 2, gz + Math.sin(e.phase) * 3, 20, dt, 2);
    this.faceTowards(e, t, dt, 3);
    this.flyMove(e, dt, 6);
    // Weak pulse shot now and then.
    e.fireTimer -= dt;
    if (e.aware && e.fireTimer <= 0 && e.los) {
      e.fireTimer = this.rng.range(3, 5);
      e.burstLeft = 1;
    }
    this.burst(e, dt, p, 70, 3, 0.1, 0.05);
  }

  /** Hover tank: stalks along the street and lobs arcing explosive shells. */
  private updateTank(e: Enemy, dt: number, p: CombatTarget, _d: number): void {
    const t = p.center;
    if (!e.aware) {
      e.yaw += dt * 0.15;
      return;
    }
    this.faceTowards(e, t, dt, 1.4);
    const flat = Math.hypot(t.x - e.x, t.z - e.z);
    if (flat > 55) {
      const sp = 5 * dt;
      const fx = Math.sin(e.yaw) * sp, fz = Math.cos(e.yaw) * sp;
      const tryMove = (mx: number, mz: number) => {
        const nx = e.x + mx, nz = e.z + mz;
        if (this.world.overlaps(nx - 2.2, e.ground + 0.5, nz - 2.2, nx + 2.2, e.ground + 3, nz + 2.2)) return false;
        if (Math.abs(this.world.surfaceBelow(nx, e.ground + 0.5, nz, 1) - e.ground) > 0.6) return false;
        e.x = nx;
        e.z = nz;
        return true;
      };
      if (!tryMove(fx, fz)) tryMove(fz * e.strafe, -fx * e.strafe) || (e.strafe *= -1);
    }
    // Turret glows before each shot.
    e.fireTimer -= dt;
    e.charge = clamp01(1 - e.fireTimer / 0.8);
    if (e.fireTimer <= 0 && e.los) {
      e.fireTimer = this.rng.range(3, 4.2);
      const from = { x: e.x + Math.sin(e.yaw) * 3, y: e.y + 2.2, z: e.z + Math.cos(e.yaw) * 3 };
      // Ballistic solution with some lead.
      const T = clamp01(Math.hypot(t.x - from.x, t.z - from.z) / 140) * 2.6 + 0.6;
      const ax = t.x + p.vel.x * T * 0.5, ay = t.y + p.vel.y * T * 0.5, az = t.z + p.vel.z * T * 0.5;
      const g = 14;
      this.weapons?.shell(from, { x: (ax - from.x) / T, y: (ay - from.y + 0.5 * g * T * T) / T, z: (az - from.z) / T }, 15);
    }
  }

  /**
   * Interceptor jet: high-speed strafing runs. It dives at you firing, blows
   * past, extends out to a few hundred metres, then turns for another pass.
   */
  private updateJet(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    const speed = Math.hypot(e.vx, e.vy, e.vz);
    if (!e.aware) {
      e.orbit += dt * 0.25;
      this.steerTo(e, e.anchor.x + Math.cos(e.orbit) * 120, e.anchor.y + 20, e.anchor.z + Math.sin(e.orbit) * 120, 45, dt, 1.2);
    } else if (e.state === "retreat") {
      // Extend away, climbing, before turning in again.
      e.stateTimer -= dt;
      const away = norm({ x: e.x - t.x, y: 0, z: e.z - t.z });
      this.steerTo(e, e.x + away.x * 200 + Math.cos(e.phase) * 60, t.y + 45, e.z + away.z * 200 + Math.sin(e.phase) * 60, 95, dt, 1.4);
      if (e.stateTimer <= 0 || d > 320) e.state = "charge";
    } else {
      // Attack run with a little lead.
      e.state = "charge";
      this.steerTo(e, t.x + p.vel.x * 0.5, t.y + p.vel.y * 0.5, t.z + p.vel.z * 0.5, 92, dt, 1.6);
      const toT = norm({ x: t.x - e.x, y: t.y - e.y, z: t.z - e.z });
      const facing = speed > 1 ? (e.vx * toT.x + e.vy * toT.y + e.vz * toT.z) / speed : 0;
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.los && facing > 0.8 && d < 220) {
        e.burstLeft = 6;
        e.fireTimer = 1.4;
      }
      if (d < 35) {
        e.state = "retreat";
        e.stateTimer = this.rng.range(2.5, 4);
      }
    }
    if (speed > 2) this.faceTowards(e, { x: e.x + e.vx, y: 0, z: e.z + e.vz }, dt, 4);
    this.burst(e, dt, p, 150, 4, 0.05, 0.018);
    this.flyMove(e, dt, 18);
  }

  /** Hunter-killer swarmer: tiny, fast, fragile; buzzes around you in packs. */
  private updateSwarmer(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    if (!e.aware) {
      e.orbit += dt * 1.2;
      this.steerTo(e, e.anchor.x + Math.cos(e.orbit) * 8, e.anchor.y + Math.sin(e.phase * 3), e.anchor.z + Math.sin(e.orbit) * 8, 14, dt, 3);
      this.flyMove(e, dt, 3);
      return;
    }
    e.orbit += e.strafe * dt * 1.6;
    const r = 11 + Math.sin(e.phase * 2.3) * 4;
    this.steerTo(e, t.x + Math.cos(e.orbit) * r, t.y + 2 + Math.sin(e.phase * 3.1) * 4, t.z + Math.sin(e.orbit) * r, 40, dt, 4);
    this.faceTowards(e, t, dt, 10);
    this.flyMove(e, dt, 2);
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && e.los && d < 90) {
      e.fireTimer = this.rng.range(1.0, 1.7);
      e.burstLeft = 1;
    }
    this.burst(e, dt, p, 90, 2, 0.1, 0.04);
  }

  /** EMP jammer: closes in, charges, and pulses - draining your suit's power. */
  private updateJammer(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    if (!e.aware) {
      this.steerTo(e, e.anchor.x, e.anchor.y + Math.sin(e.phase) * 2, e.anchor.z, 8, dt);
      this.flyMove(e, dt, 5);
      e.charge = 0;
      return;
    }
    this.faceTowards(e, t, dt, 4);
    if (e.state === "charge") {
      // Hold position while the pulse builds (glows brighter).
      e.stateTimer -= dt;
      e.charge = 1 - e.stateTimer / 1.4;
      this.steerTo(e, e.x, e.y, e.z, 0, dt, 3);
      this.flyMove(e, dt, 5);
      if (e.stateTimer <= 0) {
        e.charge = 0;
        e.state = "engage";
        e.fireTimer = this.rng.range(5, 7);
        this.weapons?.emp(this.center(e), EMP_RADIUS, 28, 4);
      }
      return;
    }
    e.orbit += e.strafe * dt * 0.7;
    this.steerTo(e, t.x + Math.cos(e.orbit) * 20, t.y + 4, t.z + Math.sin(e.orbit) * 20, 30, dt, 2);
    this.flyMove(e, dt, 5);
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && d < EMP_RADIUS * 0.9) {
      e.state = "charge";
      e.stateTimer = 1.4;
    }
  }

  /**
   * Dreadnought carrier (boss): a slow armoured airship that circles high
   * above, launches swarmers, fires missile salvos and flak.
   */
  private updateCarrier(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    if (!e.aware) {
      e.orbit += dt * 0.05;
      this.steerTo(e, e.anchor.x + Math.cos(e.orbit) * 60, e.anchor.y, e.anchor.z + Math.sin(e.orbit) * 60, 6, dt, 0.5);
    } else {
      e.orbit += e.strafe * dt * 0.06;
      this.steerTo(e, t.x + Math.cos(e.orbit) * 120, Math.max(t.y + 55, e.anchor.y), t.z + Math.sin(e.orbit) * 120, 12, dt, 0.5);
    }
    this.faceTowards(e, { x: e.x + e.vx, y: 0, z: e.z + e.vz }, dt, 0.5);
    this.flyMove(e, dt, 40);
    if (!e.aware) return;
    // Launch bay: swarmers drop out of the belly.
    e.moveTimer -= dt;
    if (e.moveTimer <= 0) {
      e.moveTimer = this.rng.range(8, 11);
      let mine = 0;
      // Launched swarmers get their own (negative) group so they don't count
      // toward the incident the carrier belongs to.
      for (const o of this.enemies) if (o.alive && o.kind === "swarmer" && o.group === -e.id) mine++;
      for (let k = 0; k < 3 && mine < CARRIER_MAX_SWARM; k++, mine++) {
        const s = this.launch("swarmer", e.x + this.rng.range(-4, 4), e.y - 4, e.z + this.rng.range(-4, 4), -e.id);
        s.vy = -10;
      }
    }
    // Missile salvo from the flanks.
    e.missileTimer -= dt;
    if (e.missileTimer <= 0 && e.los) {
      e.missileTimer = this.rng.range(6, 8);
      for (const side of [-1, 1, -1, 1]) {
        const from = { x: e.x + Math.cos(e.yaw) * side * 8, y: e.y + 1, z: e.z - Math.sin(e.yaw) * side * 8 };
        this.weapons?.missile(from, norm({ x: (t.x - from.x) * 0.4, y: 1, z: (t.z - from.z) * 0.4 }), 12);
      }
    }
    // Flak turrets.
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && e.los && d < 300) {
      e.burstLeft = 5;
      e.fireTimer = this.rng.range(1.8, 2.6);
    }
    this.burst(e, dt, p, 110, 3, 0.12, 0.06);
  }

  /**
   * Sentinel (Ultron-style flying robot): circles, then telegraphs and
   * rams you at high speed, peels off, and fires hand blasts in between.
   */
  private updateSentinel(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    if (!e.aware) {
      e.orbit += dt * 0.4;
      this.steerTo(e, e.anchor.x + Math.cos(e.orbit) * 14, e.anchor.y, e.anchor.z + Math.sin(e.orbit) * 14, 10, dt);
      this.flyMove(e, dt, 4);
      return;
    }
    this.faceTowards(e, t, dt, 8);
    e.stateTimer -= dt;
    if (e.state === "charge") {
      // Wind-up: hold still, eyes glowing.
      e.charge = 1 - e.stateTimer / 0.6;
      this.steerTo(e, e.x, e.y, e.z, 0, dt, 4);
      if (e.stateTimer <= 0) {
        e.state = "slam";
        e.stateTimer = 1.2;
        const dir = norm({ x: t.x - e.x, y: t.y - e.y, z: t.z - e.z });
        e.vx = dir.x * 62;
        e.vy = dir.y * 62;
        e.vz = dir.z * 62;
        e.charge = 0;
      }
    } else if (e.state === "slam") {
      // Ramming dash: hits once on contact.
      if (d < 3 && e.burstLeft !== -1) {
        p.takeHit(12);
        e.burstLeft = -1;
        this.weapons?.shockwave(this.center(e), 6);
      }
      if (e.stateTimer <= 0) {
        e.state = "retreat";
        e.stateTimer = 1.6;
        e.burstLeft = 0;
      }
    } else {
      if (e.state === "patrol") e.state = "engage";
      e.orbit += e.strafe * dt * 0.9;
      const r = e.state === "retreat" ? 45 : 24;
      this.steerTo(e, t.x + Math.cos(e.orbit) * r, t.y + 4 + Math.sin(e.phase) * 3, t.z + Math.sin(e.orbit) * r, 34, dt, 2.5);
      if (e.state === "retreat" && e.stateTimer <= 0) e.state = "engage";
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.los) {
        e.fireTimer = this.rng.range(1.6, 2.6);
        e.burstLeft = 2;
      }
      e.moveTimer -= dt;
      if (e.moveTimer <= 0 && e.state === "engage" && d < 70 && e.los) {
        e.moveTimer = this.rng.range(4, 6.5);
        e.state = "charge";
        e.stateTimer = 0.6;
      }
    }
    if (e.state !== "slam") this.burst(e, dt, p, 95, 4, 0.12, 0.03);
    this.flyMove(e, dt, 3);
  }

  /** Spider walker: six-legged street walker that lobs fans of mortar shells. */
  private updateSpider(e: Enemy, dt: number, p: CombatTarget, _d: number): void {
    const t = p.center;
    if (!e.aware) {
      e.yaw += dt * 0.2;
      return;
    }
    this.faceTowards(e, t, dt, 1.8);
    const flat = Math.hypot(t.x - e.x, t.z - e.z);
    if (flat > 45) {
      const sp = 6 * dt;
      const fx = Math.sin(e.yaw) * sp, fz = Math.cos(e.yaw) * sp;
      const tryMove = (mx: number, mz: number) => {
        const nx = e.x + mx, nz = e.z + mz;
        if (this.world.overlaps(nx - 2, e.ground + 0.5, nz - 2, nx + 2, e.ground + 3, nz + 2)) return false;
        if (Math.abs(this.world.surfaceBelow(nx, e.ground + 0.5, nz, 1) - e.ground) > 0.6) return false;
        e.x = nx;
        e.z = nz;
        return true;
      };
      if (!tryMove(fx, fz)) tryMove(fz * e.strafe, -fx * e.strafe) || (e.strafe *= -1);
    }
    e.fireTimer -= dt;
    e.charge = clamp01(1 - e.fireTimer / 0.7);
    if (e.fireTimer <= 0 && e.los) {
      e.fireTimer = this.rng.range(4, 5.5);
      const from = { x: e.x, y: e.y + 3.2, z: e.z };
      for (const spread of [-0.18, 0, 0.18]) {
        const T = clamp01(Math.hypot(t.x - from.x, t.z - from.z) / 140) * 2.4 + 0.8;
        const c = Math.cos(spread), s = Math.sin(spread);
        const rx = t.x - from.x, rz = t.z - from.z;
        const ax = from.x + rx * c - rz * s, az = from.z + rx * s + rz * c;
        const g = 14;
        this.weapons?.shell(from, { x: (ax - from.x) / T, y: (t.y - from.y + 0.5 * g * T * T) / T, z: (az - from.z) / T }, 10);
      }
    }
  }

  /**
   * Cloaker: invisible stealth drone. It shimmers into view only to fire a
   * burst, then fades again. Hitting it knocks the cloak off briefly.
   */
  /**
   * Heavy bomber: flies straight carpet-bombing runs over the target, drops a
   * stick of bombs while overhead, then extends and turns for another pass.
   * A tail gunner covers its six.
   */
  private updateBomber(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    const alt = Math.max(e.anchor.y, t.y + 45);
    if (!e.aware) {
      e.orbit += dt * 0.08;
      this.steerTo(e, e.anchor.x + Math.cos(e.orbit) * 180, e.anchor.y, e.anchor.z + Math.sin(e.orbit) * 180, 30, dt, 0.6);
    } else if (e.state === "retreat") {
      // Extend past the target, then swing round.
      e.stateTimer -= dt;
      this.steerTo(e, e.x + e.vx * 3 + Math.cos(e.phase * 0.4) * 40, alt, e.z + e.vz * 3 + Math.sin(e.phase * 0.4) * 40, 48, dt, 0.5);
      if (e.stateTimer <= 0) e.state = "engage";
    } else {
      // Run in toward the target's position.
      this.steerTo(e, t.x, alt, t.z, 48, dt, 0.7);
      const flat = Math.hypot(t.x - e.x, t.z - e.z);
      e.charge = Math.max(0, 1 - flat / 120);
      e.fireTimer -= dt;
      if (flat < 70 && e.fireTimer <= 0) {
        // Bombs away: they keep some of the bomber's speed and arc down.
        e.fireTimer = 0.25;
        const from = { x: e.x, y: e.y - 2.2, z: e.z };
        this.weapons?.shell(from, { x: e.vx * 0.7, y: -4, z: e.vz * 0.7 }, 22);
      }
      // Past the target and opening the range: extend for the next pass.
      const passed = (t.x - e.x) * e.vx + (t.z - e.z) * e.vz < 0;
      if (passed && flat > 50) {
        e.state = "retreat";
        e.stateTimer = this.rng.range(5, 7);
        e.charge = 0;
      }
    }
    // Tail gunner.
    e.missileTimer -= dt;
    if (e.aware && e.los && e.missileTimer <= 0 && d < 260) {
      e.missileTimer = this.rng.range(2.5, 4);
      e.burstLeft = 4;
    }
    this.burst(e, dt, p, 110, 4, 0.12, 0.03);
    const sp = Math.hypot(e.vx, e.vz);
    if (sp > 2) this.faceTowards(e, { x: e.x + e.vx, y: 0, z: e.z + e.vz }, dt, 1.2);
    this.flyMove(e, dt, 30);
  }

  /**
   * Air mine: hangs in the sky (bobbing), wakes when something flies close,
   * drifts after it blinking faster and faster, and detonates on contact.
   */
  private updateMine(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    const near = p.targetable && d < ENEMY_STATS.mine.range * 0.45;
    if (!near) {
      e.charge = Math.max(0, e.charge - dt);
      this.steerTo(e, e.anchor.x, e.anchor.y + Math.sin(e.phase * 1.3) * 1.2, e.anchor.z, 3, dt, 1);
      this.flyMove(e, dt, 2);
      return;
    }
    e.charge = Math.min(1, e.charge + dt * 0.8);
    this.steerTo(e, t.x, t.y, t.z, 9 + e.charge * 9, dt, 1.5);
    this.flyMove(e, dt, 1);
    if (d < MINE_TRIGGER) {
      e.alive = false;
      this.weapons?.explode(this.center(e), 6, 16, true);
    }
  }

  /**
   * Rooftop flak turret: tracks flyers and fires bursts of air-burst shells
   * that detonate around the target's predicted position.
   */
  private updateTurret(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    if (!e.aware) {
      e.yaw += dt * 0.3; // sweeping the sky
      e.charge = 0;
      return;
    }
    this.faceTowards(e, t, dt, 3);
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && e.los && d < ENEMY_STATS.turret.range) {
      e.fireTimer = this.rng.range(2.2, 3.2);
      e.burstLeft = 3;
      e.charge = 1;
    }
    e.charge = Math.max(0, e.charge - dt * 0.8);
    if (e.burstLeft > 0) {
      e.burstTimer -= dt;
      if (e.burstTimer <= 0) {
        e.burstTimer = 0.28;
        e.burstLeft--;
        e.flash = Math.max(e.flash, 0.4);
        // Flak: aim ahead of the target and scatter, so moving targets get missed.
        const tof = d / 220;
        const r = 7 + this.rng.range(0, 7);
        const a = this.rng.range(0, Math.PI * 2);
        const at = { x: t.x + p.vel.x * tof * 0.7 + Math.cos(a) * r, y: t.y + p.vel.y * tof * 0.7 + this.rng.range(-3, 5), z: t.z + p.vel.z * tof * 0.7 + Math.sin(a) * r };
        this.weapons?.beam(this.center(e), at, "telegraph");
        this.weapons?.explode(at, 4.5, 6, true);
      }
    }
  }

  /**
   * Rogue armour (mini-boss): a rival powered suit. Circle-strafes firing
   * paired repulsor blasts, launches missile salvos, barrel-rolls away from
   * your shots and makes boosted ramming dashes.
   */
  private updateRival(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    e.jet = Math.max(0, e.jet - dt * 2);
    if (!e.aware) {
      e.orbit += dt * 0.4;
      this.steerTo(e, e.anchor.x + Math.cos(e.orbit) * 30, e.anchor.y + Math.sin(e.phase) * 3, e.anchor.z + Math.sin(e.orbit) * 30, 18, dt, 1.5);
      this.faceTowards(e, { x: e.x + e.vx, y: 0, z: e.z + e.vz }, dt, 3);
      this.flyMove(e, dt, 6);
      return;
    }
    this.faceTowards(e, t, dt, 8);
    e.stateTimer -= dt;
    if (e.state === "charge") {
      // Boosted ramming dash.
      e.jet = 1;
      const dir = norm({ x: t.x - e.x, y: t.y - e.y, z: t.z - e.z });
      this.steerTo(e, t.x + dir.x * 20, t.y + dir.y * 20, t.z + dir.z * 20, 105, dt, 4);
      if (d < 5) {
        this.weapons?.explode(this.center(e), 3.5, 14, true);
        e.state = "retreat";
        e.stateTimer = 1.5;
      } else if (e.stateTimer <= 0) {
        e.state = "engage";
        e.stateTimer = this.rng.range(4, 7);
      }
    } else if (e.state === "retreat") {
      const away = norm({ x: e.x - t.x, y: 0.4, z: e.z - t.z });
      this.steerTo(e, e.x + away.x * 60, e.y + away.y * 60, e.z + away.z * 60, 70, dt, 3);
      if (e.stateTimer <= 0) {
        e.state = "engage";
        e.stateTimer = this.rng.range(4, 7);
      }
    } else {
      e.moveTimer -= dt;
      if (e.moveTimer <= 0) {
        e.moveTimer = this.rng.range(1.2, 2.6);
        if (this.rng.chance(0.5)) e.strafe *= -1;
      }
      e.orbit += e.strafe * dt * 0.9;
      const radius = 45 + Math.sin(e.phase * 0.6) * 12;
      this.steerTo(e, t.x + Math.cos(e.orbit) * radius, t.y + 8 + Math.sin(e.phase * 1.1) * 6, t.z + Math.sin(e.orbit) * radius, 58, dt, 2.5);
      // Paired repulsor blasts.
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.los && d < ENEMY_STATS.rival.range) {
        e.fireTimer = this.rng.range(0.9, 1.5);
        e.burstLeft = 2;
      }
      // Missile salvo.
      e.missileTimer -= dt;
      if (e.missileTimer <= 0 && e.los) {
        e.missileTimer = this.rng.range(7, 10);
        const from = this.center(e);
        for (let k = 0; k < 4; k++) {
          const dir = this.aimAt(from, p, 80, 0.25);
          this.weapons?.missile(from, { x: dir.x, y: dir.y + 0.3, z: dir.z }, 9);
        }
      }
      if (e.stateTimer <= 0 && d < 160) {
        e.state = "charge";
        e.stateTimer = 2.2;
      }
    }
    this.burst(e, dt, p, 160, 5, 0.12, 0.02);
    this.flyMove(e, dt, 5);
  }

  private updateCloaker(e: Enemy, dt: number, p: CombatTarget, d: number): void {
    const t = p.center;
    e.orbit += e.strafe * dt * 0.5;
    const r = 40 + Math.sin(e.phase * 0.5) * 12;
    if (!e.aware) {
      this.steerTo(e, e.anchor.x + Math.cos(e.orbit) * 20, e.anchor.y, e.anchor.z + Math.sin(e.orbit) * 20, 10, dt);
      this.flyMove(e, dt, 5);
      return;
    }
    this.steerTo(e, t.x + Math.cos(e.orbit) * r, t.y + 8, t.z + Math.sin(e.orbit) * r, 28, dt, 1.8);
    this.faceTowards(e, t, dt, 5);
    this.flyMove(e, dt, 5);
    e.stateTimer -= dt;
    if (e.state === "engage") {
      // Decloaked: fire, then vanish again.
      if (e.stateTimer <= 0) {
        e.state = "patrol";
        e.stateTimer = this.rng.range(3, 5);
      }
    } else if (e.stateTimer <= 0 && e.los && d < 200) {
      e.state = "engage";
      e.stateTimer = 1.6;
      e.burstLeft = 4;
    }
    this.burst(e, dt, p, 100, 5, 0.18, 0.025);
  }

  private toWalk(e: Enemy): void {
    e.state = "engage";
    e.stateTimer = this.rng.range(2.5, 4.5);
  }
}
