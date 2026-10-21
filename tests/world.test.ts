import { describe, it, expect } from "vitest";
import { generateChunk, generateBlock } from "../src/world/CityGenerator";
import { CollisionWorld, rayBox } from "../src/world/Collision";
import { DISTRICT, WATER_Y, ISLAND_MAX } from "../src/world/WorldConfig";

describe("CityGenerator", () => {
  it("is deterministic per chunk", () => {
    expect(JSON.stringify(generateChunk(0, 0))).toBe(JSON.stringify(generateChunk(0, 0)));
    expect(JSON.stringify(generateChunk(0, 0))).not.toBe(JSON.stringify(generateChunk(1, 0)));
  });

  it("keeps buildings inside their block and above ground", () => {
    for (let cx = DISTRICT.minChunk; cx <= DISTRICT.maxChunk; cx++) {
      for (let cz = DISTRICT.minChunk; cz <= DISTRICT.maxChunk; cz++) {
        for (const block of generateChunk(cx, cz).blocks) {
          for (const b of block.buildings) {
            for (const t of b.tiers) {
              expect(t.minX).toBeGreaterThanOrEqual(block.slab.minX);
              expect(t.maxX).toBeLessThanOrEqual(block.slab.maxX);
              expect(t.minZ).toBeGreaterThanOrEqual(block.slab.minZ);
              expect(t.maxZ).toBeLessThanOrEqual(block.slab.maxZ);
              expect(t.maxY).toBeGreaterThan(t.minY);
              expect(t.minY).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
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
    expect(w.surfaceBelow(15, 40, 15)).toBe(0); // inside: roof is above us
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

  it("detects overlaps", () => {
    expect(w.overlaps(19, 1, 19, 21, 3, 21)).not.toBeNull();
    expect(w.overlaps(21, 1, 21, 22, 3, 22)).toBeNull();
  });
});
