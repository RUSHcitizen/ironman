import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { GeometryBatch } from "./GeometryBatch";
import type { WorldMaterials } from "./Materials";
import { FACADE_TILE } from "./Materials";
import type { CollisionWorld } from "./Collision";
import type { RGB } from "./CityGenerator";
import { roadLines } from "./CityGenerator";
import { Rng, DEG } from "../core/math";
import {
  BLOCK_MIN_INDEX,
  BLOCK_MAX_INDEX,
  DISTRICT_MIN,
  DISTRICT_MAX,
  ISLAND_MIN,
  ISLAND_MAX,
  ROAD_WIDTH,
  SIDEWALK_HEIGHT,
  WATER_Y,
} from "./WorldConfig";

export const SUN_AZIMUTH = 250 * DEG;
export const SUN_ELEVATION = 13 * DEG;
export const SUN_DIR = new Vector3(
  Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
);

const ZENITH = new Color3(0.11, 0.17, 0.36);
const HORIZON = new Color3(0.93, 0.6, 0.42);
const HAZE = new Color3(0.6, 0.5, 0.52);
const SUN_GLOW = new Color3(1.0, 0.62, 0.3);

/** Lighting, sky, terrain, water, road markings and the distant skyline. */
export class Environment {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphericLight;
  private waterTex: Texture | null = null;

  constructor(
    private scene: Scene,
    private mats: WorldMaterials,
    world: CollisionWorld,
  ) {
    scene.clearColor = new Color4(HAZE.r, HAZE.g, HAZE.b, 1);
    scene.ambientColor = new Color3(0.25, 0.22, 0.24);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = HAZE.clone();

    this.hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    this.hemi.intensity = 0.62;
    this.hemi.diffuse = new Color3(0.72, 0.78, 1.0);
    this.hemi.groundColor = new Color3(0.36, 0.28, 0.26);
    this.hemi.specular = Color3.Black();

    this.sun = new DirectionalLight("sun", SUN_DIR.scale(-1), scene);
    this.sun.intensity = 1.15;
    this.sun.diffuse = new Color3(1.0, 0.76, 0.52);
    this.sun.specular = new Color3(1.0, 0.8, 0.6);
    this.sun.position = SUN_DIR.scale(400);

    this.buildSky();
    this.buildTerrain(world);
    this.buildMarkings();
    this.buildSkyline();
  }

  setViewDistance(d: number): void {
    this.scene.fogStart = d * 0.3;
    this.scene.fogEnd = d;
  }

  update(time: number): void {
    if (this.waterTex) {
      this.waterTex.uOffset = time * 0.004;
      this.waterTex.vOffset = Math.sin(time * 0.1) * 0.01;
    }
  }

