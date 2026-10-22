import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "../world/ProcGeo";
import type { WorldMaterials } from "../world/Materials";
import type { RGB } from "../world/CityGenerator";
import { setInstanceCount } from "../world/instancing";
import { GATE_HALF, GATE_HEIGHT, type Mission } from "./Missions";

const MAX = 8;

/** One thin-instanced part: a mesh and its matrix / colour buffers. */
class Part {
  readonly m: Float32Array;
  readonly c: Float32Array;
  n = 0;
  constructor(
    readonly mesh: Mesh,
    readonly max = MAX,
  ) {
    this.m = new Float32Array(max * 16);
    this.c = new Float32Array(max * 4).fill(1);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.thinInstanceSetBuffer("matrix", this.m, 16, false);
    mesh.thinInstanceSetBuffer("color", this.c, 4, false);
    setInstanceCount(mesh, 0);
  }
  flush(): void {
    setInstanceCount(this.mesh, this.n);
    if (this.n > 0) {
      this.mesh.thinInstanceBufferUpdated("matrix");
      this.mesh.thinInstanceBufferUpdated("color");
    }
    this.n = 0;
  }
}

/**
 * Draws special-objective props: rooftop bombs (with a blinking light and a
 * defuse progress bar), floating data cores with light pillars, and the arc
 * reactor you defend (flickering red when hit).
 */
export class MissionRenderer {
  private bomb: Part;
  private bombLight: Part;
  private bar: Part;
  private core: Part;
  private pillar: Part;
  private reactor: Part;
  private reactorGlow: Part;
  private heli: Part;
  private rotor: Part;
  private heliGlow: Part;
  private pad: Part;
  private flame: Part;
  private pylon: Part;
  private ghost: Part;
  private mat = new Matrix();
  private q = new Quaternion();
  private s = new Vector3();
  private t = new Vector3();

