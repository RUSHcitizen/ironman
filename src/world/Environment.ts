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
import type { RGB } from "./CityGenerator";
import { Rng, DEG } from "../core/math";
import {
  DISTRICT_MIN,
  DISTRICT_MAX,
  ISLAND_MIN,
  ISLAND_MAX,
  ROAD_WIDTH,
  SIDEWALK_HEIGHT,
  WATER_Y,
  SPACE_ALTITUDE,
} from "./WorldConfig";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

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
  private skyMat!: StandardMaterial;
  private stars!: Mesh;
  private starMat!: StandardMaterial;
  private viewDistance = 600;
  private lastSpace = -1;
  /** 0 at ground level, 1 in space. */
  space = 0;

  constructor(
    private scene: Scene,
    private mats: WorldMaterials,
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
    this.buildTerrain();
    this.buildSkyline();
  }

  setViewDistance(d: number): void {
    this.viewDistance = d;
    this.lastSpace = -1;
    this.setAltitude(0);
  }

  /**
   * Climbing toward space: the sky darkens to black, stars come out, and the
   * fog thins so the city stays visible far below.
   */
  setAltitude(y: number): void {
    const k = Math.min(1, Math.max(0, (y - 500) / (SPACE_ALTITUDE - 500)));
    const sp = k * k * (3 - 2 * k);
    // Fog distance tracks altitude so the ground isn't swallowed.
    const d = this.viewDistance;
    const up = Math.max(0, y - 150);
    this.scene.fogStart = d * 0.3 + up * 0.9;
    this.scene.fogEnd = d + up * 1.6;
    if (Math.abs(sp - this.lastSpace) < 0.004) return;
    this.lastSpace = sp;
    this.space = sp;
    const fog = Color3.Lerp(HAZE, new Color3(0.2, 0.32, 0.55), sp);
    this.scene.fogColor.copyFrom(fog);
    const clear = Color3.Lerp(HAZE, new Color3(0.01, 0.01, 0.03), sp);
    this.scene.clearColor.set(clear.r, clear.g, clear.b, 1);
    const b = 1 - sp * 0.97;
    this.skyMat.emissiveColor.set(b, b, b * 1.02 + sp * 0.02);
    this.starMat.alpha = Math.max(0, (sp - 0.35) / 0.65);
    this.stars.setEnabled(sp > 0.36);
    this.hemi.intensity = 0.62 - sp * 0.25;
  }

  update(time: number): void {
    if (this.waterTex) {
      this.waterTex.uOffset = time * 0.004;
      this.waterTex.vOffset = Math.sin(time * 0.1) * 0.01;
    }
  }

  private buildSky(): void {
    const sky = CreateSphere("sky", { diameter: 13000, segments: 24, sideOrientation: Mesh.BACKSIDE }, this.scene);
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
    this.skyMat = m;

    // Starfield, faded in near space.
    const tex = new DynamicTexture("starsTex", { width: 2048, height: 1024 }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 2048, 1024);
    const rng = new Rng(4242);
    for (let k = 0; k < 2600; k++) {
      const x = rng.range(0, 2048), yy = rng.range(0, 1024);
      const big = rng.chance(0.06);
      const v = Math.floor(rng.range(120, 255));
      const tint = rng.chance(0.2) ? `rgb(${v},${Math.floor(v * 0.85)},${Math.floor(v * 0.7)})` : rng.chance(0.2) ? `rgb(${Math.floor(v * 0.8)},${Math.floor(v * 0.9)},${v})` : `rgb(${v},${v},${v})`;
      ctx.fillStyle = tint;
      ctx.fillRect(x, yy, big ? 2.4 : 1.3, big ? 2.4 : 1.3);
    }
    tex.update(false);
    this.starMat = this.mats.additive("starsMat", Color3.Black(), 0);
    this.starMat.emissiveTexture = tex;
    this.stars = CreateSphere("stars", { diameter: 12000, segments: 16, sideOrientation: Mesh.BACKSIDE }, this.scene);
    this.stars.material = this.starMat;
    this.stars.infiniteDistance = true;
    this.stars.isPickable = false;
    this.stars.applyFog = false;
    this.stars.metadata = { drawOrder: 3 };
    this.stars.setEnabled(false);

    const sunDisc = CreateDisc("sunDisc", { radius: 230, tessellation: 24 }, this.scene);
    const sm = this.mats.additive("sunMat", new Color3(1, 0.86, 0.6), 1);
    sunDisc.material = sm;
    sunDisc.position = SUN_DIR.scale(6200);
    sunDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    sunDisc.infiniteDistance = true;
    sunDisc.isPickable = false;
  }

  private buildTerrain(): void {
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

    const water = CreateGround("water", { width: 16000, height: 16000 }, this.scene);
    water.position.y = WATER_Y;
    this.waterTex = this.mats.water.diffuseTexture as Texture;
    this.waterTex.uScale = this.waterTex.vScale = 640;
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

  private buildSkyline(): void {
    const b = new GeometryBatch(FACADE_TILE.masonryU, FACADE_TILE.masonryV);
    const rng = new Rng(77);
    for (let k = 0; k < 520; k++) {
      const a = rng.range(0, Math.PI * 2);
      // Leave a gap toward the sunset so the sun sits over open water.
      if (Math.abs(((a - SUN_AZIMUTH + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3) continue;
      const r = rng.range(ISLAND_MAX + 700, ISLAND_MAX + 1700);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const w = rng.range(30, 90), d = rng.range(30, 90);
      const h = rng.range(40, 150) + (rng.chance(0.25) ? rng.range(100, 280) : 0);
      const v = rng.range(0.32, 0.46);
      b.box({ minX: x - w / 2, minY: WATER_Y, minZ: z - d / 2, maxX: x + w / 2, maxY: h, maxZ: z + d / 2 }, [v, v * 1.02, v * 1.18], "facade", { top: true, sides: true });
    }
    b.build("skyline", this.scene, this.mats.skyline);
  }
}
