import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import type { PlayerController } from "../player/PlayerController";
import type { InputState } from "../input/InputState";
import { ENEMY_STATS, isCloaked, type Enemy, type EnemyManager } from "./Enemies";
import type { ProjectileSystem } from "./Projectiles";
import { dist, norm, segmentPointDistance, type V3 } from "./math3";

/** Micro-rocket pod: two rockets (one per arm), rearmed a minute after firing. */
export const MAX_ROCKETS = 2;
export const ROCKET_RELOAD = 60;
/** Unibeam: chest laser, charged briefly then fired down the aim line. */
export const UNIBEAM = { cost: 25, charge: 0.45, cooldown: 4, damage: 180, reach: 700, width: 2.2 };
export const FLARE_COOLDOWN = 6;
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
  /** Seconds until the rocket pod is rearmed (0 when full). */
  rocketReload = 0;
  /** Hand the next repulsor shot comes from (+1 right, -1 left); alternates every shot. */
  private side = 1;
  private lockTimer = 0;
  aimAssist = 0.07; // radians; larger on touch
  /** Unibeam charge progress (seconds, -1 = idle) and cooldown. */
  beamCharge = -1;
  beamCooldown = 0;
  flareCooldown = 0;

  constructor(
    private world: CollisionWorld,
    private enemies: EnemyManager,
    private projectiles: ProjectileSystem,
    private bus?: EventBus<GameEvents>,
  ) {}

  refill(): void {
    this.rockets = MAX_ROCKETS;
    this.rocketReload = 0;
  }

  update(dt: number, input: InputState, p: PlayerController, camPos: V3): void {
    this.repulsorCooldown -= dt;
    if (this.rockets < MAX_ROCKETS) {
      this.rocketReload = Math.max(0, this.rocketReload - dt);
      if (this.rocketReload <= 0) this.rockets = MAX_ROCKETS;
    }
    const armed = p.suited && p.transformTimer <= 0;
    const aim = aimDirection(p);

    this.lockTimer -= dt;
    if (this.lockTimer <= 0) {
      this.lockTimer = 0.1;
      this.locks = armed ? this.findLocks(camPos, aim) : [];
      this.assistTarget = this.locks.find((e) => this.angleTo(camPos, aim, e) < this.aimAssist) ?? null;
    }
    this.beamCooldown -= dt;
    this.flareCooldown -= dt;
    if (!armed) {
      this.beamCharge = -1;
      return;
    }
    this.updateUnibeam(dt, input.beam, p, camPos, aim);
    if (input.flares) this.popFlares(p);

    if (input.fire && this.repulsorCooldown <= 0 && p.suit.energy > 0) {
      this.repulsorCooldown = 0.15;
      p.aimTimer = 0.7;
      p.recoil = 1;
      // Alternate hands every shot: right, left, right...
      const hand = this.side;
      this.side = -this.side;
      p.fireHand = hand;
      const from = this.muzzle(p, aim, hand);
      const target = this.assistTarget ? this.leadPoint(from, this.assistTarget, 240) : this.aimPoint(camPos, aim);
      this.projectiles.playerBolt(from, norm({ x: target.x - from.x, y: target.y - from.y, z: target.z - from.z }));
      if (this.assistTarget) this.enemies.threaten(this.assistTarget);
      this.bus?.emit("weapon", { kind: "repulsor", ...from });
    }

    if (input.rockets) {
      if (this.rockets <= 0) {
        this.bus?.emit("alert", { text: `Micro-rockets rearming · ${Math.ceil(this.rocketReload)} s`, level: "warn", ttl: 2 });
      } else {
        // The whole pod (one rocket per arm) goes at once; the next pair is a minute away.
        const n = this.rockets;
        this.rockets = 0;
        this.rocketReload = ROCKET_RELOAD;
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

  private updateUnibeam(dt: number, pressed: boolean, p: PlayerController, camPos: V3, aim: V3): void {
    if (pressed && this.beamCharge < 0) {
      if (this.beamCooldown > 0) this.bus?.emit("alert", { text: `Unibeam recharging · ${this.beamCooldown.toFixed(1)} s`, level: "warn", ttl: 1.5 });
      else if (p.suit.energy < UNIBEAM.cost) this.bus?.emit("alert", { text: `Unibeam needs ${UNIBEAM.cost}% power`, level: "warn", ttl: 2 });
      else this.beamCharge = 0;
    }
    if (this.beamCharge < 0) return;
    this.beamCharge += dt;
    p.beamTimer = Math.max(p.beamTimer, 0.35);
    const chest = this.chest(p, aim);
    this.projectiles.fx.push({ kind: "charge", ...chest, size: 0.4 + (this.beamCharge / UNIBEAM.charge) * 1.4, t: 0, life: 0.05, yaw: 0, pitch: 0 });
    if (this.beamCharge < UNIBEAM.charge) {
      if (this.beamCharge - dt <= 0) this.bus?.emit("unibeam", { ...chest, charging: true });
      return;
    }
    // Fire: everything along the aim line takes a huge hit.
    this.beamCharge = -1;
    this.beamCooldown = UNIBEAM.cooldown;
    p.suit.drain(UNIBEAM.cost);
    p.beamTimer = 0.6;
    const end = this.aimPoint(camPos, aim, UNIBEAM.reach);
    const len = dist(chest, end);
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const c = this.enemies.center(e);
      if (segmentPointDistance(chest, end, c) < ENEMY_STATS[e.kind].radius + UNIBEAM.width) {
        this.enemies.damage(e, UNIBEAM.damage);
        this.projectiles.hitsThisFrame++;
      }
    }
    for (const m of this.projectiles.projectiles) {
      if (m.alive && (m.kind === "missile" || m.kind === "shell") && segmentPointDistance(chest, end, m) < UNIBEAM.width + 1) {
        m.alive = false;
        this.projectiles.explode({ x: m.x, y: m.y, z: m.z }, 3, 0, false);
      }
    }
    this.projectiles.beam(chest, end, "unibeam");
    this.projectiles.fx.push({ kind: "spark", ...end, size: 5, t: 0, life: 0.35, yaw: 0, pitch: 0 });
    if (len < UNIBEAM.reach - 1) this.projectiles.fx.push({ kind: "fire", ...end, size: 3.5, t: 0, life: 0.6, yaw: 0, pitch: 0 });
    this.bus?.emit("unibeam", { ...chest, charging: false });
    this.bus?.emit("weapon", { kind: "laser", ...chest });
  }

  private popFlares(p: PlayerController): void {
    if (this.flareCooldown > 0) {
      this.bus?.emit("alert", { text: `Flares reloading · ${this.flareCooldown.toFixed(1)} s`, level: "warn", ttl: 1.5 });
      return;
    }
    this.flareCooldown = FLARE_COOLDOWN;
    p.flareTimer = 0.5;
    const broken = this.projectiles.flares(p.center, p.vel, p);
    this.bus?.emit("flares", { count: broken });
    this.bus?.emit("alert", { text: broken > 0 ? `Flares! ${broken} missile lock${broken > 1 ? "s" : ""} broken` : "Flares deployed", level: broken > 0 ? "success" : "info", ttl: 2 });
  }

  private chest(p: PlayerController, aim: V3): V3 {
    const c = p.center;
    const up = p.mode === "flight" ? 0 : 0.35;
    return { x: c.x + aim.x * 0.5, y: c.y + up + aim.y * 0.5, z: c.z + aim.z * 0.5 };
  }

  private angleTo(camPos: V3, aim: V3, e: Enemy): number {
    const c = this.enemies.center(e);
    const d = norm({ x: c.x - camPos.x, y: c.y - camPos.y, z: c.z - camPos.z });
    return Math.acos(Math.max(-1, Math.min(1, d.x * aim.x + d.y * aim.y + d.z * aim.z)));
  }

  private findLocks(camPos: V3, aim: V3): Enemy[] {
    const cands: [number, Enemy][] = [];
    for (const e of this.enemies.enemies) {
      if (!e.alive || isCloaked(e)) continue;
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
  private aimPoint(camPos: V3, aim: V3, reach = 400): V3 {
    const hit = this.world.raycast(camPos.x, camPos.y, camPos.z, aim.x, aim.y, aim.z, reach);
    const d = Math.min(hit, reach);
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
