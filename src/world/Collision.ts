import type { Box } from "./CityGenerator";
import { ISLAND_MIN, ISLAND_MAX, WATER_Y, SIDEWALK_HEIGHT } from "./WorldConfig";

const CELL = 32;

/**
 * Static collision world made of axis-aligned boxes in a uniform spatial hash.
 * Deliberately simple: buildings are boxes, the player is a box, and the ground
 * is a height function. This keeps per-frame cost tiny on mobile.
 */
export class CollisionWorld {
  private cells = new Map<number, Box[]>();
  private slabs: Box[] = [];
  private stamp = 0;
  private marks = new WeakMap<Box, number>();
  readonly boxes: Box[] = [];

  private key(cx: number, cz: number): number {
    return ((cx + 32768) << 16) | (cz + 32768);
  }

  add(b: Box): void {
    this.boxes.push(b);
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(b);
      }
    }
  }

  /** Raised sidewalk slabs - used only by the ground height function. */
  addSlab(b: Box): void {
    this.slabs.push(b);
  }

  /** Visit each box overlapping the XZ rectangle exactly once. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, fn: (b: Box) => void): void {
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.cells.get(this.key(x, z));
        if (!list) continue;
        for (const b of list) {
          if (this.marks.get(b) === s) continue;
          this.marks.set(b, s);
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          fn(b);
        }
      }
    }
  }

  isOverWater(x: number, z: number): boolean {
    return x < ISLAND_MIN || x > ISLAND_MAX || z < ISLAND_MIN || z > ISLAND_MAX;
  }

  /** Height of the terrain (street, sidewalk or water surface) at x,z. */
  terrainHeight(x: number, z: number): number {
    if (this.isOverWater(x, z)) return WATER_Y;
    for (const s of this.slabs) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return SIDEWALK_HEIGHT;
    }
    return 0;
  }

  /**
   * Highest walkable surface under a column of half-width r at (x,z) whose top
   * is at or below `y + stepUp`.
   */
  surfaceBelow(x: number, y: number, z: number, r = 0, stepUp = 0.35): number {
    let h = this.terrainHeight(x, z);
    this.query(x - r, z - r, x + r, z + r, (b) => {
      if (b.maxY <= y + stepUp && b.maxY > h) h = b.maxY;
    });
    return h;
  }

  /** Does the given box overlap any collider? */
  overlaps(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box | null {
    let hit: Box | null = null;
    this.query(minX, minZ, maxX, maxZ, (b) => {
      if (!hit && b.maxY > minY && b.minY < maxY) hit = b;
    });
    return hit;
  }

  /**
   * Ray cast against boxes and the ground. Returns hit distance or Infinity.
   * Direction must be normalised.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, pad = 0): number {
    let best = maxDist;
    // Ground plane (street level or water).
    if (dy < -1e-6) {
      const groundY = this.isOverWater(ox, oz) ? WATER_Y : 0;
      const t = (groundY - oy) / dy;
      if (t >= 0 && t < best) best = t;
    }
    const ex = ox + dx * best, ez = oz + dz * best;
    this.query(Math.min(ox, ex) - pad, Math.min(oz, ez) - pad, Math.max(ox, ex) + pad, Math.max(oz, ez) + pad, (b) => {
      const t = rayBox(ox, oy, oz, dx, dy, dz, b, pad);
      if (t >= 0 && t < best) best = t;
    });
    return best < maxDist ? best : Infinity;
  }
}

/** Slab-method ray/AABB intersection. Returns entry distance or -1. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box, pad = 0): number {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [b.minX - pad, b.minY - pad, b.minZ - pad], mx = [b.maxX + pad, b.maxY + pad, b.maxZ + pad];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < mn[a] || o[a] > mx[a]) return -1;
      continue;
    }
    let t1 = (mn[a] - o[a]) / d[a];
    let t2 = (mx[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}
