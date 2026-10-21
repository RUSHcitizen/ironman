import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "../world/ProcGeo";
import type { WorldMaterials } from "../world/Materials";
import type { RGB } from "../world/CityGenerator";
import type { Enemy, EnemyKind, EnemyManager } from "./Enemies";
import { setInstanceCount } from "../world/instancing";

interface KindMeshes {
  body: Mesh;
  glow: Mesh;
  /** Optional extra lit part with its own transform (rotors / legs). */
  extra?: Mesh;
  max: number;
  bodyM: Float32Array;
  extraM: Float32Array;
  bodyC: Float32Array;
  glowC: Float32Array;
}

const GUN: RGB = [0.22, 0.23, 0.26];
const DARK: RGB = [0.1, 0.1, 0.12];
const RED: RGB = [0.55, 0.08, 0.06];

/** Draws all enemies with thin instances (a few draw calls total). */
export class EnemyRenderer {
  private kinds = new Map<EnemyKind, KindMeshes>();
  private m = new Matrix();
  private q = new Quaternion();
  private s = new Vector3();
  private t = new Vector3();

  constructor(scene: Scene, mats: WorldMaterials) {
    const g = new ProcGeo(scene);
    const make = (kind: EnemyKind, body: Mesh, glow: Mesh, max: number, extra?: Mesh) => {
      body.material = mats.propLit;
      glow.material = mats.propGlow;
      if (extra) extra.material = mats.propLit;
      const km: KindMeshes = {
        body,
        glow,
        extra,
        max,
        bodyM: new Float32Array(max * 16),
        extraM: new Float32Array(max * 16),
        bodyC: new Float32Array(max * 4).fill(1),
        glowC: new Float32Array(max * 4).fill(1),
      };
      for (const mesh of [body, glow, extra]) {
        if (!mesh) continue;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.thinInstanceSetBuffer("matrix", mesh === extra ? km.extraM : km.bodyM, 16, false);
        setInstanceCount(mesh, 0);
      }
      body.thinInstanceSetBuffer("color", km.bodyC, 4, false);
      glow.thinInstanceSetBuffer("color", km.glowC, 4, false);
      this.kinds.set(kind, km);
    };

    // Quad-rotor attack drone.
    make(
      "drone",
      g.merge("droneBody", [
        g.sphere(0.75, GUN, 0, 0, 0, 10, 1, 0.5, 1.15),
        g.box(2.6, 0.1, 0.18, DARK, 0, 0.05, 0, Math.PI / 4),
        g.box(2.6, 0.1, 0.18, DARK, 0, 0.05, 0, -Math.PI / 4),
        g.cyl(0.42, 0.42, 0.08, DARK, 0.92, 0.12, 0.92, 12),
        g.cyl(0.42, 0.42, 0.08, DARK, -0.92, 0.12, 0.92, 12),
        g.cyl(0.42, 0.42, 0.08, DARK, 0.92, 0.12, -0.92, 12),
        g.cyl(0.42, 0.42, 0.08, DARK, -0.92, 0.12, -0.92, 12),
        g.box(0.16, 0.16, 0.8, DARK, 0.25, -0.3, 0.5),
        g.box(0.16, 0.16, 0.8, DARK, -0.25, -0.3, 0.5),
      ]),
      g.merge("droneGlow", [g.sphere(0.2, [1, 1, 1], 0, 0, 0.82, 6), g.box(0.9, 0.05, 0.05, [1, 1, 1], 0, -0.1, -0.85)]),
      32,
    );
    // Spiked kamikaze drone.
    make(
      "kamikaze",
      g.merge("kamiBody", [
        g.ico(0.7, RED, 0, 0, 0),
        g.cyl(0, 0.18, 0.9, DARK, 0, 0, 0.8, 6, Math.PI / 2),
        g.cyl(0, 0.18, 0.7, DARK, 0.7, 0, 0, 6, 0, -Math.PI / 2),
        g.cyl(0, 0.18, 0.7, DARK, -0.7, 0, 0, 6, 0, Math.PI / 2),
        g.cyl(0, 0.18, 0.7, DARK, 0, 0.7, 0, 6),
      ]),
      g.merge("kamiGlow", [g.ico(0.42, [1, 1, 1], 0, 0, 0)]),
      24,
    );
    // Jet-pack trooper in dark armour with a rifle.
    make(
      "trooper",
      g.merge("trooperBody", [
        g.box(0.5, 0.62, 0.3, DARK, 0, 1.25, 0),
        g.box(0.36, 0.25, 0.26, GUN, 0, 0.88, 0),
        g.sphere(0.17, DARK, 0, 1.73, 0, 8, 1, 1.1, 1.1),
        g.box(0.16, 0.85, 0.18, GUN, -0.13, 0.42, 0),
        g.box(0.16, 0.85, 0.18, GUN, 0.13, 0.42, 0),
        g.box(0.14, 0.55, 0.16, DARK, -0.33, 1.2, 0.1),
        g.box(0.14, 0.55, 0.16, DARK, 0.33, 1.2, 0.18),
        g.box(0.09, 0.12, 0.85, [0.12, 0.12, 0.13], 0.24, 1.15, 0.45),
        g.box(0.42, 0.5, 0.2, RED, 0, 1.3, -0.25),
        g.cyl(0.08, 0.1, 0.25, DARK, -0.12, 1.0, -0.3, 8),
        g.cyl(0.08, 0.1, 0.25, DARK, 0.12, 1.0, -0.3, 8),
      ]),
      g.merge("trooperGlow", [g.box(0.24, 0.05, 0.05, [1, 1, 1], 0, 1.76, 0.17), g.box(0.18, 0.1, 0.18, [1, 1, 1], -0.12, 0.84, -0.3), g.box(0.18, 0.1, 0.18, [1, 1, 1], 0.12, 0.84, -0.3)]),
      32,
    );
    // Warbot: hulking two-legged assault mech.
    const plate: RGB = [0.3, 0.31, 0.33];
    make(
      "warbot",
      g.merge("warbotBody", [
        g.box(3.2, 2.2, 2.4, plate, 0, 3.9, 0),
        g.box(2.2, 1.0, 1.8, GUN, 0, 2.6, 0),
        g.box(1.2, 0.8, 1.2, DARK, 0, 5.3, 0.4),
        g.box(1.1, 1.1, 1.6, RED, -2.1, 4.6, 0),
        g.box(1.1, 1.1, 1.6, RED, 2.1, 4.6, 0),
        g.box(0.7, 2.2, 0.7, GUN, -2.0, 3.2, 0.3),
        g.box(0.5, 0.5, 2.6, DARK, 2.1, 3.4, 1.0),
        g.box(0.9, 2.4, 1.0, GUN, -0.9, 1.2, 0),
        g.box(0.9, 2.4, 1.0, GUN, 0.9, 1.2, 0),
        g.box(1.2, 0.4, 1.8, DARK, -0.9, 0.2, 0.2),
        g.box(1.2, 0.4, 1.8, DARK, 0.9, 0.2, 0.2),
      ]),
      g.merge("warbotGlow", [
        g.box(0.9, 0.16, 0.05, [1, 1, 1], 0, 5.4, 1.02),
        g.box(0.3, 0.3, 0.1, [1, 1, 1], 2.1, 3.4, 2.32),
        g.box(0.8, 0.6, 0.05, [1, 1, 1], -2.1, 4.6, 0.82),
        g.box(0.8, 0.6, 0.05, [1, 1, 1], 2.1, 4.6, 0.82),
      ]),
      4,
    );
  }

