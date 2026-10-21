import { describe, it, expect } from "vitest";
import { generateChunk, generateBlock, chunkColliders } from "../src/world/CityGenerator";
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
    for (let cx = DISTRICT.minChunk; cx <= DISTRICT.maxChunk; cx++) {
      for (let cz = DISTRICT.minChunk; cz <= DISTRICT.maxChunk; cz++) {
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

  it("covers a huge city (17.28 km square, ~299 km²) with colliders generated lazily", () => {
    expect(DISTRICT_MAX - DISTRICT_MIN).toBeGreaterThanOrEqual(17280);
    const w = new CollisionWorld();
    w.provider = (cx, cz) => chunkColliders(generateChunk(cx, cz));
    expect(w.chunksLoaded).toBe(0);
    // Querying far out in the city generates just that neighbourhood.
    const roof = w.surfaceBelow(6000, 1000, -6000, 0.5, 0);
    expect(w.chunksLoaded).toBeGreaterThan(0);
    expect(w.chunksLoaded).toBeLessThan(5);
    expect(roof).toBeGreaterThanOrEqual(0);
  });

  it("detects overlaps", () => {
    expect(w.overlaps(19, 1, 19, 21, 3, 21)).not.toBeNull();
    expect(w.overlaps(21, 1, 21, 22, 3, 22)).toBeNull();
  });
});
