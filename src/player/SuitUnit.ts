import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import type { SuitSystems } from "./SuitSystems";
import { SUIT_PARTS } from "./SuitSystems";
import type { FlightMode, PlayerController } from "./PlayerController";
import type { AvatarState } from "./ArmorModel";
import type { CombatTarget } from "../combat/Targets";
import type { Enemy, EnemyManager } from "../combat/Enemies";
import type { ProjectileSystem } from "../combat/Projectiles";
import { clamp, damp, dampAngle, wrapAngle } from "../core/math";
import { dist, norm, type V3 } from "../combat/math3";

export type SuitUnitState = "worn" | "parked" | "sentry" | "inbound";

const SENTRY_RANGE = 200;
const INBOUND_SPEED = 80;
const DOCK_DISTANCE = 2.6;

/**
 * The armour as an independent unit when nobody is wearing it: it can stand
 * parked, guard the civilian in sentry mode (fighting hostiles on its own),
 * or fly across the city when called and dock onto the player.
 * Shares SuitSystems (energy / integrity) with the player - it is the same suit.
 */
export class SuitUnit implements CombatTarget, AvatarState {
  state: SuitUnitState = "worn";
  readonly pos = { x: 0, y: 0, z: 0 };
  readonly vel = { x: 0, y: 0, z: 0 };
  mode: FlightMode = "ground";
  readonly suited = true;
  bodyYaw = 0;
  bodyPitch = 0;
  bodyRoll = 0;
  rollSpin = 0;
  walkPhase = 0;
  landingTimer = 0;
  viewPitch = 0;
  rocketTimer = 0;
  aimTimer = 0;
  thrust = 0;
  afterburner = false;
  agl = 0;
  kills = 0;
  private target: Enemy | null = null;
  private scanTimer = 0;
  private fireTimer = 0;
  private rocketCooldown = 3;
  private rollTimer = 0;
  private rollDir = 0;
  private rollCooldown = 0;
  private inboundTime = 0;
  private orbit = 0;
  private side = 1;
  private blocked = false;

  constructor(
    private world: CollisionWorld,
    readonly suit: SuitSystems,
    private enemies: EnemyManager,
    private projectiles: ProjectileSystem,
    private bus?: EventBus<GameEvents>,
  ) {}

  // --- CombatTarget ---------------------------------------------------------

  get center(): V3 {
    return { x: this.pos.x, y: this.pos.y + (this.mode === "flight" ? 1.0 : 1.1), z: this.pos.z };
  }

  /** Only an active sentry draws fire; a parked or inbound suit is ignored. */
  get targetable(): boolean {
    return this.state === "sentry";
  }

  get evading(): boolean {
    return this.rollTimer > 0;
  }

  takeHit(damage: number): boolean {
    if (!this.targetable) return false;
    if (this.evading) return false;
    const part = SUIT_PARTS[Math.floor(Math.random() * SUIT_PARTS.length)];
    this.suit.damage(damage, [part, "chest"]);
    if (this.suit.overallIntegrity < 15) {
      this.state = "parked";
      this.target = null;
      this.bus?.emit("alert", { text: "Sentry offline - armour critical, self-repair running", level: "critical", ttl: 5 });
    }
    return true;
  }

  // --- Commands ---------------------------------------------------------------

  get operational(): boolean {
    return this.suit.overallIntegrity >= 15;
  }

  /** Player stepped out: the empty suit stays standing here. */
  park(x: number, y: number, z: number, yaw: number): void {
    this.state = "parked";
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.bodyYaw = yaw;
    this.bodyPitch = this.bodyRoll = 0;
    this.mode = "ground";
    this.thrust = 0;
  }

  setSentry(on: boolean): boolean {
    if (this.state === "worn") return false;
    if (on && !this.operational) {
      this.bus?.emit("alert", { text: `Suit too damaged for sentry duty (${Math.round(this.suit.overallIntegrity)}%)`, level: "warn" });
      return false;
    }
    this.state = on ? "sentry" : "parked";
    this.target = null;
    this.bus?.emit("alert", { text: on ? "Sentry mode engaged - suit is guarding you" : "Sentry mode off - suit holding position", level: on ? "success" : "info", ttl: 3 });
    return true;
  }

