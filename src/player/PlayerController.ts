import type { InputState, TrickRequest } from "../input/InputState";
import type { CollisionWorld } from "../world/Collision";
import type { EventBus, GameEvents } from "../core/EventBus";
import { SuitSystems, SUIT_PARTS } from "./SuitSystems";
import { clamp, damp, dampAngle, moveTowards, wrapAngle, DEG } from "../core/math";
import { WORLD_LIMIT, ALTITUDE_CEILING, ISLAND_MIN, ISLAND_MAX, OXYGEN_ALTITUDE, SPACE_ALTITUDE, airDensity } from "../world/WorldConfig";

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
  // Flight was made 2.5x faster, then trimmed by 25% (now ~1.875x the original);
  // hover is 1.5x so it stays precise.
  hoverSpeed: 27,
  hoverVertical: 16,
  cruiseSpeed: 90,
  afterburnerSpeed: 234.375,
  /** Real Mach 1 at sea level: the sound barrier is a genuine milestone. */
  sonicSpeed: 343,
  /** Hold the afterburner this long to go hypersonic (x1.35 top speed). */
  hyperDelay: 1.5,
  hyperBoost: 1.35,
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
  /** Stepping out of the open armour. */
  stepOutTime: 1.5,
  /** A civilian dies landing faster than this; the armour always survives a fall (it takes damage instead). */
  civilianLethalFall: 26,
  /** Suit damage from a hard fall: (speed - 22) * k per part, capped. */
  fallDamagePerMs: 0.45,
  fallDamageMax: 45,
  /** Power drain while airborne, % per minute. */
  powerPerMinute: 1,
  /** Air drag coefficient (sea-level terminal velocity ~96 m/s, faster in thin air). */
  drag: 0.0024,
  /** A person without armour falls slower (terminal ~54 m/s). */
  civilianDrag: 0.0075,
  /** Max bank (radians) when turning in flight: nearly sideways. */
  maxBank: 1.5,
  /** Shift+A / Shift+D: snap through ~90 degrees. */
  sharpTurnTime: 0.6,
  sharpTurnAngle: Math.PI / 2,
  /** Quick piece-by-piece suit-up when the suit catches you mid-air. */
  airLatchTime: 0.8,
  /** Oxygen: % per second used on internal supply (thin air -> space), refill rate below. */
  oxygenUse: 0.9,
  oxygenUseSpace: 2.5,
  oxygenRefill: 14,
  /** Oxygen % needed to wake from a blackout. */
  oxygenWake: 30,
};

