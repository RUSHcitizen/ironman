import type { InputState, TrickRequest } from "../input/InputState";
import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import { SuitSystems, SUIT_PARTS } from "./SuitSystems";
import { clamp, damp, dampAngle, moveTowards, wrapAngle, DEG } from "../core/math";
import { WORLD_LIMIT, ALTITUDE_CEILING, ISLAND_MIN, ISLAND_MAX } from "../world/WorldConfig";

export type FlightMode = "ground" | "hover" | "flight";

export type TrickKind = "loop" | "corkscrew" | "flip" | "backflip" | "spin";

const TRICKS: Record<TrickKind, { dur: number; label: string; evade: boolean }> = {
  loop: { dur: 2.0, label: "LOOP-THE-LOOP", evade: false },
  corkscrew: { dur: 1.0, label: "CORKSCREW", evade: true },
  flip: { dur: 0.75, label: "FRONT FLIP", evade: false },
  backflip: { dur: 0.85, label: "BACKFLIP", evade: false },
  spin: { dur: 0.65, label: "360 SPIN", evade: false },
};

export const TUNING = {
  walkSpeed: 8,
  civilianWalk: 3.4,
  civilianSprint: 7,
  hoverSpeed: 18,
  hoverVertical: 11,
  cruiseSpeed: 48,
  afterburnerSpeed: 125,
  sonicSpeed: 112,
  minFlightSpeed: 18,
  gravity: 22,
  turnRate: 1.5,
  pitchRate: 1.1,
  radius: 0.45,
  height: 1.95,
  stepUp: 0.4,
  rollTime: 0.55,
  rollCooldown: 0.75,
  transformTime: 1.3,
  /** Piece-by-piece suit-up when the called suit latches on. */
  latchTime: 2.4,
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
  /** Wearing the armour? False = civilian alter ego on foot. */
  suited = true;
  /** Seconds left in a suit-up / suit-off transformation (0 = none). */
  transformTimer = 0;
  transformToSuited = true;
  /** Camera/aim angles. viewPitch > 0 looks up. */
  viewYaw = 0;
  viewPitch = -0.15;
  /** Visual body orientation (smoothed). */
  bodyYaw = 0;
  bodyPitch = 0;
  bodyRoll = 0;
  /** Extra roll from barrel rolls (radians, visual only). */
  rollSpin = 0;
  rollTimer = 0;
  rollDir = 0;
  private rollCooldown = 0;
  /** Visual trick rotations (radians) layered on the body pose. */
  trickPitch = 0;
  trickYaw = 0;
  trick: { kind: TrickKind; t: number; dur: number; fx: number; fy: number; fz: number; pitch0: number } | null = null;
  styleCombo = 0;
  private styleTimer = 0;
  /** Smoothed steering rates for fluid flight. */
  private yawRate = 0;
  private pitchRate = 0;
  private lookRate = 0;
  flightSpeed = 0;
  /** 0..1 thruster output, drives VFX and audio. */
  thrust = 0;
  afterburner = false;
  private wasAfterburner = false;
  private sonicDone = false;
  walkPhase = 0;
  /** Seconds remaining in the landing crouch. */
  landingTimer = 0;
  airTime = 0;
  /** Height above the surface directly below. */
  agl = 0;
  /** Seconds the firing pose stays raised (set by the combat system). */
  aimTimer = 0;
  rocketTimer = 0;
  nearMissStreak = 0;
  private nearMissTimer = 0;
  private nearMissCooldown = 0;
  readonly suit = new SuitSystems();
  private lowEnergyWarned = false;
  private boundaryWarned = 0;
  private ceilingWarned = 0;
  private failed = false;

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
    this.rollSpin = this.rollTimer = 0;
    this.trick = null;
    this.trickPitch = this.trickYaw = 0;
    this.yawRate = this.pitchRate = this.lookRate = 0;
    this.flightSpeed = 0;
    this.afterburner = false;
    this.landingTimer = 0;
    this.airTime = 0;
    this.grounded = true;
    this.agl = 0;
    this.transformTimer = 0;
    this.failed = false;
    this.setMode("ground");
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z);
  }

  /** Enemies only engage the player while armoured (civilians are ignored). */
  get targetable(): boolean {
    return this.suited && this.transformTimer <= 0 && !this.failed;
  }

  /** Invulnerable while barrel-rolling (or corkscrewing). */
  get evading(): boolean {
    return this.rollTimer > 0 || (this.trick !== null && TRICKS[this.trick.kind].evade);
  }

  /** Centre of mass, used as the target for enemy fire. */
  get center(): { x: number; y: number; z: number } {
    return { x: this.pos.x, y: this.pos.y + (this.mode === "flight" ? 1.0 : 1.1), z: this.pos.z };
  }

  private setMode(m: FlightMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.bus?.emit("modeChanged", { mode: m });
  }

  private alert(text: string, level: GameEvents["alert"]["level"] = "info"): void {
    this.bus?.emit("alert", { text, level });
  }

  /** Enemy hit. Returns false if evaded. */
  takeHit(damage: number): boolean {
    if (!this.suited || this.failed) return false;
    if (this.evading) {
      this.bus?.emit("evaded", {});
      return false;
    }
    const part = SUIT_PARTS[Math.floor(Math.random() * SUIT_PARTS.length)];
    this.suit.damage(damage, [part, "chest"]);
    this.bus?.emit("playerHit", { damage });
    if (this.suit.overallIntegrity < 15) {
      this.failed = true;
      this.bus?.emit("suitFailure", {});
    }
    return true;
  }

  /**
   * Toggle without an external suit (tests / fallback): suit-off steps out,
   * suit-up assembles the armour in place. The game routes G through the
   * autonomous suit instead (call it, then it docks).
   */
  requestSuitToggle(): boolean {
    return this.suited ? this.exitSuit() : this.beginSuitUp();
  }

  /** Step out of the armour (it stays behind as an empty suit). */
  exitSuit(): boolean {
    if (this.transformTimer > 0 || !this.suited) return false;
    if (this.mode !== "ground" || !this.grounded || this.landingTimer > 0) {
      this.alert("Land first to exit the suit", "warn");
      return false;
    }
    this.transformToSuited = false;
    this.transformTimer = 0.5;
    this.vel.x = this.vel.z = 0;
    this.bus?.emit("suitTransform", { toSuited: false });
    this.finishTransform();
    return true;
  }

  /** Armour assembles around the civilian (after the suit docks). */
  beginSuitUp(duration: number = TUNING.transformTime): boolean {
    if (this.transformTimer > 0 || this.suited) return false;
    this.transformToSuited = true;
    this.transformTimer = duration;
    this.vel.x = this.vel.z = 0;
    this.bus?.emit("suitTransform", { toSuited: true });
    return true;
  }

  private finishTransform(): void {
    this.suited = this.transformToSuited;
    this.afterburner = false;
    this.thrust = 0;
    if (this.suited) this.suit.charge(100);
    this.bus?.emit("suitChanged", { suited: this.suited });
  }

  update(dt: number, input: InputState): void {
    dt = Math.min(dt, 0.05);
    // View angles from look input.
    this.viewYaw = wrapAngle(this.viewYaw + input.lookX);
    const pitchLimit = this.mode === "flight" ? 85 * DEG : 70 * DEG;
    this.viewPitch = clamp(this.viewPitch + input.lookY, -pitchLimit, this.mode === "flight" ? pitchLimit : 55 * DEG);

    if (input.toggleSuit) this.requestSuitToggle();
    if (this.transformTimer > 0) {
      this.transformTimer -= dt;
      if (this.transformTimer <= 0) {
        this.transformTimer = 0;
        if (this.transformToSuited) {
          this.failed = false;
          this.finishTransform();
        }
      }
    }

    if (this.mode === "ground") this.updateGround(dt, input);
    else if (this.mode === "hover") this.updateHover(dt, input);
    else this.updateFlight(dt, input);
    this.updateRoll(dt, input);
    this.updateTricks(dt, input.trick);

    this.integrate(dt);
    this.updateBoundaries(dt);
    this.updateEnergy(dt);
    this.updateNearMiss(dt);
    this.suit.update(dt);
    if (this.landingTimer > 0) this.landingTimer -= dt;
    if (this.aimTimer > 0) this.aimTimer -= dt;
    if (this.rocketTimer > 0) this.rocketTimer -= dt;
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
    const locked = this.landingTimer > 0 || this.transformTimer > 0;
    let speed = this.suited ? TUNING.walkSpeed : input.sprint ? TUNING.civilianSprint : TUNING.civilianWalk;
    if (locked) speed = 0;
    const k = damp(this.grounded ? 12 : 2, dt);
    this.vel.x += (move.x * speed - this.vel.x) * k;
    this.vel.z += (move.z * speed - this.vel.z) * k;
    this.vel.y -= TUNING.gravity * dt;

    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (this.aimTimer > 0 && this.suited) this.bodyYaw = dampAngle(this.bodyYaw, this.viewYaw, 14, dt);
    else if (planar > 0.4) this.bodyYaw = dampAngle(this.bodyYaw, Math.atan2(this.vel.x, this.vel.z), 10, dt);
    this.walkPhase += planar * dt * (this.suited ? 1.25 : 1.9);
    this.bodyPitch += (0 - this.bodyPitch) * damp(10, dt);
    this.bodyRoll += (0 - this.bodyRoll) * damp(10, dt);
    this.thrust = moveTowards(this.thrust, 0, dt * 3);
    this.flightSpeed = 0;

    if (!this.grounded) {
      this.airTime += dt;
      if (this.suited && this.airTime > 0.55 && this.vel.y < -6) {
        this.setMode("hover");
        this.alert("Stabilisers engaged");
      }
    }
    if (locked) return;
    if (!this.suited) {
      if (input.takeoff && this.grounded) {
        this.vel.y = 5.5;
        this.grounded = false;
      }
      return;
    }
    if (input.takeoff || input.ascend) {
      this.vel.y = 9;
      this.grounded = false;
      this.setMode("hover");
    } else if (input.toggleFlight) {
      this.vel.y = 20;
      this.grounded = false;
      this.viewPitch = Math.max(this.viewPitch, 30 * DEG);
      this.flightSpeed = 40;
      this.setMode("flight");
      this.bus?.emit("boost", {});
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
    const k = damp(2.8, dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    this.vel.y += (ty - this.vel.y) * damp(3.5, dt);

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
      // Punch out of the hover with a forward burst.
      this.flightSpeed = Math.max(this.flightSpeed, 45);
      this.setMode("flight");
      this.bus?.emit("boost", {});
    }
  }

  private updateFlight(dt: number, input: InputState): void {
    // Smoothed steering: rates ease in and out, so turns carve instead of snap.
    const turnRate = TUNING.turnRate * (1.25 - Math.min(0.5, this.flightSpeed / 250));
    this.yawRate += (input.moveX * turnRate - this.yawRate) * damp(3.5, dt);
    this.viewYaw = wrapAngle(this.viewYaw + this.yawRate * dt);
    const pitchIn = ((input.ascend ? 1 : 0) - (input.descend ? 1 : 0)) * TUNING.pitchRate;
    this.pitchRate += (pitchIn - this.pitchRate) * damp(3.5, dt);
    this.viewPitch = clamp(this.viewPitch + this.pitchRate * dt, -85 * DEG, 85 * DEG);
    this.lookRate += (input.lookX / Math.max(dt, 1e-3) - this.lookRate) * damp(5, dt);

    const braking = input.moveY < -0.25;
    this.afterburner = input.moveY > 0.25 && this.suit.energy > 0;
    if (this.afterburner && !this.wasAfterburner) {
      // Afterburner kick.
      this.flightSpeed += 12;
      this.bus?.emit("boost", {});
    }
    this.wasAfterburner = this.afterburner;
    let target = TUNING.cruiseSpeed;
    if (this.afterburner) target = TUNING.afterburnerSpeed;
    // Gravity assist: dives build speed, climbs bleed it.
    const sp = Math.sin(this.viewPitch);
    target += sp < 0 ? -sp * 45 : -sp * (this.afterburner ? 8 : 20);
    if (braking) target = 0;
    const accel = this.afterburner ? 45 : braking ? 40 : sp < -0.2 ? 30 : 20;
    this.flightSpeed = moveTowards(this.flightSpeed, target, accel * dt);

    if (this.flightSpeed > TUNING.sonicSpeed && !this.sonicDone) {
      this.sonicDone = true;
      this.bus?.emit("sonicBoom", { ...this.pos });
      this.alert("Sound barrier: sonic boom", "success");
    } else if (this.flightSpeed < TUNING.sonicSpeed - 25) this.sonicDone = false;

    const cp = Math.cos(this.viewPitch);
    let dx = Math.sin(this.viewYaw) * cp, dy = sp, dz = Math.cos(this.viewYaw) * cp;
    let rate = 2.6; // momentum: velocity eases toward the heading
    const tr = this.trick;
    if (tr && tr.kind === "loop") {
      // Loop-the-loop: the flight path itself rotates through 360 degrees.
      const u = tr.t / tr.dur;
      const phi = Math.PI * 2 * (u * u * (3 - 2 * u));
      const c = Math.cos(phi), s = Math.sin(phi);
      dx = tr.fx * c;
      dz = tr.fz * c;
      dy = tr.fy * c + s;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      rate = 12;
      this.trickPitch = -phi;
    }
    const k = damp(rate, dt);
    this.vel.x += (dx * this.flightSpeed - this.vel.x) * k;
    this.vel.y += (dy * this.flightSpeed - this.vel.y) * k;
    this.vel.z += (dz * this.flightSpeed - this.vel.z) * k;

    // Body lies along the flight path; bank into the turn you are making.
    const turn = this.yawRate + this.lookRate * 0.35;
    this.bodyYaw = dampAngle(this.bodyYaw, this.viewYaw, 6, dt);
    this.bodyPitch += (Math.PI / 2 - this.viewPitch - this.bodyPitch) * damp(5, dt);
    this.bodyRoll += (clamp(-turn * 0.6, -1.3, 1.3) - this.bodyRoll) * damp(3, dt);
    this.thrust = moveTowards(this.thrust, this.afterburner ? 1 : braking ? 0.3 : 0.72, dt * 2.5);

    if (input.toggleFlight || (braking && this.flightSpeed < TUNING.minFlightSpeed)) {
      this.afterburner = false;
      this.wasAfterburner = false;
      this.yawRate = this.pitchRate = 0;
      this.setMode("hover");
    }
  }

  /** Mid-air tricks: loops, corkscrews, flips and spins, chained into a style combo. */
  private updateTricks(dt: number, req: TrickRequest | null): void {
    if (this.styleTimer > 0) {
      this.styleTimer -= dt;
      if (this.styleTimer <= 0) this.styleCombo = 0;
    }
    if (req && !this.trick && this.suited && this.mode !== "ground" && this.suit.energy > 4) {
      const kind: TrickKind =
        req === "auto" ? (this.mode === "flight" ? "loop" : "flip") : req === "spin" && this.mode === "flight" ? "corkscrew" : req === "flip" && this.mode === "flight" ? "loop" : req;
      const sp = Math.hypot(this.vel.x, this.vel.z) || 1;
      this.trick = { kind, t: 0, dur: TRICKS[kind].dur, fx: this.vel.x / sp, fy: 0, fz: this.vel.z / sp, pitch0: this.viewPitch };
      if (kind === "loop" || kind === "corkscrew") {
        // Loops need speed; keep at least cruise.
        this.flightSpeed = Math.max(this.flightSpeed, TUNING.cruiseSpeed);
      }
      if (kind === "flip" || kind === "backflip") this.vel.y += 6;
      this.suit.drain(4);
    }
    const tr = this.trick;
    if (!tr) return;
    tr.t += dt;
    const u = Math.min(1, tr.t / tr.dur);
    const e = u * u * (3 - 2 * u);
    if (tr.kind === "flip") this.trickPitch = e * Math.PI * 2;
    else if (tr.kind === "backflip") this.trickPitch = -e * Math.PI * 2;
    else if (tr.kind === "spin") this.trickYaw = e * Math.PI * 2;
    else if (tr.kind === "corkscrew") {
      this.rollSpin = -e * Math.PI * 4;
      // Spiral slightly around the flight path.
      const s = Math.sin(u * Math.PI * 2) * 6;
      this.vel.x += Math.cos(this.viewYaw) * s * dt * 10;
      this.vel.z -= Math.sin(this.viewYaw) * s * dt * 10;
    }
    if (u >= 1 || (tr.kind === "loop" && this.mode !== "flight")) {
      this.trick = null;
      this.trickPitch = this.trickYaw = 0;
      if (tr.kind === "corkscrew") this.rollSpin = 0;
      this.styleCombo = this.styleTimer > 0 ? this.styleCombo + 1 : 1;
      this.styleTimer = 3;
      this.suit.charge(3 * this.styleCombo);
      this.bus?.emit("trick", { name: TRICKS[tr.kind].label, combo: this.styleCombo });
    }
  }

  /** Barrel roll / dodge: lateral burst with brief invulnerability. */
  private updateRoll(dt: number, input: InputState): void {
    if (this.rollCooldown > 0) this.rollCooldown -= dt;
    if (input.roll !== 0 && this.suited && this.mode !== "ground" && this.rollCooldown <= 0 && this.suit.energy > 3) {
      this.rollDir = Math.sign(input.roll);
      this.rollTimer = TUNING.rollTime;
      this.rollCooldown = TUNING.rollCooldown;
      this.suit.drain(3);
      const s = Math.sin(this.viewYaw), c = Math.cos(this.viewYaw);
      const impulse = this.mode === "flight" ? 34 : 20;
      this.vel.x += c * this.rollDir * impulse;
      this.vel.z += -s * this.rollDir * impulse;
      this.bus?.emit("roll", { dir: this.rollDir });
    }
    if (this.rollTimer > 0) {
      this.rollTimer = Math.max(0, this.rollTimer - dt);
      const t = 1 - this.rollTimer / TUNING.rollTime;
      const ease = t * t * (3 - 2 * t);
      this.rollSpin = -this.rollDir * ease * Math.PI * 2;
    } else if (!this.trick || this.trick.kind !== "corkscrew") this.rollSpin = 0;
  }

  /** Reward flying fast and close to buildings. */
  private updateNearMiss(dt: number): void {
    if (this.nearMissCooldown > 0) this.nearMissCooldown -= dt;
    this.nearMissTimer -= dt;
    if (this.nearMissTimer > 0) return;
    this.nearMissTimer = 0.12;
    if (this.mode !== "flight" || this.flightSpeed < 60) {
      if (this.nearMissCooldown <= 0) this.nearMissStreak = 0;
      return;
    }
    const c = this.center;
    const s = Math.sin(this.viewYaw), co = Math.cos(this.viewYaw);
    const close = (dx: number, dy: number, dz: number) => this.world.raycast(c.x, c.y, c.z, dx, dy, dz, 7) < 7;
    if ((close(co, 0, -s) || close(-co, 0, s) || close(0, -1, 0)) && this.nearMissCooldown <= 0) {
      this.nearMissStreak++;
      this.nearMissCooldown = 0.9;
      this.suit.charge(5);
      this.bus?.emit("nearMiss", { streak: this.nearMissStreak });
    }
  }

  private integrate(dt: number): void {
    const dist = Math.hypot(this.vel.x, this.vel.y, this.vel.z) * dt;
    const steps = Math.min(12, Math.max(1, Math.ceil(dist / 1.2)));
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
    const overWater = this.world.isOverWater(this.pos.x, this.pos.z);

    if (this.mode === "ground") {
      if (supported) {
        if (!this.grounded && fallSpeed > 14) this.landed(fallSpeed > 22);
        this.grounded = true;
        this.airTime = 0;
        this.vel.y = 0;
      } else this.grounded = false;
      if (overWater && this.suited) {
        this.vel.y = 3;
        this.setMode("hover");
        this.alert("Water below - hover engaged");
      }
    } else if (contactDown) {
      const steep = this.mode === "hover" || this.viewPitch < -25 * DEG;
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
      this.suit.damage(impactSpeed * 0.15, impactSpeed > 70 ? undefined : ["chest", "arms", "helmet"]);
      this.alert(impactSpeed > 70 ? "Severe impact - armour compromised" : "Impact detected", impactSpeed > 70 ? "critical" : "warn");
      if (this.mode === "flight") {
        this.flightSpeed = 0;
        this.setMode("hover");
      }
    }
  }

  private landed(hard: boolean): void {
    this.landingTimer = hard ? 0.75 : 0.25;
    if (hard && this.suited) this.suit.damage(1.5, ["legs"]);
    this.bus?.emit("landed", { hard });
  }

  /** Move along X (axis 0) or Z (axis 2). Returns blocked speed (m/s) if hit. */
  private moveHorizontal(axis: 0 | 2, delta: number): number {
    if (delta === 0) return 0;
    const r = TUNING.radius;
    const p = this.pos;
    const nx = axis === 0 ? p.x + delta : p.x;
    const nz = axis === 2 ? p.z + delta : p.z;
    // Civilians stay on the island (no swimming).
    if (!this.suited && (nx < ISLAND_MIN + 1 || nx > ISLAND_MAX - 1 || nz < ISLAND_MIN + 1 || nz > ISLAND_MAX - 1)) return 0;
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
    this.boundaryWarned -= dt;
    this.ceilingWarned -= dt;
    const over = Math.max(Math.abs(this.pos.x), Math.abs(this.pos.z)) - WORLD_LIMIT;
    if (over > 0) {
      const d = Math.hypot(this.pos.x, this.pos.z);
      const push = over * 2;
      this.vel.x -= (this.pos.x / d) * push * dt * 10;
      this.vel.z -= (this.pos.z / d) * push * dt * 10;
      if (this.mode === "flight") this.viewYaw = dampAngle(this.viewYaw, Math.atan2(-this.pos.x, -this.pos.z), 1.5, dt);
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
    if (!this.suited || this.mode === "ground") s.charge(14 * dt);
    else if (this.mode === "hover") s.charge(2 * dt);
    else s.drain((this.afterburner ? 9 : 0.4) * dt);

    if (s.energy < 20 && !this.lowEnergyWarned) {
      this.lowEnergyWarned = true;
      this.alert("Power reserves low", s.energy <= 0 ? "critical" : "warn");
    } else if (s.energy > 35) this.lowEnergyWarned = false;
  }
}
