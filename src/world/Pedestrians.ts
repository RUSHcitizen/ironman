import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "./ProcGeo";
import type { WorldMaterials } from "./Materials";
import type { RGB } from "./CityGenerator";
import { Rng } from "../core/math";
import { BLOCK_SIZE, BLOCK_PITCH, BLOCK_MIN_INDEX, BLOCK_MAX_INDEX, SIDEWALK_HEIGHT, blockOrigin } from "./WorldConfig";
import { setInstanceCount } from "./instancing";

interface Ped {
  x0: number;
  z0: number;
  t: number;
  speed: number;
  phase: number;
  height: number;
  /** Seconds left running from danger. */
  panic: number;
  /** Seconds left cheering the hero (stop, face them, jump for joy). */
  cheer: number;
}

const SHIRTS: RGB[] = [
  [0.2, 0.3, 0.55],
  [0.6, 0.15, 0.15],
  [0.85, 0.85, 0.82],
  [0.15, 0.15, 0.17],
  [0.3, 0.5, 0.35],
  [0.75, 0.55, 0.25],
  [0.5, 0.3, 0.55],
];
const SKIN: RGB[] = [
  [0.95, 0.78, 0.66],
  [0.85, 0.66, 0.5],
  [0.7, 0.5, 0.36],
  [0.5, 0.35, 0.25],
  [0.35, 0.24, 0.18],
];
const INSET = 2.3;
const SIDE = BLOCK_SIZE - 2 * INSET;
const PERIM = SIDE * 4;

/** Pedestrians strolling around block perimeters. Cheap 4-part thin instances. */
export class PedestrianSystem {
  private peds: Ped[] = [];
  private torso: Mesh;
  private parts: Mesh[];
  private bodyM: Float32Array;
  private legLM: Float32Array;
  private legRM: Float32Array;
  readonly max: number;
  private active = 0;
  private rng = new Rng(1234);
  /** Where the crowd looks while cheering. */
  private heroX = 0;
  private heroZ = 0;

  constructor(scene: Scene, mats: WorldMaterials, max = 80) {
    this.max = max;
    const g = new ProcGeo(scene);
    const rng = new Rng(99);
    this.torso = g.merge("pedTorso", [g.box(0.46, 0.66, 0.26, [1, 1, 1], 0, 1.18, 0), g.box(0.12, 0.6, 0.14, [1, 1, 1], -0.3, 1.16, 0), g.box(0.12, 0.6, 0.14, [1, 1, 1], 0.3, 1.16, 0)]);
    const head = g.merge("pedHead", [g.sphere(0.13, [1, 1, 1], 0, 1.66, 0, 4, 1, 1.15, 1)]);
    const pants: RGB = [0.16, 0.17, 0.22];
    // Legs are modelled hanging from the hip so they can swing.
    const legL = g.merge("pedLegL", [g.box(0.17, 0.86, 0.2, pants, -0.12, -0.43, 0)]);
    const legR = g.merge("pedLegR", [g.box(0.17, 0.86, 0.2, pants, 0.12, -0.43, 0)]);
    this.parts = [this.torso, head, legL, legR];
    this.bodyM = new Float32Array(max * 16);
    this.legLM = new Float32Array(max * 16);
    this.legRM = new Float32Array(max * 16);
    for (const p of this.parts) {
      p.material = mats.propLit;
      p.alwaysSelectAsActiveMesh = true;
    }
    this.torso.thinInstanceSetBuffer("matrix", this.bodyM, 16, false);
    head.thinInstanceSetBuffer("matrix", this.bodyM, 16, false);
    legL.thinInstanceSetBuffer("matrix", this.legLM, 16, false);
    legR.thinInstanceSetBuffer("matrix", this.legRM, 16, false);
    const colors = new Float32Array(max * 4);
    const skins = new Float32Array(max * 4);
    for (let k = 0; k < max; k++) {
      const i = rng.int(-4, 4);
      const j = rng.int(-4, 4);
      this.peds.push({
        x0: blockOrigin(i) + INSET,
        z0: blockOrigin(j) + INSET,
        t: rng.range(0, PERIM),
        speed: rng.range(1.1, 1.7) * (rng.chance(0.5) ? 1 : -1),
        phase: rng.range(0, 6),
        height: rng.range(0.88, 1.1),
        panic: 0,
        cheer: 0,
      });
      colors.set([...rng.pick(SHIRTS), 1], k * 4);
      skins.set([...rng.pick(SKIN), 1], k * 4);
    }
    this.torso.thinInstanceSetBuffer("color", colors, 4, true);
    head.thinInstanceSetBuffer("color", skins, 4, true);
    this.setCount(max);
  }

  /** Spread pedestrians over the blocks around a point (game start / teleport). */
  scatter(px: number, pz: number): void {
    for (const p of this.peds) {
      const i = Math.max(BLOCK_MIN_INDEX, Math.min(BLOCK_MAX_INDEX, Math.floor(px / BLOCK_PITCH) + this.rng.int(-3, 3)));
      const j = Math.max(BLOCK_MIN_INDEX, Math.min(BLOCK_MAX_INDEX, Math.floor(pz / BLOCK_PITCH) + this.rng.int(-3, 3)));
      p.x0 = blockOrigin(i) + INSET;
      p.z0 = blockOrigin(j) + INSET;
      p.t = this.rng.range(0, PERIM);
    }
  }

