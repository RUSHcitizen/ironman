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

  /** Generate layout data and register colliders for every chunk. */
  registerWorld(): void {
    for (const [cx, cz] of this.districtChunks()) {
      const spec = generateChunk(cx, cz);
      this.specs.set(ChunkManager.key(cx, cz), spec);
      for (const b of chunkColliders(spec)) this.world.add(b);
    }
  }

  /** Synchronously load every chunk within `radius` (used during the loading screen). */
  loadAround(x: number, z: number, radius: number): number {
    let n = 0;
    for (const [cx, cz] of this.districtChunks()) {
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
    let missing: [number, number, number][] = [];
    for (const [cx, cz] of this.districtChunks()) {
      const d = chunkDistance(cx, cz, x, z);
      const key = ChunkManager.key(cx, cz);
      if (d < viewDistance && !this.chunks.has(key)) missing.push([d, cx, cz]);
      else if (d > viewDistance + 260 && this.chunks.has(key)) this.unload(cx, cz);
    }
    missing = missing.sort((a, b) => a[0] - b[0]).slice(0, budget);
    for (const [, cx, cz] of missing) this.load(cx, cz);
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
    const spec = this.specs.get(key) ?? generateChunk(cx, cz);
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
