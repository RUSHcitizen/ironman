import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import type { PlayerController } from "../player/PlayerController";
import { Rng } from "../core/math";
import { dist, len, norm, type V3 } from "./math3";

export type EnemyKind = "drone" | "kamikaze" | "trooper" | "warbot";

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
}

/** How enemies hurt things - implemented by the projectile system. */
export interface EnemyWeapons {
  bolt(from: V3, dir: V3, speed: number, damage: number): void;
  missile(from: V3, dir: V3, damage: number): void;
  explode(at: V3, size: number, damage: number, hurtsPlayer: boolean): void;
  beam(from: V3, to: V3, kind: "telegraph" | "laser"): void;
  shockwave(at: V3, radius: number): void;
}

/**
 * Hostile units and their behaviours. Pure simulation (no rendering) so it can
 * be unit-tested headlessly. Enemies ignore the player while out of the suit.
 */
export class EnemyManager {
  readonly enemies: Enemy[] = [];
  kills = 0;
  private nextId = 1;
  private rng = new Rng(777);
  weapons: EnemyWeapons | null = null;

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
    };
    this.enemies.push(e);
    return e;
  }

  clear(): void {
    this.enemies.length = 0;
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
    } else if (e.kind === "trooper" && e.state !== "hop" && this.rng.chance(0.25)) {
      this.startHop(e);
      e.dodgeCooldown = 3;
    }
  }

  damage(e: Enemy, amount: number): void {
    if (!e.alive) return;
    e.hp -= amount;
    e.flash = 1;
    e.aware = true;
    if (e.hp <= 0) {
      e.alive = false;
      this.kills++;
      const c = this.center(e);
      const size = e.kind === "warbot" ? 9 : e.kind === "kamikaze" ? 5 : 3.2;
      this.weapons?.explode(c, size, e.kind === "kamikaze" ? 8 : 0, true);
      this.bus?.emit("kill", { kind: e.kind, total: this.kills });
    } else if (e.kind === "drone" && e.hp < e.maxHp * 0.35 && e.state !== "retreat") {
      e.state = "retreat";
      e.stateTimer = 2.2;
    }
  }

  update(dt: number, p: PlayerController): void {
    const target = p.center;
    const hostile = p.suited && p.transformTimer <= 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.phase += dt;
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
      }
    }
    // Drop long-dead entries.
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
  private aimAt(from: V3, p: PlayerController, speed: number, spread: number): V3 {
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

  private updateDrone(e: Enemy, dt: number, p: PlayerController, d: number): void {
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

  private burst(e: Enemy, dt: number, p: PlayerController, speed: number, damage: number, interval: number, spread: number): void {
    if (e.burstLeft <= 0) return;
    e.burstTimer -= dt;
    if (e.burstTimer > 0) return;
    e.burstTimer = interval;
    e.burstLeft--;
    const from = this.center(e);
    from.y += e.kind === "trooper" ? 0.3 : e.kind === "warbot" ? 1.2 : 0;
    this.weapons?.bolt(from, this.aimAt(from, p, speed, spread), speed, damage);
  }

  private updateKamikaze(e: Enemy, dt: number, p: PlayerController, d: number): void {
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

  private updateTrooper(e: Enemy, dt: number, p: PlayerController, d: number): void {
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

  private updateWarbot(e: Enemy, dt: number, p: PlayerController, _d: number): void {
    const t = p.center;
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
            if (this.world.overlaps(nx - 2.2, e.ground + 0.5, nz - 2.2, nx + 2.2, e.ground + 5, nz + 2.2)) return false;
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
          const low = t.y - e.ground < 10;
          const roll = this.rng.next();
          if (low && flat < 22) {
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
          const from = { x: e.x + Math.cos(e.yaw) * side * 1.8, y: e.y + 5.2, z: e.z - Math.sin(e.yaw) * side * 1.8 };
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
        const eye = { x: e.x + Math.sin(e.yaw) * 1.4, y: e.y + 4.4, z: e.z + Math.cos(e.yaw) * 1.4 };
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
          if (tt < len && Math.hypot(px, py, pz) < 1.8) p.takeHit(22);
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
          this.weapons?.shockwave({ x: e.x, y: e.ground + 0.3, z: e.z }, 22);
          if (flat < 22 && t.y - e.ground < 6) p.takeHit(16);
          this.toWalk(e);
        }
        break;
      }
      default:
        this.toWalk(e);
    }
  }

  private toWalk(e: Enemy): void {
    e.state = "engage";
    e.stateTimer = this.rng.range(2.5, 4.5);
  }
}
