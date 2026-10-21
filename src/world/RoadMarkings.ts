import type { GeometryBatch } from "./GeometryBatch";
import type { RGB } from "./CityGenerator";
import { BLOCK_PITCH, ROAD_WIDTH } from "./WorldConfig";

const YELLOW: RGB = [0.95, 0.75, 0.2];
const WHITE: RGB = [0.92, 0.92, 0.9];

/**
 * Lane lines, stop lines and crosswalks for the road segments owned by one
 * chunk. `roads` are road line indices (line k sits at k * BLOCK_PITCH),
 * `segments` are block indices along the road; axis 0 = roads running along Z.
 */
export function addRoadMarkings(b: GeometryBatch, roads: number[], segments: number[], axis: 0 | 1): void {
  const half = ROAD_WIDTH / 2;
  const y = 0.02;
  for (const k of roads) {
    const L = k * BLOCK_PITCH;
    for (const m of segments) {
      const s0 = m * BLOCK_PITCH + half, s1 = (m + 1) * BLOCK_PITCH - half;
      const c0 = s0 + 3.5, c1 = s1 - 3.5;
      {
        const strip = (a: number, w: number, from: number, to: number, col: RGB) =>
          axis === 0 ? b.rect(L + a - w / 2, from, L + a + w / 2, to, y, col) : b.rect(from, L + a - w / 2, to, L + a + w / 2, y, col);
        strip(-0.22, 0.14, c0, c1, YELLOW);
        strip(0.22, 0.14, c0, c1, YELLOW);
        for (let t = c0 + 1; t < c1 - 3; t += 6) {
          strip(-3.75, 0.14, t, t + 3, WHITE);
          strip(3.75, 0.14, t, t + 3, WHITE);
        }
        // Stop lines on the approach side of right-hand traffic.
        const sgn = axis === 0 ? 1 : -1;
        strip((sgn * half) / 2, half, c1 + 0.2, c1 + 0.6, WHITE);
        strip((-sgn * half) / 2, half, c0 - 0.6, c0 - 0.2, WHITE);
        for (let a = -half + 0.8; a < half - 0.5; a += 1.2) {
          strip(a, 0.55, s0 + 0.3, s0 + 3.0, WHITE);
          strip(a, 0.55, s1 - 3.0, s1 - 0.3, WHITE);
        }
      }
    }
  }
}
