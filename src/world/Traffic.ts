import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "./ProcGeo";
import type { WorldMaterials } from "./Materials";
import { roadLines, type RGB } from "./CityGenerator";
import { Rng } from "../core/math";
import { BLOCK_MIN_INDEX, BLOCK_MAX_INDEX, DISTRICT_MIN, DISTRICT_MAX, ROAD_WIDTH } from "./WorldConfig";
import { setInstanceCount } from "./instancing";

interface Car {
  /** 0: travels along Z (road at x = line), 1: travels along X. */
  axis: 0 | 1;
  dir: 1 | -1;
  line: number;
  laneOffset: number;
  s: number;
  speed: number;
  cruise: number;
  lane: number;
}

const CAR_COLORS: RGB[] = [
  [0.95, 0.75, 0.1], // taxi
  [0.95, 0.75, 0.1],
  [0.95, 0.75, 0.1],
  [0.1, 0.1, 0.12],
  [0.85, 0.85, 0.88],
  [0.55, 0.08, 0.08],
  [0.15, 0.25, 0.5],
  [0.35, 0.38, 0.4],
  [0.2, 0.35, 0.25],
];

export const SIGNAL_PERIOD = 9;
/** Cars further than this (m, per axis) from the player respawn near them. */
const RECYCLE_RADIUS = 420;

/** Lightweight lane-following traffic with signal phases and car spacing. */
export class TrafficSystem {
  private cars: Car[] = [];
  private parts: Mesh[];
  private body: Mesh;
  private matrices: Float32Array;
  private colors: Float32Array;
  private lines = roadLines(BLOCK_MIN_INDEX, BLOCK_MAX_INDEX);
  private rng = new Rng(4242);
  private time = 0;
  phase = 0;
  readonly max: number;

  constructor(scene: Scene, mats: WorldMaterials, max = 64) {
    this.max = max;
    const g = new ProcGeo(scene);
    const dark: RGB = [0.08, 0.08, 0.09];
    const glassC: RGB = [0.18, 0.22, 0.28];
    this.body = g.merge("carBody", [g.box(1.9, 0.72, 4.5, [1, 1, 1], 0, 0.62, 0), g.box(1.72, 0.58, 2.3, [1, 1, 1], 0, 1.25, -0.25)]);
    const detail = g.merge("carDetail", [
      g.box(1.76, 0.42, 2.0, glassC, 0, 1.28, -0.25),
      g.cyl(0.36, 0.36, 0.3, dark, -0.92, 0.36, 1.45, 10, 0, Math.PI / 2),
      g.cyl(0.36, 0.36, 0.3, dark, 0.92, 0.36, 1.45, 10, 0, Math.PI / 2),
      g.cyl(0.36, 0.36, 0.3, dark, -0.92, 0.36, -1.45, 10, 0, Math.PI / 2),
      g.cyl(0.36, 0.36, 0.3, dark, 0.92, 0.36, -1.45, 10, 0, Math.PI / 2),
    ]);
    const lights = g.merge("carLights", [
      g.box(0.4, 0.16, 0.06, [1, 0.95, 0.8], -0.62, 0.72, 2.26),
      g.box(0.4, 0.16, 0.06, [1, 0.95, 0.8], 0.62, 0.72, 2.26),
      g.box(0.42, 0.14, 0.06, [1, 0.1, 0.05], -0.62, 0.78, -2.26),
      g.box(0.42, 0.14, 0.06, [1, 0.1, 0.05], 0.62, 0.78, -2.26),
    ]);
    this.body.material = mats.propLit;
    detail.material = mats.propLit;
    lights.material = mats.propGlow;
    this.parts = [this.body, detail, lights];
    this.matrices = new Float32Array(max * 16);
    this.colors = new Float32Array(max * 4);
    for (const p of this.parts) {
      p.alwaysSelectAsActiveMesh = true;
      p.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    }
    for (let k = 0; k < max; k++) this.cars.push(this.spawnCar(k));
    for (let k = 0; k < max; k++) this.colors.set([...this.rng.pick(CAR_COLORS), 1], k * 4);
    this.body.thinInstanceSetBuffer("color", this.colors, 4, true);
    this.setCount(max);
  }

  private spawnCar(k: number): Car {
    const r = this.rng;
    const axis = (k % 2) as 0 | 1;
    const dir = r.chance(0.5) ? 1 : -1;
    const line = r.pick(this.lines);
    const laneIdx = r.int(0, 1);
    // Right-hand traffic: +Z traffic keeps to +X; +X traffic keeps to -Z.
    const side = axis === 0 ? dir : -dir;
    const laneOffset = side * (laneIdx === 0 ? 2 : 5.6);
    const cruise = r.range(9, 15);
    return { axis, dir, line, laneOffset, s: r.range(DISTRICT_MIN, DISTRICT_MAX), speed: cruise, cruise, lane: (this.lines.indexOf(line) * 2 + axis) * 4 + (dir > 0 ? 0 : 2) + laneIdx };
  }

