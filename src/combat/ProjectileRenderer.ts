import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "../world/ProcGeo";
import type { WorldMaterials } from "../world/Materials";
import type { ProjectileSystem } from "./Projectiles";
import { setInstanceCount } from "../world/instancing";

class Batch {
  readonly matrices: Float32Array;
  readonly colors: Float32Array;
  n = 0;
  private m = new Matrix();
  private q = new Quaternion();
  private s = new Vector3();
  private t = new Vector3();

  constructor(
    readonly mesh: Mesh,
    readonly max: number,
    colored = true,
  ) {
    this.matrices = new Float32Array(max * 16);
    this.colors = new Float32Array(max * 4).fill(1);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    if (colored) mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
    setInstanceCount(mesh, 0);
  }

  push(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, sx: number, sy: number, sz: number, r = 1, g = 1, b = 1): void {
    if (this.n >= this.max) return;
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, this.q);
    this.s.set(sx, sy, sz);
    this.t.set(x, y, z);
    Matrix.ComposeToRef(this.s, this.q, this.t, this.m);
    this.m.copyToArray(this.matrices, this.n * 16);
    this.colors[this.n * 4] = r;
    this.colors[this.n * 4 + 1] = g;
    this.colors[this.n * 4 + 2] = b;
    this.n++;
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

/** Yaw/pitch that point local +Z along a direction. */
function orient(dx: number, dy: number, dz: number): [number, number] {
  return [Math.atan2(dx, dz), -Math.asin(Math.max(-1, Math.min(1, dy)))];
}

/** Draws bolts, rockets, missiles, beams, explosions, rings and smoke. */
export class ProjectileRenderer {
  private bolts: Batch;
  private rocketBodies: Batch;
  private flames: Batch;
  private fireballs: Batch;
  private rings: Batch;
  private puffs: Batch;
  private debris: Batch;
  private beamTubes: Batch;

