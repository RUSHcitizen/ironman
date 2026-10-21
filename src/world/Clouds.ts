import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Rng } from "../core/math";
import { setInstanceCount } from "./instancing";

const MAX = 240;
const FIELD = 9000;

interface Cloud {
  x: number;
  y: number;
  z: number;
  size: number;
  aspect: number;
  tint: number;
}

/**
 * A layer of soft billboard clouds (600-1400 m) drifting slowly over the
 * city, so climbing toward space punches through them. One draw call.
 */
export class Clouds {
  private mesh: Mesh;
  private clouds: Cloud[] = [];
  private matrices = new Float32Array(MAX * 16);
  private colors = new Float32Array(MAX * 4).fill(1);
  private count = 0;
  private m = new Matrix();
  private q = new Quaternion();
  private s = new Vector3();
  private t = new Vector3();
  private drift = 0;

  constructor(scene: Scene) {
    const tex = new DynamicTexture("cloudTex", { width: 256, height: 128 }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 128);
    const rng = new Rng(31);
    // Billowy puff made of many soft blobs, flatter at the bottom.
    for (let k = 0; k < 46; k++) {
      const x = rng.range(40, 216), y = rng.range(48, 92) - Math.sin(((x - 40) / 176) * Math.PI) * 22;
      const r = rng.range(14, 32);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.7)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    tex.hasAlpha = true;
    tex.update(false);
    const mat = new StandardMaterial("cloudMat", scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    // Bright enough to read as sunlit cloud after tone mapping.
    mat.emissiveColor = new Color3(1.45, 1.3, 1.22);
    mat.backFaceCulling = false;
    mat.transparencyMode = 2; // alpha blend
    mat.disableDepthWrite = true;
    mat.fogEnabled = true;
    this.mesh = CreatePlane("clouds", { width: 2, height: 1 }, scene);
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.metadata = { drawOrder: 1.5 };
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
    setInstanceCount(this.mesh, 0);

    const r = new Rng(2024);
    for (let k = 0; k < MAX; k++) {
      this.clouds.push({
        x: r.range(-FIELD / 2, FIELD / 2),
        y: r.range(620, 1400),
        z: r.range(-FIELD / 2, FIELD / 2),
        size: r.range(90, 260),
        aspect: r.range(0.35, 0.6),
        tint: r.range(0.82, 1),
      });
    }
  }

  setCount(n: number): void {
    this.count = Math.min(MAX, n);
  }

  /** Billboard toward the camera; tint warmer toward the sunset. */
  update(dt: number, cam: Vector3): void {
    this.drift += dt * 3;
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const c = this.clouds[k];
      // Wrap the field around the camera so clouds are everywhere you fly.
      let x = c.x + this.drift;
      x = cam.x + ((((x - cam.x) % FIELD) + FIELD * 1.5) % FIELD) - FIELD / 2;
      const z = cam.z + ((((c.z - cam.z) % FIELD) + FIELD * 1.5) % FIELD) - FIELD / 2;
      const dx = cam.x - x, dy = cam.y - c.y, dz = cam.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 5200) continue;
      const yaw = Math.atan2(dx, dz);
      const pitch = -Math.atan2(dy, Math.hypot(dx, dz)) * 0.85;
      Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, this.q);
      this.s.set(c.size, c.size * c.aspect * 2, 1);
      this.t.set(x, c.y, z);
      Matrix.ComposeToRef(this.s, this.q, this.t, this.m);
      this.m.copyToArray(this.matrices, n * 16);
      // Fade when the camera is inside / very near a cloud.
      const near = Math.min(1, Math.max(0, (d - c.size * 0.3) / (c.size * 0.9)));
      this.colors.set([c.tint, c.tint * 0.96, c.tint * 0.95, near], n * 4);
      n++;
    }
    setInstanceCount(this.mesh, n);
    if (n > 0) {
      this.mesh.thinInstanceBufferUpdated("matrix");
      this.mesh.thinInstanceBufferUpdated("color");
    }
  }
}
