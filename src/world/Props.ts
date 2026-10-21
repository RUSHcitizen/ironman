import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Material } from "@babylonjs/core/Materials/material";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { ProcGeo } from "./ProcGeo";
import type { PropPlacement, PropType } from "./CityGenerator";
import type { WorldMaterials } from "./Materials";

interface PropDef {
  parts: Mesh[];
  /** Large rooftop silhouettes stay visible to the full view distance. */
  far: boolean;
  /** Per-instance colour buffer (traffic signal lamps). */
  signal?: Mesh;
}

interface ChunkProps {
  cx: number;
  cz: number;
  /** Per-type packed 4x4 matrices. */
  matrices: Map<PropType, Float32Array>;
}

const DARK: [number, number, number] = [0.16, 0.17, 0.19];

/**
 * Street furniture & rooftop props rendered with thin instances: one draw call
 * per prop part regardless of count. Instance buffers are rebuilt from the
 * chunks near the camera only when the camera has moved meaningfully.
 */
export class PropSystem {
  private defs = new Map<PropType, PropDef>();
  private chunks = new Map<string, ChunkProps>();
  private lastX = Infinity;
  private lastZ = Infinity;
  private dirty = true;
  private signalPhase = 0;
  private signalAxes: Uint8Array = new Uint8Array(0);
  readonly beaconParts: Mesh[] = [];

  constructor(
    scene: Scene,
    private mats: WorldMaterials,
  ) {
    const g = new ProcGeo(scene);
    const lit = (name: string, parts: Mesh[]) => this.instanced(g.merge(name, parts), mats.propLit);
    const glow = (name: string, parts: Mesh[], mat: Material = mats.propGlow) => this.instanced(g.merge(name, parts), mat);

    this.defs.set("streetlight", {
      far: false,
      parts: [
        lit("streetlight", [g.cyl(0.09, 0.14, 7.6, DARK, 0, 3.8, 0, 8), g.box(0.1, 0.1, 2.1, DARK, 0, 7.5, 1.0), g.box(0.5, 0.2, 0.9, DARK, 0, 7.4, 2.0)]),
        glow("streetlightGlow", [g.box(0.38, 0.05, 0.7, [1, 0.86, 0.6], 0, 7.28, 2.0)]),
      ],
    });
    const signal = glow("signalLamp", [g.box(0.32, 0.32, 0.46, [1, 1, 1], 0, 4.6, 3.1)]);
    this.defs.set("trafficLight", {
      far: false,
      signal,
      parts: [lit("trafficLight", [g.cyl(0.12, 0.14, 5.5, DARK, 0, 2.75, 0, 8), g.box(0.12, 0.12, 3.3, DARK, 0, 5.3, 1.6), g.box(0.44, 1.15, 0.4, [0.3, 0.26, 0.1], 0, 4.75, 3.1)]), signal],
    });
    const wood: [number, number, number] = [0.47, 0.31, 0.18];
    this.defs.set("bench", {
      far: false,
      parts: [lit("bench", [g.box(1.8, 0.08, 0.5, wood, 0, 0.46, 0), g.box(1.8, 0.42, 0.06, wood, 0, 0.78, -0.24), g.box(0.08, 0.46, 0.45, DARK, -0.8, 0.23, 0), g.box(0.08, 0.46, 0.45, DARK, 0.8, 0.23, 0)])],
    });
    this.defs.set("hydrant", {
      far: false,
      parts: [lit("hydrant", [g.cyl(0.16, 0.19, 0.62, [0.78, 0.14, 0.08], 0, 0.31, 0, 8), g.sphere(0.17, [0.8, 0.62, 0.15], 0, 0.64, 0, 4), g.box(0.5, 0.11, 0.11, [0.78, 0.14, 0.08], 0, 0.42, 0)])],
    });
    this.defs.set("trashcan", {
      far: false,
      parts: [lit("trashcan", [g.cyl(0.3, 0.26, 0.95, [0.12, 0.27, 0.17], 0, 0.48, 0, 10), g.cyl(0.33, 0.33, 0.06, DARK, 0, 0.97, 0, 10)])],
    });
    this.defs.set("tree", {
      far: false,
      parts: [lit("tree", [g.cyl(0.14, 0.24, 3.2, [0.36, 0.26, 0.18], 0, 1.6, 0, 7), g.ico(2.1, [0.22, 0.42, 0.18], 0, 4.4, 0, 1.1), g.ico(1.4, [0.3, 0.5, 0.2], 0.7, 5.6, -0.4)])],
    });
    const tank: [number, number, number] = [0.43, 0.3, 0.2];
    this.defs.set("waterTower", {
      far: true,
      parts: [
        lit("waterTower", [
          g.box(0.25, 4, 0.25, DARK, -1.7, 2, -1.7),
          g.box(0.25, 4, 0.25, DARK, 1.7, 2, -1.7),
          g.box(0.25, 4, 0.25, DARK, -1.7, 2, 1.7),
          g.box(0.25, 4, 0.25, DARK, 1.7, 2, 1.7),
          g.cyl(2.7, 2.7, 0.25, DARK, 0, 4.1, 0, 12),
          g.cyl(2.45, 2.5, 4.6, tank, 0, 6.5, 0, 14),
          g.cyl(2.52, 2.52, 0.12, DARK, 0, 5.4, 0, 14),
          g.cyl(2.52, 2.52, 0.12, DARK, 0, 7.6, 0, 14),
          g.cyl(0, 2.7, 1.6, [0.27, 0.23, 0.21], 0, 9.6, 0, 14),
        ]),
      ],
    });
    this.defs.set("acUnit", {
      far: true,
      parts: [lit("acUnit", [g.box(2.4, 1.3, 1.6, [0.6, 0.61, 0.63], 0, 0.65, 0), g.cyl(0.5, 0.5, 0.1, DARK, 0, 1.33, 0, 10)])],
    });
    const tip = glow("antennaTip", [g.sphere(0.4, [1, 1, 1], 0, 14.2, 0, 4)], mats.beacon);
    this.beaconParts.push(tip);
    this.defs.set("antenna", {
      far: true,
      parts: [lit("antenna", [g.cyl(0.08, 0.2, 14, [0.35, 0.36, 0.38], 0, 7, 0, 6), g.box(2.2, 0.08, 0.08, [0.35, 0.36, 0.38], 0, 9, 0), g.box(1.4, 0.08, 0.08, [0.35, 0.36, 0.38], 0, 11.5, 0)]), tip],
    });
    const stone: [number, number, number] = [0.72, 0.7, 0.64];
    this.defs.set("fountain", {
      far: false,
      parts: [
        lit("fountain", [g.cyl(6, 6.2, 0.9, stone, 0, 0.45, 0, 24), g.cyl(0.6, 0.8, 2.4, stone, 0, 1.2, 0, 10), g.cyl(1.8, 0.6, 0.4, stone, 0, 2.5, 0, 14)]),
        glow("fountainWater", [g.cyl(5.6, 5.6, 0.06, [0.32, 0.55, 0.68], 0, 0.86, 0, 24), g.cyl(1.6, 1.6, 0.05, [0.5, 0.75, 0.85], 0, 2.71, 0, 14)]),
      ],
    });
  }