  update(mgr: EnemyManager): void {
    const counts = new Map<EnemyKind, number>();
    for (const e of mgr.enemies) {
      if (!e.alive) continue;
      const km = this.kinds.get(e.kind)!;
      const n = counts.get(e.kind) ?? 0;
      if (n >= km.max) continue;
      counts.set(e.kind, n + 1);
      this.write(km, n, e);
    }
    for (const [kind, km] of this.kinds) {
      const n = counts.get(kind) ?? 0;
      for (const mesh of [km.body, km.glow, km.extra]) {
        if (!mesh) continue;
        setInstanceCount(mesh, n);
        if (n > 0) mesh.thinInstanceBufferUpdated("matrix");
      }
      if (n > 0) {
        km.body.thinInstanceBufferUpdated("color");
        km.glow.thinInstanceBufferUpdated("color");
      }
    }
  }

  private write(km: KindMeshes, i: number, e: Enemy): void {
    let pitch = 0, roll = 0, y = e.y;
    if (e.kind === "drone") {
      // Lean into motion like a real quad-rotor.
      const fwd = e.vx * Math.sin(e.yaw) + e.vz * Math.cos(e.yaw);
      const side = e.vx * Math.cos(e.yaw) - e.vz * Math.sin(e.yaw);
      pitch = Math.max(-0.5, Math.min(0.5, fwd * 0.025));
      roll = Math.max(-0.6, Math.min(0.6, -side * 0.03));
    } else if (e.kind === "kamikaze") {
      roll = e.phase * 6;
    } else if (e.kind === "warbot") {
      y += Math.abs(Math.sin(e.phase * 3.5)) * 0.15;
    }
    Quaternion.RotationYawPitchRollToRef(e.yaw, pitch, roll, this.q);
    this.s.set(1, 1, 1);
    this.t.set(e.x, y, e.z);
    Matrix.ComposeToRef(this.s, this.q, this.t, this.m);
    this.m.copyToArray(km.bodyM, i * 16);

    // Hit flash: tint towards white.
    const f = e.flash;
    km.bodyC.set([1 + f * 2, 1 + f * 2, 1 + f * 2, 1], i * 4);
    let gr = 1, gg = 0.12, gb = 0.06;
    if (e.kind === "kamikaze") {
      const blink = e.aware ? (Math.sin(e.phase * 18) > 0 ? 1 : 0.25) : 0.6;
      gr = blink;
      gg = 0.2 * blink;
      gb = 0.05;
    } else if (e.kind === "trooper") {
      gr = 1;
      gg = 0.15 + e.jet * 0.5;
      gb = 0.05 + e.jet * 0.3;
    } else if (e.kind === "warbot") {
      const c = 0.5 + e.charge * 1.5;
      gr = c;
      gg = 0.1 + e.charge * 0.4;
      gb = 0.05 + e.charge * 0.2;
    } else if (!e.aware) {
      gr = 0.9;
      gg = 0.5;
      gb = 0.1;
    }
    km.glowC.set([gr, gg, gb, 1], i * 4);
  }
}
