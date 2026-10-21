import type { InputState } from "../input/InputState";
import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import { SuitSystems } from "./SuitSystems";
import { clamp, damp, dampAngle, moveTowards, wrapAngle, DEG } from "../core/math";
import { WORLD_LIMIT, ALTITUDE_CEILING } from "../world/WorldConfig";

export type FlightMode = "ground" | "hover" | "flight";

export const TUNING = {
  walkSpeed: 8,
  hoverSpeed: 17,
  hoverVertical: 10,
  cruiseSpeed: 55,
  afterburnerSpeed: 125,
  minFlightSpeed: 18,
  gravity: 22,
  turnRate: 1.6,
  pitchRate: 1.15,
  radius: 0.45,
  height: 1.95,
  stepUp: 0.4,
};

/**
 * Player movement simulation. Owns the view (camera aim) angles so the camera
 * and flight steering always agree. Pure logic - no rendering dependencies.
 */
export class PlayerController {
  readonly pos = { x: 0, y: 0, z: 0 };
  readonly vel = { x: 0, y: 0, z: 0 };
  mode: FlightMode = "ground";
  grounded = true;
  /** Camera/aim angles. viewPitch > 0 looks up. */
  viewYaw = 0;
  viewPitch = -0.15;
  /** Visual body orientation (smoothed). */
  bodyYaw = 0;
  bodyPitch = 0;
  bodyRoll = 0;
  flightSpeed = 0;
  /** 0..1 thruster output, drives VFX and audio. */
  thrust = 0;
  afterburner = false;
  walkPhase = 0;
  /** Seconds remaining in the landing crouch. */
  landingTimer = 0;
  airTime = 0;
  /** Height above the surface directly below. */
  agl = 0;
  readonly suit = new SuitSystems();
  private lowEnergyWarned = false;
  private boundaryWarned = 0;
  private ceilingWarned = 0;

  constructor(
    private world: CollisionWorld,
    private bus?: EventBus<GameEvents>,
  ) {}

