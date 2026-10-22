import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "./ProcGeo";
import type { WorldMaterials } from "./Materials";
import { roadLines, type RGB } from "./CityGenerator";
import { Rng } from "../core/math";
import { BLOCK_MIN_INDEX, BLOCK_MAX_INDEX, BLOCK_PITCH, DISTRICT_MIN, DISTRICT_MAX, ROAD_WIDTH } from "./WorldConfig";
import { setInstanceCount } from "./instancing";

type VehicleKind = "car" | "van" | "bus";

interface Car {
  kind: VehicleKind;
  /** 0: travels along Z (road at x = line), 1: travels along X. */
  axis: 0 | 1;
  dir: 1 | -1;
  line: number;
  laneOffset: number;
  s: number;
  speed: number;
  cruise: number;
  lane: number;
  length: number;
  slot: number;
  /** Smoothed body pitch from braking / accelerating (suspension). */
  pitch?: number;
}

interface KindMeshes {
  parts: Mesh[];
  body: Mesh;
  matrices: Float32Array;
  colors: Float32Array;
  max: number;
  n: number;
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
  [0.6, 0.6, 0.62],
];
const VAN_COLORS: RGB[] = [
  [0.92, 0.92, 0.9],
  [0.85, 0.85, 0.82],
  [0.3, 0.4, 0.6],
  [0.75, 0.2, 0.15],
];
const BUS_COLORS: RGB[] = [
  [0.2, 0.4, 0.75],
  [0.88, 0.88, 0.9],
];

export const SIGNAL_PERIOD = 9;
/** Cars further than this (m, per axis) from the player respawn near them. */
const RECYCLE_RADIUS = 420;
const LENGTH: Record<VehicleKind, number> = { car: 4.5, van: 6, bus: 12 };

/**
 * Lane-following traffic with signal phases, vehicle spacing and a few vehicle
 * types. Vehicles stay in a window around the player, so density is constant
 * no matter how big the city is.
 */
export class TrafficSystem {
  private cars: Car[] = [];
  private kinds = new Map<VehicleKind, KindMeshes>();
  private lines = roadLines(BLOCK_MIN_INDEX, BLOCK_MAX_INDEX);
  private rng = new Rng(4242);
  private time = 0;
  private active = 0;
  phase = 0;
  readonly max: number;
  private m = new Matrix();
  private q = new Quaternion();
  private sc = new Vector3();
  private t = new Vector3();

  constructor(scene: Scene, mats: WorldMaterials, max = 64) {
    this.max = max;
    const g = new ProcGeo(scene);
    const dark: RGB = [0.08, 0.08, 0.09];
    const glassC: RGB = [0.18, 0.22, 0.28];
    const W: RGB = [1, 1, 1];
    const wheel = (x: number, z: number, r = 0.36) => g.cyl(r, r, 0.3, dark, x, r, z, 10, 0, Math.PI / 2);
    const lights = (half: number, y: number, w = 0.62) => [
      g.box(0.4, 0.16, 0.06, [1, 0.95, 0.8], -w, y, half + 0.01),
      g.box(0.4, 0.16, 0.06, [1, 0.95, 0.8], w, y, half + 0.01),
      g.box(0.42, 0.14, 0.06, [1, 0.1, 0.05], -w, y + 0.06, -half - 0.01),
      g.box(0.42, 0.14, 0.06, [1, 0.1, 0.05], w, y + 0.06, -half - 0.01),
    ];
    const build = (kind: VehicleKind, body: Mesh[], detail: Mesh[], glow: Mesh[], n: number) => {
      const b = g.merge(`${kind}Body`, body);
      const d = g.merge(`${kind}Detail`, detail);
      const l = g.merge(`${kind}Lights`, glow);
      b.material = mats.propLit;
      d.material = mats.propLit;
      l.material = mats.propGlow;
      const km: KindMeshes = { parts: [b, d, l], body: b, matrices: new Float32Array(n * 16), colors: new Float32Array(n * 4).fill(1), max: n, n: 0 };
      for (const p of km.parts) {
        p.alwaysSelectAsActiveMesh = true;
        p.thinInstanceSetBuffer("matrix", km.matrices, 16, false);
      }
      b.thinInstanceSetBuffer("color", km.colors, 4, false);
      this.kinds.set(kind, km);
    };
    build(
      "car",
      [g.box(1.9, 0.72, 4.5, W, 0, 0.62, 0), g.box(1.72, 0.58, 2.3, W, 0, 1.25, -0.25)],
      [g.box(1.76, 0.42, 2.0, glassC, 0, 1.28, -0.25), wheel(-0.92, 1.45), wheel(0.92, 1.45), wheel(-0.92, -1.45), wheel(0.92, -1.45)],
      lights(2.25, 0.72),
      max,
    );
    build(
      "van",
      [g.box(2.1, 2.2, 4.4, W, 0, 1.5, -0.7), g.box(2.0, 1.2, 1.6, W, 0, 1.0, 2.3)],
      [g.box(1.9, 0.6, 0.06, glassC, 0, 1.75, 2.95), wheel(-1.0, 1.9, 0.4), wheel(1.0, 1.9, 0.4), wheel(-1.0, -2.0, 0.4), wheel(1.0, -2.0, 0.4)],
      lights(3.0, 0.75, 0.7),
      Math.ceil(max * 0.25),
    );
    build(
      "bus",
      [g.box(2.5, 2.8, 12, W, 0, 1.9, 0)],
      [
        g.box(2.54, 0.9, 10.6, glassC, 0, 2.4, 0.3),
        g.box(2.3, 1.2, 0.06, glassC, 0, 2.3, 6.01),
        g.box(2.56, 0.25, 12.02, [0.85, 0.65, 0.1], 0, 1.2, 0),
        wheel(-1.2, 4.2, 0.5),
        wheel(1.2, 4.2, 0.5),
        wheel(-1.2, -3.8, 0.5),
        wheel(1.2, -3.8, 0.5),
      ],
      [...lights(6.0, 0.9, 0.9), g.box(1.6, 0.25, 0.05, [1, 0.6, 0.1], 0, 3.1, 6.02)],
      Math.ceil(max * 0.15),
    );
    for (let k = 0; k < max; k++) this.cars.push(this.spawnCar(k));
    this.setCount(max);
  }

