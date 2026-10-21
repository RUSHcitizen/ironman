import { describe, it, expect } from "vitest";
import { CollisionWorld } from "../src/world/Collision";
import { PlayerController } from "../src/player/PlayerController";
import { EnemyManager } from "../src/combat/Enemies";
import { ProjectileSystem } from "../src/combat/Projectiles";
import { Combat, UNIBEAM } from "../src/combat/Combat";
import { rankFor } from "../src/gameplay/Progress";
import { isCloaked } from "../src/combat/Enemies";
import { emptyInput, type InputState } from "../src/input/InputState";

function setup() {
  const world = new CollisionWorld();
  const player = new PlayerController(world);
  player.spawn(0, 0, 0, 0); // facing +Z
  const enemies = new EnemyManager(world);
  const proj = new ProjectileSystem(world, enemies, [player]);
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
    s.enemies.update(dt, [s.player]);
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
    expect(m?.homing).toBeNull();
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

describe("new enemy types", () => {
  it("a shield drone cuts damage to nearby allies until it is destroyed", () => {
    const s = setup();
    const trooper = s.enemies.spawn("trooper", 0, 0, 80);
    const shield = s.enemies.spawn("shielder", 4, 6, 82);
    s.enemies.update(1 / 60, [s.player]);
    expect(trooper.shielded).toBe(true);
    s.enemies.damage(trooper, 20);
    expect(trooper.hp).toBeCloseTo(45 - 5);
    s.enemies.damage(shield, 1000);
    s.enemies.update(1 / 60, [s.player]);
    expect(trooper.shielded).toBe(false);
    s.enemies.damage(trooper, 20);
    expect(trooper.hp).toBeCloseTo(40 - 20);
  });

  it("snipers telegraph with a laser before their heavy shot", () => {
    const s = setup();
    s.enemies.spawn("sniper", 0, 0, 120);
    let telegraph = false;
    let shot = false;
    for (let k = 0; k < 60 * 10 && !shot; k++) {
      run(s, 1 / 60);
      if (s.proj.beams.some((b) => b.kind === "telegraph")) telegraph = true;
      if (s.proj.projectiles.some((p) => p.kind === "enemyBolt" && p.speed > 200)) shot = true;
    }
    expect(telegraph).toBe(true);
    expect(shot).toBe(true);
  });

  it("tanks lob arcing shells that hurt on impact", () => {
    const s = setup();
    s.enemies.spawn("tank", 0, 0, 90);
    let sawShell = false;
    for (let k = 0; k < 60 * 12; k++) {
      run(s, 1 / 60);
      if (s.proj.projectiles.some((p) => p.kind === "shell")) sawShell = true;
    }
    expect(sawShell).toBe(true);
    expect(s.player.suit.overallIntegrity).toBeLessThan(100);
  });

  it("gunships circle-strafe and fire on the player", () => {
    const s = setup();
    const g = s.enemies.spawn("gunship", 0, 40, 100);
    run(s, 8);
    expect(g.alive).toBe(true);
    expect(Math.hypot(g.x, g.z)).toBeGreaterThan(40);
    expect(s.player.suit.overallIntegrity).toBeLessThan(100);
  });

  it("interceptor jets make fast strafing passes, overshoot and come back", () => {
    const s = setup();
    s.player.mode = "hover";
    s.player.pos.y = 60;
    s.player.grounded = false;
    const j = s.enemies.spawn("jet", 0, 120, 300);
    let maxSpeed = 0, retreated = false;
    for (let k = 0; k < 12 * 60; k++) {
      run(s, 1 / 60);
      maxSpeed = Math.max(maxSpeed, Math.hypot(j.vx, j.vy, j.vz));
      if (j.state === "retreat") retreated = true;
    }
    expect(maxSpeed).toBeGreaterThan(70);
    expect(retreated).toBe(true);
    expect(s.player.suit.overallIntegrity).toBeLessThan(100);
  });

  it("swarmers buzz in close, peck at you and pop in one hit", () => {
    const s = setup();
    const w = s.enemies.spawn("swarmer", 0, 6, 60);
    run(s, 5);
    expect(Math.hypot(w.x, w.z)).toBeLessThan(25);
    s.enemies.damage(w, 10);
    expect(w.alive).toBe(false);
  });

  it("EMP jammers charge and pulse, draining suit power", () => {
    const s = setup();
    s.player.mode = "hover";
    s.player.pos.y = 10;
    s.player.grounded = false;
    const j = s.enemies.spawn("jammer", 0, 15, 30);
    let charged = false;
    for (let k = 0; k < 10 * 60 && s.player.suit.energy > 80; k++) {
      run(s, 1 / 60);
      if (j.state === "charge") charged = true;
      s.player.suit.energy = Math.min(s.player.suit.energy, 100);
    }
    expect(charged).toBe(true);
    expect(s.player.suit.energy).toBeLessThan(80);
  });

  it("the Dreadnought carrier launches swarmers that don't count toward its incident group", () => {
    const s = setup();
    const c = s.enemies.spawn("carrier", 0, 70, 120, 5);
    run(s, 14);
    expect(c.alive).toBe(true);
    const swarm = s.enemies.enemies.filter((e) => e.alive && e.kind === "swarmer");
    expect(swarm.length).toBeGreaterThanOrEqual(3);
    expect(swarm.length).toBeLessThanOrEqual(9);
    expect(swarm.every((e) => e.group === -c.id)).toBe(true);
    expect(s.enemies.aliveInGroup(5)).toBe(1);
  });

  it("the Unibeam charges, then destroys everything on the aim line and costs power", () => {
    const s = setup();
    s.player.viewPitch = 0;
    s.player.mode = "hover";
    s.player.grounded = false;
    s.player.pos.y = 20;
    const a = s.enemies.spawn("drone", 0, 21.5, 60);
    const b = s.enemies.spawn("trooper", 0, 20, 140);
    const off = s.enemies.spawn("drone", 40, 21, 60);
    run(s, 0.1, {}, { beam: true });
    expect(s.combat.beamCharge).toBeGreaterThanOrEqual(0);
    expect(a.alive).toBe(true);
    run(s, UNIBEAM.charge + 0.1);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(off.alive).toBe(true);
    expect(s.player.suit.energy).toBeLessThan(100 - UNIBEAM.cost + 5);
    expect(s.combat.beamCooldown).toBeGreaterThan(0);
    expect(s.proj.beams.some((x) => x.kind === "unibeam")).toBe(true);
  });

  it("flares break missile locks and the missiles chase the decoys instead", () => {
    const s = setup();
    s.player.mode = "hover";
    s.player.grounded = false;
    s.player.pos.y = 30;
    s.proj.missile({ x: 0, y: 30, z: 120 }, { x: 0, y: 0, z: -1 }, 14);
    run(s, 0.5);
    const m = s.proj.projectiles.find((p) => p.kind === "missile")!;
    expect(m.homing).toBe(s.player);
    run(s, 0.05, {}, { flares: true });
    expect(m.homing).toBeNull();
    expect(m.decoy).toBeTruthy();
    expect(s.proj.particles.filter((p) => p.kind === "flare").length).toBeGreaterThan(5);
    const hp = s.player.suit.overallIntegrity;
    run(s, 4);
    expect(s.player.suit.overallIntegrity).toBe(hp);
  });

  it("destroyed enemies throw tumbling wreckage that lands", () => {
    const s = setup();
    const e = s.enemies.spawn("gunship", 0, 30, 80);
    s.enemies.damage(e, 1000);
    const debris = s.proj.particles.filter((p) => p.kind === "debris");
    expect(debris.length).toBeGreaterThan(5);
    run(s, 2);
    for (const d of s.proj.particles.filter((p) => p.kind === "debris")) expect(d.y).toBeGreaterThanOrEqual(0);
  });

  it("hero rank climbs with XP", () => {
    expect(rankFor(0).name).toBe("ROOKIE");
    expect(rankFor(1500).name).toBe("VIGILANTE");
    expect(rankFor(13000).name).toBe("AVENGER");
    expect(rankFor(1e6).next).toBeNull();
  });

  it("sentinels wind up, ram you at high speed, then peel away", () => {
    const s = setup();
    s.player.mode = "hover";
    s.player.grounded = false;
    s.player.pos.y = 20;
    const e = s.enemies.spawn("sentinel", 0, 24, 40);
    let charged = false, dashSpeed = 0;
    for (let k = 0; k < 12 * 60; k++) {
      run(s, 1 / 60);
      if (e.state === "charge") charged = true;
      if (e.state === "slam") dashSpeed = Math.max(dashSpeed, Math.hypot(e.vx, e.vy, e.vz));
    }
    expect(charged).toBe(true);
    expect(dashSpeed).toBeGreaterThan(40);
    expect(s.player.suit.overallIntegrity).toBeLessThan(100);
  });

  it("spider walkers lob fans of mortar shells", () => {
    const s = setup();
    s.enemies.spawn("spider", 0, 0, 90);
    let shells = 0;
    for (let k = 0; k < 8 * 60 && shells < 3; k++) {
      run(s, 1 / 60);
      shells = Math.max(shells, s.proj.projectiles.filter((p) => p.kind === "shell").length);
    }
    expect(shells).toBeGreaterThanOrEqual(3);
  });

  it("cloakers stay invisible (no lock-on) until they fire or get hit", () => {
    const s = setup();
    s.player.viewPitch = 0.1;
    const e = s.enemies.spawn("cloaker", 0, 8, 60);
    run(s, 0.5);
    expect(isCloaked(e)).toBe(true);
    expect(s.combat.locks).not.toContain(e);
    s.enemies.damage(e, 5);
    expect(isCloaked(e)).toBe(false);
    let fired = false;
    for (let k = 0; k < 10 * 60 && !fired; k++) {
      run(s, 1 / 60);
      fired = s.proj.projectiles.some((p) => p.kind === "enemyBolt");
    }
    expect(fired).toBe(true);
  });

  it("the titan is a scaled-up warbot boss", () => {
    const s = setup();
    const t = s.enemies.spawn("titan", 0, 0, 80);
    run(s, 10);
    expect(t.alive).toBe(true);
    expect(t.maxHp).toBeGreaterThan(900);
    expect(s.player.suit.overallIntegrity).toBeLessThan(100);
  });
});