  spawn(x: number, y: number, z: number, yaw: number): void {
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.viewYaw = this.bodyYaw = yaw;
    this.viewPitch = -0.15;
    this.bodyPitch = this.bodyRoll = 0;
    this.flightSpeed = 0;
    this.afterburner = false;
    this.landingTimer = 0;
    this.airTime = 0;
    this.grounded = true;
    this.agl = 0;
    this.setMode("ground");
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z);
  }

  private setMode(m: FlightMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.bus?.emit("modeChanged", { mode: m });
  }

  private alert(text: string, level: GameEvents["alert"]["level"] = "info"): void {
    this.bus?.emit("alert", { text, level });
  }

  update(dt: number, input: InputState): void {
    dt = Math.min(dt, 0.05);
    // View angles from look input.
    this.viewYaw = wrapAngle(this.viewYaw + input.lookX);
    const pitchLimit = this.mode === "flight" ? 85 * DEG : 70 * DEG;
    this.viewPitch = clamp(this.viewPitch + input.lookY, -pitchLimit, this.mode === "flight" ? pitchLimit : 55 * DEG);

    if (this.mode === "ground") this.updateGround(dt, input);
    else if (this.mode === "hover") this.updateHover(dt, input);
    else this.updateFlight(dt, input);

    this.integrate(dt);
    this.updateBoundaries(dt);
    this.updateEnergy(dt);
    this.suit.update(dt);
    if (this.landingTimer > 0) this.landingTimer -= dt;
  }

  private planarInput(input: InputState): { x: number; z: number; mag: number } {
    let mx = input.moveX, my = input.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    if (mag > 1e-3) {
      const inv = mag / Math.hypot(mx, my);
      mx *= inv;
      my *= inv;
    }
    const s = Math.sin(this.viewYaw), c = Math.cos(this.viewYaw);
    // forward = (sin, cos), right = (cos, -sin)
    return { x: s * my + c * mx, z: c * my - s * mx, mag };
  }

  private updateGround(dt: number, input: InputState): void {
    const move = this.planarInput(input);
    const landing = this.landingTimer > 0;
    const speed = landing ? 0 : TUNING.walkSpeed;
    const k = damp(this.grounded ? 12 : 2, dt);
    this.vel.x += (move.x * speed - this.vel.x) * k;
    this.vel.z += (move.z * speed - this.vel.z) * k;
    this.vel.y -= TUNING.gravity * dt;

    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (planar > 0.4) this.bodyYaw = dampAngle(this.bodyYaw, Math.atan2(this.vel.x, this.vel.z), 10, dt);
    this.walkPhase += planar * dt * 1.25;
    this.bodyPitch += (0 - this.bodyPitch) * damp(10, dt);
    this.bodyRoll += (0 - this.bodyRoll) * damp(10, dt);
    this.thrust = moveTowards(this.thrust, 0, dt * 3);
    this.flightSpeed = 0;

    if (!this.grounded) {
      this.airTime += dt;
      if (this.airTime > 0.55 && this.vel.y < -6) {
        this.setMode("hover");
        this.alert("Stabilisers engaged");
      }
    }
    if (landing) return;
    if (input.takeoff || input.ascend) {
      this.vel.y = 9;
      this.grounded = false;
      this.setMode("hover");
    } else if (input.toggleFlight) {
      this.vel.y = 18;
      this.grounded = false;
      this.viewPitch = Math.max(this.viewPitch, 30 * DEG);
      this.flightSpeed = 30;
      this.setMode("flight");
      this.alert("Flight mode: launch");
    }
  }

  private updateHover(dt: number, input: InputState): void {
    const move = this.planarInput(input);
    const hasEnergy = this.suit.energy > 0;
    const vy = (input.ascend ? 1 : 0) - (input.descend ? 1 : 0);
    const tx = move.x * TUNING.hoverSpeed;
    const tz = move.z * TUNING.hoverSpeed;
    const ty = hasEnergy ? vy * TUNING.hoverVertical : vy > 0 ? 1 : -3;
    const k = damp(3.2, dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    this.vel.y += (ty - this.vel.y) * damp(4, dt);

    this.bodyYaw = dampAngle(this.bodyYaw, this.viewYaw, 6, dt);
    // Lean into horizontal motion.
    const fwd = this.vel.x * Math.sin(this.bodyYaw) + this.vel.z * Math.cos(this.bodyYaw);
    const right = this.vel.x * Math.cos(this.bodyYaw) - this.vel.z * Math.sin(this.bodyYaw);
    this.bodyPitch += (clamp(fwd / TUNING.hoverSpeed, -1, 1) * 0.35 - this.bodyPitch) * damp(5, dt);
    this.bodyRoll += (clamp(-right / TUNING.hoverSpeed, -1, 1) * 0.3 - this.bodyRoll) * damp(5, dt);
    this.thrust = moveTowards(this.thrust, 0.45 + 0.35 * Math.max(0, vy) + 0.15 * move.mag, dt * 3);
    this.flightSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.afterburner = false;

    if (input.toggleFlight) {
      this.flightSpeed = Math.max(this.flightSpeed, 32);
      this.setMode("flight");
    }
  }

  private updateFlight(dt: number, input: InputState): void {
    this.viewYaw = wrapAngle(this.viewYaw + input.moveX * TUNING.turnRate * dt);
    const pitchIn = (input.ascend ? 1 : 0) - (input.descend ? 1 : 0);
    this.viewPitch = clamp(this.viewPitch + pitchIn * TUNING.pitchRate * dt, -85 * DEG, 85 * DEG);

    const braking = input.moveY < -0.25;
    this.afterburner = input.moveY > 0.25 && this.suit.energy > 0;
    let target = TUNING.cruiseSpeed;
    if (this.afterburner) target = TUNING.afterburnerSpeed;
    if (braking) target = 0;
    const accel = this.afterburner ? 45 : braking ? 55 : 28;
    this.flightSpeed = moveTowards(this.flightSpeed, target, accel * dt);

    const cp = Math.cos(this.viewPitch);
    const dx = Math.sin(this.viewYaw) * cp, dy = Math.sin(this.viewPitch), dz = Math.cos(this.viewYaw) * cp;
    const k = damp(3.5, dt);
    this.vel.x += (dx * this.flightSpeed - this.vel.x) * k;
    this.vel.y += (dy * this.flightSpeed - this.vel.y) * k;
    this.vel.z += (dz * this.flightSpeed - this.vel.z) * k;

    // Body lies along the flight path; bank into turns.
    const turn = input.moveX * TUNING.turnRate + input.lookX / Math.max(dt, 1e-3) * 0.25;
    this.bodyYaw = dampAngle(this.bodyYaw, this.viewYaw, 8, dt);
    this.bodyPitch += (Math.PI / 2 - this.viewPitch - this.bodyPitch) * damp(6, dt);
    this.bodyRoll += (clamp(-turn * 0.5, -1.1, 1.1) - this.bodyRoll) * damp(4, dt);
    this.thrust = moveTowards(this.thrust, this.afterburner ? 1 : braking ? 0.3 : 0.72, dt * 2.5);

    if (input.toggleFlight || (braking && this.flightSpeed < TUNING.minFlightSpeed)) {
      this.afterburner = false;
      this.setMode("hover");
    }
  }

  private integrate(dt: number): void {
    const dist = Math.hypot(this.vel.x, this.vel.y, this.vel.z) * dt;
    const steps = Math.min(10, Math.max(1, Math.ceil(dist / 1.2)));
    const h = dt / steps;
    let contactDown = false;
    let impactSpeed = 0;
    const fallSpeed = -this.vel.y;
    for (let s = 0; s < steps; s++) {
      impactSpeed = Math.max(impactSpeed, this.moveHorizontal(0, this.vel.x * h), this.moveHorizontal(2, this.vel.z * h));
      contactDown = this.moveVertical(this.vel.y * h) || contactDown;
    }

    const surface = this.world.surfaceBelow(this.pos.x, this.pos.y + 0.05, this.pos.z, TUNING.radius);
    this.agl = this.pos.y - surface;
    const supported = this.agl < 0.06 && this.vel.y <= 0.01;

    if (this.mode === "ground") {
      if (supported) {
        if (!this.grounded && fallSpeed > 14) this.landed(fallSpeed > 22);
        this.grounded = true;
        this.airTime = 0;
        this.vel.y = 0;
      } else this.grounded = false;
    } else if (contactDown) {
      const steep = this.mode === "hover" || this.viewPitch < -25 * DEG;
      const overWater = this.world.isOverWater(this.pos.x, this.pos.z);
      if (overWater) {
        this.vel.y = Math.max(this.vel.y, 2);
        if (this.mode === "flight") this.viewPitch = Math.max(this.viewPitch, 0);
      } else if (steep) {
        const hard = this.mode === "flight" && this.speed > 30;
        this.vel.x *= 0.1;
        this.vel.z *= 0.1;
        this.vel.y = 0;
        this.grounded = true;
        this.setMode("ground");
        this.landed(hard || fallSpeed > 16);
      } else {
        // Shallow approach: skim the surface.
        this.viewPitch = Math.max(this.viewPitch, 0);
      }
    }

    if (impactSpeed > 22 && this.mode !== "ground") {
      this.bus?.emit("impact", { speed: impactSpeed });
      this.suit.damage(impactSpeed * 0.18, impactSpeed > 60 ? undefined : ["chest", "arms", "helmet"]);
      this.alert(impactSpeed > 60 ? "Severe impact - armour compromised" : "Impact detected", impactSpeed > 60 ? "critical" : "warn");
      if (this.mode === "flight") {
        this.flightSpeed = 0;
        this.setMode("hover");
      }
    }
  }

  private landed(hard: boolean): void {
    this.landingTimer = hard ? 0.75 : 0.25;
    if (hard) this.suit.damage(1.5, ["legs"]);
    this.bus?.emit("landed", { hard });
  }

  /** Move along X (axis 0) or Z (axis 2). Returns blocked speed (m/s) if hit. */
  private moveHorizontal(axis: 0 | 2, delta: number): number {
    if (delta === 0) return 0;
    const r = TUNING.radius;
    const p = this.pos;
    const nx = axis === 0 ? p.x + delta : p.x;
    const nz = axis === 2 ? p.z + delta : p.z;
    const hit = this.world.overlaps(nx - r, p.y + TUNING.stepUp, nz - r, nx + r, p.y + TUNING.height, nz + r);
    if (!hit) {
      p.x = nx;
      p.z = nz;
      return 0;
    }
    const v = axis === 0 ? this.vel.x : this.vel.z;
    if (axis === 0) {
      p.x = delta > 0 ? hit.minX - r - 1e-3 : hit.maxX + r + 1e-3;
      this.vel.x = -this.vel.x * 0.15;
    } else {
      p.z = delta > 0 ? hit.minZ - r - 1e-3 : hit.maxZ + r + 1e-3;
      this.vel.z = -this.vel.z * 0.15;
    }
    return Math.abs(v);
  }

  /** Returns true when downward motion hit a surface. */
  private moveVertical(delta: number): boolean {
    const p = this.pos;
    const r = TUNING.radius;
    if (delta > 0) {
      const hit = this.world.overlaps(p.x - r, p.y + delta, p.z - r, p.x + r, p.y + delta + TUNING.height, p.z + r);
      if (hit && hit.minY >= p.y + TUNING.height - 0.01) {
        p.y = hit.minY - TUNING.height - 1e-3;
        this.vel.y = Math.min(this.vel.y, 0);
        return false;
      }
      p.y += delta;
      return false;
    }
    const surface = this.world.surfaceBelow(p.x, p.y, p.z, r, TUNING.stepUp);
    if (p.y + delta <= surface) {
      p.y = surface;
      if (this.vel.y < 0) this.vel.y = 0;
      return true;
    }
    // Step up onto low surfaces we are standing in (curbs).
    if (p.y < surface) p.y = surface;
    p.y += delta;
    return false;
  }

  private updateBoundaries(dt: number): void {
    const d = Math.hypot(this.pos.x, this.pos.z);
    this.boundaryWarned -= dt;
    this.ceilingWarned -= dt;
    if (d > WORLD_LIMIT) {
      const push = (d - WORLD_LIMIT) * 2;
      this.vel.x -= (this.pos.x / d) * push * dt * 10;
      this.vel.z -= (this.pos.z / d) * push * dt * 10;
      if (this.boundaryWarned <= 0) {
        this.alert("Leaving operational airspace - turning back", "warn");
        this.boundaryWarned = 6;
      }
    }
    if (this.pos.y > ALTITUDE_CEILING) {
      this.vel.y = Math.min(this.vel.y, -(this.pos.y - ALTITUDE_CEILING));
      if (this.mode === "flight") this.viewPitch = Math.min(this.viewPitch, 0);
      if (this.ceilingWarned <= 0) {
        this.alert("Altitude ceiling - icing risk", "warn");
        this.ceilingWarned = 8;
      }
    }
  }

  private updateEnergy(dt: number): void {
    const s = this.suit;
    if (this.mode === "ground") s.charge(14 * dt);
    else if (this.mode === "hover") s.charge(1.5 * dt);
    else s.drain((this.afterburner ? 11 : 0.6) * dt);

    if (s.energy < 20 && !this.lowEnergyWarned) {
      this.lowEnergyWarned = true;
      this.alert("Power reserves low", s.energy <= 0 ? "critical" : "warn");
    } else if (s.energy > 35) this.lowEnergyWarned = false;
  }
}