  /** Summon the suit: it flies to the player and docks. */
  call(): boolean {
    if (this.state === "worn" || this.state === "inbound") return false;
    if (!this.operational) {
      this.bus?.emit("alert", { text: `Suit offline - self-repair at ${Math.round(this.suit.overallIntegrity)}%`, level: "warn" });
      return false;
    }
    this.state = "inbound";
    this.inboundTime = 0;
    this.target = null;
    return true;
  }

  // --- Simulation -------------------------------------------------------------

  /** Returns true on the frame the suit docks onto the player. */
  update(dt: number, p: PlayerController): boolean {
    dt = Math.min(dt, 0.05);
    if (this.state === "worn") return false;
    if (this.rocketTimer > 0) this.rocketTimer -= dt;
    if (this.aimTimer > 0) this.aimTimer -= dt;
    if (this.rollCooldown > 0) this.rollCooldown -= dt;
    this.updateRoll(dt);

    let docked = false;
    if (this.state === "parked") this.updateParked(dt);
    else if (this.state === "sentry") this.updateSentry(dt, p);
    else docked = this.updateInbound(dt, p);

    const surface = this.world.surfaceBelow(this.pos.x, this.pos.y + 0.05, this.pos.z, 0.45);
    this.agl = this.pos.y - surface;
    return docked;
  }

  private updateParked(dt: number): void {
    // Settle onto the ground if left hovering.
    const surface = this.world.surfaceBelow(this.pos.x, this.pos.y + 0.05, this.pos.z, 0.45);
    if (this.pos.y > surface + 0.02) {
      this.mode = "hover";
      this.vel.y = Math.max(this.vel.y - 12 * dt, -7);
      this.pos.y = Math.max(surface, this.pos.y + this.vel.y * dt);
      this.thrust = 0.4;
    } else {
      this.pos.y = surface;
      this.vel.y = 0;
      this.mode = "ground";
      this.thrust = Math.max(0, this.thrust - dt * 2);
    }
    this.vel.x = this.vel.z = 0;
    this.bodyPitch += (0 - this.bodyPitch) * damp(6, dt);
    this.bodyRoll += (0 - this.bodyRoll) * damp(6, dt);
  }

  private updateSentry(dt: number, p: PlayerController): void {
    // Pick the nearest visible hostile.
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.3;
      this.target = this.findTarget();
    }
    if (this.target && !this.target.alive) this.target = null;

    // Escort position: ahead and to one side of where the civilian is looking
    // (so you can watch it work) - whichever side is not inside a building.
    const yaw = p.viewYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let oy = 3;
    let ox = 0, oz = 0;
    for (const [fwd, right, up] of [
      [6, 4.5, 0],
      [6, -4.5, 0],
      [-3, 0, 4],
    ]) {
      const cx = p.pos.x + fx * fwd + rx * right, cz = p.pos.z + fz * fwd + rz * right;
      if (!this.world.overlaps(cx - 1, p.pos.y + oy + up - 1, cz - 1, cx + 1, p.pos.y + oy + up + 2.5, cz + 1)) {
        ox = cx - p.pos.x;
        oz = cz - p.pos.z;
        oy += up;
        break;
      }
    }
    if (this.target) {
      this.orbit += dt * 0.6;
      const wx = ox + Math.cos(this.orbit) * 5, wz = oz + Math.sin(this.orbit) * 5;
      // Only weave where there is open air.
      if (!this.world.overlaps(p.pos.x + wx - 1, p.pos.y + 4, p.pos.z + wz - 1, p.pos.x + wx + 1, p.pos.y + 7.5, p.pos.z + wz + 1)) {
        ox = wx;
        oz = wz;
      }
      oy = Math.max(oy, 5 + Math.sin(this.orbit * 1.7) * 2);
    }
    const far = dist(this.pos, p.pos) > 120;
    this.steer(p.pos.x + ox, p.pos.y + oy, p.pos.z + oz, far ? 70 : 30, dt);
    this.fly(dt, 3);