  private buildSky(): void {
    const sky = CreateSphere("sky", { diameter: 4000, segments: 24, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const pos = sky.getVerticesData(VertexBuffer.PositionKind)!;
    const colors = new Float32Array((pos.length / 3) * 4);
    const d = new Vector3();
    for (let k = 0; k < pos.length / 3; k++) {
      d.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).normalize();
      const up = Math.max(0, d.y);
      const t = Math.pow(up, 0.55);
      const sunAmt = Math.pow(Math.max(0, Vector3.Dot(d, SUN_DIR)), 6);
      let c = Color3.Lerp(HORIZON, ZENITH, t);
      c = Color3.Lerp(c, SUN_GLOW, sunAmt * (1 - t * 0.6));
      if (d.y < 0) c = Color3.Lerp(HAZE, new Color3(0.2, 0.2, 0.26), Math.min(1, -d.y * 3));
      else if (d.y < 0.06) c = Color3.Lerp(HAZE, c, d.y / 0.06);
      colors.set([c.r, c.g, c.b, 1], k * 4);
    }
    sky.setVerticesData(VertexBuffer.ColorKind, colors);
    const m = new StandardMaterial("skyMat", this.scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.White();
    m.fogEnabled = false;
    sky.material = m;
    sky.infiniteDistance = true;
    sky.isPickable = false;
    sky.applyFog = false;
    sky.metadata = { drawOrder: 2 };

    const sunDisc = CreateDisc("sunDisc", { radius: 70, tessellation: 24 }, this.scene);
    const sm = this.mats.additive("sunMat", new Color3(1, 0.86, 0.6), 1);
    sunDisc.material = sm;
    sunDisc.position = SUN_DIR.scale(1900);
    sunDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    sunDisc.infiniteDistance = true;
    sunDisc.isPickable = false;
  }

  private buildTerrain(world: CollisionWorld): void {
    const size = ISLAND_MAX - ISLAND_MIN;
    const ground = CreateGround("ground", { width: size, height: size }, this.scene);
    ground.position.set((ISLAND_MIN + ISLAND_MAX) / 2, 0, (ISLAND_MIN + ISLAND_MAX) / 2);
    const asphalt = this.mats.asphalt.diffuseTexture as Texture;
    asphalt.uScale = asphalt.vScale = size / 10;
    ground.material = this.mats.asphalt;
    ground.receiveShadows = true;
    ground.isPickable = false;
    ground.freezeWorldMatrix();
    ground.metadata = { drawOrder: 1 };

    const water = CreateGround("water", { width: 6000, height: 6000 }, this.scene);
    water.position.y = WATER_Y;
    this.waterTex = this.mats.water.diffuseTexture as Texture;
    this.waterTex.uScale = this.waterTex.vScale = 240;
    water.material = this.mats.water;
    water.isPickable = false;
    water.freezeWorldMatrix();
    water.metadata = { drawOrder: 1 };

    // Sea wall and waterfront promenade.
    const b = new GeometryBatch(8, 8);
    const wall: RGB = [0.55, 0.53, 0.5];
    b.box({ minX: ISLAND_MIN, minY: WATER_Y - 3, minZ: ISLAND_MIN, maxX: ISLAND_MAX, maxY: 0, maxZ: ISLAND_MAX }, wall, "world", { sides: true });
    const inner = ROAD_WIDTH / 2;
    const prom: RGB = [0.78, 0.76, 0.72];
    const slabs = [
      { minX: ISLAND_MIN, minZ: ISLAND_MIN, maxX: ISLAND_MAX, maxZ: DISTRICT_MIN - inner },
      { minX: ISLAND_MIN, minZ: DISTRICT_MAX + inner, maxX: ISLAND_MAX, maxZ: ISLAND_MAX },
      { minX: ISLAND_MIN, minZ: DISTRICT_MIN - inner, maxX: DISTRICT_MIN - inner, maxZ: DISTRICT_MAX + inner },
      { minX: DISTRICT_MAX + inner, minZ: DISTRICT_MIN - inner, maxX: ISLAND_MAX, maxZ: DISTRICT_MAX + inner },
    ];
    for (const s of slabs) {
      const box = { ...s, minY: 0, maxY: SIDEWALK_HEIGHT };
      b.box(box, prom, "world", { top: true, sides: true });
      world.addSlab(box);
    }
    const rail: RGB = [0.2, 0.22, 0.24];
    const r0 = ISLAND_MIN + 0.3, r1 = ISLAND_MAX - 0.3;
    b.box({ minX: r0, minY: 0.9, minZ: r0, maxX: r1, maxY: 1.0, maxZ: r0 + 0.08 }, rail, "world");
    b.box({ minX: r0, minY: 0.9, minZ: r1 - 0.08, maxX: r1, maxY: 1.0, maxZ: r1 }, rail, "world");
    b.box({ minX: r0, minY: 0.9, minZ: r0, maxX: r0 + 0.08, maxY: 1.0, maxZ: r1 }, rail, "world");
    b.box({ minX: r1 - 0.08, minY: 0.9, minZ: r0, maxX: r1, maxY: 1.0, maxZ: r1 }, rail, "world");
    const m = b.build("promenade", this.scene, this.mats.concrete);
    if (m) m.receiveShadows = true;
  }

  private buildMarkings(): void {
    const b = new GeometryBatch(1, 1);
    const yellow: RGB = [0.95, 0.75, 0.2];
    const white: RGB = [0.92, 0.92, 0.9];
    const lines = roadLines(BLOCK_MIN_INDEX, BLOCK_MAX_INDEX);
    const half = ROAD_WIDTH / 2;
    const y = 0.02;
    for (const L of lines) {
      for (let k = 0; k < lines.length - 1; k++) {
        // Segment between intersections on this road.
        const s0 = lines[k] + half, s1 = lines[k + 1] - half;
        const c0 = s0 + 3.5, c1 = s1 - 3.5; // leave room for crosswalks
        for (const axis of [0, 1]) {
          const strip = (a: number, w: number, from: number, to: number, col: RGB) =>
            axis === 0 ? b.rect(L + a - w / 2, from, L + a + w / 2, to, y, col) : b.rect(from, L + a - w / 2, to, L + a + w / 2, y, col);
          strip(-0.22, 0.14, c0, c1, yellow);
          strip(0.22, 0.14, c0, c1, yellow);
          for (let t = c0 + 1; t < c1 - 3; t += 6) {
            strip(-3.75, 0.14, t, t + 3, white);
            strip(3.75, 0.14, t, t + 3, white);
          }
          // Stop lines on the approach side of right-hand traffic.
          const sgn = axis === 0 ? 1 : -1;
          strip((sgn * half) / 2, half, c1 + 0.2, c1 + 0.6, white);
          strip((-sgn * half) / 2, half, c0 - 0.6, c0 - 0.2, white);
          // Crosswalk stripes at both ends.
          for (let a = -half + 0.8; a < half - 0.5; a += 1.2) {
            strip(a, 0.55, s0 + 0.3, s0 + 3.0, white);
            strip(a, 0.55, s1 - 3.0, s1 - 0.3, white);
          }
        }
      }
    }
    const mesh = b.build("markings", this.scene, this.mats.markings);
    if (mesh) mesh.receiveShadows = true;
  }

  private buildSkyline(): void {
    const b = new GeometryBatch(FACADE_TILE.masonryU, FACADE_TILE.masonryV);
    const rng = new Rng(77);
    for (let k = 0; k < 260; k++) {
      const a = rng.range(0, Math.PI * 2);
      // Leave a gap toward the sunset so the sun sits over open water.
      if (Math.abs(((a - SUN_AZIMUTH + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3) continue;
      const r = rng.range(1150, 1750);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const w = rng.range(24, 70), d = rng.range(24, 70);
      const h = rng.range(30, 120) + (rng.chance(0.25) ? rng.range(80, 220) : 0);
      const v = rng.range(0.32, 0.46);
      b.box({ minX: x - w / 2, minY: WATER_Y, minZ: z - d / 2, maxX: x + w / 2, maxY: h, maxZ: z + d / 2 }, [v, v * 1.02, v * 1.18], "facade", { top: true, sides: true });
    }
    b.build("skyline", this.scene, this.mats.skyline);
  }
}
