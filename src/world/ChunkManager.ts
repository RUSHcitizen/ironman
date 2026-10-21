import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { GeometryBatch } from "./GeometryBatch";
import { generateChunk, areaName, chunkColliders, type ChunkSpec, type RGB, type PropPlacement } from "./CityGenerator";
import { addRoadMarkings } from "./RoadMarkings";
import { FACADE_TILE, type WorldMaterials } from "./Materials";
import type { CollisionWorld } from "./Collision";
import type { PropSystem } from "./Props";
import { CHUNK_SIZE, CHUNK_BLOCKS, DISTRICT } from "./WorldConfig";

interface LoadedChunk {
  key: string;
  spec: ChunkSpec;
  meshes: Mesh[];
  centerX: number;
  centerZ: number;
  visible: boolean;
}

const SIDEWALK: RGB = [0.8, 0.79, 0.76];
const ROOF: RGB = [0.42, 0.42, 0.44];
const GOLD: RGB = [0.9, 0.68, 0.3];

/**
 * Owns city chunks. Layout data and colliders exist for the whole city from
 * the start (cheap), while meshes and props stream in around the camera and
 * are disposed when far away, so memory and draw calls stay bounded however
 * large the city grows.
 */
export class ChunkManager {
  private chunks = new Map<string, LoadedChunk>();
  private specs = new Map<string, ChunkSpec>();
  private scanX = Infinity;
  private scanZ = Infinity;
  private pending = true;
  private ringMat: import("@babylonjs/core/Materials/standardMaterial").StandardMaterial | null = null;

  constructor(
    private scene: Scene,
    private mats: WorldMaterials,
    private world: CollisionWorld,
    private props: PropSystem,
  ) {}

  static key(cx: number, cz: number): string {
    return cx + "," + cz;
  }

  /**
   * Hook the collision world up to lazy per-chunk generation: a chunk's
   * layout and colliders are created the first time anything touches it.
   */
  registerWorld(): void {
    this.world.provider = (cx, cz) => chunkColliders(this.spec(cx, cz));
  }

  /** Forget layouts of far chunks that have no meshes loaded (memory bound). */
  dropSpecs(coords: [number, number][]): void {
    for (const [cx, cz] of coords) {
      const key = ChunkManager.key(cx, cz);
      if (!this.chunks.has(key)) this.specs.delete(key);
    }
  }

  get specCount(): number {
    return this.specs.size;
  }

  /** Cached chunk layout (deterministic, generated on demand). */
  private spec(cx: number, cz: number): ChunkSpec {
    const key = ChunkManager.key(cx, cz);
    let s = this.specs.get(key);
    if (!s) this.specs.set(key, (s = generateChunk(cx, cz)));
    return s;
  }

  /** Synchronously load every chunk within `radius` (used during the loading screen). */
  loadAround(x: number, z: number, radius: number): number {
    let n = 0;
    this.pending = true;
    for (const [cx, cz] of this.chunksNear(x, z, radius)) {
      if (chunkDistance(cx, cz, x, z) < radius && !this.chunks.has(ChunkManager.key(cx, cz))) {
        this.load(cx, cz);
        n++;
      }
    }
    return n;
  }

  /**
   * Stream chunks: load at most `budget` missing chunks (nearest first) inside
   * the view distance and unload chunks well outside it.
   */
  stream(x: number, z: number, viewDistance: number, budget = 1): void {
    // Rescan only after moving a bit, or while loads are still pending.
    if (!this.pending && Math.hypot(x - this.scanX, z - this.scanZ) < 24) return;
    this.scanX = x;
    this.scanZ = z;
    let missing: [number, number, number][] = [];
    for (const [cx, cz] of this.chunksNear(x, z, viewDistance)) {
      const d = chunkDistance(cx, cz, x, z);
      if (d < viewDistance && !this.chunks.has(ChunkManager.key(cx, cz))) missing.push([d, cx, cz]);
    }
    for (const c of [...this.chunks.values()]) {
      if (Math.hypot(c.centerX - x, c.centerZ - z) - CHUNK_SIZE * 0.71 > viewDistance + 260) {
        this.unload(Math.floor(c.centerX / CHUNK_SIZE), Math.floor(c.centerZ / CHUNK_SIZE));
      }
    }
    this.pending = missing.length > budget;
    missing = missing.sort((a, b) => a[0] - b[0]).slice(0, budget);
    for (const [, cx, cz] of missing) this.load(cx, cz);
  }

