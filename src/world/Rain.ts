import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { WorldMaterials } from "./Materials";
import { setInstanceCount } from "./instancing";

const BOX = 36; // drops live in a cube this size around the camera
const FALL = 26;

/**
 * Rain: thin streaks in a box that follows the camera, wrapping around it.
 * Streaks are oriented along the drops' velocity relative to you, so flying
 * fast through rain sweeps them toward you. One thin-instanced draw call.
 */
export class Rain {
  private mesh: Mesh;
  private buf: Float32Array;
  private pos: Float32Array;
  private max: number;
  private count = 0;
  private m = new Matrix();
  private q = new Quaternion();
  private s = new Vector3();
  private t = new Vector3();
  private up = new Vector3(0, 1, 0);
  private dir = new Vector3();

  constructor(scene: Scene, mats: WorldMaterials, max = 1400) {
    this.max = max;
    this.mesh = CreateBox("rain", { width: 0.025, height: 1, depth: 0.025 }, scene);
    this.mesh.material = mats.additive("rainMat", new Color3(0.45, 0.5, 0.58), 0.45);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.buf = new Float32Array(max * 16);
    this.pos = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * BOX;
      this.pos[i * 3 + 1] = (Math.random() - 0.5) * BOX;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
    }
    this.mesh.thinInstanceSetBuffer("matrix", this.buf, 16, false);
    setInstanceCount(this.mesh, 0);
  }

  /** Number of drops (0 = no rain). */
  setCount(n: number): void {
    this.count = Math.max(0, Math.min(this.max, n));
    if (this.count === 0) setInstanceCount(this.mesh, 0);
  }

  /** `cam` = camera position, `vel` = viewer velocity (m/s), `y` = altitude (no rain above the clouds). */
  update(dt: number, cam: Vector3, vel: { x: number; y: number; z: number }, y: number): void {
    const n = y > 700 ? 0 : this.count;
    setInstanceCount(this.mesh, n);
    if (n === 0) return;
    // Drops fall with a little wind; relative to you they also stream past.
    const rx = 3 - vel.x, ry = -FALL - vel.y, rz = 1.5 - vel.z;
    const rl = Math.hypot(rx, ry, rz) || 1;
    this.dir.set(rx / rl, ry / rl, rz / rl);
    // Rotate the unit-Y streak onto the relative velocity.
    const axis = Vector3.Cross(this.up, this.dir);
    const al = axis.length();
    if (al < 1e-5) Quaternion.FromEulerAnglesToRef(0, 0, this.dir.y < 0 ? Math.PI : 0, this.q);
    else Quaternion.RotationAxisToRef(axis.scaleInPlace(1 / al), Math.acos(Math.max(-1, Math.min(1, this.dir.y))), this.q);
    const len = Math.min(5, 0.9 + rl * 0.02);
    this.s.set(1, len, 1);
    const h = BOX / 2;
    const mx = (vel.x - 3) * dt, my = (vel.y + FALL) * dt, mz = (vel.z - 1.5) * dt;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      // Move relative to the camera, wrapping inside the box.
      let px = this.pos[k] - mx, py = this.pos[k + 1] - my, pz = this.pos[k + 2] - mz;
      px = ((((px + h) % BOX) + BOX) % BOX) - h;
      py = ((((py + h) % BOX) + BOX) % BOX) - h;
      pz = ((((pz + h) % BOX) + BOX) % BOX) - h;
      this.pos[k] = px;
      this.pos[k + 1] = py;
      this.pos[k + 2] = pz;
      this.t.set(cam.x + px, cam.y + py, cam.z + pz);
      Matrix.ComposeToRef(this.s, this.q, this.t, this.m);
      this.m.copyToArray(this.buf, i * 16);
    }
    this.mesh.thinInstanceBufferUpdated("matrix");
  }
}