  constructor(scene: Scene, mats: WorldMaterials) {
    const g = new ProcGeo(scene);
    const W: RGB = [1, 1, 1];
    const D: RGB = [0.13, 0.13, 0.15];
    const Y: RGB = [0.85, 0.65, 0.1];
    const lit = (m: Mesh) => ((m.material = mats.propLit), m);
    const glow = (m: Mesh) => ((m.material = mats.propGlow), m);
    this.bomb = new Part(
      lit(g.merge("bombBody", [g.box(1.4, 0.8, 1.0, D, 0, 0.4, 0), g.box(1.42, 0.12, 1.02, Y, 0, 0.55, 0), g.box(1.42, 0.12, 1.02, Y, 0, 0.25, 0), g.cyl(0.05, 0.05, 0.6, D, 0.4, 1.0, 0, 6)])),
    );
    this.bombLight = new Part(glow(g.merge("bombLight", [g.sphere(0.16, W, 0, 0.9, 0, 6), g.box(0.5, 0.18, 0.04, W, 0, 0.45, 0.52)])));
    this.bar = new Part(glow(g.merge("bombBar", [g.box(1, 0.14, 0.14, W, 0.5, 0, 0)])));
    this.core = new Part(glow(g.merge("dataCore", [g.ico(0.7, W, 0, 0, 0, 1.3), g.box(0.2, 2.2, 0.2, W, 0, 0, 0)])));
    const pillar = g.merge("corePillar", [g.cyl(0.3, 0.6, 30, W, 0, 15, 0, 8)]);
    pillar.material = mats.additive("corePillarMat", Color3.White(), 1);
    this.pillar = new Part(pillar);
    this.reactor = new Part(
      lit(
        g.merge("reactorBody", [
          g.cyl(2.2, 2.6, 1.0, D, 0, 0.5, 0, 16),
          g.box(0.5, 4.2, 0.5, [0.3, 0.3, 0.34], 1.7, 2.1, 0),
          g.box(0.5, 4.2, 0.5, [0.3, 0.3, 0.34], -1.7, 2.1, 0),
          g.box(0.5, 4.2, 0.5, [0.3, 0.3, 0.34], 0, 2.1, 1.7),
          g.box(0.5, 4.2, 0.5, [0.3, 0.3, 0.34], 0, 2.1, -1.7),
          g.cyl(2.2, 2.2, 0.4, D, 0, 4.2, 0, 16),
        ]),
      ),
    );
    this.reactorGlow = new Part(glow(g.merge("reactorCore", [g.sphere(1.0, W, 0, 2.2, 0, 12), g.cyl(1.9, 1.9, 0.12, W, 0, 1.05, 0, 16)])));
    // Medevac helicopter: white cabin, tail boom, skids; red cross and beacons glow.
    const white: RGB = [0.85, 0.86, 0.88];
    this.heli = new Part(
      lit(
        g.merge("medevac", [
          g.sphere(1.6, white, 0, 0, 0.4, 12, 1, 0.85, 1.5),
          g.box(0.5, 0.5, 5.2, white, 0, 0.3, -3.6),
          g.box(0.12, 1.4, 0.9, white, 0, 0.9, -6.0),
          g.box(0.12, 0.12, 4.0, D, -0.9, -1.4, 0.3),
          g.box(0.12, 0.12, 4.0, D, 0.9, -1.4, 0.3),
          g.cyl(0.12, 0.12, 0.6, D, 0, 1.45, 0.3, 6),
        ]),
      ),
    );
    this.rotor = new Part(lit(g.merge("medevacRotor", [g.box(9.5, 0.06, 0.32, D, 0, 0, 0), g.box(0.32, 0.06, 9.5, D, 0, 0, 0)])));
    this.heliGlow = new Part(glow(g.merge("medevacCross", [g.box(0.06, 0.9, 0.3, W, 1.62, 0.1, 0.4), g.box(0.06, 0.3, 0.9, W, 1.62, 0.1, 0.4), g.box(0.06, 0.9, 0.3, W, -1.62, 0.1, 0.4), g.box(0.06, 0.3, 0.9, W, -1.62, 0.1, 0.4), g.sphere(0.12, W, 0, -0.9, 1.6, 4)])));
    // Rooftop fire: a cluster of flame cones (scaled down as it is blown out).
    this.flame = new Part(glow(g.merge("roofFire", [g.cyl(0, 1.6, 4.5, W, 0, 2.25, 0, 7), g.cyl(0, 1.1, 3.2, W, 1.5, 1.6, 0.6, 6), g.cyl(0, 1.0, 2.8, W, -1.3, 1.4, -0.8, 6)])));
    // Race pylons: tall glowing columns (one per side of each gate).
    this.pylon = new Part(glow(g.merge("racePylon", [g.cyl(0.7, 0.9, GATE_HEIGHT * 2, W, 0, 0, 0, 10), g.cyl(1.4, 1.4, 0.5, W, 0, GATE_HEIGHT, 0, 10)])), 16);
    // The rival: a glowing hologram suit in flying pose.
    this.ghost = new Part(glow(g.merge("raceGhost", [g.sphere(0.36, W, 0, 0, 0.75, 8, 1, 1, 1.1), g.box(0.55, 0.32, 1.1, W, 0, 0, 0), g.box(0.18, 0.18, 1.0, W, -0.15, 0, -0.95), g.box(0.18, 0.18, 1.0, W, 0.15, 0, -0.95), g.box(0.14, 0.14, 0.75, W, -0.42, 0, 0.1), g.box(0.14, 0.14, 0.75, W, 0.42, 0, 0.1)])));
    // Hospital landing pad: a glowing square with an H.
    this.pad = new Part(glow(g.merge("hospitalPad", [g.box(10, 0.06, 0.4, W, 0, 0, 5), g.box(10, 0.06, 0.4, W, 0, 0, -5), g.box(0.4, 0.06, 10, W, 5, 0, 0), g.box(0.4, 0.06, 10, W, -5, 0, 0), g.box(0.5, 0.07, 4, W, -1.2, 0, 0), g.box(0.5, 0.07, 4, W, 1.2, 0, 0), g.box(2.4, 0.07, 0.5, W, 0, 0, 0)])));
  }