  constructor(scene: Scene, mats: WorldMaterials) {
    const add = mats.additive("fxAdd", Color3.White(), 1);
    const bolt = CreateBox("bolt", { width: 1, height: 1, depth: 1 }, scene);
    bolt.material = add;
    this.bolts = new Batch(bolt, 360);

    const g = new ProcGeo(scene);
    const body = g.merge("rocketBody", [
      g.cyl(0.07, 0.07, 0.7, [0.75, 0.75, 0.78], 0, 0, 0, 8, Math.PI / 2),
      g.cyl(0, 0.07, 0.18, [0.8, 0.15, 0.1], 0, 0, 0.44, 8, Math.PI / 2),
      g.box(0.24, 0.02, 0.14, [0.3, 0.3, 0.32], 0, 0, -0.3),
      g.box(0.02, 0.24, 0.14, [0.3, 0.3, 0.32], 0, 0, -0.3),
    ]);
    body.material = mats.propLit;
    this.rocketBodies = new Batch(body, 90, false);
    const flame = CreateIcoSphere("rocketFlame", { radius: 0.5, subdivisions: 1 }, scene);
    flame.material = add;
    this.flames = new Batch(flame, 90);

    // Soft camera-facing sprites (radial glow texture) for fire, sparks and smoke.
    const glowTex = new DynamicTexture("glowTex", { width: 64, height: 64 }, scene, true);
    const ctx = glowTex.getContext() as unknown as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.25, "#bbbbbb");
    grad.addColorStop(0.6, "#3a3a3a");
    grad.addColorStop(1, "#000000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    glowTex.update(false);
    const spriteMat = mats.additive("fxSprite", Color3.White(), 1) as StandardMaterial;
    spriteMat.diffuseTexture = glowTex;
    const ball = CreatePlane("fireball", { size: 2 }, scene);
    ball.material = spriteMat;
    this.fireballs = new Batch(ball, 120);
    const ring = CreateTorus("fxRing", { diameter: 2, thickness: 0.12, tessellation: 32 }, scene);
    ring.material = add;
    this.rings = new Batch(ring, 16);
    const puff = CreatePlane("puff", { size: 2 }, scene);
    puff.material = spriteMat;
    this.puffs = new Batch(puff, 320);
    // Tumbling wreckage chunks (lit, tinted per instance).
    const chunk = g.merge("debris", [g.box(1, 0.6, 0.8, [0.3, 0.3, 0.33]), g.box(0.5, 0.9, 0.3, [0.2, 0.2, 0.22], 0.3, 0.2, 0)]);
    chunk.material = mats.propLit;
    this.debris = new Batch(chunk, 200);
    // Round tubes for lasers and the Unibeam (a box looks like a slab side-on).
    const tube = CreateCylinder("beamTube", { diameter: 1, height: 1, tessellation: 12, cap: 0 }, scene);
    tube.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2));
    tube.material = add;
    this.beamTubes = new Batch(tube, 64);
  }

  update(ps: ProjectileSystem, cam: { x: number; y: number; z: number }): void {
    // Sprites face the camera.
    const face = (x: number, y: number, z: number): [number, number] => {
      const dx = cam.x - x, dy = cam.y - y, dz = cam.z - z;
      const l = Math.hypot(dx, dy, dz) || 1;
      return orient(dx / l, dy / l, dz / l);
    };
    for (const p of ps.projectiles) {
      const [yaw, pitch] = orient(p.dx, p.dy, p.dz);
      if (p.kind === "bolt") this.bolts.push(p.x, p.y, p.z, yaw, pitch, 0, 0.22, 0.22, 3.2, 0.5, 1.6, 2.0);
      else if (p.kind === "enemyBolt") this.bolts.push(p.x, p.y, p.z, yaw, pitch, 0, 0.28, 0.28, 1.8, 2.0, 0.35, 0.15);
      else if (p.kind === "shell") {
        // Glowing plasma shell.
        const [fy, fp] = face(p.x, p.y, p.z);
        this.fireballs.push(p.x, p.y, p.z, fy, fp, 0, 0.9, 0.9, 0.9, 1.8, 0.7, 0.2);
      }
      else {
        const s = p.kind === "missile" ? 1.6 : 1;
        this.rocketBodies.push(p.x, p.y, p.z, yaw, pitch, 0, s, s, s);
        const f = 0.8 + Math.random() * 0.4;
        const bx = p.x - p.dx * 0.5 * s, by = p.y - p.dy * 0.5 * s, bz = p.z - p.dz * 0.5 * s;
        if (p.kind === "rocket") this.flames.push(bx, by, bz, yaw, pitch, 0, 0.35 * f, 0.35 * f, 0.9 * f, 2.0, 1.4, 0.7);
        else this.flames.push(bx, by, bz, yaw, pitch, 0, 0.5 * f, 0.5 * f, 1.3 * f, 2.0, 0.3, 0.15);
      }
    }
    for (const b of ps.beams) {
      const dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, dz = b.b.z - b.a.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      const [yaw, pitch] = orient(dx / l, dy / l, dz / l);
      const mx = (b.a.x + b.b.x) / 2, my = (b.a.y + b.b.y) / 2, mz = (b.a.z + b.b.z) / 2;
      if (b.kind === "telegraph") this.bolts.push(mx, my, mz, yaw, pitch, 0, 0.12, 0.12, l, 1.2, 0.1, 0.05);
      else if (b.kind === "arc") {
        // Lightning: a jagged chain of short segments, re-jittered every frame.
        const n = 4;
        let px = b.a.x, py = b.a.y, pz = b.a.z;
        for (let k = 1; k <= n; k++) {
          const u = k / n;
          const j = k < n ? Math.min(2, l * 0.08) : 0;
          const qx = b.a.x + dx * u + (Math.random() - 0.5) * j, qy = b.a.y + dy * u + (Math.random() - 0.5) * j, qz = b.a.z + dz * u + (Math.random() - 0.5) * j;
          const sx = qx - px, sy = qy - py, sz = qz - pz;
          const sl = Math.hypot(sx, sy, sz) || 1;
          const [syaw, spitch] = orient(sx / sl, sy / sl, sz / sl);
          this.beamTubes.push((px + qx) / 2, (py + qy) / 2, (pz + qz) / 2, syaw, spitch, 0, 0.14, 0.14, sl, 0.25, 0.6, 1.8);
          px = qx;
          py = qy;
          pz = qz;
        }
      }
      else if (b.kind === "unibeam") {
        // Thick white-cyan core inside a wide soft cyan sheath, shrinking out.
        const k = 1 - b.t / b.life;
        const w = 0.25 + 0.35 * k;
        this.beamTubes.push(mx, my, mz, yaw, pitch, 0, w, w, l, 1.3 * k + 0.3, 1.8 * k + 0.3, 2.0 * k + 0.3);
        this.beamTubes.push(mx, my, mz, yaw, pitch, 0, w * 2.4, w * 2.4, l, 0.08 * k, 0.35 * k, 0.55 * k);
      } else {
        const k = 1 - b.t / b.life;
        this.beamTubes.push(mx, my, mz, yaw, pitch, 0, 1.6 * k + 0.2, 1.6 * k + 0.2, l, 3 * k, 0.6 * k, 0.4 * k);
      }
    }
    for (const f of ps.fx) {
      const u = f.t / f.life;
      const fade = 1 - u;
      if (f.kind === "fire") {
        const r = f.size * (0.5 + 0.9 * (1 - (1 - u) * (1 - u)));
        const [yaw, pitch] = face(f.x, f.y, f.z);
        // Orange fireball fading to dark red, plus a brief white-hot core.
        this.fireballs.push(f.x, f.y, f.z, yaw, pitch, u * 2, r, r, r, 1.6 * fade, 0.75 * fade * fade, 0.25 * fade * fade * fade);
        if (u < 0.3) {
          const c = 1 - u / 0.3;
          this.fireballs.push(f.x, f.y, f.z, yaw, pitch, 0, r * 0.6, r * 0.6, r * 0.6, 1.4 * c, 1.2 * c, 0.9 * c);
        }
      } else if (f.kind === "spark") {
        const r = f.size * (1.2 - u * 0.6);
        const [yaw, pitch] = face(f.x, f.y, f.z);
        this.fireballs.push(f.x, f.y, f.z, yaw, pitch, 0, r, r, r, 1.0 * fade, 1.2 * fade, 1.4 * fade);
      } else if (f.kind === "charge") {
        // Unibeam charging at the arc reactor.
        const [yaw, pitch] = face(f.x, f.y, f.z);
        const r = f.size * (0.9 + Math.random() * 0.2);
        this.fireballs.push(f.x, f.y, f.z, yaw, pitch, 0, r, r, r, 0.7, 1.6, 2.0);
      } else if (f.kind === "dust") {
        const r = f.size * (0.3 + u * 0.9);
        this.rings.push(f.x, f.y + 0.3, f.z, 0, 0, 0, r, 0.6 + u, r, 0.35 * fade, 0.32 * fade, 0.28 * fade);
      } else if (f.kind === "shock") {
        const r = f.size * u;
        this.rings.push(f.x, f.y, f.z, 0, 0, 0, r, r * 0.6 + 1, r, 2 * fade, 0.9 * fade, 0.3 * fade);
      } else {
        const r = f.size * (0.4 + u);
        this.rings.push(f.x, f.y, f.z, f.yaw, Math.PI / 2 - f.pitch, 0, r, r * 0.3 + 1, r, 1.2 * fade, 1.4 * fade, 1.6 * fade);
      }
    }
    for (const pf of ps.puffs) {
      const u = pf.t / pf.life;
      const r = 0.3 + u * 1.3;
      const [yaw, pitch] = face(pf.x, pf.y, pf.z);
      const k = (1 - u) * (pf.hot ? 0.22 : 0.16);
      if (pf.hot) this.puffs.push(pf.x, pf.y, pf.z, yaw, pitch, 0, r, r, r, k * 1.1, k * 0.8, k * 0.55);
      else this.puffs.push(pf.x, pf.y, pf.z, yaw, pitch, 0, r, r, r, k * 1.1, k * 0.45, k * 0.35);
    }
    for (const p of ps.particles) {
      const u = p.t / p.life;
      if (p.kind === "debris") {
        const s = p.size * 2 * (u > 0.8 ? (1 - u) / 0.2 : 1);
        const glow = Math.max(0, 1 - u * 2.5);
        this.debris.push(p.x, p.y, p.z, p.spin, p.spin * 0.7, p.spin * 0.4, s, s, s, 0.5 + glow * 2, 0.45 + glow * 0.6, 0.45);
      } else {
        const [yaw, pitch] = face(p.x, p.y, p.z);
        const fade = 1 - u;
        if (p.kind === "flare") {
          const r = p.size * (0.8 + Math.random() * 0.3);
          this.fireballs.push(p.x, p.y, p.z, yaw, pitch, 0, r, r, r, 1.3 * fade + 0.2, 1.0 * fade + 0.15, 0.6 * fade);
        } else if (p.kind === "ember") {
          const r = p.size * fade;
          this.fireballs.push(p.x, p.y, p.z, yaw, pitch, 0, r, r, r, 2 * fade, 0.9 * fade, 0.3 * fade);
        } else if (p.kind === "vapour") {
          // Contrail puff: starts thin, swells and fades. Size holds strength.
          const r = 0.12 + u * 0.9;
          const k = 0.09 * p.size * fade;
          this.puffs.push(p.x, p.y, p.z, yaw, pitch, 0, r, r, r, k * 0.95, k, k * 1.1);
        } else {
          // Dust: soft, low-intensity warm grey.
          const r = p.size * (0.6 + u * 1.6);
          const k = 0.11 * fade;
          this.puffs.push(p.x, p.y, p.z, yaw, pitch, u, r, r, r, k, k * 0.95, k * 0.85);
        }
      }
    }
    for (const b of [this.bolts, this.rocketBodies, this.flames, this.fireballs, this.rings, this.puffs, this.debris, this.beamTubes]) b.flush();
  }
}