  private spawnCar(k: number): Car {
    const r = this.rng;
    const roll = r.next();
    const kind: VehicleKind = roll < 0.08 ? "bus" : roll < 0.25 ? "van" : "car";
    const axis = (k % 2) as 0 | 1;
    const dir = r.chance(0.5) ? 1 : -1;
    const line = r.pick(this.lines);
    // Buses keep to the right (outer) lane.
    const laneIdx = kind === "bus" ? 1 : r.int(0, 1);
    // Right-hand traffic: +Z traffic keeps to +X; +X traffic keeps to -Z.
    const side = axis === 0 ? dir : -dir;
    const laneOffset = side * (laneIdx === 0 ? 2 : 5.6);
    const cruise = kind === "bus" ? r.range(7, 10) : r.range(9, 15);
    const car: Car = { kind, axis, dir, line, laneOffset, s: r.range(-300, 300), speed: cruise, cruise, lane: 0, length: LENGTH[kind], slot: 0 };
    car.lane = this.laneId(car);
    // Colour per vehicle.
    const km = this.kinds.get(kind)!;
    const colors = kind === "car" ? CAR_COLORS : kind === "van" ? VAN_COLORS : BUS_COLORS;
    car.slot = km.n++;
    if (car.slot < km.max) km.colors.set([...r.pick(colors), 1], car.slot * 4);
    return car;
  }

  private laneId(c: Car): number {
    const laneIdx = Math.abs(c.laneOffset) > 3 ? 1 : 0;
    return ((Math.round(c.line / BLOCK_PITCH) - BLOCK_MIN_INDEX) * 2 + c.axis) * 4 + (c.dir > 0 ? 0 : 2) + laneIdx;
  }

  setCount(n: number): void {
    this.active = Math.max(0, Math.min(this.max, n));
  }

  /** Spread all vehicles over the roads around a point (game start / teleport). */
  scatter(px: number, pz: number): void {
    for (const c of this.cars) {
      this.recycle(c, px, pz);
      const along = c.axis === 0 ? pz : px;
      c.s = Math.max(DISTRICT_MIN, Math.min(DISTRICT_MAX, along + this.rng.range(-RECYCLE_RADIUS * 0.8, RECYCLE_RADIUS * 0.8)));
    }
  }

  /** Move a car that drifted far from the player onto a lane near them. */
  private recycle(c: Car, px: number, pz: number): void {
    const r = this.rng;
    const along = c.axis === 0 ? pz : px;
    const across = c.axis === 0 ? px : pz;
    const near = this.lines.filter((L) => Math.abs(L - across) < RECYCLE_RADIUS * 0.8);
    if (near.length === 0) return;
    c.line = r.pick(near);
    // Appear ahead/behind at a distance so cars do not pop in next to you.
    const sign = r.chance(0.5) ? 1 : -1;
    c.s = Math.max(DISTRICT_MIN, Math.min(DISTRICT_MAX, along + sign * r.range(120, RECYCLE_RADIUS * 0.8)));
    c.speed = c.cruise;
    c.lane = this.laneId(c);
  }