    if (this.target) {
      const c = this.enemies.center(this.target);
      this.bodyYaw = dampAngle(this.bodyYaw, Math.atan2(c.x - this.pos.x, c.z - this.pos.z), 8, dt);
      const flat = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
      this.viewPitch = Math.atan2(c.y - this.center.y, flat);
      this.engage(dt, c);
    } else {
      this.bodyYaw = dampAngle(this.bodyYaw, yaw, 3, dt);
      this.viewPitch = 0;
    }
    this.dodgeMissiles();
  }

  private findTarget(): Enemy | null {
    let best: Enemy | null = null;
    let bd = SENTRY_RANGE;
    const me = this.center;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const c = this.enemies.center(e);
      const d = dist(me, c);
      if (d >= bd) continue;
      const dir = norm({ x: c.x - me.x, y: c.y - me.y, z: c.z - me.z });
      if (this.world.raycast(me.x, me.y, me.z, dir.x, dir.y, dir.z, d - 1) !== Infinity) continue;
      best = e;
      bd = d;
    }
    return best;
  }

  private engage(dt: number, c: V3): void {
    const t = this.target!;
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && this.suit.energy > 2) {
      this.fireTimer = 0.28;
      this.suit.drain(0.4);
      this.aimTimer = 0.6;
      const from = this.muzzle(this.side);
      this.side = -this.side;
      const tof = dist(from, c) / 240;
      const aim = { x: c.x + t.vx * tof - from.x, y: c.y + t.vy * tof - from.y, z: c.z + t.vz * tof - from.z };
      this.projectiles.playerBolt(from, aim);
      this.enemies.threaten(t);
      this.bus?.emit("weapon", { kind: "repulsor", ...from });
    }
    this.rocketCooldown -= dt;
    if (this.rocketCooldown <= 0) {
      this.rocketCooldown = 5;
      this.rocketTimer = 0.8;
      for (const side of [1, -1]) {
        const from = this.muzzle(side);
        const dir = norm({ x: c.x - from.x, y: c.y - from.y + 6, z: c.z - from.z });
        this.projectiles.playerRocket(from, dir, t);
      }
      this.bus?.emit("weapon", { kind: "rocket", ...this.center });
    }
  }

  /** Barrel-roll away from missiles homing on the suit. */
  private dodgeMissiles(): void {
    if (this.rollCooldown > 0) return;
    for (const m of this.projectiles.projectiles) {
      if (m.kind !== "missile" || m.homing !== this) continue;
      if (dist(m, this.center) < 25) {
        this.rollDir = Math.random() < 0.5 ? -1 : 1;
        this.rollTimer = 0.55;
        this.rollCooldown = 2.5;
        this.vel.x += Math.cos(this.bodyYaw) * this.rollDir * 22;
        this.vel.z += -Math.sin(this.bodyYaw) * this.rollDir * 22;
        return;
      }
    }
  }

  private updateRoll(dt: number): void {
    if (this.rollTimer > 0) {
      this.rollTimer = Math.max(0, this.rollTimer - dt);
      const t = 1 - this.rollTimer / 0.55;
      this.rollSpin = -this.rollDir * t * t * (3 - 2 * t) * Math.PI * 2;
    } else this.rollSpin = 0;
  }

  private updateInbound(dt: number, p: PlayerController): boolean {
    this.inboundTime += dt;
    const goal = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    const flat = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
    let tx = goal.x, ty = goal.y, tz = goal.z;
    if (flat > 45) {
      // Cruise above the rooftops along the way.
      const ahead = Math.min(flat, 60) / flat;
      const sx = this.pos.x + (goal.x - this.pos.x) * ahead, sz = this.pos.z + (goal.z - this.pos.z) * ahead;
      ty = Math.max(goal.y + 15, this.world.surfaceBelow(sx, 1000, sz, 3, 0) + 18, this.world.surfaceBelow(this.pos.x, 1000, this.pos.z, 3, 0) + 12);
    }
    const d = dist(this.pos, goal);
    const speed = Math.min(INBOUND_SPEED, 6 + d * 1.6);
    this.steer(tx, ty, tz, speed, dt, flat > 45 ? 3 : 6);
    this.fly(dt, flat > 45 ? 4 : 0);
    if (Math.hypot(this.vel.x, this.vel.z) > 3) this.bodyYaw = dampAngle(this.bodyYaw, Math.atan2(this.vel.x, this.vel.z), 6, dt);
    this.viewPitch = 0;
    // Dock when close (or give up on a stuck path after a while).
    // Dock when close - also when a wall right next to the player is in the way.
    if (d < DOCK_DISTANCE || (this.blocked && flat < 4 && Math.abs(this.pos.y - goal.y) < 4) || this.inboundTime > 30) {
      this.state = "worn";
      this.vel.x = this.vel.y = this.vel.z = 0;
      return true;
    }
    return false;
  }

  private steer(tx: number, ty: number, tz: number, maxSpeed: number, dt: number, rate = 2.5): void {
    let dx = (tx - this.pos.x) * 1.4, dy = (ty - this.pos.y) * 1.4, dz = (tz - this.pos.z) * 1.4;
    const l = Math.hypot(dx, dy, dz);
    if (l > maxSpeed) {
      dx *= maxSpeed / l;
      dy *= maxSpeed / l;
      dz *= maxSpeed / l;
    }
    const k = damp(rate, dt);
    this.vel.x += (dx - this.vel.x) * k;
    this.vel.y += (dy - this.vel.y) * k;
    this.vel.z += (dz - this.vel.z) * k;
  }

  /** Integrate flight with simple building avoidance; poses the body. */
  private fly(dt: number, clearance: number): void {
    this.blocked = false;
    const speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    // Climb if a building is right ahead (only when really travelling).
    if (speed > 14) {
      const c = this.center;
      const dir = { x: this.vel.x / speed, y: 0, z: this.vel.z / speed };
      if (this.world.raycast(c.x, c.y, c.z, dir.x, 0, dir.z, Math.max(8, speed * 0.6)) !== Infinity) this.vel.y = Math.max(this.vel.y, 18);
    }
    const nx = this.pos.x + this.vel.x * dt, ny = this.pos.y + this.vel.y * dt, nz = this.pos.z + this.vel.z * dt;
    const r = 0.5;
    if (!this.world.overlaps(nx - r, ny + 0.3, nz - r, nx + r, ny + 1.9, nz + r)) {
      this.pos.x = nx;
      this.pos.y = ny;
      this.pos.z = nz;
    } else {
      this.blocked = true;
      this.vel.x *= 0.3;
      this.vel.z *= 0.3;
      this.vel.y = Math.max(this.vel.y, 10);
      this.pos.y += 10 * dt;
    }
    const floor = this.world.surfaceBelow(this.pos.x, this.pos.y + 0.5, this.pos.z, r);
    if (this.pos.y < floor + clearance) this.pos.y += (floor + clearance - this.pos.y) * Math.min(1, dt * 3);
    if (this.pos.y < floor) this.pos.y = floor;

    // Pose: hover lean at low speed, superhero flight pose when fast.
    const fast = speed > 28;
    this.mode = fast ? "flight" : "hover";
    this.thrust = clamp(0.45 + speed / 90, 0, 1);
    this.afterburner = speed > 60;
    if (fast) {
      const pitch = Math.asin(clamp(this.vel.y / Math.max(speed, 1e-3), -1, 1));
      this.bodyPitch += (Math.PI / 2 - pitch - this.bodyPitch) * damp(5, dt);
    } else {
      const fwd = this.vel.x * Math.sin(this.bodyYaw) + this.vel.z * Math.cos(this.bodyYaw);
      this.bodyPitch += (clamp(fwd / 18, -1, 1) * 0.35 - this.bodyPitch) * damp(5, dt);
    }
    const side = this.vel.x * Math.cos(this.bodyYaw) - this.vel.z * Math.sin(this.bodyYaw);
    this.bodyRoll += (clamp(-side / 25, -0.8, 0.8) - this.bodyRoll) * damp(4, dt);
    this.bodyYaw = wrapAngle(this.bodyYaw);
  }

  private muzzle(side: number): V3 {
    const c = this.center;
    return { x: c.x + Math.cos(this.bodyYaw) * 0.5 * side + Math.sin(this.bodyYaw) * 0.9, y: c.y + 0.35, z: c.z - Math.sin(this.bodyYaw) * 0.5 * side + Math.cos(this.bodyYaw) * 0.9 };
  }
}
