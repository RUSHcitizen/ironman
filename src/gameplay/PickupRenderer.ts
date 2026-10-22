import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "../world/ProcGeo";
import type { WorldMaterials } from "../world/Materials";
import type { RGB } from "../world/CityGenerator";
import { setInstanceCount } from "../world/instancing";
import { PICKUP_LIFE, type Pickup, type PickupKind } from "./Pickups";

const MAX = 24;
const COLORS: Record<PickupKind, RGB> = {
  repair: [0.25, 1.3, 0.45],
  power: [0.35, 0.8, 1.5],
  rockets: [1.5, 0.75, 0.15],
};

/**
 * Pickups: a spinning glowing gem in a dark cage, with a faint light pillar
 * so salvage can be spotted from a distance. Thin instances (3 draw calls).
 */
export class PickupRenderer {
  private gem: Mesh;
  private cage: Mesh;
  private pillar: Mesh;
  private gemM = new Float32Array(MAX * 16);
  private cageM = new Float32Array(MAX * 16);
  private pillarM = new Float32Array(MAX * 16);
  private gemC = new Float32Array(MAX * 4).fill(1);
  private pillarC = new Float32Array(MAX * 4).fill(1);
  private m = new Matrix();
  private q = new Quaternion();
  private qId = Quaternion.Identity();
  private s = new Vector3();
  private t = new Vector3();

  constructor(scene: Scene, mats: WorldMaterials) {
    const g = new ProcGeo(scene);
    const W: RGB = [1, 1, 1];
    const D: RGB = [0.12, 0.12, 0.14];
    this.gem = g.merge("pickupGem", [g.ico(0.42, W, 0, 0, 0, 1.4)]);
    this.gem.material = mats.propGlow;
    this.cage = g.merge("pickupCage", [
      g.box(0.08, 1.5, 0.08, D, 0.55, 0, 0),
      g.box(0.08, 1.5, 0.08, D, -0.55, 0, 0),
      g.box(0.08, 1.5, 0.08, D, 0, 0, 0.55),
      g.box(0.08, 1.5, 0.08, D, 0, 0, -0.55),
      g.box(1.2, 0.08, 1.2, D, 0, 0.75, 0),
      g.box(1.2, 0.08, 1.2, D, 0, -0.75, 0),
    ]);
    this.cage.material = mats.propLit;
    this.pillar = g.merge("pickupPillar", [g.cyl(0.25, 0.5, 14, W, 0, 7, 0, 8)]);
    this.pillar.material = mats.additive("pickupBeam", Color3.White(), 1);
    for (const [mesh, buf] of [
      [this.gem, this.gemM],
      [this.cage, this.cageM],
      [this.pillar, this.pillarM],
    ] as const) {
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.isPickable = false;
      mesh.thinInstanceSetBuffer("matrix", buf, 16, false);
      setInstanceCount(mesh, 0);
    }
    this.gem.thinInstanceSetBuffer("color", this.gemC, 4, false);
    this.pillar.thinInstanceSetBuffer("color", this.pillarC, 4, false);
  }

  update(items: readonly Pickup[], time: number): void {
    const n = Math.min(MAX, items.length);
    for (let i = 0; i < n; i++) {
      const p = items[i];
      // Pop in, blink out at the end of life.
      const grow = Math.min(1, p.age / 0.35);
      const fading = p.age > PICKUP_LIFE - 5;
      const vis = fading && Math.sin(time * 18) < 0 ? 0.35 : 1;
      const bob = Math.sin(time * 2.4 + i) * 0.18;
      const spin = time * 2.2 + i;
      const pulse = 1 + Math.sin(time * 5 + i) * 0.08;
      const c = COLORS[p.kind];
      this.t.set(p.x, p.y + bob, p.z);
      Quaternion.RotationYawPitchRollToRef(spin, 0, 0, this.q);
      this.s.setAll(grow * pulse);
      Matrix.ComposeToRef(this.s, this.q, this.t, this.m);
      this.m.copyToArray(this.gemM, i * 16);
      this.gemC.set([c[0] * vis, c[1] * vis, c[2] * vis, 1], i * 4);
      Quaternion.RotationYawPitchRollToRef(-spin * 0.5, 0, 0, this.q);
      this.s.setAll(grow);
      Matrix.ComposeToRef(this.s, this.q, this.t, this.m);
      this.m.copyToArray(this.cageM, i * 16);
      this.t.set(p.x, p.y - 1, p.z);
      this.s.set(grow, grow, grow);
      Matrix.ComposeToRef(this.s, this.qId, this.t, this.m);
      this.m.copyToArray(this.pillarM, i * 16);
      const a = 0.16 * vis * (0.8 + Math.sin(time * 3 + i) * 0.2);
      this.pillarC.set([c[0] * a, c[1] * a, c[2] * a, 1], i * 4);
    }
    for (const mesh of [this.gem, this.cage, this.pillar]) {
      setInstanceCount(mesh, n);
      if (n > 0) mesh.thinInstanceBufferUpdated("matrix");
    }
    if (n > 0) {
      this.gem.thinInstanceBufferUpdated("color");
      this.pillar.thinInstanceBufferUpdated("color");
    }
  }
}
