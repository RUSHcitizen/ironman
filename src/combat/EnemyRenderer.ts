import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "../world/ProcGeo";
import type { WorldMaterials } from "../world/Materials";
import type { RGB } from "../world/CityGenerator";
import type { Enemy, EnemyKind, EnemyManager } from "./Enemies";
import { SHIELD_RADIUS } from "./Enemies";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
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
const W1: RGB = [1, 1, 1];

/** Draws all enemies with thin instances (a few draw calls total). */
export class EnemyRenderer {
  private kinds = new Map<EnemyKind, KindMeshes>();
  private m = new Matrix();
  private q = new Quaternion();
  private s = new Vector3();
  private t = new Vector3();
  private bubble: Mesh;
  private qId = Quaternion.Identity();
  private bubbleM: Float32Array;
  private bubbleC: Float32Array;

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

    // VTOL gunship with ducted fans and missile pods.
    const hull: RGB = [0.24, 0.25, 0.28];
    make(
      "gunship",
      g.merge("gunshipBody", [
        g.box(2.4, 1.8, 7.5, hull, 0, 0, 0),
        g.box(1.8, 1.2, 2.2, DARK, 0, 0.4, 3.6),
        g.box(1.2, 1.1, 3.2, hull, 0, 0.2, -5.0),
        g.box(0.2, 1.8, 1.4, hull, 0, 1.2, -6.2),
        g.box(7.6, 0.25, 1.6, DARK, 0, 0.3, 0.4),
        g.cyl(1.5, 1.5, 0.7, hull, -4.4, 0.4, 0.4, 16),
        g.cyl(1.5, 1.5, 0.7, hull, 4.4, 0.4, 0.4, 16),
        g.box(0.6, 0.6, 1.8, RED, -2.4, -0.5, 1.0),
        g.box(0.6, 0.6, 1.8, RED, 2.4, -0.5, 1.0),
        g.cyl(0.12, 0.12, 1.6, DARK, 0, -1.0, 3.9, 8, Math.PI / 2),
      ]),
      g.merge("gunshipGlow", [g.box(1.5, 0.35, 0.05, W1, 0, 0.6, 4.72), g.cyl(1.2, 1.2, 0.05, W1, -4.4, 0.05, 0.4, 16), g.cyl(1.2, 1.2, 0.05, W1, 4.4, 0.05, 0.4, 16)]),
      6,
    );
    // Hooded rooftop sniper with a long rifle.
    const cloak: RGB = [0.13, 0.16, 0.14];
    make(
      "sniper",
      g.merge("sniperBody", [
        g.box(0.5, 0.65, 0.3, cloak, 0, 1.25, 0),
        g.box(0.36, 0.25, 0.26, GUN, 0, 0.88, 0),
        g.sphere(0.19, cloak, 0, 1.73, -0.02, 8, 1, 1.15, 1.2),
        g.box(0.16, 0.85, 0.18, GUN, -0.13, 0.42, 0),
        g.box(0.16, 0.85, 0.18, GUN, 0.13, 0.42, 0),
        g.box(0.14, 0.5, 0.16, cloak, 0.28, 1.25, 0.25),
        g.box(0.14, 0.5, 0.16, cloak, -0.25, 1.25, 0.3),
        g.box(0.08, 0.12, 1.9, [0.1, 0.1, 0.11], 0.1, 1.42, 0.75),
        g.box(0.36, 0.42, 0.2, DARK, 0, 1.3, -0.25),
      ]),
      g.merge("sniperGlow", [g.box(0.2, 0.04, 0.05, W1, 0, 1.76, 0.2), g.sphere(0.05, W1, 0.1, 1.42, 1.72, 4)]),
      16,
    );
    // Shield drone: core with a halo ring.
    make(
      "shielder",
      g.merge("shielderBody", [g.sphere(0.8, GUN, 0, 0, 0, 10, 1, 0.8, 1), g.cyl(1.7, 1.7, 0.12, DARK, 0, 0, 0, 20), g.cyl(1.2, 1.2, 0.14, GUN, 0, 0, 0, 20)]),
      g.merge("shielderGlow", [g.sphere(0.45, W1, 0, 0, 0.55, 8), g.cyl(1.5, 1.5, 0.15, W1, 0, 0, 0, 20)]),
      12,
    );
    // Tracked hover tank with a long cannon.
    make(
      "tank",
      g.merge("tankBody", [
        g.box(4.2, 1.4, 6.4, hull, 0, 0.9, 0),
        g.box(1.0, 1.0, 6.8, DARK, -2.4, 0.5, 0),
        g.box(1.0, 1.0, 6.8, DARK, 2.4, 0.5, 0),
        g.box(2.8, 1.1, 3.0, hull, 0, 2.15, -0.3),
        g.cyl(0.22, 0.26, 4.2, DARK, 0, 2.2, 3.1, 10, Math.PI / 2),
        g.box(0.5, 0.5, 0.5, RED, 1.1, 2.9, -1.2),
      ]),
      g.merge("tankGlow", [g.cyl(0.18, 0.18, 0.05, W1, 0, 2.2, 5.22, 10, Math.PI / 2), g.box(1.6, 0.12, 0.05, W1, 0, 2.3, 1.22), g.box(3.8, 0.1, 0.05, W1, 0, 0.5, 3.21)]),
      8,
    );