  /** Pedestrians near danger run away along the sidewalk for a while. */
  panic(x: number, z: number, radius: number): void {
    for (let k = 0; k < this.active; k++) {
      const p = this.peds[k];
      const [px, pz] = this.position(p);
      const d = Math.hypot(px - x, pz - z);
      if (d > radius) continue;
      p.panic = 6 + Math.random() * 4;
      // Pick the walking direction that increases distance from the danger.
      const [ax, az] = this.position({ ...p, t: p.t + 1 });
      const away = Math.hypot(ax - x, az - z) > d;
      p.speed = Math.abs(p.speed) * (away ? 1 : -1);
    }
  }

  /** Pedestrians near (x, z) stop, turn to the hero and jump for joy. */
  cheer(x: number, z: number, radius: number): number {
    this.heroX = x;
    this.heroZ = z;
    let n = 0;
    for (let k = 0; k < this.active; k++) {
      const p = this.peds[k];
      const [px, pz] = this.position(p);
      if (p.panic > 0 || Math.hypot(px - x, pz - z) > radius) continue;
      p.cheer = 3 + Math.random() * 1.5;
      n++;
    }
    return n;
  }

  private position(p: Pick<Ped, "x0" | "z0" | "t">): [number, number] {
    const t = ((p.t % PERIM) + PERIM) % PERIM;
    const side = Math.floor(t / SIDE);
    const u = t - side * SIDE;
    if (side === 0) return [p.x0 + u, p.z0];
    if (side === 1) return [p.x0 + SIDE, p.z0 + u];
    if (side === 2) return [p.x0 + SIDE - u, p.z0 + SIDE];
    return [p.x0, p.z0 + SIDE - u];
  }

  setCount(n: number): void {
    this.active = Math.max(0, Math.min(this.max, n));
    for (const p of this.parts) setInstanceCount(p, this.active);
  }

  update(dt: number, px = 0, pz = 0): void {
    // Keep pedestrians on blocks around the player.
    for (let k = 0; k < this.active; k++) {
      const p = this.peds[k];
      if (Math.max(Math.abs(p.x0 - px), Math.abs(p.z0 - pz)) > 360) {
        const bi = Math.floor(px / BLOCK_PITCH) + this.rng.int(-4, 4);
        const bj = Math.floor(pz / BLOCK_PITCH) + this.rng.int(-4, 4);
        const i = Math.max(BLOCK_MIN_INDEX, Math.min(BLOCK_MAX_INDEX, bi));
        const j = Math.max(BLOCK_MIN_INDEX, Math.min(BLOCK_MAX_INDEX, bj));
        p.x0 = blockOrigin(i) + INSET;
        p.z0 = blockOrigin(j) + INSET;
      }
    }
    const q = new Quaternion();
    const m = new Matrix();
    const s = new Vector3(1, 1, 1);
    const t = new Vector3();
    for (let k = 0; k < this.active; k++) {
      const p = this.peds[k];
      const cheering = p.cheer > 0 && p.panic <= 0;
      const run = p.panic > 0 ? 3.2 : cheering ? 0 : 1;
      if (p.panic > 0) p.panic -= dt;
      if (p.cheer > 0) p.cheer -= dt;
      p.t = (((p.t + p.speed * run * dt) % PERIM) + PERIM) % PERIM;
      p.phase += Math.abs(p.speed) * run * dt * 3.2;
      const side = Math.floor(p.t / SIDE);
      const u = p.t - side * SIDE;
      let x = p.x0, z = p.z0, yaw = 0;
      if (side === 0) { x += u; yaw = Math.PI / 2; }
      else if (side === 1) { x += SIDE; z += u; yaw = 0; }
      else if (side === 2) { x += SIDE - u; z += SIDE; yaw = -Math.PI / 2; }
      else { z += SIDE - u; yaw = Math.PI; }
      if (p.speed < 0) yaw += Math.PI;
      let bob = Math.abs(Math.sin(p.phase)) * (p.panic > 0 ? 0.1 : 0.05);
      if (cheering) {
        // Face the hero and hop up and down, each at their own rhythm.
        yaw = Math.atan2(this.heroX - x, this.heroZ - z);
        p.phase += dt * (7 + (k % 5));
        bob = Math.abs(Math.sin(p.phase)) * 0.28;
      }
      s.set(p.height, p.height, p.height);
      Quaternion.RotationYawPitchRollToRef(yaw, p.panic > 0 ? 0.25 : cheering ? -0.12 : 0, 0, q);
      t.set(x, SIDEWALK_HEIGHT + bob, z);
      Matrix.ComposeToRef(s, q, t, m);
      m.copyToArray(this.bodyM, k * 16);
      const swing = cheering ? 0.15 * Math.sin(p.phase) : Math.sin(p.phase) * (p.panic > 0 ? 0.8 : 0.45);
      t.y = SIDEWALK_HEIGHT + 0.86 * p.height + bob;
      Quaternion.RotationYawPitchRollToRef(yaw, swing, 0, q);
      Matrix.ComposeToRef(s, q, t, m);
      m.copyToArray(this.legLM, k * 16);
      Quaternion.RotationYawPitchRollToRef(yaw, -swing, 0, q);
      Matrix.ComposeToRef(s, q, t, m);
      m.copyToArray(this.legRM, k * 16);
    }
    for (const p of this.parts) p.thinInstanceBufferUpdated("matrix");
  }
}
