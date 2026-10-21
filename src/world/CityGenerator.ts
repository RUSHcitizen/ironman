import { Rng, hashSeed, clamp, lerp } from "../core/math";
import {
  BLOCK_PITCH,
  BLOCK_SIZE,
  CHUNK_BLOCKS,
  SIDEWALK_WIDTH,
  SIDEWALK_HEIGHT,
  WORLD_SEED,
  HERO_BLOCK,
  DISTRICT,
  blockOrigin,
} from "./WorldConfig";

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export type BuildingStyle = "masonry" | "glass" | "hero";
export type RGB = [number, number, number];

export interface BuildingSpec {
  style: BuildingStyle;
  tint: RGB;
  tiers: Box[];
  /** Decorative bands (cornices / crowns), rendered but not collidable. */
  trims: Box[];
}

export type PropType =
  | "streetlight"
  | "trafficLight"
  | "bench"
  | "hydrant"
  | "trashcan"
  | "tree"
  | "waterTower"
  | "acUnit"
  | "antenna"
  | "fountain";

export interface PropPlacement {
  type: PropType;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export type BlockKind = "buildings" | "park" | "plaza" | "hero";

export interface BlockSpec {
  i: number;
  j: number;
  kind: BlockKind;
  /** Sidewalk / ground slab footprint. */
  slab: Box;
  buildings: BuildingSpec[];
  props: PropPlacement[];
  /** Extra collidable boxes that are not buildings (water towers, pads...). */
  colliders: Box[];
  name: string;
}

export interface ChunkSpec {
  cx: number;
  cz: number;
  blocks: BlockSpec[];
}

const MASONRY_TINTS: RGB[] = [
  [0.86, 0.8, 0.7],
  [0.66, 0.36, 0.27],
  [0.55, 0.42, 0.33],
  [0.92, 0.88, 0.78],
  [0.62, 0.62, 0.64],
  [0.74, 0.58, 0.44],
];
const GLASS_TINTS: RGB[] = [
  [0.55, 0.72, 0.9],
  [0.5, 0.78, 0.78],
  [0.42, 0.48, 0.6],
  [0.78, 0.66, 0.5],
  [0.62, 0.7, 0.78],
];

const AREA_NAMES = [
  "Inwood Heights", "Harlem Rise", "Morningside", "Yorkville", "Spanish Harbor",
  "Hudson Yards", "Northpark West", "Northpark", "Lenox Hill", "East River Gate",
  "Hell's Point", "Theatre Row", "Midtown Core", "Bryant Commons", "Murray Rise",
  "Chelsea Steps", "Flatiron Wedge", "Union Square", "Gramercy Gate", "Stuy Town",
  "Village Bend", "SoHo Lofts", "Financial Spire", "Bowery Line", "East Docks",
];

const REGION_CHUNKS = 2;

/** District name for a chunk (regions of 2x2 chunks, 5x5 regions). */
export function areaName(cx: number, cz: number): string {
  const n = Math.round(Math.sqrt(AREA_NAMES.length));
  const rx = clampInt(Math.floor((cx - DISTRICT.minChunk) / REGION_CHUNKS), 0, n - 1);
  const rz = clampInt(Math.floor((cz - DISTRICT.minChunk) / REGION_CHUNKS), 0, n - 1);
  return AREA_NAMES[(n - 1 - rz) * n + rx];
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Big central park footprint in block indices (inclusive). */
export const BIG_PARK = { i0: -9, i1: -6, j0: 4, j1: 10 };

/** Skyscraper density 0..1: a midtown core and a taller downtown core. */
export function skylineFactor(x: number, z: number): number {
  const midtown = 1 - Math.hypot(x - 20, z - 150) / 720;
  const downtown = (1 - Math.hypot(x - 260, z + 1080) / 520) * 1.15;
  return clamp(Math.max(midtown, downtown, 0), 0, 1.15);
}

export function blockKind(i: number, j: number): BlockKind {
  if (i === HERO_BLOCK.i && j === HERO_BLOCK.j) return "hero";
  if (i === -1 && j === 0) return "plaza";
  if (i >= BIG_PARK.i0 && i <= BIG_PARK.i1 && j >= BIG_PARK.j0 && j <= BIG_PARK.j1) return "park";
  const r = hashSeed(WORLD_SEED + 7, i, j) / 4294967296;
  if (r < 0.035) return "park";
  if (r < 0.06) return "plaza";
  return "buildings";
}

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function generateChunk(cx: number, cz: number): ChunkSpec {
  const blocks: BlockSpec[] = [];
  for (let bi = 0; bi < CHUNK_BLOCKS; bi++) {
    for (let bj = 0; bj < CHUNK_BLOCKS; bj++) {
      const i = cx * CHUNK_BLOCKS + bi;
      const j = cz * CHUNK_BLOCKS + bj;
      blocks.push(generateBlock(i, j, areaName(cx, cz)));
    }
  }
  return { cx, cz, blocks };
}

export function generateBlock(i: number, j: number, name = ""): BlockSpec {
  const rng = new Rng(hashSeed(WORLD_SEED, i, j));
  const x0 = blockOrigin(i);
  const z0 = blockOrigin(j);
  const kind = blockKind(i, j);
  const spec: BlockSpec = {
    i,
    j,
    kind,
    slab: box(x0, 0, z0, x0 + BLOCK_SIZE, SIDEWALK_HEIGHT, z0 + BLOCK_SIZE),
    buildings: [],
    props: [],
    colliders: [],
    name,
  };

  addStreetFurniture(spec, rng, x0, z0);

  const lx0 = x0 + SIDEWALK_WIDTH + 2;
  const lz0 = z0 + SIDEWALK_WIDTH + 2;
  const lot = BLOCK_SIZE - 2 * (SIDEWALK_WIDTH + 2); // 52

  if (kind === "hero") {
    addHeroTower(spec, x0 + BLOCK_SIZE / 2, z0 + BLOCK_SIZE / 2);
  } else if (kind === "park" || kind === "plaza") {
    addOpenSpace(spec, rng, lx0, lz0, lot, kind);
  } else {
    // Taller buildings towards the district core (midtown feel).
    const cxw = x0 + BLOCK_SIZE / 2;
    const czw = z0 + BLOCK_SIZE / 2;
    const core = skylineFactor(cxw, czw);
    for (const p of splitLot(rng, lx0, lz0, lot)) addBuilding(spec, rng, p, core);
  }
  return spec;
}

interface Parcel {
  x: number;
  z: number;
  w: number;
  d: number;
}

function splitLot(rng: Rng, x: number, z: number, s: number): Parcel[] {
  const gap = 2;
  const h = (s - gap) / 2;
  const r = rng.next();
  if (r < 0.22) return [{ x, z, w: s, d: s }];
  if (r < 0.5) {
    return rng.chance(0.5)
      ? [{ x, z, w: h, d: s }, { x: x + h + gap, z, w: h, d: s }]
      : [{ x, z, w: s, d: h }, { x, z: z + h + gap, w: s, d: h }];
  }
  if (r < 0.75) {
    return [
      { x, z, w: h, d: s },
      { x: x + h + gap, z, w: h, d: h },
      { x: x + h + gap, z: z + h + gap, w: h, d: h },
    ];
  }
  return [
    { x, z, w: h, d: h },
    { x: x + h + gap, z, w: h, d: h },
    { x, z: z + h + gap, w: h, d: h },
    { x: x + h + gap, z: z + h + gap, w: h, d: h },
  ];
}

function addBuilding(spec: BlockSpec, rng: Rng, p: Parcel, core: number): void {
  const inset = rng.range(0, 1.5);
  let minX = p.x + inset;
  let minZ = p.z + inset;
  let maxX = p.x + p.w - inset;
  let maxZ = p.z + p.d - inset;
  const footprint = Math.min(maxX - minX, maxZ - minZ);
  const tallness = rng.next() * core;
  let height = lerp(12, 40, rng.next()) + tallness * tallness * 210 + core * 30;
  if (footprint < 22) height = Math.min(height, 70 + rng.range(0, 30));
  height = Math.round(height / 3.6) * 3.6; // whole floors

  const glass = height > 70 ? rng.chance(0.6) : rng.chance(0.15);
  const style: BuildingStyle = glass ? "glass" : "masonry";
  const tint = glass ? rng.pick(GLASS_TINTS) : rng.pick(MASONRY_TINTS);
  const b: BuildingSpec = { style, tint, tiers: [], trims: [] };

  const tierCount = style === "masonry" ? (height > 110 ? 3 : height > 60 ? 2 : 1) : height > 90 && rng.chance(0.5) ? 2 : 1;
  let y = 0;
  for (let t = 0; t < tierCount; t++) {
    const frac = tierCount === 1 ? 1 : t === 0 ? rng.range(0.45, 0.62) : t === tierCount - 1 ? 1 : rng.range(0.6, 0.8);
    const top = t === tierCount - 1 ? height : Math.round(lerp(y, height, frac) / 3.6) * 3.6;
    if (top - y < 7) continue;
    b.tiers.push(box(minX, y, minZ, maxX, top, maxZ));
    if (style === "masonry") b.trims.push(box(minX - 0.45, top - 0.9, minZ - 0.45, maxX + 0.45, top + 0.35, maxZ + 0.45));
    y = top;
    const step = rng.range(2.5, 5);
    if (maxX - minX - 2 * step < 10 || maxZ - minZ - 2 * step < 10) break;
    minX += step;
    minZ += step;
    maxX -= step;
    maxZ -= step;
  }
  if (b.tiers.length === 0) return;
  const top = b.tiers[b.tiers.length - 1];

  // Glass towers get a slimmer mechanical crown.
  if (style === "glass" && rng.chance(0.55)) {
    const s = rng.range(3, 6);
    if (top.maxX - top.minX > 2 * s + 6 && top.maxZ - top.minZ > 2 * s + 6) {
      const crown = box(top.minX + s, top.maxY, top.minZ + s, top.maxX - s, top.maxY + rng.range(5, 12), top.maxZ - s);
      b.trims.push(crown);
      spec.colliders.push(crown);
    }
  }
  spec.buildings.push(b);
  addRooftopProps(spec, rng, top, style);
}

function addRooftopProps(spec: BlockSpec, rng: Rng, top: Box, style: BuildingStyle): void {
  const w = top.maxX - top.minX;
  const d = top.maxZ - top.minZ;
  const y = top.maxY;
  if (style === "masonry" && y < 95 && w > 12 && d > 12 && rng.chance(0.55)) {
    const x = rng.range(top.minX + 4, top.maxX - 4);
    const z = rng.range(top.minZ + 4, top.maxZ - 4);
    const s = rng.range(0.85, 1.15);
    spec.props.push({ type: "waterTower", x, y, z, yaw: rng.range(0, Math.PI), scale: s });
    spec.colliders.push(box(x - 2.6 * s, y, z - 2.6 * s, x + 2.6 * s, y + 9.5 * s, z + 2.6 * s));
  }
  const ac = rng.int(0, Math.min(4, Math.floor((w * d) / 120)));
  for (let k = 0; k < ac; k++) {
    spec.props.push({
      type: "acUnit",
      x: rng.range(top.minX + 2, top.maxX - 2),
      y,
      z: rng.range(top.minZ + 2, top.maxZ - 2),
      yaw: rng.chance(0.5) ? 0 : Math.PI / 2,
      scale: rng.range(0.8, 1.3),
    });
  }
  if (y > 120 && rng.chance(0.7)) {
    spec.props.push({ type: "antenna", x: (top.minX + top.maxX) / 2, y, z: (top.minZ + top.maxZ) / 2, yaw: 0, scale: rng.range(0.8, 1.4) });
  }
}

function addHeroTower(spec: BlockSpec, cx: number, cz: number): void {
  const b: BuildingSpec = { style: "hero", tint: [0.72, 0.82, 0.95], tiers: [], trims: [] };
  b.tiers.push(box(cx - 24, 0, cz - 24, cx + 24, 18, cz + 24));
  b.tiers.push(box(cx - 17, 18, cz - 17, cx + 17, 132, cz + 17));
  b.tiers.push(box(cx - 13, 132, cz - 13, cx + 13, 146, cz + 13));
  b.trims.push(box(cx - 24.6, 17.2, cz - 24.6, cx + 24.6, 18.6, cz + 24.6));
  b.trims.push(box(cx - 17.6, 131.2, cz - 17.6, cx + 17.6, 132.6, cz + 17.6));
  spec.buildings.push(b);
  // Cantilevered landing pad on the roof.
  spec.colliders.push(box(cx - 15, 146, cz - 15, cx + 15, 147.2, cz + 15));
  spec.props.push({ type: "antenna", x: cx - 10, y: 147.2, z: cz + 10, yaw: 0, scale: 1.6 });
}

function addOpenSpace(spec: BlockSpec, rng: Rng, x: number, z: number, s: number, kind: BlockKind): void {
  const c = s / 2;
  if (kind === "plaza") {
    spec.props.push({ type: "fountain", x: x + c, y: SIDEWALK_HEIGHT, z: z + c, yaw: 0, scale: 1 });
    spec.colliders.push(box(x + c - 6, 0, z + c - 6, x + c + 6, 1.1, z + c + 6));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      spec.props.push({ type: "tree", x: x + c + Math.cos(a) * 19, y: SIDEWALK_HEIGHT, z: z + c + Math.sin(a) * 19, yaw: a, scale: rng.range(0.9, 1.2) });
      spec.props.push({ type: "bench", x: x + c + Math.cos(a + 0.39) * 12, y: SIDEWALK_HEIGHT, z: z + c + Math.sin(a + 0.39) * 12, yaw: -a - 0.39 + Math.PI / 2, scale: 1 });
    }
    return;
  }
  // Park: scattered trees with a cross path left open.
  for (let k = 0; k < 34; k++) {
    const px = rng.range(x + 2, x + s - 2);
    const pz = rng.range(z + 2, z + s - 2);
    if (Math.abs(px - (x + c)) < 4 || Math.abs(pz - (z + c)) < 4) continue;
    spec.props.push({ type: "tree", x: px, y: SIDEWALK_HEIGHT, z: pz, yaw: rng.range(0, 6.28), scale: rng.range(0.8, 1.5) });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    spec.props.push({ type: "bench", x: x + c + Math.cos(a) * 7, y: SIDEWALK_HEIGHT, z: z + c + Math.sin(a) * 7, yaw: -a + Math.PI / 2, scale: 1 });
  }
}

function addStreetFurniture(spec: BlockSpec, rng: Rng, x0: number, z0: number): void {
  const s = BLOCK_SIZE;
  const y = SIDEWALK_HEIGHT;
  const edge = 1.0; // distance from curb
  // Streetlights along each side, facing the road.
  for (let k = 0; k < 3; k++) {
    const t = 12 + k * 20;
    spec.props.push({ type: "streetlight", x: x0 + t, y, z: z0 + edge, yaw: Math.PI, scale: 1 });
    spec.props.push({ type: "streetlight", x: x0 + t, y, z: z0 + s - edge, yaw: 0, scale: 1 });
    spec.props.push({ type: "streetlight", x: x0 + edge, y, z: z0 + t, yaw: -Math.PI / 2, scale: 1 });
    spec.props.push({ type: "streetlight", x: x0 + s - edge, y, z: z0 + t, yaw: Math.PI / 2, scale: 1 });
  }
  // Traffic signals on every corner.
  const corners: [number, number, number][] = [
    [x0 + edge, z0 + edge, -Math.PI * 0.75],
    [x0 + s - edge, z0 + edge, Math.PI * 0.75],
    [x0 + edge, z0 + s - edge, -Math.PI * 0.25],
    [x0 + s - edge, z0 + s - edge, Math.PI * 0.25],
  ];
  for (const [x, z, yaw] of corners) spec.props.push({ type: "trafficLight", x, y, z, yaw, scale: 1 });

  const small: PropType[] = ["hydrant", "trashcan", "bench", "trashcan"];
  for (let k = 0; k < 6; k++) {
    const type = rng.pick(small);
    const side = rng.int(0, 3);
    const t = rng.range(6, s - 6);
    const off = type === "bench" ? 2.6 : 1.6;
    const [x, z, yaw] =
      side === 0 ? [x0 + t, z0 + off, Math.PI] : side === 1 ? [x0 + t, z0 + s - off, 0] : side === 2 ? [x0 + off, z0 + t, -Math.PI / 2] : [x0 + s - off, z0 + t, Math.PI / 2];
    spec.props.push({ type, x, y, z, yaw, scale: 1 });
  }
}

/** Road centre-line coordinates (same set on both axes) for traffic & markings. */
export function roadLines(minBlock: number, maxBlock: number): number[] {
  const lines: number[] = [];
  for (let k = minBlock; k <= maxBlock + 1; k++) lines.push(k * BLOCK_PITCH);
  return lines;
}

/** Every collidable box of a chunk (building tiers + extra colliders). */
export function chunkColliders(spec: ChunkSpec): Box[] {
  const out: Box[] = [];
  for (const block of spec.blocks) {
    for (const b of block.buildings) out.push(...b.tiers);
    out.push(...block.colliders);
  }
  return out;
}