export type DeathCause = "fall" | "water";

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
  /** Bank about the body's long axis in flight: turning right drops the right arm. */
  bank = 0;
  /** Sharp turn in progress (Shift+A / Shift+D). */
  sharp: { dir: number; t: number; dur: number } | null = null;
  private sharpCooldown = 0;
  /** Piloting the empty suit remotely (nobody inside). */
  remote = false;
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
  /** Seconds the afterburner has been held; past hyperDelay = hypersonic. */
  private burnTime = 0;
  hypersonic = false;
  /** Fastest speed reached this session (m/s). */
  topSpeed = 0;
  /**
   * RUSH 0..1: flying fast close to buildings, rooftops or the street builds
   * it; it adds up to +30% top speed and drains away in open sky.
   */
  rush = 0;
  private rushLevel = 0;
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
  /** Unibeam pose (chest thrust forward, arms back). */
  beamTimer = 0;
  private lastYaw = 0;
  /** Flares just popped (arms flung wide) - animation only. */
  flareTimer = 0;
  /** Repulsor recoil (1 on a shot, decays) - animation only. */
  recoil = 0;
  /** Hit flinch (1 when hit, decays) and the side it came from (-1 left / +1 right). */
  flinch = 0;
  /** Hand that fired the last repulsor shot (+1 right, -1 left). */
  fireHand = 1;
  /** Air-braking in flight (drives the flare-out pose). */
  braking = false;
  flinchSide = 0;
  nearMissStreak = 0;
  private nearMissTimer = 0;
  private nearMissCooldown = 0;
  readonly suit = new SuitSystems();
  private lowEnergyWarned = false;
  private boundaryWarned = 0;
  private ceilingWarned = 0;
  private failed = false;
  /** Suit destroyed in the air: the pilot drifts down safely (emergency descent). */
  chute = false;
  /** Thrusters cut (H): unpowered free fall until re-engaged. */
  freefall = false;
  /** Passed out from lack of oxygen: thrusters can't be re-engaged. */
  blackout = false;
  /** Killed (e.g. by a fall); waiting for the game to respawn us. */
  dead = false;
  deadTime = 0;
  private zone: "air" | "thin" | "space" = "air";
  private oxygenWarned = 100;

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
    this.bank = 0;
    this.sharp = null;
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
    this.freefall = this.blackout = this.dead = this.chute = false;
    this.deadTime = 0;
    this.recoil = this.flinch = 0;
    this.suit.oxygen = 100;
    this.oxygenWarned = 100;
    this.zone = "air";
    this.setMode("ground");
  }

  /**
   * Take control of a body at a given state (switching between the person
   * and the remotely piloted suit). Keeps the shared suit systems.
   */
  possess(o: { x: number; y: number; z: number; yaw: number; suited: boolean; mode?: FlightMode; vel?: { x: number; y: number; z: number } }): void {
    const oxygen = this.suit.oxygen;
    this.spawn(o.x, o.y, o.z, o.yaw);
    this.suit.oxygen = oxygen;
    this.suited = o.suited;
    if (o.vel) {
      this.vel.x = o.vel.x;
      this.vel.y = o.vel.y;
      this.vel.z = o.vel.z;
    }
    if (o.suited && o.mode && o.mode !== "ground") {
      this.grounded = false;
      this.airTime = 1;
      this.flightSpeed = Math.hypot(this.vel.x, this.vel.z);
      if (o.mode === "flight") this.flightSpeed = Math.max(this.flightSpeed, TUNING.minFlightSpeed + 10);
      this.setMode(o.mode);
    }
  }

  /** Above the edge of space. */
  get inSpace(): boolean {
    return this.pos.y > SPACE_ALTITUDE;
  }

  /** Falling fast with no thrust (drives the skydive pose and camera). */
  get falling(): boolean {
    return this.mode === "ground" && !this.grounded && this.airTime > 0.3 && this.vel.y < -9;
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
    this.flinch = Math.min(1, 0.4 + damage / 20);
    this.flinchSide = Math.random() < 0.5 ? -1 : 1;

    return true;
  }

  /** EMP pulse from a jammer drone: knocks out suit power. */
  emp(drain: number): void {
    if (!this.suited) return;
    this.suit.energy = Math.max(0, this.suit.energy - drain);
    this.alert(`EMP hit - power drained to ${Math.round(this.suit.energy)}%`, "warn");
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
    this.transformTimer = TUNING.stepOutTime;
    this.vel.x = this.vel.z = 0;
    this.bus?.emit("suitTransform", { toSuited: false, airborne: false });
    this.finishTransform();
    return true;
  }

  /**
   * The suit has been destroyed: the pilot is left as a civilian. In the air,
   * the suit's last act is an emergency descent so the pilot lands safely.
   */
  suitDestroyed(): void {
    this.suited = false;
    this.freefall = this.blackout = false;
    this.trick = null;
    this.trickPitch = this.trickYaw = 0;
    this.afterburner = this.wasAfterburner = this.hypersonic = false;
    this.transformTimer = 0;
    this.chute = !this.grounded || this.mode !== "ground";
    if (this.mode !== "ground") {
      this.vel.y = Math.max(this.vel.y, -6);
      this.grounded = false;
      this.setMode("ground");
    }
    this.bus?.emit("suitChanged", { suited: false });
  }

  /**
   * Bail out of the armour mid-air: you are thrown clear and fall as a
   * civilian. Call the suit back (G) before you hit the ground.
   */
  eject(): boolean {
    if (!this.suited || this.transformTimer > 0 || this.remote || this.dead) return false;
    this.transformToSuited = false;
    this.transformTimer = 0.35;
    this.freefall = this.blackout = false;
    this.trick = null;
    this.trickPitch = this.trickYaw = 0;
    this.afterburner = this.wasAfterburner = false;
    this.yawRate = this.pitchRate = 0;
    const s = Math.sin(this.bodyYaw), c = Math.cos(this.bodyYaw);
    this.vel.x -= s * 3;
    this.vel.z -= c * 3;
    this.vel.y = Math.max(this.vel.y, 0) + 5;
    this.grounded = false;
    this.airTime = 0.3;
    this.setMode("ground");
    this.bus?.emit("suitTransform", { toSuited: false, airborne: true });
    this.finishTransform();
    this.alert("EJECTED! Call the suit (G) before you hit the ground!", "critical");
    return true;
  }

  /** Armour assembles around the civilian (after the suit docks). */
  beginSuitUp(duration: number = TUNING.transformTime): boolean {
    if (this.transformTimer > 0 || this.suited) return false;
    this.transformToSuited = true;
    this.transformTimer = duration;
    if (this.grounded) this.vel.x = this.vel.z = 0;
    this.bus?.emit("suitTransform", { toSuited: true, airborne: !this.grounded });
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
    if (this.dead) {
      this.vel.x = this.vel.y = this.vel.z = 0;
      this.thrust = 0;
      this.deadTime += dt;
      return;
    }
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

    if (input.cutThrust && this.suited && this.transformTimer <= 0) {
      if (this.mode !== "ground") this.cutThrusters();
      else if (this.freefall) this.reengage("hover");
    }
    if (this.mode === "ground") this.updateGround(dt, input);
    else if (this.mode === "hover") this.updateHover(dt, input);
    else this.updateFlight(dt, input);
    this.updateSharpTurn(dt, input.sharpTurn);
    if (this.mode !== "flight") this.bank += (0 - this.bank) * damp(4, dt);
    this.updateRoll(dt, input);
    this.updateTricks(dt, input.trick);

    this.integrate(dt);
    this.updateBoundaries(dt);
    this.updateEnergy(dt);
    this.updateOxygen(dt);
    if (this.suited && !this.failed && this.suit.overallIntegrity <= 1) {
      // Full damage: the suit is destroyed (from hits, crashes or falls).
      this.failed = true;
      this.bus?.emit("suitFailure", {});
    }
    this.updateNearMiss(dt);
    // Rush fades in open sky (and fast when you stop flying).
    this.rush = Math.max(0, this.rush - dt * (this.mode === "flight" ? 0.12 : 0.6));
    this.suit.update(dt);
    if (this.landingTimer > 0) this.landingTimer -= dt;
    if (this.aimTimer > 0) this.aimTimer -= dt;
    if (this.rocketTimer > 0) this.rocketTimer -= dt;
    if (this.beamTimer > 0) this.beamTimer -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 7);
    if (this.flareTimer > 0) this.flareTimer -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 3.5);
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
    const steppingOut = this.transformTimer > 0 && !this.transformToSuited && this.grounded;
    const locked = this.landingTimer > 0 || this.transformTimer > 0;
    let speed = this.suited ? TUNING.walkSpeed : input.sprint ? TUNING.civilianSprint : TUNING.civilianWalk;
    if (locked) speed = 0;
    const falling = this.falling;
    if (this.chute && !this.grounded) {
      // Emergency descent: slow, steady, steerable.
      this.vel.y = Math.max(this.vel.y - TUNING.gravity * dt, -6);
      this.vel.x += (move.x * 6 - this.vel.x) * damp(1.5, dt);
      this.vel.z += (move.z * 6 - this.vel.z) * damp(1.5, dt);
    } else if (this.freefall || falling || (!this.grounded && this.airTime > 0.2)) {
      // Unpowered fall: keep momentum, steer a little like a skydiver.
      const air = TUNING.gravity * 0.45;
      this.vel.x += move.x * air * dt;
      this.vel.z += move.z * air * dt;
    } else {
      let tx = move.x * speed, tz = move.z * speed;
      if (steppingOut) {
        // Back out of the open armour, still facing it.
        const t = TUNING.stepOutTime - this.transformTimer;
        const back = t > 0.4 && t < 1.15 ? -1.9 : 0;
        tx = Math.sin(this.bodyYaw) * back;
        tz = Math.cos(this.bodyYaw) * back;
      }
      const k = damp(this.grounded ? 12 : 2, dt);
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
    }
    if (!this.chute) this.vel.y -= TUNING.gravity * dt;
    if (!this.grounded && !this.chute) {
      // Aerodynamic drag (weaker in thin air, so falls from space get fast).
      const sp = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
      const f = Math.min(1, (this.suited ? TUNING.drag : TUNING.civilianDrag) * airDensity(this.pos.y) * sp * dt);
      this.vel.x -= this.vel.x * f;
      this.vel.y -= this.vel.y * f;
      this.vel.z -= this.vel.z * f;
    }

    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (falling) this.bodyYaw = dampAngle(this.bodyYaw, this.viewYaw, 3, dt);
    else if (steppingOut) {
      /* keep facing the suit */
    } else if (this.aimTimer > 0 && this.suited) this.bodyYaw = dampAngle(this.bodyYaw, this.viewYaw, 14, dt);
    else if (planar > 0.4) this.bodyYaw = dampAngle(this.bodyYaw, Math.atan2(this.vel.x, this.vel.z), 10, dt);
    this.walkPhase += (steppingOut ? -planar : planar) * dt * (this.suited ? 1.25 : 1.9);
    // Turning on the spot: shuffle the feet.
    if (this.grounded && planar < 0.4) {
      const turn = Math.abs(wrapAngle(this.bodyYaw - this.lastYaw));
      this.walkPhase += Math.min(0.3, turn * 1.6);
    }
    this.lastYaw = this.bodyYaw;
    // Belly-to-earth while falling fast.
    this.bodyPitch += ((falling ? 1.2 : 0) - this.bodyPitch) * damp(falling ? 2.5 : 10, dt);
    this.bodyRoll += (0 - this.bodyRoll) * damp(10, dt);
    this.thrust = moveTowards(this.thrust, 0, dt * 3);
    this.flightSpeed = 0;

    if (!this.grounded) {
      this.airTime += dt;
      if (this.suited && !this.freefall && this.airTime > 0.55 && this.vel.y < -6) {
        this.setMode("hover");
        this.alert("Stabilisers engaged");
      }
    }
    if (locked || this.blackout) return;
    if (this.freefall) {
      if (input.takeoff || input.ascend) this.reengage("hover");
      else if (input.toggleFlight) this.reengage("flight");
      return;
    }
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

  /** H: cut all thrust and drop. */
  cutThrusters(reason = "Thrusters cut - free fall · H or SPACE to re-engage"): void {
    this.freefall = true;
    this.trick = null;
    this.trickPitch = this.trickYaw = 0;
    this.afterburner = this.wasAfterburner = false;
    this.yawRate = this.pitchRate = 0;
    this.grounded = false;
    this.airTime = Math.max(this.airTime, 0.3);
    this.setMode("ground");
    this.alert(reason, this.blackout ? "critical" : "warn");
  }

  private reengage(mode: "hover" | "flight"): void {
    if (this.blackout) return;
    this.freefall = false;
    if (mode === "flight") {
      this.flightSpeed = Math.max(40, Math.hypot(this.vel.x, this.vel.z));
      this.viewPitch = Math.max(this.viewPitch, -30 * DEG);
      this.bus?.emit("boost", {});
    }
    this.setMode(mode);
    this.alert("Thrusters re-engaged", "success");
  }

  private updateHover(dt: number, input: InputState): void {
    const move = this.planarInput(input);
    const hasEnergy = this.suit.energy > 0;
    const vy = (input.ascend ? 1 : 0) - (input.descend ? 1 : 0);
    const tx = move.x * TUNING.hoverSpeed;
    const tz = move.z * TUNING.hoverSpeed;
    // No power: the thrusters can only slow the descent.
    const ty = hasEnergy ? vy * TUNING.hoverVertical : -4;
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
    const turnRate = TUNING.turnRate * (1.25 - Math.min(0.5, this.flightSpeed / 625));
    // Banked turns bite harder: roll into the turn and it tightens.
    const bankGrip = 0.75 + 0.45 * Math.min(1, Math.abs(this.bank) / TUNING.maxBank);
    this.yawRate += (input.moveX * turnRate * bankGrip - this.yawRate) * damp(4.5, dt);
    this.viewYaw = wrapAngle(this.viewYaw + this.yawRate * dt);
    const pitchIn = ((input.ascend ? 1 : 0) - (input.descend ? 1 : 0)) * TUNING.pitchRate;
    this.pitchRate += (pitchIn - this.pitchRate) * damp(4.5, dt);
    this.viewPitch = clamp(this.viewPitch + this.pitchRate * dt, -85 * DEG, 85 * DEG);
    this.lookRate += (input.lookX / Math.max(dt, 1e-3) - this.lookRate) * damp(5, dt);

    const braking = input.moveY < -0.25;
    this.braking = braking;
    this.afterburner = input.moveY > 0.25 && this.suit.energy > 0;
    if (this.afterburner && !this.wasAfterburner) {
      // Afterburner kick.
      this.flightSpeed += 22;
      this.bus?.emit("boost", {});
    }
    this.wasAfterburner = this.afterburner;
    // Keep burning and the suit goes hypersonic: an extra surge of speed.
    this.burnTime = this.afterburner ? this.burnTime + dt : 0;
    const hyper = this.burnTime > TUNING.hyperDelay && this.suit.energy > 0;
    if (hyper && !this.hypersonic) {
      this.flightSpeed += 30;
      this.bus?.emit("hypersonic", { ...this.pos });
    }
    this.hypersonic = hyper;

    // Thin air at altitude: less drag, so the suit flies much faster.
    const thin = 1 + clamp((this.pos.y - 400) / 2000, 0, 1) * 1.6;
    let target = (this.afterburner ? TUNING.afterburnerSpeed * (hyper ? TUNING.hyperBoost : 1) : TUNING.cruiseSpeed) * thin * (1 + 0.3 * this.rush);
    // Gravity assist: dives build speed, climbs bleed it.
    const sp = Math.sin(this.viewPitch);
    target += sp < 0 ? -sp * 84 : -sp * (this.afterburner ? 15 : 37.5);
    if (braking) target = 0;
    const accel = hyper ? 112 : this.afterburner ? 84 : braking ? 100 : sp < -0.2 ? 56 : 37.5;
    this.flightSpeed = moveTowards(this.flightSpeed, target, accel * dt);

    if (this.flightSpeed > TUNING.sonicSpeed && !this.sonicDone) {
      this.sonicDone = true;
      this.bus?.emit("sonicBoom", { ...this.pos });
      this.alert("Sound barrier: sonic boom", "success");
    } else if (this.flightSpeed < TUNING.sonicSpeed - 40) this.sonicDone = false;
    this.topSpeed = Math.max(this.topSpeed, this.speed);

    const cp = Math.cos(this.viewPitch);
    let dx = Math.sin(this.viewYaw) * cp, dy = sp, dz = Math.cos(this.viewYaw) * cp;
    // Momentum: the path follows the heading snappily when slow, and carries
    // more momentum (a satisfying drift through turns) when fast.
    let rate = 4.2 - Math.min(2, this.flightSpeed / 150);
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
    if (this.sharp) rate = Math.max(rate, 7); // the flight path snaps round too
    const k = damp(rate, dt);
    this.vel.x += (dx * this.flightSpeed - this.vel.x) * k;
    this.vel.y += (dy * this.flightSpeed - this.vel.y) * k;
    this.vel.z += (dz * this.flightSpeed - this.vel.z) * k;

    // Body lies along the flight path and banks into the turn about its long
    // axis, gradually going nearly sideways (right turn: right arm down).
    const turn = this.yawRate + this.lookRate * 0.35;
    this.bodyYaw = dampAngle(this.bodyYaw, this.viewYaw, 6, dt);
    this.bodyPitch += (Math.PI / 2 - this.viewPitch - this.bodyPitch) * damp(5, dt);
    this.bodyRoll += (0 - this.bodyRoll) * damp(6, dt);
    if (!this.sharp) this.bank += (clamp(-turn * 0.95, -TUNING.maxBank, TUNING.maxBank) - this.bank) * damp(2.2, dt);
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
    if (req && !this.trick && this.suited && this.mode !== "ground" && this.suit.energy > 0) {
      const kind: TrickKind =
        req === "auto" ? (this.mode === "flight" ? "loop" : "flip") : req === "spin" && this.mode === "flight" ? "corkscrew" : req === "flip" && this.mode === "flight" ? "loop" : req;
      const sp = Math.hypot(this.vel.x, this.vel.z) || 1;
      this.trick = { kind, t: 0, dur: TRICKS[kind].dur, fx: this.vel.x / sp, fy: 0, fz: this.vel.z / sp, pitch0: this.viewPitch };
      if (kind === "loop" || kind === "corkscrew") {
        // Loops need speed; keep at least cruise.
        this.flightSpeed = Math.max(this.flightSpeed, TUNING.cruiseSpeed);
      }
      if (kind === "flip" || kind === "backflip") this.vel.y += 6;
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

  /**
   * Sharp turn (Shift+A / Shift+D): snap the heading ~90 degrees with a hard,
   * past-vertical bank in flight (the flight path follows); a quick pivot in
   * hover. Costs a little speed and power.
   */
  private updateSharpTurn(dt: number, req: number): void {
    if (this.sharpCooldown > 0) this.sharpCooldown -= dt;
    if (req !== 0 && !this.sharp && this.sharpCooldown <= 0 && this.suited && (this.mode === "flight" || this.mode === "hover") && this.suit.energy > 0 && !this.trick) {
      const dur = this.mode === "flight" ? TUNING.sharpTurnTime : 0.35;
      this.sharp = { dir: Math.sign(req), t: 0, dur };
      this.sharpCooldown = dur + 0.15;
      if (this.mode === "flight") this.flightSpeed *= 0.9;
      this.bus?.emit("boost", {});
    }
    const sh = this.sharp;
    if (!sh) return;
    const e0 = smooth(sh.t / sh.dur);
    sh.t = Math.min(sh.dur, sh.t + dt);
    const e1 = smooth(sh.t / sh.dur);
    this.viewYaw = wrapAngle(this.viewYaw + sh.dir * TUNING.sharpTurnAngle * (e1 - e0));
    if (this.mode === "flight") {
      // Hard bank, slightly past vertical, faster than a normal turn.
      this.bank += (-sh.dir * 1.75 - this.bank) * damp(9, dt);
    } else this.bodyYaw = this.viewYaw;
    if (sh.t >= sh.dur || this.mode === "ground") this.sharp = null;
  }

  /** Barrel roll / dodge: lateral burst with brief invulnerability. */
  private updateRoll(dt: number, input: InputState): void {
    if (this.rollCooldown > 0) this.rollCooldown -= dt;
    if (input.roll !== 0 && this.suited && this.mode !== "ground" && this.rollCooldown <= 0 && this.suit.energy > 0) {
      this.rollDir = Math.sign(input.roll);
      this.rollTimer = TUNING.rollTime;
      this.rollCooldown = TUNING.rollCooldown;
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
    // RUSH: skimming rooftops / the street or threading between buildings.
    if (this.flightSpeed > 75) {
      const skim = this.world.raycast(c.x, c.y, c.z, 0, -1, 0, 28) < 28;
      const side = this.world.raycast(c.x, c.y, c.z, co, 0, -s, 14) < 14 || this.world.raycast(c.x, c.y, c.z, -co, 0, s, 14) < 14;
      if (skim || side) this.rush = Math.min(1, this.rush + (side ? 0.07 : 0.045));
    }
    const lvl = this.rush >= 0.99 ? 2 : this.rush >= 0.5 ? 1 : 0;
    if (lvl > this.rushLevel) this.bus?.emit("rush", { level: lvl });
    this.rushLevel = lvl;
    if ((close(co, 0, -s) || close(-co, 0, s) || close(0, -1, 0)) && this.nearMissCooldown <= 0) {
      this.nearMissStreak++;
      this.nearMissCooldown = 0.9;
      this.suit.charge(5);
      this.bus?.emit("nearMiss", { streak: this.nearMissStreak });
    }
  }

  private integrate(dt: number): void {
    const speed0 = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    const dist = speed0 * dt;
    // Fine sub-steps so even hypersonic flight can't tunnel through walls.
    const steps = Math.min(24, Math.max(1, Math.ceil(dist / 1.4)));
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
        if (!this.grounded && !this.suited && !this.chute && fallSpeed > TUNING.civilianLethalFall) {
          this.die(overWater ? "water" : "fall", fallSpeed);
          return;
        }
        if (!this.grounded && this.suited && fallSpeed > 30) {
          // The armour always survives a fall - it takes the damage instead.
          const dmg = Math.min(TUNING.fallDamageMax, (fallSpeed - 22) * TUNING.fallDamagePerMs);
          this.suit.damage(dmg);
          this.bus?.emit("impact", { speed: fallSpeed });
          this.alert(`Hard landing at ${Math.round(fallSpeed * 3.6)} km/h - armour ${Math.round(this.suit.overallIntegrity)}%`, dmg > 25 ? "critical" : "warn");
        }
        if (!this.grounded && fallSpeed > 14) this.landed(fallSpeed > 22);
        this.grounded = true;
        this.chute = false;
        this.freefall = false;
        this.airTime = 0;
        this.vel.y = 0;
      } else this.grounded = false;
      if (overWater && this.suited && !this.blackout && (supported || !this.freefall)) {
        this.freefall = false;
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

    // Glancing blow in flight: scrape along the wall and keep flying.
    if (impactSpeed > 6 && this.mode === "flight" && impactSpeed < speed0 * 0.5 && impactSpeed < 120) {
      this.flightSpeed *= 0.88;
      this.suit.damage(impactSpeed * 0.04, ["arms", "legs"]);
      const hs = Math.hypot(this.vel.x, this.vel.z);
      // The body jolts away from the wall (it's on the side opposite the deflection).
      this.flinch = Math.max(this.flinch, 0.5);
      if (hs > 5) this.flinchSide = wrapAngle(Math.atan2(this.vel.x, this.vel.z) - this.viewYaw) > 0 ? -1 : 1;
      if (hs > 5) this.viewYaw = dampAngle(this.viewYaw, Math.atan2(this.vel.x, this.vel.z), 12, dt);
      this.bus?.emit("scrape", { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, speed: impactSpeed });
      impactSpeed = 0;
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

  /** Fatal impact: the game shows it and returns us to the tower. */
  private die(cause: DeathCause, speed: number): void {
    this.dead = true;
    this.failed = true;
    this.freefall = this.blackout = false;
    this.trick = null;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.thrust = 0;
    this.afterburner = false;
    this.grounded = true;
    this.bus?.emit("playerDied", { cause, speed });
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
    if (this.pos.y > ALTITUDE_CEILING && this.mode !== "ground") {
      this.vel.y = Math.min(this.vel.y, -(this.pos.y - ALTITUDE_CEILING));
      if (this.mode === "flight") this.viewPitch = Math.min(this.viewPitch, 0);
      if (this.ceilingWarned <= 0) {
        this.alert("Maximum altitude - thrusters can't climb any higher", "warn");
        this.ceilingWarned = 8;
      }
    }
  }

  /**
   * Above OXYGEN_ALTITUDE the suit runs on its internal supply, faster in
   * space. At zero the pilot blacks out and the thrusters go dead.
   */
  private updateOxygen(dt: number): void {
    const s = this.suit;
    const y = this.pos.y;
    const zone = y > SPACE_ALTITUDE ? "space" : y > OXYGEN_ALTITUDE ? "thin" : "air";
    if (zone !== this.zone && this.suited && !this.remote) {
      if (zone === "space") this.alert("You're in space, boss. Oxygen is limited - watch the gauge", "success");
      else if (zone === "thin" && this.zone === "air") this.alert("Thin air - switching to internal oxygen", "warn");
      else if (zone === "air") this.alert("Breathable air - oxygen recharging", "info");
    }
    this.zone = zone;
    if (zone === "air" || !this.suited || this.remote) {
      s.oxygen = Math.min(100, s.oxygen + TUNING.oxygenRefill * dt);
      if (s.oxygen > 60) this.oxygenWarned = 100;
    } else {
      const k = clamp((y - OXYGEN_ALTITUDE) / (SPACE_ALTITUDE - OXYGEN_ALTITUDE), 0, 1);
      s.oxygen = Math.max(0, s.oxygen - (TUNING.oxygenUse + (TUNING.oxygenUseSpace - TUNING.oxygenUse) * k) * dt);
    }
    for (const [lvl, text, level] of [
      [50, "Oxygen at 50%", "warn"],
      [25, "Oxygen critical - descend now!", "critical"],
      [10, "Oxygen 10% - you're about to pass out, boss!", "critical"],
    ] as const) {
      if (s.oxygen <= lvl && this.oxygenWarned > lvl) {
        this.oxygenWarned = lvl;
        this.alert(text, level);
      }
    }
    if (s.oxygen <= 0 && !this.blackout && this.suited && !this.remote) {
      this.blackout = true;
      this.cutThrusters("Pilot unconscious - no oxygen. Thrusters offline");
    } else if (this.blackout && s.oxygen >= TUNING.oxygenWake) {
      this.blackout = false;
      this.alert("You're back with me, boss! SPACE to re-engage thrusters", "success");
    }
  }

  /**
   * Power: drains 1% per minute while the suit is airborne (flying, hovering,
   * falling). Touch the ground and it recharges to full instantly. At 0% the
   * thrusters can't hold you up: you sink to the ground to recharge.
   */
  private updateEnergy(dt: number): void {
    const s = this.suit;
    if (!this.suited) return;
    if (this.grounded && this.mode === "ground") {
      if (s.energy < 100) {
        if (s.energy <= 0.5) this.alert("Power restored", "success");
        s.charge(100);
      }
    } else s.drain((TUNING.powerPerMinute / 60) * dt);

    if (s.energy < 20 && !this.lowEnergyWarned) {
      this.lowEnergyWarned = true;
      this.alert("Power reserves low", "warn");
    } else if (s.energy > 35) this.lowEnergyWarned = false;
    if (s.energy <= 0 && this.mode === "flight") {
      // Out of power: drop out of flight and sink to the ground.
      this.afterburner = this.wasAfterburner = false;
      this.setMode("hover");
      this.alert("Power depleted - descending. Land to recharge", "critical");
    }
  }
}

function smooth(u: number): number {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}
