import { describe, it, expect } from "vitest";
import { CollisionWorld } from "../src/world/Collision";
import { PlayerController } from "../src/player/PlayerController";
import { SuitUnit } from "../src/player/SuitUnit";
import { EnemyManager } from "../src/combat/Enemies";
import { ProjectileSystem } from "../src/combat/Projectiles";
import type { CombatTarget } from "../src/combat/Targets";
import { emptyInput } from "../src/input/InputState";

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
    for (let k = 0; k < 30 && s.suit.state === "sentry"; k++) s.suit.takeHit(30);
    expect(s.suit.state).toBe("parked");
    expect(s.suit.call()).toBe(false);
  });
});