  /** px/pz = player position; py = player height (cars brake for people on the road). */
  update(dt: number, px = 0, pz = 0, py = 0): void {
    this.time += dt;
    this.phase = Math.floor(this.time / SIGNAL_PERIOD) % 2;
    const half = ROAD_WIDTH / 2;
    const lo = DISTRICT_MIN - half, hi = DISTRICT_MAX + half;
    const n = this.active;
    for (let i = 0; i < n; i++) {
      const c = this.cars[i];
      const cx = c.axis === 0 ? c.line + c.laneOffset : c.s;
      const cz = c.axis === 0 ? c.s : c.line + c.laneOffset;
      if (Math.max(Math.abs(cx - px), Math.abs(cz - pz)) > RECYCLE_RADIUS) this.recycle(c, px, pz);
    }
    for (const km of this.kinds.values()) km.n = 0;

    for (let i = 0; i < n; i++) {
      const c = this.cars[i];
      let target = c.cruise;
      // Car following (bumper to bumper, so vehicle lengths matter).
      let gap = Infinity;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = this.cars[j];
        if (o.lane !== c.lane) continue;
        const d = (o.s - c.s) * c.dir - (o.length + c.length) / 2;
        if (d > -1 && d < gap) gap = d;
      }
      // Brake for the player standing in this lane.
      if (py < 3) {
        const across = c.axis === 0 ? px : pz;
        const along = c.axis === 0 ? pz : px;
        if (Math.abs(across - (c.line + c.laneOffset)) < 2) {
          const d = (along - c.s) * c.dir - c.length / 2;
          if (d > -1 && d < gap) gap = d;
        }
      }
      if (gap < 30) target = Math.min(target, Math.max(0, (gap - 3) * 0.8));
      // Signals: axis 0 has green on phase 0.
      if ((c.axis === 0 ? 0 : 1) !== this.phase) {
        const stop = this.nextStopLine(c) - c.length / 2;
        if (stop > 0 && stop < 22) target = Math.min(target, Math.max(0, (stop - 1) * 0.7));
      }
      const dv = Math.max(-9 * dt, Math.min(4 * dt, target - c.speed));
      c.speed += dv;
      // Suspension: nose dips under braking, squats when pulling away.
      const want = Math.max(-0.05, Math.min(0.04, (-dv / Math.max(dt, 1e-3)) * 0.006));
      c.pitch = (c.pitch ?? 0) + (want - (c.pitch ?? 0)) * Math.min(1, dt * 6);
      c.s += c.speed * c.dir * dt;
      if (c.s > hi) c.s = lo;
      else if (c.s < lo) c.s = hi;

      const x = c.axis === 0 ? c.line + c.laneOffset : c.s;
      const z = c.axis === 0 ? c.s : c.line + c.laneOffset;
      const yaw = c.axis === 0 ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      // Shrink in/out at road ends to hide wrap-around.
      const edge = Math.min(c.s - lo, hi - c.s);
      const sc = Math.min(1, Math.max(0.01, edge / 6));
      const km = this.kinds.get(c.kind)!;
      if (km.n >= km.max) continue;
      this.sc.set(sc, sc, sc);
      Quaternion.RotationYawPitchRollToRef(yaw, c.pitch ?? 0, 0, this.q);
      // Tiny road-surface bounce at speed.
      this.t.set(x, Math.abs(Math.sin(c.s * 0.9)) * 0.015 * Math.min(1, c.speed / 10), z);
      Matrix.ComposeToRef(this.sc, this.q, this.t, this.m);
      this.m.copyToArray(km.matrices, km.n * 16);
      // Keep each vehicle's colour with it.
      if (c.slot !== km.n) {
        const tmp = km.colors.slice(km.n * 4, km.n * 4 + 4);
        km.colors.copyWithin(km.n * 4, c.slot * 4, c.slot * 4 + 4);
        km.colors.set(tmp, c.slot * 4);
        for (const o of this.cars) if (o !== c && o.kind === c.kind && o.slot === km.n) o.slot = c.slot;
        c.slot = km.n;
      }
      km.n++;
    }
    for (const km of this.kinds.values()) {
      for (const p of km.parts) {
        setInstanceCount(p, km.n);
        if (km.n > 0) p.thinInstanceBufferUpdated("matrix");
      }
      if (km.n > 0) km.body.thinInstanceBufferUpdated("color");
    }
  }

  /** Distance to the next stop line ahead, or Infinity. */
  private nextStopLine(c: Car): number {
    // Road lines sit every BLOCK_PITCH metres, so the next one is found directly
    // (the city has well over a thousand lines; no scanning them per car).
    const offset = ROAD_WIDTH / 2 + 3.8;
    const k = c.dir > 0 ? Math.floor((c.s + offset) / BLOCK_PITCH) + 1 : Math.ceil((c.s - offset) / BLOCK_PITCH) - 1;
    if (k < BLOCK_MIN_INDEX || k > BLOCK_MAX_INDEX + 1) return Infinity;
    return (k * BLOCK_PITCH - c.dir * offset - c.s) * c.dir;
  }

}