  /** District chunks within `radius` (plus a margin) of a point. */
  chunksNear(x: number, z: number, radius: number): [number, number][] {
    const r = Math.ceil(radius / CHUNK_SIZE) + 1;
    const ccx = Math.floor(x / CHUNK_SIZE), ccz = Math.floor(z / CHUNK_SIZE);
    const out: [number, number][] = [];
    for (let cx = Math.max(DISTRICT.minChunk, ccx - r); cx <= Math.min(DISTRICT.maxChunk, ccx + r); cx++) {
      for (let cz = Math.max(DISTRICT.minChunk, ccz - r); cz <= Math.min(DISTRICT.maxChunk, ccz + r); cz++) out.push([cx, cz]);
    }
    return out;
  }

  /** All chunk coordinates of the current district. */
  districtChunks(): [number, number][] {
    const out: [number, number][] = [];
    for (let cx = DISTRICT.minChunk; cx <= DISTRICT.maxChunk; cx++) for (let cz = DISTRICT.minChunk; cz <= DISTRICT.maxChunk; cz++) out.push([cx, cz]);
    return out;
  }

  areaAt(x: number, z: number): string {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    if (cx < DISTRICT.minChunk || cx > DISTRICT.maxChunk || cz < DISTRICT.minChunk || cz > DISTRICT.maxChunk) return "Upper Bay";
    return areaName(cx, cz);
  }

  load(cx: number, cz: number): void {
    const key = ChunkManager.key(cx, cz);
    if (this.chunks.has(key)) return;
    const spec = this.spec(cx, cz);
    const masonry = new GeometryBatch(FACADE_TILE.masonryU, FACADE_TILE.masonryV);
    const glass = new GeometryBatch(FACADE_TILE.glassU, FACADE_TILE.glassV);
    const concrete = new GeometryBatch(8, 8);
    const markings = new GeometryBatch(1, 1);
    const meshes: Mesh[] = [];
    const props: PropPlacement[] = [];

    for (const block of spec.blocks) {
      const slabColor: RGB = block.kind === "park" ? [0.36, 0.52, 0.27] : SIDEWALK;
      concrete.box(block.slab, slabColor, "world", { top: true, sides: true });
      if (block.kind === "park") {
        // Paved path ring around the lawn.
        const s = block.slab;
        const w = 4;
        for (const r of [
          { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.minZ + w },
          { minX: s.minX, maxX: s.maxX, minZ: s.maxZ - w, maxZ: s.maxZ },
          { minX: s.minX, maxX: s.minX + w, minZ: s.minZ, maxZ: s.maxZ },
          { minX: s.maxX - w, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ },
        ]) concrete.rect(r.minX, r.minZ, r.maxX, r.maxZ, s.maxY + 0.01, SIDEWALK);
      }

      for (const b of block.buildings) {
        const batch = b.style === "masonry" ? masonry : glass;
        for (const t of b.tiers) {
          batch.box(t, b.tint, "facade", { sides: true });
          concrete.box(t, ROOF, "world", { top: true, sides: false });
        }
        for (const t of b.trims) {
          const isTrim = t.maxY - t.minY < 2;
          concrete.box(t, b.style === "hero" ? GOLD : isTrim ? lighten(b.tint) : ROOF, "world", { top: true, sides: true, bottom: isTrim });
        }
      }
      props.push(...block.props);
      if (block.kind === "hero") meshes.push(...this.heroDetails(block.slab));
    }

    // Road markings for the road lines/segments this chunk owns.
    const own = (c: number) => {
      const r: number[] = [];
      for (let k = 0; k < CHUNK_BLOCKS; k++) r.push(c * CHUNK_BLOCKS + k);
      if (c === DISTRICT.maxChunk) r.push((c + 1) * CHUNK_BLOCKS);
      return r;
    };
    const segs = (c: number) => Array.from({ length: CHUNK_BLOCKS }, (_, k) => c * CHUNK_BLOCKS + k);
    // Roads along Z (x = line) owned by cx, segments along cz; and vice versa.
    addRoadMarkings(markings, own(cx), segs(cz), 0);
    addRoadMarkings(markings, own(cz), segs(cx), 1);

    for (const [batch, mat, name] of [
      [masonry, this.mats.masonry, "masonry"],
      [glass, this.mats.glass, "glass"],
      [concrete, this.mats.concrete, "concrete"],
      [markings, this.mats.markings, "markings"],
    ] as const) {
      const m = batch.build(`chunk_${key}_${name}`, this.scene, mat);
      if (m) {
        meshes.push(m);
        m.receiveShadows = true;
      }
    }

    const centerX = (cx + 0.5) * CHUNK_SIZE;
    const centerZ = (cz + 0.5) * CHUNK_SIZE;
    this.props.addChunk(key, centerX, centerZ, props);
    this.chunks.set(key, { key, spec, meshes, centerX, centerZ, visible: true });
  }