  private active = 0;

  setCount(n: number): void {
    this.active = Math.max(0, Math.min(this.max, n));
    for (const p of this.parts) setInstanceCount(p, this.active);
  }

  /** Move a car that drifted far from the player onto a lane near them. */
  private recycle(c: Car, px: number, pz: number): void {
    const r = this.rng;
    const along = c.axis === 0 ? pz : px;
    const across = c.axis === 0 ? px : pz;
    const near = this.lines.filter((L) => Math.abs(L - across) < RECYCLE_RADIUS * 0.8);
    if (near.length === 0) return;
    const line = r.pick(near);
    c.line = line;
    // Appear ahead/behind at a distance so cars do not pop in next to you.
    const sign = r.chance(0.5) ? 1 : -1;
    c.s = Math.max(DISTRICT_MIN, Math.min(DISTRICT_MAX, along + sign * r.range(120, RECYCLE_RADIUS * 0.8)));
    c.speed = c.cruise;
    const laneIdx = Math.abs(c.laneOffset) > 3 ? 1 : 0;
    c.lane = (this.lines.indexOf(line) * 2 + c.axis) * 4 + (c.dir > 0 ? 0 : 2) + laneIdx;
  }

  update(dt: number, px = 0, pz = 0): void {
    this.time += dt;
    for (let i = 0; i < this.active; i++) {
      const c = this.cars[i];
      const cx = c.axis === 0 ? c.line + c.laneOffset : c.s;
      const cz = c.axis === 0 ? c.s : c.line + c.laneOffset;
      if (Math.max(Math.abs(cx - px), Math.abs(cz - pz)) > RECYCLE_RADIUS) this.recycle(c, px, pz);
    }
    this.phase = Math.floor(this.time / SIGNAL_PERIOD) % 2;
    const half = ROAD_WIDTH / 2;
    const lo = DISTRICT_MIN - half, hi = DISTRICT_MAX + half;
    const q = new Quaternion();
    const m = new Matrix();
    const one = new Vector3(1, 1, 1);
    const t = new Vector3();
    const n = this.active;

    for (let i = 0; i < n; i++) {
      const c = this.cars[i];
      let target = c.cruise;
      // Car following.
      let gap = Infinity;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = this.cars[j];
        if (o.lane !== c.lane) continue;
        const d = (o.s - c.s) * c.dir;
        if (d > 0 && d < gap) gap = d;
      }
      if (gap < 30) target = Math.min(target, Math.max(0, (gap - 7) * 0.8));
      // Signals: axis 0 has green on phase 0.
      if ((c.axis === 0 ? 0 : 1) !== this.phase) {
        const stop = this.nextStopLine(c);
        if (stop > 0 && stop < 22) target = Math.min(target, Math.max(0, (stop - 1) * 0.7));
      }
      c.speed += Math.max(-9 * dt, Math.min(4 * dt, target - c.speed));
      c.s += c.speed * c.dir * dt;
      if (c.s > hi) c.s = lo;
      else if (c.s < lo) c.s = hi;

      const x = c.axis === 0 ? c.line + c.laneOffset : c.s;
      const z = c.axis === 0 ? c.s : c.line + c.laneOffset;
      const yaw = c.axis === 0 ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      // Shrink in/out at road ends to hide wrap-around.
      const edge = Math.min(c.s - lo, hi - c.s);
      const sc = Math.min(1, Math.max(0.01, edge / 6));
      one.set(sc, sc, sc);
      Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, q);
      t.set(x, 0, z);
      Matrix.ComposeToRef(one, q, t, m);
      m.copyToArray(this.matrices, i * 16);
    }
    for (const p of this.parts) p.thinInstanceBufferUpdated("matrix");
  }

  /** Distance to the next stop line ahead, or Infinity. */
  private nextStopLine(c: Car): number {
    let best = Infinity;
    const offset = ROAD_WIDTH / 2 + 3.8;
    for (const L of this.lines) {
      const stopS = L - c.dir * offset;
      const d = (stopS - c.s) * c.dir;
      if (d > 0 && d < best) best = d;
    }
    return best;
  }

  /** Approximate car boxes near a point (for future collision/interaction). */
  carsNear(x: number, z: number, r: number): number {
    let n = 0;
    for (let i = 0; i < this.active; i++) {
      const c = this.cars[i];
      const cx = c.axis === 0 ? c.line + c.laneOffset : c.s;
      const cz = c.axis === 0 ? c.s : c.line + c.laneOffset;
      if (Math.hypot(cx - x, cz - z) < r) n++;
    }
    return n;
  }
}
