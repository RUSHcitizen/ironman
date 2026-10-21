import type { Scene } from "@babylonjs/core/scene";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { WorldMaterials } from "../world/Materials";
import type { PlayerController } from "./PlayerController";
import { Rng } from "../core/math";
import { setInstanceCount } from "../world/instancing";

const COUNT = 56;

/** Wind streaks rushing past the camera at high speed - cheap speed sensation. */
export class SpeedFx {
  private mesh: Mesh;
  private pts: { x: number; y: number; z: number }[] = [];
  private matrices = new Float32Array(COUNT * 16);
  private colors = new Float32Array(COUNT * 4).fill(1);
  private rng = new Rng(55);
  private m = new Matrix();
  private q = new Quaternion();
  private s = new Vector3();
  private t = new Vector3();

  constructor(scene: Scene, mats: WorldMaterials) {
    this.mesh = CreateBox("streak", { width: 1, height: 1, depth: 1 }, scene);
    this.mesh.material = mats.additive("streakMat", Color3.White(), 1);
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
    setInstanceCount(this.mesh, 0);
    for (let k = 0; k < COUNT; k++) this.pts.push({ x: 0, y: -1e5, z: 0 });
  }

  update(cam: Vector3, p: PlayerController): void {
    const speed = p.speed;
    const k = Math.max(0, Math.min(1, (speed - 45) / 90));
    if (k <= 0 || p.mode !== "flight") {
      setInstanceCount(this.mesh, 0);
      return;
    }
    const inv = 1 / Math.max(1, speed);
    const dx = p.vel.x * inv, dy = p.vel.y * inv, dz = p.vel.z * inv;
    const yaw = Math.atan2(dx, dz), pitch = -Math.asin(Math.max(-1, Math.min(1, dy)));
    // Perpendicular basis for spawning in a ring around the flight path.
    const ux = -dz, uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    for (let i = 0; i < COUNT; i++) {
      const pt = this.pts[i];
      const rx = pt.x - cam.x, ry = pt.y - cam.y, rz = pt.z - cam.z;
      const ahead = rx * dx + ry * dy + rz * dz;
      if (ahead < -4 || ahead > 90 || rx * rx + ry * ry + rz * rz > 9000) {
        const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(5, 16), d = this.rng.range(25, 85);
        const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
        pt.x = cam.x + dx * d + (ux / ul) * ca;
        pt.y = cam.y + dy * d + sa;
        pt.z = cam.z + dz * d + (uz / ul) * ca;
      }
      const len = Math.min(6, 1 + speed * 0.03);
      Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, this.q);
      this.s.set(0.02, 0.02, len);
      this.t.set(pt.x, pt.y, pt.z);
      Matrix.ComposeToRef(this.s, this.q, this.t, this.m);
      this.m.copyToArray(this.matrices, i * 16);
      const b = k * 0.32;
      this.colors.set([b * 0.8, b * 0.95, b, 1], i * 4);
    }
    setInstanceCount(this.mesh, COUNT);
    this.mesh.thinInstanceBufferUpdated("matrix");
    this.mesh.thinInstanceBufferUpdated("color");
  }
}