  /** Landing pad and glowing rings on the hero landmark. */
  private heroDetails(slab: { minX: number; maxX: number; minZ: number; maxZ: number }): Mesh[] {
    const cx = (slab.minX + slab.maxX) / 2, cz = (slab.minZ + slab.maxZ) / 2;
    const pad = CreateCylinder("heroPad", { diameter: 30, height: 1.2, tessellation: 32 }, this.scene);
    pad.position.set(cx, 146.6, cz);
    pad.material = this.mats.concrete;
    const ringMat = (this.ringMat ??= this.mats.additive("heroRing", new Color3(0.3, 0.85, 1), 0.9));
    const ring = CreateTorus("heroRing", { diameter: 26, thickness: 0.35, tessellation: 28 }, this.scene);
    ring.position.set(cx, 147.25, cz);
    ring.material = ringMat;
    const crown = CreateTorus("heroCrown", { diameter: 36, thickness: 0.6, tessellation: 28 }, this.scene);
    crown.position.set(cx, 131.9, cz);
    crown.material = ringMat;
    for (const m of [pad, ring, crown]) {
      m.isPickable = false;
      m.freezeWorldMatrix();
    }
    return [pad, ring, crown];
  }

  unload(cx: number, cz: number): void {
    const key = ChunkManager.key(cx, cz);
    const c = this.chunks.get(key);
    if (!c) return;
    for (const m of c.meshes) m.dispose();
    this.props.removeChunk(key);
    this.chunks.delete(key);
  }

  updateVisibility(camX: number, camZ: number, viewDistance: number): void {
    const half = CHUNK_SIZE * 0.71;
    for (const c of this.chunks.values()) {
      const vis = Math.hypot(c.centerX - camX, c.centerZ - camZ) - half < viewDistance;
      if (vis !== c.visible) {
        c.visible = vis;
        for (const m of c.meshes) m.setEnabled(vis);
      }
    }
  }

  get count(): number {
    return this.chunks.size;
  }
}

function chunkDistance(cx: number, cz: number, x: number, z: number): number {
  return Math.hypot((cx + 0.5) * CHUNK_SIZE - x, (cz + 0.5) * CHUNK_SIZE - z) - CHUNK_SIZE * 0.71;
}

function lighten(c: RGB): RGB {
  return [Math.min(1, c[0] * 1.12 + 0.05), Math.min(1, c[1] * 1.12 + 0.05), Math.min(1, c[2] * 1.12 + 0.05)];
}
