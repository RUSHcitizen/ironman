import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "../world/ProcGeo";
import type { WorldMaterials } from "../world/Materials";
import type { RGB } from "../world/CityGenerator";
import { setInstanceCount } from "../world/instancing";
import type { Mission } from "./Missions";

const MAX = 8;

/** One thin-instanced part: a mesh and its matrix / colour buffers. */
class Part {
  readonly m: Float32Array;
  readonly c: Float32Array;
  n = 0;
  constructor(readonly mesh: Mesh) {
    this.m = new Float32Array(MAX * 16);
    this.c = new Float32Array(MAX * 4).fill(1);
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
  }

  private put(part: Part, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, c: RGB): void {
    if (part.n >= MAX) return;
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
    for (const p of [this.bomb, this.bombLight, this.bar, this.core, this.pillar, this.reactor, this.reactorGlow]) p.flush();
  }
}
