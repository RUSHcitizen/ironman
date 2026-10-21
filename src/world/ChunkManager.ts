import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { GeometryBatch } from "./GeometryBatch";
import { generateChunk, areaName, type ChunkSpec, type RGB } from "./CityGenerator";
import { FACADE_TILE, type WorldMaterials } from "./Materials";
import type { CollisionWorld } from "./Collision";
import type { PropSystem } from "./Props";
import { CHUNK_SIZE, DISTRICT } from "./WorldConfig";

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
 * Owns city chunks: builds their merged meshes, registers colliders and props,
 * and toggles visibility by distance. Generation is deterministic per chunk,
 * so streaming a larger city only requires calling load/unload by radius.
 */
export class ChunkManager {
  private chunks = new Map<string, LoadedChunk>();
  shadowReceivers: Mesh[] = [];

  constructor(
    private scene: Scene,
    private mats: WorldMaterials,
    private world: CollisionWorld,
    private props: PropSystem,
  ) {}

  static key(cx: number, cz: number): string {
    return cx + "," + cz;
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
    const spec = generateChunk(cx, cz);
    const masonry = new GeometryBatch(FACADE_TILE.masonryU, FACADE_TILE.masonryV);
    const glass = new GeometryBatch(FACADE_TILE.glassU, FACADE_TILE.glassV);
    const concrete = new GeometryBatch(8, 8);
    const meshes: Mesh[] = [];
    const props = [];

    for (const block of spec.blocks) {
      const slabColor: RGB = block.kind === "park" ? [0.36, 0.52, 0.27] : SIDEWALK;
      concrete.box(block.slab, slabColor, "world", { top: true, sides: true });
      this.world.addSlab(block.slab);
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
          this.world.add(t);
        }
        for (const t of b.trims) {
          const isTrim = t.maxY - t.minY < 2;
          concrete.box(t, b.style === "hero" ? GOLD : isTrim ? lighten(b.tint) : ROOF, "world", { top: true, sides: true, bottom: isTrim });
        }
      }
      for (const c of block.colliders) this.world.add(c);
      props.push(...block.props);
      if (block.kind === "hero") meshes.push(...this.heroDetails(block.slab));
    }

    for (const [batch, mat, name] of [
      [masonry, this.mats.masonry, "masonry"],
      [glass, this.mats.glass, "glass"],
      [concrete, this.mats.concrete, "concrete"],
    ] as const) {
      const m = batch.build(`chunk_${key}_${name}`, this.scene, mat);
      if (m) {
        meshes.push(m);
        m.receiveShadows = true;
        this.shadowReceivers.push(m);
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
    const ringMat = this.mats.additive("heroRing", new Color3(0.3, 0.85, 1), 0.9);
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
    // Note: colliders are kept; the collision world is rebuilt when streaming lands.
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

function lighten(c: RGB): RGB {
  return [Math.min(1, c[0] * 1.12 + 0.05), Math.min(1, c[1] * 1.12 + 0.05), Math.min(1, c[2] * 1.12 + 0.05)];
}
