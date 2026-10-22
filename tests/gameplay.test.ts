import { describe, it, expect } from "vitest";
import { KillStreak, STREAK_WINDOW } from "../src/gameplay/Streaks";
import { Pickups, PICKUP_LIFE } from "../src/gameplay/Pickups";
import { CollisionWorld } from "../src/world/Collision";
import { PlayerController } from "../src/player/PlayerController";
import { EventBus, type GameEvents } from "../src/core/EventBus";
import { emptyInput } from "../src/input/InputState";

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
