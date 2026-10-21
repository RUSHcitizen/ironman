import { describe, it, expect } from "vitest";
import { PlayerController, TUNING } from "../src/player/PlayerController";
import { CollisionWorld } from "../src/world/Collision";
import { EventBus, type GameEvents } from "../src/core/EventBus";
import { emptyInput, type InputState } from "../src/input/InputState";

function sim(p: PlayerController, seconds: number, input: Partial<InputState> = {}, edges: Partial<InputState> = {}): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const s = { ...emptyInput(), ...input, ...(t === 0 ? edges : {}) };
    p.update(dt, s);
  }
}

function makeWorld(): CollisionWorld {
  const w = new CollisionWorld();
  w.add({ minX: 20, minY: 0, minZ: -50, maxX: 40, maxY: 60, maxZ: 50 }); // a wall to the east
  return w;
}

describe("PlayerController", () => {
  it("walks forward on the ground", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, 0);
    sim(p, 1, { moveY: 1 });
    expect(p.mode).toBe("ground");
    expect(p.pos.z).toBeGreaterThan(4);
    expect(p.pos.y).toBeCloseTo(0, 3);
  });

  it("takes off into hover and climbs", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, 0);
    sim(p, 2, { ascend: true }, { takeoff: true });
    expect(p.mode).toBe("hover");
    expect(p.pos.y).toBeGreaterThan(10);
  });

  it("holds altitude in hover without input", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, 0);
    sim(p, 1.5, { ascend: true }, { takeoff: true });
    sim(p, 1);
    const y = p.pos.y;
    sim(p, 2);
    expect(Math.abs(p.pos.y - y)).toBeLessThan(0.5);
  });

  it("enters flight, accelerates with afterburner and brakes back to hover", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, Math.PI); // face away from the wall
    sim(p, 0.5, {}, { toggleFlight: true });
    expect(p.mode).toBe("flight");
    sim(p, 3, { moveY: 1 });
    expect(p.afterburner).toBe(true);
    expect(p.speed).toBeGreaterThan(80);
    expect(p.suit.energy).toBeLessThan(100);
    sim(p, 4, { moveY: -1 });
    expect(p.mode).toBe("hover");
  });

  it("lands when descending in hover", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, 0);
    sim(p, 1, { ascend: true }, { takeoff: true });
    sim(p, 4, { descend: true });
    expect(p.mode).toBe("ground");
    expect(p.pos.y).toBeCloseTo(0, 2);
  });

  it("lands on rooftops", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(30, 60, 0, 0);
    expect(p.agl).toBe(0);
    sim(p, 0.5);
    expect(p.pos.y).toBeCloseTo(60, 2);
    expect(p.mode).toBe("ground");
  });

  it("collides with buildings and takes damage at speed", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 20, 0, Math.PI / 2); // facing east, toward the wall
    p.mode = "flight";
    p.viewPitch = 0;
    p.flightSpeed = 100;
    p.vel.x = 100;
    sim(p, 1, { moveY: 1 });
    expect(p.pos.x).toBeLessThan(20);
    expect(p.mode).toBe("hover");
    expect(p.suit.overallIntegrity).toBeLessThan(100);
  });

  it("never tunnels through walls at afterburner speed", () => {
    const p = new PlayerController(makeWorld());
    for (let k = 0; k < 20; k++) {
      p.spawn(-50, 10 + k, k - 10, Math.PI / 2);
      p.mode = "flight";
      p.viewPitch = 0;
      p.flightSpeed = 125;
      p.vel.x = 125;
      sim(p, 1.5, { moveY: 1 });
      expect(p.pos.x).toBeLessThan(20);
    }
  });

  it("takes the suit off and walks as a civilian, then suits up again", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, 0);
    expect(p.requestSuitToggle()).toBe(true);
    expect(p.suited).toBe(false);
    sim(p, 1.4); // frozen while the armour peels away
    sim(p, 1.5, { moveY: 1 });
    const walked = p.pos.z;
    expect(walked).toBeGreaterThan(2);
    expect(walked).toBeLessThan(8); // slower than the armour
    sim(p, 1, { moveY: 1, sprint: true });
    expect(p.pos.z - walked).toBeGreaterThan(4);
    // Civilians can jump but not fly.
    sim(p, 0.5, {}, { toggleFlight: true });
    expect(p.mode).toBe("ground");
    sim(p, 0.1, {}, { toggleSuit: true });
    expect(p.transformTimer).toBeGreaterThan(0);
    sim(p, 1.5);
    expect(p.suited).toBe(true);
  });

  it("refuses to remove the suit mid-air", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, 0);
    sim(p, 1, { ascend: true }, { takeoff: true });
    expect(p.requestSuitToggle()).toBe(false);
    expect(p.suited).toBe(true);
  });

  it("barrel rolls dash sideways and grant brief invulnerability", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, Math.PI);
    sim(p, 0.5, {}, { toggleFlight: true });
    const x0 = p.pos.x;
    sim(p, 0.1, {}, { roll: 1 });
    expect(p.evading).toBe(true);
    expect(p.takeHit(20)).toBe(false);
    sim(p, 0.4);
    expect(Math.abs(p.pos.x - x0)).toBeGreaterThan(3);
    sim(p, 1);
    expect(p.evading).toBe(false);
    expect(p.takeHit(5)).toBe(true);
  });

  it("dives build more speed than level flight", () => {
    const level = new PlayerController(makeWorld());
    level.spawn(0, 400, -600, 0);
    level.mode = "flight";
    level.flightSpeed = 60;
    level.viewPitch = 0;
    sim(level, 3);
    const dive = new PlayerController(makeWorld());
    dive.spawn(0, 400, -600, 0);
    dive.mode = "flight";
    dive.flightSpeed = 60;
    dive.viewPitch = -0.7;
    sim(dive, 3);
    expect(dive.flightSpeed).toBeGreaterThan(level.flightSpeed + 15);
  });

  it("loop-the-loop: the flight path loops and returns near the starting altitude", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 200, -400, Math.PI);
    p.mode = "flight";
    p.flightSpeed = 48;
    p.viewPitch = 0;
    p.vel.z = -48;
    sim(p, 0.5);
    const y0 = p.pos.y;
    let maxY = y0;
    sim(p, 0.02, {}, { trick: "flip" });
    expect(p.trick?.kind).toBe("loop");
    for (let k = 0; k < 140; k++) {
      sim(p, 1 / 60);
      maxY = Math.max(maxY, p.pos.y);
    }
    expect(p.trick).toBeNull();
    expect(maxY - y0).toBeGreaterThan(10);
    expect(Math.abs(p.pos.y - y0)).toBeLessThan(6);
    expect(p.mode).toBe("flight");
  });

  it("hover flips spin the body and chained tricks build a style combo", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, 0);
    sim(p, 1.5, { ascend: true }, { takeoff: true });
    sim(p, 0.3, {}, { trick: "flip" });
    expect(Math.abs(p.trickPitch)).toBeGreaterThan(0.5);
    sim(p, 0.6);
    expect(p.trickPitch).toBe(0);
    expect(p.styleCombo).toBe(1);
    sim(p, 0.8, {}, { trick: "spin" });
    expect(p.styleCombo).toBe(2);
  });

  it("corkscrew in flight is a double roll that dodges fire", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 200, -400, Math.PI);
    p.mode = "flight";
    p.flightSpeed = 48;
    sim(p, 0.1, {}, { trick: "spin" });
    expect(p.trick?.kind).toBe("corkscrew");
    expect(p.evading).toBe(true);
    expect(p.takeHit(10)).toBe(false);
  });

  it("H cuts thrust into a free fall; SPACE re-engages the hover", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, Math.PI);
    sim(p, 6, { ascend: true }, { takeoff: true });
    expect(p.mode).toBe("hover");
    sim(p, 1.5);
    const y0 = p.pos.y;
    sim(p, 1.2, {}, { cutThrust: true });
    expect(p.freefall).toBe(true);
    expect(p.mode).toBe("ground");
    expect(p.pos.y).toBeLessThan(y0 - 8);
    expect(p.falling).toBe(true);
    // No automatic stabilisers while the thrusters are cut.
    sim(p, 0.3);
    expect(p.mode).toBe("ground");
    sim(p, 1.5, {}, { takeoff: true });
    expect(p.freefall).toBe(false);
    expect(p.mode).toBe("hover");
    expect(p.dead).toBe(false);
  });

  it("in the suit you survive a fall from any height - the armour takes the damage", () => {
    const short = new PlayerController(makeWorld());
    short.spawn(0, 30, 0, 0);
    short.mode = "hover";
    short.grounded = false;
    sim(short, 0.1, {}, { cutThrust: true });
    sim(short, 4);
    expect(short.dead).toBe(false);

    for (const h of [400, 3000]) {
      const events: string[] = [];
      const bus = { emit: (t: string) => events.push(t) } as never;
      const p = new PlayerController(makeWorld(), bus);
      p.spawn(0, h, 0, 0);
      p.mode = "hover";
      p.grounded = false;
      sim(p, 0.1, {}, { cutThrust: true });
      for (let t = 0; t < 90 && !p.grounded; t += 1 / 60) p.update(1 / 60, emptyInput());
      expect(p.dead).toBe(false);
      expect(p.grounded).toBe(true);
      expect(events).not.toContain("playerDied");
      expect(p.suit.overallIntegrity).toBeLessThan(100);
      expect(p.suit.overallIntegrity).toBeGreaterThanOrEqual(55);
    }
  });

  it("full damage destroys the suit; repeated hard falls can do it", () => {
    const events: string[] = [];
    const bus = { emit: (t: string) => events.push(t) } as never;
    const p = new PlayerController(makeWorld(), bus);
    for (let k = 0; k < 4 && !events.includes("suitFailure"); k++) {
      p.pos.y = 600;
      p.mode = "hover";
      p.grounded = false;
      sim(p, 0.1, {}, { cutThrust: true });
      for (let t = 0; t < 30 && !p.grounded; t += 1 / 60) p.update(1 / 60, emptyInput());
      p.update(1 / 60, emptyInput());
    }
    expect(events).toContain("suitFailure");
    expect(p.dead).toBe(false);
    // The pilot is left as a civilian; in the air they drift down safely.
    p.pos.y = 300;
    p.grounded = false;
    p.mode = "hover";
    p.suitDestroyed();
    expect(p.suited).toBe(false);
    expect(p.chute).toBe(true);
    sim(p, 70);
    expect(p.dead).toBe(false);
    expect(p.grounded).toBe(true);
  });

  it("power drains 1% per minute in the air, recharges instantly on the ground, and at 0% you sink", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 200, -400, Math.PI);
    p.mode = "flight";
    p.grounded = false;
    p.viewPitch = 0;
    sim(p, 60, { moveY: 1 });
    expect(p.suit.energy).toBeGreaterThan(98.9);
    expect(p.suit.energy).toBeLessThan(99.1);
    p.suit.energy = 0.001;
    sim(p, 0.5);
    expect(p.mode).toBe("hover");
    const y = p.pos.y;
    sim(p, 3, { ascend: true });
    expect(p.pos.y).toBeLessThan(y);
    // Land: instant full recharge.
    p.pos.y = 1;
    sim(p, 2);
    expect(p.grounded).toBe(true);
    expect(p.suit.energy).toBe(100);
  });

  it("civilians die from much shorter falls than the armour", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 60, 0, 0);
    p.suited = false;
    p.grounded = false;
    sim(p, 5);
    expect(p.dead).toBe(true);
  });

  it("flies to space; oxygen drains up there and refills in breathable air", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 2700, 0, 0);
    p.mode = "hover";
    p.grounded = false;
    expect(p.inSpace).toBe(true);
    sim(p, 10);
    expect(p.suit.oxygen).toBeLessThan(80);
    expect(p.suit.oxygen).toBeGreaterThan(60);
    p.pos.y = 500;
    sim(p, 3);
    expect(p.suit.oxygen).toBeGreaterThan(95);
  });

  it("no ceiling below space: flight climbs past 2.6 km", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 2000, 0, Math.PI);
    p.mode = "flight";
    p.grounded = false;
    p.flightSpeed = 60;
    p.viewPitch = 1.2;
    sim(p, 15, { moveY: 1 });
    expect(p.pos.y).toBeGreaterThan(2600);
  });

  it("running out of oxygen blacks you out: thrusters die until you fall back into air", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 3000, 0, 0);
    p.mode = "hover";
    p.grounded = false;
    p.suit.oxygen = 0.5;
    sim(p, 0.5);
    expect(p.blackout).toBe(true);
    expect(p.freefall).toBe(true);
    // Can't re-engage while unconscious.
    sim(p, 0.5, { ascend: true }, { takeoff: true });
    expect(p.mode).toBe("ground");
    // Fall back below the oxygen line, wake up, and recover.
    let woke = false;
    for (let i = 0; i < 60 * 40 && !woke && !p.dead; i++) {
      p.update(1 / 60, emptyInput());
      woke = !p.blackout;
    }
    expect(woke).toBe(true);
    expect(p.pos.y).toBeGreaterThan(100);
    sim(p, 3, {}, { takeoff: true });
    expect(p.mode).toBe("hover");
    expect(p.dead).toBe(false);
  });

  it("stepping out walks the civilian backwards out of the armour", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 0, 0, 0);
    expect(p.exitSuit()).toBe(true);
    expect(p.suited).toBe(false);
    sim(p, 0.3, { moveY: 1 });
    expect(Math.abs(p.pos.z)).toBeLessThan(0.2);
    sim(p, 1.4, { moveY: 1 });
    expect(p.pos.z).toBeLessThan(-0.9);
    expect(p.bodyYaw).toBeCloseTo(0, 3);
    expect(p.transformTimer).toBe(0);
  });

  it("banks gradually and nearly sideways in a turn: right turn drops the right arm", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 300, -400, Math.PI);
    p.mode = "flight";
    p.grounded = false;
    p.flightSpeed = 48;
    sim(p, 0.15, { moveX: 1 });
    const early = p.bank;
    expect(early).toBeLessThan(0);
    expect(early).toBeGreaterThan(-0.6);
    sim(p, 2.5, { moveX: 1 });
    // Negative bank about the long axis = left shoulder up, right arm down.
    expect(p.bank).toBeLessThan(-1.2);
    expect(p.bank).toBeGreaterThanOrEqual(-1.5);
    sim(p, 2.5, { moveX: -1 });
    expect(p.bank).toBeGreaterThan(1.2);
    sim(p, 3);
    expect(Math.abs(p.bank)).toBeLessThan(0.2);
  });

  it("G mid-air ejects: you fall out of the suit as a civilian and die if nobody catches you", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 120, -400, Math.PI);
    p.mode = "hover";
    p.grounded = false;
    expect(p.eject()).toBe(true);
    expect(p.suited).toBe(false);
    expect(p.mode).toBe("ground");
    sim(p, 1);
    expect(p.pos.y).toBeLessThan(120);
    sim(p, 8);
    expect(p.dead).toBe(true);
  });

  it("an empty suit flown remotely survives a fall that would kill a pilot, and uses no oxygen", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 400, -400, 0);
    p.remote = true;
    p.mode = "hover";
    p.grounded = false;
    sim(p, 0.1, {}, { cutThrust: true });
    sim(p, 15);
    expect(p.dead).toBe(false);
    expect(p.grounded).toBe(true);
    expect(p.suit.overallIntegrity).toBeLessThan(100);
    p.possess({ x: 0, y: 3000, z: -400, yaw: 0, suited: true, mode: "hover" });
    expect(p.mode).toBe("hover");
    sim(p, 5);
    expect(p.suit.oxygen).toBe(100);
  });

  it("Shift+A / Shift+D sharp turn snaps the heading ~90 degrees with a hard bank", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 300, -400, Math.PI);
    p.mode = "flight";
    p.grounded = false;
    p.flightSpeed = 60;
    p.vel.z = -60;
    sim(p, 0.2, {}, { sharpTurn: 1 });
    expect(p.sharp).not.toBeNull();
    expect(p.bank).toBeLessThan(-1.0);
    sim(p, 0.6);
    expect(p.sharp).toBeNull();
    // Heading turned right by ~90 degrees (PI -> 3PI/2 = -PI/2).
    expect(Math.abs(Math.atan2(Math.sin(p.viewYaw + Math.PI / 2), Math.cos(p.viewYaw + Math.PI / 2)))).toBeLessThan(0.05);
    // The flight path follows: most velocity now along the new heading (-X).
    expect(p.vel.x).toBeLessThan(-35);
    sim(p, 0.1, {}, { sharpTurn: -1 });
    expect(p.bank).toBeGreaterThan(-1.0);
  });

  it("flight is 25% slower than the 2.5x pass: cruise 90 m/s, afterburner ~234 m/s", () => {
    expect(TUNING.cruiseSpeed).toBe(48 * 2.5 * 0.75);
    expect(TUNING.afterburnerSpeed).toBe(125 * 2.5 * 0.75);
    const p = new PlayerController(makeWorld());
    p.spawn(0, 200, -400, Math.PI);
    p.mode = "flight";
    p.grounded = false;
    p.viewPitch = 0;
    sim(p, 4);
    expect(p.speed).toBeGreaterThan(80);
    expect(p.speed).toBeLessThan(100);
    sim(p, 1.2, { moveY: 1 });
    expect(p.hypersonic).toBe(false);
    expect(p.speed).toBeGreaterThan(150);
    expect(p.speed).toBeLessThan(240);
  });

  it("holding the afterburner goes hypersonic; in thin air high up it breaks Mach 1 (sonic boom)", () => {
    const events: string[] = [];
    const bus = { emit: (t: string) => events.push(t) } as never;
    const p = new PlayerController(makeWorld(), bus);
    p.spawn(0, 300, -400, Math.PI);
    p.mode = "flight";
    p.grounded = false;
    p.viewPitch = 0;
    p.flightSpeed = 90;
    sim(p, 6, { moveY: 1 });
    expect(p.hypersonic).toBe(true);
    expect(events).toContain("hypersonic");
    expect(p.speed).toBeGreaterThan(290);
    expect(p.speed).toBeLessThan(343);
    // Higher up the thinner air lets the same burn push past the sound barrier.
    p.pos.y = 1500;
    sim(p, 6, { moveY: 1 });
    expect(p.speed).toBeGreaterThan(343);
    expect(events).toContain("sonicBoom");
    expect(p.topSpeed).toBeGreaterThan(343);
    sim(p, 0.1);
    expect(p.hypersonic).toBe(false);
  });

  it("hover is 1.5x faster but still settles precisely", () => {
    const p = new PlayerController(makeWorld());
    p.spawn(0, 50, -400, Math.PI);
    p.mode = "hover";
    p.grounded = false;
    sim(p, 3, { moveY: 1 });
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeGreaterThan(24);
    sim(p, 2);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeLessThan(1);
  });
  it("glancing a wall scrapes along it instead of stopping the flight", () => {
    const w = new CollisionWorld();
    w.add({ minX: 20, minY: 0, minZ: -2000, maxX: 40, maxY: 300, maxZ: 2000 });
    const bus = new EventBus<GameEvents>();
    const scrapes: number[] = [];
    bus.on("scrape", (e) => scrapes.push(e.speed));
    const p = new PlayerController(w, bus);
    p.spawn(15, 100, -600, 0.12); // heading north, drifting into the wall
    p.mode = "flight";
    p.grounded = false;
    p.viewPitch = 0;
    p.flightSpeed = 150;
    p.vel.z = 150;
    sim(p, 2);
    expect(scrapes.length).toBeGreaterThan(0);
    expect(p.mode).toBe("flight");
    expect(p.pos.x).toBeLessThan(20);
    expect(p.speed).toBeGreaterThan(80);
    expect(p.pos.z).toBeGreaterThan(-500);
  });

  it("skimming low and fast builds RUSH, which raises top speed; it fades up high", () => {
    const w = new CollisionWorld();
    w.add({ minX: -3000, minY: -10, minZ: -3000, maxX: 3000, maxY: 0, maxZ: 3000 });
    const p = new PlayerController(w);
    p.spawn(0, 12, -2500, 0);
    p.mode = "flight";
    p.grounded = false;
    p.viewPitch = 0;
    p.flightSpeed = 140;
    p.vel.z = 140;
    sim(p, 5);
    expect(p.rush).toBeGreaterThan(0.5);
    expect(p.speed).toBeGreaterThan(TUNING.cruiseSpeed * 1.1);
    p.pos.y = 600;
    sim(p, 6);
    expect(p.rush).toBeLessThan(0.5);
  });
});