  private put(part: Part, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, c: RGB): void {
    if (part.n >= part.max) return;
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, this.q);
    Matrix.ComposeToRef(this.s.set(sx, sy, sz), this.q, this.t.set(x, y, z), this.mat);
    this.mat.copyToArray(part.m, part.n * 16);
    part.c.set([c[0], c[1], c[2], 1], part.n * 4);
    part.n++;
  }

  update(mission: Mission | null, time: number): void {
    if (mission) {
      if (mission.kind === "bombs") {
        // The light blinks faster as the clock runs down.
        const rate = 2 + Math.max(0, 1 - mission.timeLeft / 80) * 14;
        for (const b of mission.points) {
          this.put(this.bomb, b.x, b.y, b.z, 0, 1, 1, 1, [1, 1, 1]);
          const on = b.done ? 0.9 : Math.sin(time * rate * Math.PI) > 0 ? 1.6 : 0.2;
          this.put(this.bombLight, b.x, b.y, b.z, 0, 1, 1, 1, b.done ? [0.2, on, 0.3] : [on, 0.08, 0.05]);
          if (!b.done && b.progress > 0) this.put(this.bar, b.x - 0.7, b.y + 1.6, b.z, 0, 1.4 * b.progress, 1, 1, [0.3, 1.4, 0.4]);
        }
      } else if (mission.kind === "race") {
        const next = mission.points.findIndex((g) => !g.done);
        for (let i = 0; i < mission.points.length; i++) {
          const g = mission.points[i];
          if (g.done) continue;
          const a = mission.points[Math.max(0, i - 1)], b = mission.points[Math.min(mission.points.length - 1, i + 1)];
          const yaw = Math.atan2(b.x - a.x, b.z - a.z);
          const rx = Math.cos(yaw) * GATE_HALF, rz = -Math.sin(yaw) * GATE_HALF;
          const hot = i === next;
          const pulse = hot ? 1.2 + Math.sin(time * 6) * 0.3 : 0.6;
          const c: RGB = hot ? [1.5 * pulse, 0.85 * pulse, 0.15] : [0.15, 0.7 * pulse, 1.2 * pulse];
          this.put(this.pylon, g.x + rx, g.y, g.z + rz, 0, 1, 1, 1, c);
          this.put(this.pylon, g.x - rx, g.y, g.z - rz, 0, 1, 1, 1, c);
        }
        if (mission.raceT >= 3) {
          const gp = mission.ghostPos();
          const flick = Math.sin(time * 40) > -0.6 ? 1 : 0.4;
          this.put(this.ghost, gp.x, gp.y, gp.z, gp.yaw, 1.6, 1.6, 1.6, [0.3 * flick, 1.1 * flick, 1.6 * flick]);
        }
      } else if (mission.kind === "fires") {
        for (let i = 0; i < mission.points.length; i++) {
          const f = mission.points[i];
          if (f.done) continue;
          const k = 1 - f.progress * 0.85;
          const flick = 1 + Math.sin(time * 13 + i * 2) * 0.12 + Math.sin(time * 29 + i) * 0.06;
          this.put(this.flame, f.x, f.y, f.z, time * 0.7 + i, k * flick, k * (1.1 + Math.sin(time * 9 + i) * 0.15), k * flick, [1.6, 0.55 + Math.sin(time * 17 + i) * 0.1, 0.12]);
        }
      } else if (mission.kind === "cores") {
        for (let i = 0; i < mission.points.length; i++) {
          const c = mission.points[i];
          if (c.done) continue;
          const bob = Math.sin(time * 2 + i) * 0.4;
          const pulse = 1 + Math.sin(time * 6 + i) * 0.1;
          this.put(this.core, c.x, c.y + bob, c.z, time * 1.8 + i, pulse, pulse, pulse, [0.3, 1.1, 1.6]);
          const a = 0.14 + Math.sin(time * 3 + i) * 0.04;
          this.put(this.pillar, c.x, c.y - 2, c.z, 0, 1, 1, 1, [0.3 * a, 1.1 * a, 1.6 * a]);
        }
      } else if (mission.kind === "escort" && mission.reactor) {
        const h = mission.reactor;
        const c = h.center;
        const yaw = Math.atan2(h.vel.x, h.vel.z);
        const hit = Math.max(0, 1 - h.hitAgo * 4);
        // Nose down into its flight, with a little wobble when hit.
        Quaternion.RotationYawPitchRollToRef(yaw, 0.12, Math.sin(time * 30) * 0.08 * hit, this.q);
        Matrix.ComposeToRef(this.s.set(1, 1, 1), this.q, this.t.set(c.x, c.y, c.z), this.mat);
        if (this.heli.n < MAX) {
          this.mat.copyToArray(this.heli.m, this.heli.n * 16);
          this.heli.c.set([1 + hit, 1, 1, 1], this.heli.n * 4);
          this.heli.n++;
        }
        if (this.heliGlow.n < MAX) {
          this.mat.copyToArray(this.heliGlow.m, this.heliGlow.n * 16);
          const blink = Math.sin(time * 8) > 0 ? 1.4 : 0.5;
          this.heliGlow.c.set([1.4, 0.1 * blink, 0.08, 1], this.heliGlow.n * 4);
          this.heliGlow.n++;
        }
        this.put(this.rotor, c.x, c.y + 1.75, c.z, time * 22, 1, 1, 1, [1, 1, 1]);
        const pad = mission.points[0];
        const pulse = 0.6 + Math.sin(time * 3) * 0.3;
        this.put(this.pad, pad.x, pad.y + 0.05, pad.z, 0, 1, 1, 1, [0.3 * pulse, 1.2 * pulse, 0.5 * pulse]);
      } else if (mission.kind === "defend" && mission.reactor) {
        const r = mission.reactor;
        const b = r.center;
        this.put(this.reactor, b.x, b.y - 2, b.z, 0, 1, 1, 1, [1, 1, 1]);
        // Steady blue; flashes red when hit and dims as it weakens.
        const hit = Math.max(0, 1 - r.hitAgo * 4);
        const life = 0.4 + (r.hp / 100) * 0.9;
        const pulse = 1 + Math.sin(time * 4) * 0.06;
        this.put(this.reactorGlow, b.x, b.y - 2, b.z, time * 0.8, pulse, 1, pulse, [0.3 * life + hit * 1.5, 0.8 * life, 1.5 * life]);
      }
    }
    for (const p of [this.bomb, this.bombLight, this.bar, this.core, this.pillar, this.reactor, this.reactorGlow, this.heli, this.rotor, this.heliGlow, this.pad, this.flame, this.pylon, this.ghost]) p.flush();
  }
}
