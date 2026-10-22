import { describe, it, expect } from "vitest";
import { generateChunk, generateBlock, chunkColliders, skylineFactor, areaName } from "../src/world/CityGenerator";
import { CollisionWorld, rayBox } from "../src/world/Collision";
import { DISTRICT, WATER_Y, ISLAND_MAX, SIDEWALK_HEIGHT, DISTRICT_MAX, DISTRICT_MIN } from "../src/world/WorldConfig";

describe("CityGenerator", () => {
  it("is deterministic per chunk", () => {
    expect(JSON.stringify(generateChunk(0, 0))).toBe(JSON.stringify(generateChunk(0, 0)));
    expect(JSON.stringify(generateChunk(0, 0))).not.toBe(JSON.stringify(generateChunk(1, 0)));
  });

  it("keeps buildings inside their block and above ground", () => {
    const bad: string[] = [];
    let checked = 0;
    // Sample every 7th chunk each way across the whole (huge) district, edges included.
    const along = (k: number) => Math.min(DISTRICT.maxChunk, DISTRICT.minChunk + k * 7);
    for (let a = 0; along(a - 1) < DISTRICT.maxChunk; a++) {
      for (let b = 0; along(b - 1) < DISTRICT.maxChunk; b++) {
        const cx = along(a), cz = along(b);
        for (const block of generateChunk(cx, cz).blocks) {
          for (const b of block.buildings) {
            for (const t of b.tiers) {
              checked++;
              const s = block.slab;
              if (t.minX < s.minX || t.maxX > s.maxX || t.minZ < s.minZ || t.maxZ > s.maxZ || !(t.maxY > t.minY) || t.minY < 0) bad.push(`${cx},${cz}`);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(100000);
  }, 60_000);

  it("registers the landing pad and rooftop props as colliders", () => {
    const w = new CollisionWorld();
    for (const b of chunkColliders(generateChunk(0, 0))) w.add(b);
    // Standing on the Avengers Tower pad (block 0,0 centre is 40,40).
    expect(w.surfaceBelow(36, 200, 34, 0.45)).toBeCloseTo(147.2);
  });

  it("places the hero tower with a landing pad", () => {
    const hero = generateBlock(0, 0);
    expect(hero.kind).toBe("hero");
    expect(Math.max(...hero.colliders.map((c) => c.maxY))).toBeCloseTo(147.2);
  });
});

describe("CollisionWorld", () => {
  const w = new CollisionWorld();
  w.add({ minX: 10, minY: 0, minZ: 10, maxX: 20, maxY: 50, maxZ: 20 });

  it("finds rooftop surfaces below a point", () => {
    expect(w.surfaceBelow(15, 60, 15)).toBe(50);
    expect(w.surfaceBelow(15, 40, 15)).toBe(SIDEWALK_HEIGHT); // roof is above us; block sidewalk below
    expect(w.surfaceBelow(0, 10, 0)).toBe(0);
  });

  it("reports water beyond the island", () => {
    expect(w.isOverWater(ISLAND_MAX + 5, 0)).toBe(true);
    expect(w.terrainHeight(ISLAND_MAX + 5, 0)).toBe(WATER_Y);
  });

  it("ray casts against boxes and ground", () => {
    expect(w.raycast(0, 25, 15, 1, 0, 0, 100)).toBeCloseTo(10);
    expect(w.raycast(0, 10, 0, 0, -1, 0, 100)).toBeCloseTo(10);
    expect(w.raycast(0, 60, 15, 1, 0, 0, 100)).toBe(Infinity);
    expect(rayBox(0, 25, 15, -1, 0, 0, { minX: 10, minY: 0, minZ: 10, maxX: 20, maxY: 50, maxZ: 20 })).toBe(-1);
  });

  it("knows roads from sidewalks analytically", () => {
    expect(w.terrainHeight(0, 40)).toBe(0); // avenue at x = 0
    expect(w.terrainHeight(40, 40)).toBe(SIDEWALK_HEIGHT); // inside block 0,0
    expect(w.terrainHeight(-960, 40)).toBe(0); // avenue far away (roads every 80 m)
    expect(w.terrainHeight(-1000, -1000)).toBe(SIDEWALK_HEIGHT);
  });

  it("covers a huge city (122 km square, ~14,900 km², 50x the old map) with colliders generated lazily", () => {
    expect(DISTRICT_MAX - DISTRICT_MIN).toBeGreaterThanOrEqual(122240);
    expect(((DISTRICT_MAX - DISTRICT_MIN) / 1000) ** 2 / 298.6).toBeGreaterThan(49.9);
    const w = new CollisionWorld();
    w.provider = (cx, cz) => chunkColliders(generateChunk(cx, cz));
    expect(w.chunksLoaded).toBe(0);
    // Querying far out in the city generates just that neighbourhood.
    const roof = w.surfaceBelow(55000, 1000, -55000, 0.5, 0);
    expect(w.chunksLoaded).toBeGreaterThan(0);
    expect(w.chunksLoaded).toBeLessThan(5);
    expect(roof).toBeGreaterThanOrEqual(0);
    // Far chunks can be evicted to bound memory, and come back on demand.
    const before = w.chunksLoaded;
    expect(w.evictFar(0, 0, 1000).length).toBe(before);
    expect(w.chunksLoaded).toBe(0);
    expect(w.surfaceBelow(55000, 1000, -55000, 0.5, 0)).toBe(roof);
    expect(w.chunksLoaded).toBe(before);
    // Still city right up to the edge, and harbour water beyond it.
    expect(w.terrainHeight(DISTRICT_MAX - 30, 0)).toBeGreaterThanOrEqual(0);
    expect(w.terrainHeight(ISLAND_MAX + 50, 0)).toBe(WATER_Y);
  });

  it("spreads named skyscraper clusters across the whole map", () => {
    let tall = 0;
    for (let x = -56000; x <= 56000; x += 14000) {
      for (let z = -56000; z <= 56000; z += 14000) {
        let best = 0;
        for (let dx = -1750; dx <= 1750; dx += 250) for (let dz = -1750; dz <= 1750; dz += 250) best = Math.max(best, skylineFactor(x + dx, z + dz));
        if (best > 0.5) tall++;
      }
    }
    expect(tall).toBeGreaterThan(60); // of 81 sample cells
    // Names are deterministic and exist everywhere, including the far corners.
    expect(areaName(DISTRICT.maxChunk, DISTRICT.minChunk)).toBe(areaName(DISTRICT.maxChunk, DISTRICT.minChunk));
    expect(areaName(DISTRICT.maxChunk, DISTRICT.minChunk).length).toBeGreaterThan(3);
  });

  it("detects overlaps", () => {
    expect(w.overlaps(19, 1, 19, 21, 3, 21)).not.toBeNull();
    expect(w.overlaps(21, 1, 21, 22, 3, 22)).toBeNull();
  });
});