    // Shield bubble (one per shield drone), faint additive purple.
    this.bubble = CreateSphere("shieldBubble", { diameter: 2, segments: 16 }, scene);
    this.bubble.material = mats.additive("shieldMat", Color3.White(), 1);
    this.bubble.alwaysSelectAsActiveMesh = true;
    this.bubble.isPickable = false;
    this.bubbleM = new Float32Array(12 * 16);
    this.bubbleC = new Float32Array(12 * 4).fill(1);
    this.bubble.thinInstanceSetBuffer("matrix", this.bubbleM, 16, false);
    this.bubble.thinInstanceSetBuffer("color", this.bubbleC, 4, false);
    setInstanceCount(this.bubble, 0);
  }

  update(mgr: EnemyManager): void {
    let nb = 0;
    for (const e of mgr.enemies) {
      if (!e.alive || e.kind !== "shielder" || nb >= 12) continue;
      const pulse = 1 + Math.sin(e.phase * 3) * 0.02;
      Matrix.ComposeToRef(this.s.set(SHIELD_RADIUS * pulse, SHIELD_RADIUS * pulse, SHIELD_RADIUS * pulse), this.qId, this.t.set(e.x, e.y, e.z), this.m);
      this.m.copyToArray(this.bubbleM, nb * 16);
      this.bubbleC.set([0.05, 0.016, 0.085, 1], nb * 4);
      nb++;
    }
    setInstanceCount(this.bubble, nb);
    if (nb > 0) {
      this.bubble.thinInstanceBufferUpdated("matrix");
      this.bubble.thinInstanceBufferUpdated("color");
    }
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
    } else if (e.kind === "gunship") {
      const fwd = e.vx * Math.sin(e.yaw) + e.vz * Math.cos(e.yaw);
      const side = e.vx * Math.cos(e.yaw) - e.vz * Math.sin(e.yaw);
      pitch = Math.max(-0.3, Math.min(0.3, fwd * 0.02));
      roll = Math.max(-0.4, Math.min(0.4, -side * 0.025));
    } else if (e.kind === "shielder") {
      y += Math.sin(e.phase * 2) * 0.3;
    } else if (e.kind === "tank") {
      y += 0.4 + Math.sin(e.phase * 2) * 0.08; // hovering hull
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
    } else if (e.kind === "shielder") {
      gr = 0.7;
      gg = 0.3;
      gb = 1.2;
    } else if (e.kind === "gunship") {
      gr = 1.2;
      gg = 0.25;
      gb = 0.1;
    } else if (e.kind === "warbot" || e.kind === "tank" || e.kind === "sniper") {
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
