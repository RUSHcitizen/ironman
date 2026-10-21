/**
 * World layout constants. The city is a Manhattan-style grid of blocks grouped
 * into square chunks. Chunks are generated deterministically from their
 * coordinates, so the district can grow simply by widening the chunk range.
 */
export const BLOCK_PITCH = 80; // block + one road
export const ROAD_WIDTH = 16;
export const SIDEWALK_WIDTH = 4;
export const SIDEWALK_HEIGHT = 0.15;
export const BLOCK_SIZE = BLOCK_PITCH - ROAD_WIDTH; // 64, includes sidewalk ring
export const CHUNK_BLOCKS = 2;
export const CHUNK_SIZE = BLOCK_PITCH * CHUNK_BLOCKS; // 160

/** Inclusive chunk range of the playable district. Expand to grow the city. */
export const DISTRICT = { minChunk: -2, maxChunk: 1 };

export const DISTRICT_MIN = DISTRICT.minChunk * CHUNK_SIZE; // -320
export const DISTRICT_MAX = (DISTRICT.maxChunk + 1) * CHUNK_SIZE; // 320
/** Promenade margin outside the outermost roads before the shoreline. */
export const ISLAND_MARGIN = ROAD_WIDTH / 2 + 14;
export const ISLAND_MIN = DISTRICT_MIN - ISLAND_MARGIN;
export const ISLAND_MAX = DISTRICT_MAX + ISLAND_MARGIN;
export const WATER_Y = -1.2;
/** Soft boundary - ARIA steers the player back beyond this. */
export const WORLD_LIMIT = 900;
export const ALTITUDE_CEILING = 650;

export const WORLD_SEED = 1939;

export const BLOCK_MIN_INDEX = DISTRICT.minChunk * CHUNK_BLOCKS;
export const BLOCK_MAX_INDEX = (DISTRICT.maxChunk + 1) * CHUNK_BLOCKS - 1;

/** World-space min corner of block (i, j) including its sidewalk ring. */
export function blockOrigin(i: number): number {
  return i * BLOCK_PITCH + ROAD_WIDTH / 2;
}

/** Hero landmark location (block 0,0). */
export const HERO_BLOCK = { i: 0, j: 0 };
