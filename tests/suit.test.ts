import { describe, it, expect } from "vitest";
import { CollisionWorld } from "../src/world/Collision";
import { PlayerController, TUNING } from "../src/player/PlayerController";
import { SuitUnit } from "../src/player/SuitUnit";
import { EnemyManager } from "../src/combat/Enemies";
import { ProjectileSystem } from "../src/combat/Projectiles";
import type { CombatTarget } from "../src/combat/Targets";
import { emptyInput } from "../src/input/InputState";
import { SUIT_UP_STAGES, SUIT_UP_TIME, SuitStage, pieceTiming, stageAt, suitUpPose } from "../src/player/SuitUpChoreography";

function setup() {
  const world = new CollisionWorld();
  // A tall building between the suit and the player.
  world.add({ minX: -20, minY: 0, minZ: 80, maxX: 20, maxY: 60, maxZ: 120 });
  const player = new PlayerController(world);
  player.spawn(0, 0, 0, 0);
  const enemies = new EnemyManager(world);
  const targets: CombatTarget[] = [player];
  const proj = new ProjectileSystem(world, enemies, targets);
  const suit = new SuitUnit(world, player.suit, enemies, proj);
  targets.push(suit);
  return { world, player, enemies, proj, suit };
}

function step(s: ReturnType<typeof setup>, seconds: number, moveY = 0): boolean {
  const dt = 1 / 60;
  let docked = false;
  for (let t = 0; t < seconds && !docked; t += dt) {
    s.player.update(dt, { ...emptyInput(), moveY });
    docked = s.suit.update(dt, s.player);
    s.enemies.update(dt, [s.player, s.suit]);
    s.proj.update(dt);
  }
  return docked;
}

describe("autonomous suit", () => {
  it("stepping out leaves the suit parked; calling it flies it over buildings to dock", () => {
    const s = setup();
    expect(s.player.exitSuit()).toBe(true);
    expect(s.player.suited).toBe(false);
    // Suit left 200 m away on the far side of a building.
    s.suit.park(0, 0, 200, Math.PI);
    expect(s.suit.call()).toBe(true);
    expect(s.suit.state).toBe("inbound");
    const docked = step(s, 25);
    expect(docked).toBe(true);
    expect(s.suit.state).toBe("worn");
    // The player can now suit up.
    expect(s.player.beginSuitUp()).toBe(true);
    step(s, 1.5);
    expect(s.player.suited).toBe(true);
  });

  it("follows a walking civilian while inbound", () => {
    const s = setup();
    s.player.exitSuit();
    s.suit.park(60, 0, -40, 0);
    s.suit.call();
    expect(step(s, 20, 1)).toBe(true);
  });

  it("sentry mode fights hostiles on its own while enemies ignore the civilian", () => {
    const s = setup();
    s.player.exitSuit();
    s.suit.park(0, 0, -3, 0);
    expect(s.suit.setSentry(true)).toBe(true);
    s.enemies.spawn("drone", 10, 20, -60);
    s.enemies.spawn("trooper", -30, 0, -50);
    step(s, 20);
    expect(s.enemies.kills).toBeGreaterThanOrEqual(1);
    // Enemies shot at the suit (shared integrity), never at the civilian.
    expect(s.player.suited).toBe(false);
    expect(s.player.targetable).toBe(false);
  });

  it("a wrecked sentry goes offline and cannot be called until repaired", () => {
    const s = setup();
    s.player.exitSuit();
    s.suit.park(0, 0, -3, 0);
    s.suit.setSentry(true);
    for (let k = 0; k < 300 && s.suit.state === "sentry"; k++) s.suit.takeHit(30);
    expect(s.suit.state).toBe("parked");
    expect(s.suit.call()).toBe(false);
  });

  it("after a mid-air eject, a quick call catches you before you hit the ground", () => {
    const s = setup();
    s.player.spawn(0, 150, -300, Math.PI);
    s.player.mode = "hover";
    s.player.grounded = false;
    s.player.eject();
    s.suit.park(s.player.pos.x, s.player.pos.y, s.player.pos.z, Math.PI);
    step(s, 0.6);
    expect(s.player.suited).toBe(false);
    expect(s.suit.call()).toBe(true);
    const docked = step(s, 6);
    expect(docked).toBe(true);
    expect(s.player.grounded).toBe(false);
    expect(s.player.beginSuitUp(TUNING.airLatchTime)).toBe(true);
    step(s, 3);
    expect(s.player.suited).toBe(true);
    expect(s.player.dead).toBe(false);
    expect(s.player.mode).toBe("hover");
  });
});

describe("suit-up choreography", () => {
  it("goes chest, right arm, left arm, right leg, left leg, helmet, then faceplate - and control returns after it", () => {
    const order = [SuitStage.Core, SuitStage.RightArm, SuitStage.LeftArm, SuitStage.RightLeg, SuitStage.LeftLeg, SuitStage.Helmet, SuitStage.Faceplate];
    for (let k = 1; k < order.length; k++) expect(SUIT_UP_STAGES[order[k]].start).toBeGreaterThan(SUIT_UP_STAGES[order[k - 1]].start);
    for (const st of order) {
      const s = SUIT_UP_STAGES[st];
      expect(stageAt(s.start + s.dur / 2)).toBe(st);
      // Every plate of a section lands inside its own section's window.
      for (const o of [0, 0.5, 1]) {
        const { t0, flight } = pieceTiming(st, o);
        expect(t0).toBeGreaterThanOrEqual(s.start);
        expect(t0 + flight).toBeLessThanOrEqual(s.start + s.dur + 1e-9);
      }
    }
    expect(SUIT_UP_STAGES[SuitStage.Faceplate].start + SUIT_UP_STAGES[SuitStage.Faceplate].dur).toBeLessThanOrEqual(SUIT_UP_TIME);
    expect(TUNING.latchTime).toBeGreaterThanOrEqual(SUIT_UP_TIME);
  });

  it("raises each arm out to the side, then lifts each knee, looking at the limb", () => {
    const mid = (st: number) => SUIT_UP_STAGES[st].start + SUIT_UP_STAGES[st].dur * 0.5;
    const ra = suitUpPose(mid(SuitStage.RightArm));
    expect(ra.pose.shR![1]).toBeGreaterThan(1.2); // right arm straight out
    expect(Math.abs(ra.pose.shL![1])).toBeLessThan(0.5);
    expect(ra.look).toBeGreaterThan(0.3);
    const la = suitUpPose(mid(SuitStage.LeftArm));
    expect(la.pose.shL![1]).toBeLessThan(-1.2);
    expect(la.look).toBeLessThan(-0.3);
    const rl = suitUpPose(mid(SuitStage.RightLeg));
    expect(rl.pose.hipR![0]).toBeLessThan(-0.8); // knee up
    expect(rl.pose.knR![0]).toBeGreaterThan(0.9);
    expect(Math.abs(rl.pose.hipL![0])).toBeLessThan(0.1);
    const ll = suitUpPose(mid(SuitStage.LeftLeg));
    expect(ll.pose.hipL![0]).toBeLessThan(-0.8);
    // Helmet / faceplate: standing tall, both feet down.
    const fp = suitUpPose(mid(SuitStage.Faceplate));
    expect(Math.abs(fp.pose.hipL![0]) + Math.abs(fp.pose.hipR![0])).toBeLessThan(0.1);
  });
});
