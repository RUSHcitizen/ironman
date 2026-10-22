import { describe, it, expect } from "vitest";
import { KillStreak, STREAK_WINDOW } from "../src/gameplay/Streaks";
import { Pickups, PICKUP_LIFE } from "../src/gameplay/Pickups";
import { CollisionWorld } from "../src/world/Collision";
import { PlayerController } from "../src/player/PlayerController";
import { EventBus, type GameEvents } from "../src/core/EventBus";
import { emptyInput } from "../src/input/InputState";
import { planMission, BOMB_DEFUSE_TIME, COURIER_ESCAPE, type MissionContext } from "../src/gameplay/Missions";
import { EnemyManager } from "../src/combat/Enemies";
import { Achievements } from "../src/gameplay/Achievements";
import { Rng } from "../src/core/math";

describe("kill streaks", () => {
  it("chains kills inside the window into call-outs with a growing XP multiplier", () => {
    const s = new KillStreak();
    expect(s.kill(0).label).toBeNull();
    const two = s.kill(1);
    expect(two.label).toBe("DOUBLE KILL");
    expect(two.multiplier).toBeCloseTo(1.25);
    expect(s.kill(2).label).toBe("TRIPLE KILL");
    for (let k = 3; k < 10; k++) s.kill(k);
    expect(s.chain).toBe(10);
    expect(s.kill(10).multiplier).toBe(3); // capped
    // A gap longer than the window resets the chain.
    const fresh = s.kill(10 + STREAK_WINDOW + 0.1);
    expect(fresh.chain).toBe(1);
    expect(fresh.multiplier).toBe(1);
    expect(s.best).toBe(11);
  });
});

describe("pickups", () => {
  it("big wrecks always drop salvage that settles above the ground and is pulled in when you fly close", () => {
    const w = new CollisionWorld();
    const p = new Pickups(w);
    p.onKill("titan", 0, 20, 0);
    expect(p.items.length).toBe(2);
    // Far away: they pop, fall and settle ~1.3 m above the street.
    for (let t = 0; t < 4; t += 1 / 60) p.update(1 / 60, 500, 50, 500, true);
    for (const it of p.items) expect(it.y).toBeCloseTo(it.rest, 3);
    expect(p.items[0].rest).toBeGreaterThan(1);
    // Fly by within the magnet range: collected.
    let got = 0;
    for (let t = 0; t < 2; t += 1 / 60) got += p.update(1 / 60, 6, 3, 0, true).length;
    expect(got).toBe(2);
    expect(p.items.length).toBe(0);
  });

  it("can't be collected out of the suit, and expire after a while", () => {
    const p = new Pickups(new CollisionWorld());
    p.drop("repair", 0, 10, 0);
    for (let t = 0; t < 3; t += 1 / 60) expect(p.update(1 / 60, 0, 2, 0, false).length).toBe(0);
    for (let t = 0; t < PICKUP_LIFE; t += 0.5) p.update(0.5, 100, 2, 100, true);
    expect(p.items.length).toBe(0);
  });
});

describe("superhero landing", () => {
  it("a hard landing in the suit flags a superhero landing and reports its speed", () => {
    const bus = new EventBus<GameEvents>();
    const seen: { hard: boolean; speed: number; suited: boolean }[] = [];
    bus.on("landed", (e) => seen.push(e));
    const p = new PlayerController(new CollisionWorld(), bus);
    p.spawn(0, 60, 0, 0);
    p.mode = "hover";
    p.grounded = false;
    p.cutThrusters();
    for (let t = 0; t < 6 && !p.grounded; t += 1 / 60) p.update(1 / 60, emptyInput());
    expect(seen.length).toBe(1);
    expect(seen[0].hard).toBe(true);
    expect(seen[0].suited).toBe(true);
    expect(seen[0].speed).toBeGreaterThan(22);
    expect(p.superLanding).toBeGreaterThan(0.8);
  });
});

/** A small grid of 30 m towers to put bombs and cores on. */
function towers(): CollisionWorld {
  const w = new CollisionWorld();
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) w.add({ minX: i * 80 + 10, minY: 0, minZ: j * 80 + 10, maxX: i * 80 + 60, maxY: 30 + ((i + j) & 3) * 10, maxZ: j * 80 + 60 });
  return w;
}