  private instanced(mesh: Mesh, mat: Material): Mesh {
    mesh.material = mat;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.thinInstanceSetBuffer("matrix", new Float32Array(16), 16, false);
    mesh.thinInstanceCount = 0;
    return mesh;
  }

  addChunk(key: string, cx: number, cz: number, props: PropPlacement[]): void {
    const grouped = new Map<PropType, PropPlacement[]>();
    for (const p of props) {
      let list = grouped.get(p.type);
      if (!list) grouped.set(p.type, (list = []));
      list.push(p);
    }
    const matrices = new Map<PropType, Float32Array>();
    const m = new Matrix();
    const q = new Quaternion();
    const s = new Vector3();
    const t = new Vector3();
    for (const [type, list] of grouped) {
      const arr = new Float32Array(list.length * 16);
      list.forEach((p, k) => {
        Quaternion.RotationYawPitchRollToRef(p.yaw, 0, 0, q);
        s.set(p.scale, p.scale, p.scale);
        t.set(p.x, p.y, p.z);
        Matrix.ComposeToRef(s, q, t, m);
        m.copyToArray(arr, k * 16);
      });
      matrices.set(type, arr);
    }
    this.chunks.set(key, { cx, cz, matrices });
    this.dirty = true;
  }

  removeChunk(key: string): void {
    if (this.chunks.delete(key)) this.dirty = true;
  }

  setSignalPhase(phase: number): void {
    if (phase === this.signalPhase) return;
    this.signalPhase = phase;
    this.applySignalColors();
  }

  /** Rebuild instance buffers for chunks within range of the camera. */
  update(camX: number, camZ: number, nearDist: number, farDist: number, chunkSize: number): void {
    if (!this.dirty && Math.hypot(camX - this.lastX, camZ - this.lastZ) < 12) return;
    this.dirty = false;
    this.lastX = camX;
    this.lastZ = camZ;
    const half = chunkSize / 2;
    for (const [type, def] of this.defs) {
      const limit = (def.far ? farDist : nearDist) + half * 1.42;
      const lists: Float32Array[] = [];
      let total = 0;
      for (const c of this.chunks.values()) {
        const arr = c.matrices.get(type);
        if (!arr) continue;
        if (Math.hypot(c.cx - camX, c.cz - camZ) > limit) continue;
        lists.push(arr);
        total += arr.length;
      }
      const buf = new Float32Array(Math.max(16, total));
      let o = 0;
      for (const a of lists) {
        buf.set(a, o);
        o += a.length;
      }
      for (const mesh of def.parts) {
        mesh.thinInstanceSetBuffer("matrix", buf, 16, false);
        mesh.thinInstanceCount = total / 16;
      }
      if (def.signal) {
        this.signalAxes = new Uint8Array(total / 16);
        for (let k = 0; k < this.signalAxes.length; k++) this.signalAxes[k] = k & 1;
        this.applySignalColors();
      }
    }
  }

  private applySignalColors(): void {
    const mesh = this.defs.get("trafficLight")?.signal;
    if (!mesh) return;
    const n = this.signalAxes.length;
    const col = new Float32Array(Math.max(4, n * 4));
    for (let k = 0; k < n; k++) {
      const green = this.signalAxes[k] === this.signalPhase;
      col.set(green ? [0.2, 1, 0.45, 1] : [1, 0.16, 0.08, 1], k * 4);
    }
    mesh.thinInstanceSetBuffer("color", col, 4, false);
  }

  setBeaconOn(on: boolean): void {
    this.mats.beacon.emissiveColor.set(on ? 1 : 0.15, on ? 0.12 : 0.02, on ? 0.08 : 0.02);
  }

  get scenePropCount(): number {
    let n = 0;
    for (const d of this.defs.values()) n += d.parts[0].thinInstanceCount;
    return n;
  }

  dispose(): void {
    for (const d of this.defs.values()) for (const p of d.parts) p.dispose();
  }
}
