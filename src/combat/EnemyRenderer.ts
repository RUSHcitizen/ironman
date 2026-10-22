import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "../world/ProcGeo";
import type { WorldMaterials } from "../world/Materials";
import type { RGB } from "../world/CityGenerator";
import type { Enemy, EnemyKind, EnemyManager } from "./Enemies";
import { SHIELD_RADIUS, isCloaked } from "./Enemies";
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

    // Interceptor jet: swept delta wing, twin tails, glowing engines.
    const jetHull: RGB = [0.2, 0.21, 0.24];
    make(
      "jet",
      g.merge("jetBody", [
        g.box(1.3, 0.9, 7.5, jetHull, 0, 0, 0),
        g.cyl(0, 0.62, 2.2, DARK, 0, 0.05, 4.8, 10, Math.PI / 2),
        g.box(1.0, 0.5, 1.6, DARK, 0, 0.6, 1.8),
        g.box(4.2, 0.14, 2.6, jetHull, -2.4, -0.1, -1.0, 0.45),
        g.box(4.2, 0.14, 2.6, jetHull, 2.4, -0.1, -1.0, -0.45),
        g.box(0.14, 1.5, 1.4, jetHull, -0.6, 1.0, -3.2),
        g.box(0.14, 1.5, 1.4, jetHull, 0.6, 1.0, -3.2),
        g.box(0.5, 0.3, 1.4, RED, -1.6, -0.35, 0.2),
        g.box(0.5, 0.3, 1.4, RED, 1.6, -0.35, 0.2),
      ]),
      g.merge("jetGlow", [g.cyl(0.42, 0.42, 0.06, W1, -0.35, 0, -3.78, 10, Math.PI / 2), g.cyl(0.42, 0.42, 0.06, W1, 0.35, 0, -3.78, 10, Math.PI / 2), g.box(0.7, 0.2, 0.05, W1, 0, 0.62, 2.62)]),
      8,
    );
    // Swarmer: a tiny spiked seeker.
    make(
      "swarmer",
      g.merge("swarmBody", [g.ico(0.38, GUN, 0, 0, 0), g.box(1.2, 0.05, 0.12, DARK, 0, 0, 0, Math.PI / 4), g.box(1.2, 0.05, 0.12, DARK, 0, 0, 0, -Math.PI / 4), g.cyl(0, 0.1, 0.5, DARK, 0, 0, 0.45, 6, Math.PI / 2)]),
      g.merge("swarmGlow", [g.sphere(0.16, W1, 0, 0, 0.3, 4)]),
      48,
    );
    // EMP jammer: a coil drone with crackling emitter prongs.
    make(
      "jammer",
      g.merge("jammerBody", [
        g.cyl(0.7, 0.9, 1.1, GUN, 0, 0, 0, 12),
        g.cyl(1.4, 1.4, 0.12, DARK, 0, 0.35, 0, 16),
        g.cyl(1.4, 1.4, 0.12, DARK, 0, -0.35, 0, 16),
        g.cyl(0.06, 0.06, 1.6, DARK, 0.9, 0, 0, 6),
        g.cyl(0.06, 0.06, 1.6, DARK, -0.9, 0, 0, 6),
        g.cyl(0.06, 0.06, 1.6, DARK, 0, 0, 0.9, 6),
        g.cyl(0.06, 0.06, 1.6, DARK, 0, 0, -0.9, 6),
      ]),
      g.merge("jammerGlow", [g.cyl(1.1, 1.1, 0.14, W1, 0, 0, 0, 16), g.sphere(0.12, W1, 0.9, 0.85, 0, 4), g.sphere(0.12, W1, -0.9, 0.85, 0, 4), g.sphere(0.12, W1, 0, 0.85, 0.9, 4), g.sphere(0.12, W1, 0, 0.85, -0.9, 4)]),
      12,
    );
    // Dreadnought carrier: a huge armoured airship with a launch bay and rotors.
    const armour: RGB = [0.26, 0.27, 0.3];
    make(
      "carrier",
      g.merge("carrierBody", [
        g.sphere(5.5, armour, 0, 0, 0, 14, 1.0, 0.75, 3.6),
        g.box(7.0, 2.2, 14.0, DARK, 0, -3.4, 0),
        g.box(3.0, 3.0, 6.0, armour, 0, 4.2, 6),
        g.box(1.2, 4.5, 4.0, armour, 0, 4.0, -16),
        g.box(26, 0.6, 5.0, DARK, 0, 0.6, 4),
        g.cyl(3.4, 3.4, 1.2, armour, -13, 0.9, 4, 18),
        g.cyl(3.4, 3.4, 1.2, armour, 13, 0.9, 4, 18),
        g.cyl(3.4, 3.4, 1.2, armour, -9, 0.9, -11, 18),
        g.cyl(3.4, 3.4, 1.2, armour, 9, 0.9, -11, 18),
        g.box(14, 0.5, 3.5, DARK, 0, 0.6, -11),
        g.box(1.6, 1.6, 4.0, RED, -6.2, -1.2, 10),
        g.box(1.6, 1.6, 4.0, RED, 6.2, -1.2, 10),
        g.box(1.4, 1.4, 3.0, RED, 0, -4.8, 8),
      ]),
      g.merge("carrierGlow", [
        g.box(5.0, 0.2, 9.0, W1, 0, -4.55, -1),
        g.box(2.2, 0.5, 0.1, W1, 0, 4.6, 9.05),
        g.cyl(2.9, 2.9, 0.1, W1, -13, 0.25, 4, 18),
        g.cyl(2.9, 2.9, 0.1, W1, 13, 0.25, 4, 18),
        g.cyl(2.9, 2.9, 0.1, W1, -9, 0.25, -11, 18),
        g.cyl(2.9, 2.9, 0.1, W1, 9, 0.25, -11, 18),
      ]),
      2,
    );

    // Sentinel: sleek silver humanoid robot (Ultron-style), red eyes and core.
    const chrome: RGB = [0.62, 0.64, 0.68];
    make(
      "sentinel",
      g.merge("sentinelBody", [
        g.box(0.62, 0.8, 0.36, chrome, 0, 0.35, 0),
        g.box(0.44, 0.35, 0.3, GUN, 0, -0.2, 0),
        g.sphere(0.2, chrome, 0, 1.0, 0.02, 8, 0.9, 1.15, 1),
        g.box(0.16, 0.75, 0.16, chrome, -0.42, 0.25, 0),
        g.box(0.16, 0.75, 0.16, chrome, 0.42, 0.25, 0),
        g.box(0.16, 0.8, 0.18, GUN, -0.14, -0.75, 0),
        g.box(0.16, 0.8, 0.18, GUN, 0.14, -0.75, 0),
      ]),
      g.merge("sentinelGlow", [g.box(0.24, 0.05, 0.05, W1, 0, 1.05, 0.19), g.sphere(0.09, W1, 0, 0.45, 0.19, 6), g.sphere(0.08, W1, -0.14, -1.18, 0, 4), g.sphere(0.08, W1, 0.14, -1.18, 0, 4)]),
      24,
    );
    // Spider walker: armoured pod on six splayed legs.
    const legs: Mesh[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const lx = Math.sin(a), lz = Math.cos(a);
      legs.push(g.box(0.3, 0.3, 2.6, DARK, lx * 2.2, 1.9, lz * 2.2, a), g.box(0.28, 2.2, 0.28, GUN, lx * 3.4, 0.95, lz * 3.4));
    }
    make(
      "spider",
      g.merge("spiderBody", [g.sphere(1.7, hull, 0, 2.2, 0, 10, 1.2, 0.7, 1.35), g.box(1.6, 0.8, 1.2, DARK, 0, 3.1, -0.3), g.cyl(0.2, 0.25, 1.8, DARK, 0, 3.3, 0.9, 8, Math.PI / 2.6), ...legs]),
      g.merge("spiderGlow", [g.sphere(0.25, W1, -0.5, 2.5, 2.1, 6), g.sphere(0.25, W1, 0.5, 2.5, 2.1, 6), g.sphere(0.18, W1, 0, 3.75, 1.6, 6)]),
      8,
    );
    // Cloaker: angular stealth drone (only visible while decloaked).
    make(
      "cloaker",
      g.merge("cloakerBody", [g.box(2.4, 0.18, 1.2, [0.12, 0.13, 0.16], 0, 0, -0.1), g.box(0.7, 0.4, 1.8, [0.1, 0.1, 0.12], 0, 0.1, 0), g.cyl(0, 0.35, 0.9, DARK, 0, 0, 1.2, 4, Math.PI / 2)]),
      g.merge("cloakerGlow", [g.box(1.8, 0.04, 0.05, W1, 0, 0, 0.52), g.sphere(0.12, W1, 0, 0.05, 1.5, 4)]),
      12,
    );
    // Titan: a towering super-heavy mech (the warbot's big brother).
    const titanPlate: RGB = [0.24, 0.24, 0.27];
    make(
      "titan",
      g.merge("titanBody", [
        g.box(5.8, 4.0, 4.2, titanPlate, 0, 7.0, 0),
        g.box(4.0, 1.8, 3.2, GUN, 0, 4.7, 0),
        g.box(2.0, 1.4, 2.0, DARK, 0, 9.6, 0.6),
        g.box(2.0, 2.0, 2.8, RED, -3.8, 8.3, 0),
        g.box(2.0, 2.0, 2.8, RED, 3.8, 8.3, 0),
        g.cyl(0.5, 0.6, 4.6, DARK, 3.8, 9.6, 2.6, 10, Math.PI / 2),
        g.box(1.3, 4.0, 1.3, GUN, -3.6, 5.6, 0.5),
        g.box(1.6, 4.4, 1.8, GUN, -1.6, 2.2, 0),
        g.box(1.6, 4.4, 1.8, GUN, 1.6, 2.2, 0),
        g.box(2.2, 0.7, 3.2, DARK, -1.6, 0.35, 0.4),
        g.box(2.2, 0.7, 3.2, DARK, 1.6, 0.35, 0.4),
      ]),
      g.merge("titanGlow", [
        g.box(1.6, 0.3, 0.08, W1, 0, 9.8, 1.62),
        g.box(1.5, 1.1, 0.08, W1, -3.8, 8.3, 1.45),
        g.box(1.5, 1.1, 0.08, W1, 3.8, 8.3, 1.45),
        g.sphere(0.45, W1, 0, 7.2, 2.15, 8),
      ]),
      2,
    );

    // Heavy bomber: a flying wing with four rear engines and a tail gun.
    const bomberHull: RGB = [0.2, 0.21, 0.24];
    make(
      "bomber",
      g.merge("bomberBody", [
        g.box(15, 0.5, 3.6, bomberHull, 0, 0, -0.6),
        g.box(9, 0.6, 2.4, bomberHull, 0, 0.05, 1.6),
        g.sphere(1.4, GUN, 0, 0.3, 1.2, 10, 1, 0.7, 3.2),
        g.box(0.2, 2.0, 1.6, DARK, -2.6, 1.0, -2.2),
        g.box(0.2, 2.0, 1.6, DARK, 2.6, 1.0, -2.2),
        g.cyl(0.55, 0.55, 2.0, DARK, -4.6, -0.3, -2.0, 10, Math.PI / 2),
        g.cyl(0.55, 0.55, 2.0, DARK, -2.0, -0.3, -2.2, 10, Math.PI / 2),
        g.cyl(0.55, 0.55, 2.0, DARK, 2.0, -0.3, -2.2, 10, Math.PI / 2),
        g.cyl(0.55, 0.55, 2.0, DARK, 4.6, -0.3, -2.0, 10, Math.PI / 2),
        g.box(1.8, 0.7, 1.4, DARK, 0, -0.6, 0.6),
        g.cyl(0.12, 0.12, 1.6, DARK, 0, 0.2, -3.6, 6, Math.PI / 2),
      ]),
      g.merge("bomberGlow", [
        g.cyl(0.42, 0.42, 0.1, W1, -4.6, -0.3, -3.05, 10, Math.PI / 2),
        g.cyl(0.42, 0.42, 0.1, W1, -2.0, -0.3, -3.25, 10, Math.PI / 2),
        g.cyl(0.42, 0.42, 0.1, W1, 2.0, -0.3, -3.25, 10, Math.PI / 2),
        g.cyl(0.42, 0.42, 0.1, W1, 4.6, -0.3, -3.05, 10, Math.PI / 2),
        g.sphere(0.2, W1, -7.5, 0, -0.6, 4),
        g.sphere(0.2, W1, 7.5, 0, -0.6, 4),
        g.box(1.4, 0.12, 0.9, W1, 0, -0.98, 0.6),
      ]),
      4,
    );
    // Air mine: a spiked sphere with a blinking core band.
    make(
      "mine",
      g.merge("mineBody", [
        g.sphere(0.6, GUN, 0, 0, 0, 10),
        g.cyl(0.0, 0.12, 0.55, DARK, 0, 0.7, 0, 6),
        g.cyl(0.12, 0.0, 0.55, DARK, 0, -0.7, 0, 6),
        g.cyl(0.0, 0.12, 0.55, DARK, 0.7, 0, 0, 6, 0, -Math.PI / 2),
        g.cyl(0.0, 0.12, 0.55, DARK, -0.7, 0, 0, 6, 0, Math.PI / 2),
        g.cyl(0.0, 0.12, 0.55, DARK, 0, 0, 0.7, 6, Math.PI / 2),
        g.cyl(0.0, 0.12, 0.55, DARK, 0, 0, -0.7, 6, -Math.PI / 2),
      ]),
      g.merge("mineGlow", [g.cyl(0.64, 0.64, 0.12, W1, 0, 0, 0, 14)]),
      40,
    );
    // Rooftop flak turret: armoured base, rotating head, twin barrels.
    make(
      "turret",
      g.merge("turretBody", [
        g.box(3.0, 0.8, 3.0, DARK, 0, 0.4, 0),
        g.cyl(1.1, 1.3, 0.6, GUN, 0, 1.1, 0, 12),
        g.box(1.9, 1.0, 1.7, GUN, 0, 1.75, 0),
        g.cyl(0.16, 0.16, 2.8, DARK, -0.45, 1.85, 1.9, 8, Math.PI / 2),
        g.cyl(0.16, 0.16, 2.8, DARK, 0.45, 1.85, 1.9, 8, Math.PI / 2),
      ]),
      g.merge("turretGlow", [g.sphere(0.14, W1, -0.45, 1.85, 3.3, 4), g.sphere(0.14, W1, 0.45, 1.85, 3.3, 4), g.box(1.2, 0.12, 0.05, W1, 0, 2.0, 0.87)]),
      12,
    );
    // Rogue armour: a gunmetal rival suit with an orange visor and reactor.
    const steel: RGB = [0.32, 0.33, 0.36];
    const black: RGB = [0.07, 0.07, 0.08];
    make(
      "rival",
      g.merge("rivalBody", [
        g.sphere(0.42, steel, 0, 0.35, 0, 10, 1.1, 1.0, 0.75),
        g.box(0.6, 0.35, 0.4, black, 0, -0.05, 0),
        g.sphere(0.17, steel, 0, 0.95, 0.02, 8, 1, 1.15, 1.05),
        g.sphere(0.16, black, -0.5, 0.6, 0, 6),
        g.sphere(0.16, black, 0.5, 0.6, 0, 6),
        g.cyl(0.08, 0.07, 0.75, steel, -0.55, 0.2, 0, 8),
        g.cyl(0.08, 0.07, 0.75, steel, 0.55, 0.2, 0, 8),
        g.cyl(0.1, 0.08, 0.9, steel, -0.15, -0.65, 0, 8),
        g.cyl(0.1, 0.08, 0.9, steel, 0.15, -0.65, 0, 8),
        g.box(0.5, 0.45, 0.18, black, 0, 0.35, -0.38),
      ]),
      g.merge("rivalGlow", [
        g.cyl(0.1, 0.1, 0.04, W1, 0, 0.4, 0.33, 12, Math.PI / 2),
        g.box(0.18, 0.04, 0.03, W1, 0, 1.0, 0.18),
        g.sphere(0.06, W1, -0.15, -1.13, 0, 4),
        g.sphere(0.06, W1, 0.15, -1.13, 0, 4),
        g.sphere(0.05, W1, -0.55, -0.2, 0, 4),
        g.sphere(0.05, W1, 0.55, -0.2, 0, 4),
      ]),
      3,
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
      if (!e.alive || isCloaked(e)) continue;
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
      roll = Math.sin(e.phase * 0.8) * 0.12;
    } else if (e.kind === "trooper" || e.kind === "sniper") {
      // Lean into strafes; tuck forward on jet-pack hops; idle breathing bob.
      const side = e.state === "hop" ? e.vx * Math.cos(e.yaw) - e.vz * Math.sin(e.yaw) : e.strafe * 2.5;
      roll = Math.max(-0.3, Math.min(0.3, -side * 0.05)) + (e.state === "hop" ? Math.sin(e.phase * 6) * 0.08 : 0);
      pitch = e.state === "hop" ? Math.max(-0.4, Math.min(0.4, -e.vy * 0.03)) : 0;
      y += Math.sin(e.phase * 2.4) * 0.02;
    } else if (e.kind === "tank") {
      y += 0.4 + Math.sin(e.phase * 2) * 0.08; // hovering hull
    } else if (e.kind === "jet") {
      // Nose follows the flight path; bank hard into turns.
      const sp = Math.hypot(e.vx, e.vy, e.vz) || 1;
      pitch = -Math.asin(Math.max(-1, Math.min(1, e.vy / sp)));
      const side = e.vx * Math.cos(e.yaw) - e.vz * Math.sin(e.yaw);
      roll = Math.max(-1.3, Math.min(1.3, -side * 0.04));
    } else if (e.kind === "swarmer") {
      roll = e.phase * 9;
    } else if (e.kind === "jammer") {
      y += Math.sin(e.phase * 2.5) * 0.25;
      // The coil spins up as the pulse charges.
      roll = 0;
      pitch = Math.sin(e.phase) * 0.05;
    } else if (e.kind === "sentinel") {
      // Leans hard into its dash, hovers upright otherwise.
      const sp = Math.hypot(e.vx, e.vz);
      pitch = Math.min(1.2, sp * 0.02) + Math.sin(e.phase * 2) * 0.05;
      y += Math.sin(e.phase * 2.2) * 0.2;
    } else if (e.kind === "spider" || e.kind === "titan") {
      // Heavy gait bob.
      y += Math.abs(Math.sin(e.phase * (e.kind === "titan" ? 2.2 : 5))) * (e.kind === "titan" ? 0.35 : 0.2);
      roll = Math.sin(e.phase * (e.kind === "titan" ? 1.1 : 2.5)) * 0.03;
    } else if (e.kind === "cloaker") {
      roll = Math.sin(e.phase) * 0.15;
    } else if (e.kind === "carrier") {
      pitch = Math.sin(e.phase * 0.3) * 0.03;
      roll = Math.sin(e.phase * 0.23) * 0.04;
    } else if (e.kind === "bomber") {
      // Lumbering banks into its turns, a slow wallow otherwise.
      const side = e.vx * Math.cos(e.yaw) - e.vz * Math.sin(e.yaw);
      roll = Math.max(-0.5, Math.min(0.5, -side * 0.03)) + Math.sin(e.phase * 0.7) * 0.03;
      pitch = Math.sin(e.phase * 0.5) * 0.02;
    } else if (e.kind === "mine") {
      // Tumbles slowly; shivers when armed.
      roll = e.phase * 0.6 + (e.charge > 0 ? Math.sin(e.phase * 40) * 0.05 * e.charge : 0);
      pitch = e.phase * 0.4;
    } else if (e.kind === "turret") {
      // Barrels raised toward the sky, kicking back as each shell fires.
      pitch = -0.5 + e.flash * 0.15;
    } else if (e.kind === "rival") {
      // Flies like a suit: leans into its velocity, flat out on a dash.
      const fwd = e.vx * Math.sin(e.yaw) + e.vz * Math.cos(e.yaw);
      const side = e.vx * Math.cos(e.yaw) - e.vz * Math.sin(e.yaw);
      pitch = e.state === "charge" ? 1.35 : Math.max(-0.4, Math.min(0.9, fwd * 0.02));
      roll = Math.max(-0.9, Math.min(0.9, -side * 0.03)) + e.jet * Math.sin(e.phase * 14) * 0.6;
      y += Math.sin(e.phase * 3) * 0.12;
    }
    const spin = e.kind === "jammer" ? e.phase * (1.5 + e.charge * 12) : e.kind === "shielder" ? e.phase * 0.9 : 0;
    Quaternion.RotationYawPitchRollToRef(e.yaw + spin, pitch, roll, this.q);
    // Warp in: grow from nothing with a slight overshoot.
    const w = Math.min(1, e.age / 0.5);
    const grow = w >= 1 ? 1 : 1 + 2.4 * Math.pow(w - 1, 3) + 1.4 * Math.pow(w - 1, 2);
    // Hit squash: a quick swell when struck.
    const hit = grow * (1 + e.flash * 0.12);
    this.s.set(hit, hit * (1 - e.flash * 0.06), hit);
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
    } else if (e.kind === "gunship" || e.kind === "jet" || e.kind === "carrier") {
      gr = 1.2;
      gg = e.kind === "jet" ? 0.5 : 0.25;
      gb = 0.1;
    } else if (e.kind === "jammer") {
      // Builds from dim blue to a blinding pulse.
      const c = 0.4 + e.charge * 1.6 + (e.charge > 0 ? Math.sin(e.phase * 40) * 0.2 : 0);
      gr = 0.3 * c;
      gg = 0.7 * c;
      gb = 1.3 * c;
    } else if (e.kind === "swarmer") {
      gr = 1.3;
      gg = 0.9;
      gb = 0.1;
    } else if (e.kind === "sentinel") {
      const c = 0.8 + e.charge * 2;
      gr = c;
      gg = 0.12 + e.charge * 0.3;
      gb = 0.08;
    } else if (e.kind === "cloaker") {
      // Shimmering as it decloaks.
      gr = 0.4 + Math.sin(e.phase * 30) * 0.2;
      gg = 0.9;
      gb = 1.3;
    } else if (e.kind === "bomber") {
      // Engines burn orange; the belly light flashes red over the drop zone.
      gr = 1.3;
      gg = 0.45 + (e.charge > 0.5 && Math.sin(e.phase * 20) > 0 ? -0.3 : 0);
      gb = 0.12;
    } else if (e.kind === "mine") {
      // Slow red pulse; frantic blinking once it is chasing you.
      const rate = 3 + e.charge * 30;
      const on = Math.sin(e.phase * rate) > 0 ? 1 : 0.15;
      gr = 1.4 * on;
      gg = 0.1 * on;
      gb = 0.05;
    } else if (e.kind === "turret") {
      const c = 0.5 + e.charge * 1.5 + e.flash * 2;
      gr = c;
      gg = 0.45 * c;
      gb = 0.1;
    } else if (e.kind === "rival") {
      // Orange reactor and visor, boots flaring on a dash.
      const c = 1 + e.jet * 1.2;
      gr = 1.4 * c;
      gg = 0.55 * c;
      gb = 0.12;
    } else if (e.kind === "warbot" || e.kind === "tank" || e.kind === "sniper" || e.kind === "spider" || e.kind === "titan") {
      const c = 0.5 + e.charge * 1.5;
      gr = c;
      gg = 0.1 + e.charge * 0.4;
      gb = 0.05 + e.charge * 0.2;
    } else if (!e.aware) {
      gr = 0.9;
      gg = 0.5;
      gb = 0.1;
    }
    // Bright flash while warping in.
    const warp = Math.max(0, 1 - e.age / 0.6) * 3;
    km.glowC.set([gr + warp * 0.4, gg + warp * 0.9, gb + warp, 1], i * 4);
  }
}
