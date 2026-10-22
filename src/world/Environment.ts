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

export type TimeOfDay = "sunset" | "day" | "night";

interface Palette {
  zenith: Color3;
  horizon: Color3;
  haze: Color3;
  glow: Color3;
  /** Sun (or moon) azimuth / elevation. */
  az: number;
  el: number;
  sun: Color3;
  sunI: number;
  hemi: Color3;
  hemiI: number;
  ground: Color3;
  disc: Color3;
  discR: number;
  /** City window glow (emissive texture level). */
  windows: number;
  /** Minimum star visibility at ground level. */
  stars: number;
}

const PALETTES: Record<TimeOfDay, Palette> = {
  sunset: {
    zenith: new Color3(0.11, 0.17, 0.36), horizon: new Color3(0.93, 0.6, 0.42), haze: new Color3(0.6, 0.5, 0.52), glow: new Color3(1.0, 0.62, 0.3),
    az: 250 * DEG, el: 13 * DEG, sun: new Color3(1.0, 0.76, 0.52), sunI: 1.15, hemi: new Color3(0.72, 0.78, 1.0), hemiI: 0.62, ground: new Color3(0.36, 0.28, 0.26),
    disc: new Color3(1, 0.86, 0.6), discR: 230, windows: 1, stars: 0,
  },
  day: {
    zenith: new Color3(0.2, 0.42, 0.85), horizon: new Color3(0.7, 0.82, 0.95), haze: new Color3(0.66, 0.75, 0.86), glow: new Color3(1, 0.96, 0.85),
    az: 200 * DEG, el: 52 * DEG, sun: new Color3(1, 0.97, 0.92), sunI: 1.3, hemi: new Color3(0.8, 0.86, 1), hemiI: 0.78, ground: new Color3(0.42, 0.4, 0.38),
    disc: new Color3(1, 0.98, 0.9), discR: 160, windows: 0.35, stars: 0,
  },
  night: {
    zenith: new Color3(0.008, 0.015, 0.05), horizon: new Color3(0.07, 0.09, 0.17), haze: new Color3(0.06, 0.075, 0.13), glow: new Color3(0.35, 0.42, 0.6),
    az: 140 * DEG, el: 38 * DEG, sun: new Color3(0.5, 0.6, 0.85), sunI: 0.35, hemi: new Color3(0.4, 0.5, 0.8), hemiI: 0.3, ground: new Color3(0.12, 0.1, 0.12),
    disc: new Color3(0.85, 0.9, 1), discR: 110, windows: 2.4, stars: 0.85,
  },
};

/** Lighting, sky, terrain, water and road markings. */
export class Environment {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphericLight;
  private waterTex: Texture | null = null;
  private skyMat!: StandardMaterial;
  private stars!: Mesh;
  private starMat!: StandardMaterial;
  private viewDistance = 600;
  private palette: Palette = PALETTES.sunset;
  private skyMesh!: Mesh;
  private sunDisc!: Mesh;
  time: TimeOfDay = "sunset";
  private lastSpace = -1;
  /** 0 at ground level, 1 in space. */
  space = 0;

  constructor(
    private scene: Scene,
    private mats: WorldMaterials,
  ) {
    const haze = PALETTES.sunset.haze;
    scene.clearColor = new Color4(haze.r, haze.g, haze.b, 1);
    scene.ambientColor = new Color3(0.25, 0.22, 0.24);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = haze.clone();

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
    const haze = this.palette.haze;
    const fog = Color3.Lerp(haze, new Color3(0.2, 0.32, 0.55), sp);
    this.scene.fogColor.copyFrom(fog);
    const clear = Color3.Lerp(haze, new Color3(0.01, 0.01, 0.03), sp);
    this.scene.clearColor.set(clear.r, clear.g, clear.b, 1);
    const b = 1 - sp * 0.97;
    this.skyMat.emissiveColor.set(b, b, b * 1.02 + sp * 0.02);
    const starA = Math.max(this.palette.stars, (sp - 0.35) / 0.65);
    this.starMat.alpha = starA;
    this.stars.setEnabled(starA > 0.01);
    this.hemi.intensity = this.palette.hemiI * (1 - sp * 0.4);
  }

  update(time: number): void {
    if (this.waterTex) {
      this.waterTex.uOffset = time * 0.004;
      this.waterTex.vOffset = Math.sin(time * 0.1) * 0.01;
    }
  }

  /** Sunset (default), day or night: sky, sun / moon, light, fog and window glow. */
  setTimeOfDay(t: TimeOfDay): void {
    const pal = PALETTES[t] ?? PALETTES.sunset;
    this.time = t;
    this.palette = pal;
    const dir = new Vector3(Math.sin(pal.az) * Math.cos(pal.el), Math.sin(pal.el), Math.cos(pal.az) * Math.cos(pal.el));
    this.paintSky(pal, dir);
    this.sun.direction = dir.scale(-1);
    this.sun.diffuse = pal.sun.clone();
    this.sun.specular = pal.sun.scale(t === "night" ? 0.5 : 1);
    this.sun.intensity = pal.sunI;
    this.hemi.diffuse = pal.hemi.clone();
    this.hemi.groundColor = pal.ground.clone();
    this.hemi.intensity = pal.hemiI;
    this.scene.ambientColor = pal.ground.scale(0.7);
    this.sunDisc.position = dir.scale(6200);
    this.sunDisc.scaling.setAll(pal.discR / 230);
    (this.sunDisc.material as StandardMaterial).emissiveColor = pal.disc.clone();
    for (const m of [this.mats.masonry, this.mats.glass]) if (m.emissiveTexture) m.emissiveTexture.level = pal.windows;
    this.lastSpace = -1;
  }

  private paintSky(pal: Palette, sunDir: Vector3): void {
    const sky = this.skyMesh;
    const pos = sky.getVerticesData(VertexBuffer.PositionKind)!;
    const colors = new Float32Array((pos.length / 3) * 4);
    const d = new Vector3();
    const below = pal.haze.scale(0.4);
    for (let k = 0; k < pos.length / 3; k++) {
      d.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).normalize();
      const up = Math.max(0, d.y);
      const t = Math.pow(up, 0.55);
      const sunAmt = Math.pow(Math.max(0, Vector3.Dot(d, sunDir)), 6);
      let c = Color3.Lerp(pal.horizon, pal.zenith, t);
      c = Color3.Lerp(c, pal.glow, sunAmt * (1 - t * 0.6));
      if (d.y < 0) c = Color3.Lerp(pal.haze, below, Math.min(1, -d.y * 3));
      else if (d.y < 0.06) c = Color3.Lerp(pal.haze, c, d.y / 0.06);
      colors.set([c.r, c.g, c.b, 1], k * 4);
    }
    sky.setVerticesData(VertexBuffer.ColorKind, colors);
  }

  private buildSky(): void {
    const sky = CreateSphere("sky", { diameter: 13000, segments: 24, sideOrientation: Mesh.BACKSIDE }, this.scene);
    this.skyMesh = sky;
    this.paintSky(PALETTES.sunset, SUN_DIR);
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
    this.sunDisc = sunDisc;
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

    // The harbour reaches well past the island on every side (one tile per 25 m).
    const sea = size + 24000;
    const water = CreateGround("water", { width: sea, height: sea }, this.scene);
    water.position.y = WATER_Y;
    this.waterTex = this.mats.water.diffuseTexture as Texture;
    this.waterTex.uScale = this.waterTex.vScale = sea / 25;
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
}
