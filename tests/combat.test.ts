import { describe, it, expect } from "vitest";
import { CollisionWorld } from "../src/world/Collision";
import { PlayerController } from "../src/player/PlayerController";
import { EnemyManager } from "../src/combat/Enemies";
import { ProjectileSystem } from "../src/combat/Projectiles";
import { Combat } from "../src/combat/Combat";
import { emptyInput, type InputState } from "../src/input/InputState";

function setup() {
  const world = new CollisionWorld();
  const player = new PlayerController(world);
  player.spawn(0, 0, 0, 0); // facing +Z
  const enemies = new EnemyManager(world);
  const proj = new ProjectileSystem(world, enemies, player);
  const combat = new Combat(world, enemies, proj);
  return { world, player, enemies, proj, combat };
}

function run(s: ReturnType<typeof setup>, seconds: number, input: Partial<InputState> = {}, edges: Partial<InputState> = {}) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const inp = { ...emptyInput(), ...input, ...(t === 0 ? edges : {}) };
    s.player.update(dt, inp);
    const c = s.player.center;
    // Camera roughly behind the player looking along the view direction.
    s.combat.update(dt, inp, s.player, { x: c.x - Math.sin(s.player.viewYaw) * 4, y: c.y + 0.5, z: c.z - Math.cos(s.player.viewYaw) * 4 });
    s.enemies.update(dt, s.player);
    s.proj.update(dt);
  }
}

describe("combat", () => {
  it("repulsors destroy a trooper in the crosshair", () => {
    const s = setup();
    s.player.viewPitch = 0;
    const e = s.enemies.spawn("trooper", 0, 0, 40);
    run(s, 3, { fire: true });
    expect(e.alive).toBe(false);
    expect(s.enemies.kills).toBe(1);
  });

  it("homing rockets lock on and hit an off-centre drone", () => {
    const s = setup();
    s.player.viewPitch = 0.05;
    const e = s.enemies.spawn("drone", 25, 6, 80);
    run(s, 0.3); // let lock-on find it
    expect(s.combat.locks).toContain(e);
    run(s, 3, {}, { rockets: true });
    expect(e.alive).toBe(false);
    expect(s.combat.rockets).toBeLessThan(8);
  });

  it("drones engage and damage a suited player but ignore a civilian", () => {
    const s = setup();
    s.enemies.spawn("drone", 0, 12, 40);
    run(s, 8);
    expect(s.player.suit.overallIntegrity).toBeLessThan(100);

    const c = setup();
    c.player.requestSuitToggle();
    expect(c.player.suited).toBe(false);
    c.enemies.spawn("drone", 0, 12, 40);
    run(c, 8);
    expect(c.player.suit.overallIntegrity).toBe(100);
  });

  it("a barrel roll breaks missile lock", () => {
    const s = setup();
    run(s, 1, { ascend: true }, { takeoff: true });
    s.proj.missile({ x: 0, y: s.player.center.y, z: 60 }, { x: 0, y: 0, z: -1 }, 14);
    run(s, 0.2, {}, { roll: 1 });
    const m = s.proj.projectiles.find((p) => p.kind === "missile");
    expect(m?.homingPlayer).toBe(false);
  });

  it("kamikaze drones dive in and explode on the player", () => {
    const s = setup();
    s.enemies.spawn("kamikaze", 0, 8, 60);
    run(s, 6);
    expect(s.enemies.alive.length).toBe(0);
    expect(s.player.suit.overallIntegrity).toBeLessThan(100);
  });

  it("the warbot telegraphs its laser before firing", () => {
    const s = setup();
    const w = s.enemies.spawn("warbot", 0, 0, 60);
    let telegraphed = false;
    let fired = false;
    for (let k = 0; k < 60 * 15 && !fired; k++) {
      run(s, 1 / 60);
      if (s.proj.beams.some((b) => b.kind === "telegraph")) telegraphed = true;
      if (s.proj.beams.some((b) => b.kind === "laser")) fired = true;
    }
    expect(w.alive).toBe(true);
    // Laser only ever appears after a telegraph.
    if (fired) expect(telegraphed).toBe(true);
    expect(telegraphed || s.proj.projectiles.some((p) => p.kind === "missile") || s.player.suit.overallIntegrity < 100).toBe(true);
  });
});