describe("special objectives", () => {
  const ctxAt = (enemies: EnemyManager, x: number, y: number, z: number): MissionContext => ({ px: x, py: y, pz: z, suited: true, enemies });

  it("bomb threat: hover beside each rooftop bomb to defuse it; leave one and the timer sets them off", () => {
    const w = towers();
    const enemies = new EnemyManager(w);
    const m = planMission("bombs", w, new Rng(3), 0, 0, enemies, 1)!;
    expect(m.points.length).toBe(3);
    for (const b of m.points) expect(b.y).toBeGreaterThan(14); // on a roof
    for (const b of m.points.slice(0, 2)) {
      for (let t = 0; t < BOMB_DEFUSE_TIME + 0.2; t += 0.1) m.update(0.1, ctxAt(enemies, b.x + 2, b.y + 2, b.z));
      expect(b.done).toBe(true);
    }
    expect(m.status).toBe("active");
    for (let t = 0; t < 100; t += 0.5) m.update(0.5, ctxAt(enemies, 2000, 50, 2000));
    expect(m.status).toBe("lost");
  });

  it("data cores: fly through all six to win", () => {
    const w = towers();
    const enemies = new EnemyManager(w);
    const m = planMission("cores", w, new Rng(5), 0, 0, enemies, 1)!;
    expect(m.points.length).toBe(6);
    for (const c of m.points) m.update(0.1, ctxAt(enemies, c.x, c.y, c.z));
    expect(m.status).toBe("won");
  });

  it("courier: it runs from you and escapes if you fall behind; shoot it down to win", () => {
    const w = new CollisionWorld();
    const enemies = new EnemyManager(w);
    const m = planMission("courier", w, new Rng(7), 0, 0, enemies, 9)!;
    const courier = enemies.enemies.find((e) => e.kind === "courier")!;
    const target = { center: { x: 0, y: 40, z: -60 }, vel: { x: 0, y: 0, z: 0 }, targetable: true, evading: false, takeHit: () => true };
    const z0 = courier.z;
    for (let t = 0; t < 3; t += 1 / 60) enemies.update(1 / 60, [target]);
    expect(courier.z).toBeGreaterThan(z0 + 60); // fleeing away from the player (who is at -z)
    // You stay put: it gets away.
    const lost = planMission("courier", w, new Rng(8), 0, 0, enemies, 10)!;
    const c2 = enemies.enemies.find((e) => e.group === 10)!;
    c2.x = COURIER_ESCAPE + 50;
    lost.update(0.1, ctxAt(enemies, 0, 40, 0));
    expect(lost.status).toBe("lost");
    enemies.damage(courier, 1000);
    m.update(0.1, ctxAt(enemies, 0, 40, 0));
    expect(m.status).toBe("won");
  });

  it("defend the reactor: waves come for it; it is lost if destroyed, won if the waves are beaten", () => {
    const w = towers();
    const enemies = new EnemyManager(w);
    const m = planMission("defend", w, new Rng(11), 0, 0, enemies, 4)!;
    const r = m.reactor!;
    expect(r.targetable).toBe(true);
    m.update(3.1, ctxAt(enemies, 2000, 50, 2000));
    expect(m.wave).toBe(1);
    expect(enemies.aliveInGroup(4)).toBe(3);
    // Kill each wave as it arrives: the next comes straight away; after the last, it's won.
    for (let k = 0; k < 10 && m.status === "active"; k++) {
      for (const e of enemies.enemies) if (e.group === 4) enemies.damage(e, 5000);
      enemies.update(0.01, [r]);
      m.update(0.1, ctxAt(enemies, 2000, 50, 2000));
    }
    expect(m.status).toBe("won");
    expect(r.targetable).toBe(false);
    // A destroyed reactor loses the mission.
    const m2 = planMission("defend", w, new Rng(12), 0, 0, enemies, 5)!;
    m2.reactor!.takeHit(1000);
    m2.update(0.1, ctxAt(enemies, 2000, 50, 2000));
    expect(m2.status).toBe("lost");
  });
});

describe("achievements", () => {
  it("unlock once from game events and announce themselves", () => {
    const bus = new EventBus<GameEvents>();
    const a = new Achievements(bus);
    const got: string[] = [];
    bus.on("achievement", (e) => got.push(e.id));
    bus.emit("kill", { kind: "titan", total: 1, x: 0, y: 0, z: 0 });
    bus.emit("kill", { kind: "drone", total: 2, x: 0, y: 0, z: 0 });
    bus.emit("streak", { chain: 7, label: "RAMPAGE" });
    bus.emit("objective", { kind: "bombs", won: true });
    bus.emit("objective", { kind: "cores", won: false });
    bus.emit("superLanding", { hits: 3 });
    expect(got).toEqual(["firstBlood", "giantSlayer", "doubleKill", "rampage", "bombSquad", "heroLanding"]);
    expect(a.list().filter((x) => x.done).length).toBe(6);
    expect(a.unlock("firstBlood")).toBe(false);
  });
});
