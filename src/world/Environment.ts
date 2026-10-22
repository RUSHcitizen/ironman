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
  /** Current weather (fog, light and sky darken in rain and storms). */
  weather: "clear" | "rain" | "storm" = "clear";
  private lastY = 0;
  /** Lightning flash (1 = flash, decays) brightening the sky and ambient light. */
  private flashT = 0;
  /** Unit vector toward the sun (or moon at night). */
  readonly sunDir = SUN_DIR.clone();
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
  /** Rain / storm: closer fog, darker sky and light (fades out above the clouds). */
  setWeather(w: "clear" | "rain" | "storm"): void {
    this.weather = w;
    this.lastSpace = -1;
    this.applyLight();
    this.setAltitude(this.lastY);
  }

  /** How much the weather applies at a height (0 above the cloud deck). */
  private overcast(y: number): number {
    const w = this.weather === "storm" ? 1 : this.weather === "rain" ? 0.6 : 0;
    return w * Math.min(1, Math.max(0, 1 - (y - 500) / 500));
  }

  private applyLight(): void {
    const o = this.overcast(this.lastY);
    this.sun.intensity = this.palette.sunI * (1 - o * 0.65) + this.flashT * 1.5;
    this.hemi.intensity = this.palette.hemiI * (1 - this.space * 0.4) * (1 - o * 0.3) + this.flashT * 0.9;
  }

  /** A lightning strike lights up the sky. */
  flash(): void {
    this.flashT = 1;
    this.lastSpace = -1;
  }

  setAltitude(y: number): void {
    this.lastY = y;
    const o = this.overcast(y);
    const k = Math.min(1, Math.max(0, (y - 500) / (SPACE_ALTITUDE - 500)));
    const sp = k * k * (3 - 2 * k);
    // Fog distance tracks altitude so the ground isn't swallowed.
    const d = this.viewDistance;
    const up = Math.max(0, y - 150);
    this.scene.fogStart = (d * 0.3 + up * 0.9) * (1 - o * 0.75);
    this.scene.fogEnd = (d + up * 1.6) * (1 - o * 0.45);
    if (Math.abs(sp - this.lastSpace) < 0.004 && o === 0 && this.flashT <= 0) return;
    this.lastSpace = sp;
    this.space = sp;
    const grey = this.time === "night" ? new Color3(0.05, 0.055, 0.07) : new Color3(0.36, 0.38, 0.42);
    const haze = Color3.Lerp(this.palette.haze, grey, o * 0.8).add(new Color3(0.6, 0.62, 0.7).scale(this.flashT * 0.5));
    const fog = Color3.Lerp(haze, new Color3(0.2, 0.32, 0.55), sp);
    this.scene.fogColor.copyFrom(fog);
    const clear = Color3.Lerp(haze, new Color3(0.01, 0.01, 0.03), sp);
    this.scene.clearColor.set(clear.r, clear.g, clear.b, 1);
    const b = (1 - sp * 0.97) * (1 - o * 0.55) + this.flashT * 0.8;
    this.skyMat.emissiveColor.set(b, b, b * 1.02 + sp * 0.02);
    const starA = Math.max(this.palette.stars, (sp - 0.35) / 0.65);
    this.starMat.alpha = starA;
    this.stars.setEnabled(starA > 0.01);
    this.applyLight();
  }

  private ground!: Mesh;
  private water!: Mesh;
  private patchKey = "";

  /** Re-centre the ground and water patches under the camera (call every frame). */
  followCamera(x: number, z: number): void {
    // Cover everything out to the fog (which reaches further when you climb).
    const reach = Math.min(30000, Math.max(1500, this.scene.fogEnd + 400));
    const snap = (v: number, step: number) => Math.round(v / step) * step;
    const half = snap(reach, 100);
    // Ground: 10 m asphalt tiles, clipped to the island.
    const lo = Math.ceil(ISLAND_MIN / 10) * 10, hi = Math.floor(ISLAND_MAX / 10) * 10;
    const gx0 = Math.max(lo, snap(x, 10) - half), gx1 = Math.min(hi, snap(x, 10) + half);
    const gz0 = Math.max(lo, snap(z, 10) - half), gz1 = Math.min(hi, snap(z, 10) + half);
    // Water: 25 m tiles, never clipped.
    const wx = snap(x, 25), wz = snap(z, 25), wh = snap(Math.max(half, 3000), 25);
    const key = `${gx0},${gx1},${gz0},${gz1},${wx},${wz},${wh}`;
    if (key === this.patchKey) return;
    this.patchKey = key;
    const g = this.ground;
    const gw = gx1 - gx0, gd = gz1 - gz0;
    g.setEnabled(gw > 0 && gd > 0);
    if (gw > 0 && gd > 0) {
      g.position.set((gx0 + gx1) / 2, 0, (gz0 + gz1) / 2);
      g.scaling.set(gw, 1, gd);
      const t = this.mats.asphalt.diffuseTexture as Texture;
      t.uScale = gw / 10;
      t.vScale = gd / 10;
    }
    this.water.position.set(wx, WATER_Y, wz);
    this.water.scaling.set(wh * 2, 1, wh * 2);
    if (this.waterTex) this.waterTex.uScale = this.waterTex.vScale = (wh * 2) / 25;
  }

  update(time: number, dt = 0): void {
    if (this.flashT > 0) {
      // Flicker, then fade.
      this.flashT = Math.max(0, this.flashT - dt * 4) * (Math.random() < 0.15 ? 0.3 : 1);
      this.lastSpace = -1;
      this.setAltitude(this.lastY);
    }
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
    this.applyLight();
    this.hemi.diffuse = pal.hemi.clone();
    this.hemi.groundColor = pal.ground.clone();
    this.hemi.intensity = pal.hemiI;
    this.scene.ambientColor = pal.ground.scale(0.7);
    this.sunDisc.position = dir.scale(6200);
    this.sunDir.copyFrom(dir);
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

  /**
   * Street surface and harbour water are finely subdivided patches that
   * follow the camera (snapped to whole texture tiles so the texture never
   * swims). One island-sized quad would have kilometre-long triangles and
   * texture coordinates in the thousands, which GPUs interpolate badly:
   * black, flickering, over-bright road.
   */
  private buildTerrain(): void {
    const ground = CreateGround("ground", { width: 1, height: 1, subdivisions: 32 }, this.scene);
    ground.material = this.mats.asphalt;
    ground.receiveShadows = true;
    ground.isPickable = false;
    ground.metadata = { drawOrder: 1 };
    this.ground = ground;

    const water = CreateGround("water", { width: 1, height: 1, subdivisions: 32 }, this.scene);
    water.position.y = WATER_Y;
    this.waterTex = this.mats.water.diffuseTexture as Texture;
    water.material = this.mats.water;
    water.isPickable = false;
    water.metadata = { drawOrder: 1 };
    this.water = water;
    this.followCamera(0, 0);

    // Sea wall and waterfront promenade, built from pieces at most 1 km long
    // (kilometre-scale triangles with huge texture coordinates render badly).
    const b = new GeometryBatch(8, 8);
    type Faces = Parameters<GeometryBatch["box"]>[3];
    const piece = (box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }, color: RGB, faces?: Faces) => {
      const alongX = box.maxX - box.minX >= box.maxZ - box.minZ;
      const a0 = alongX ? box.minX : box.minZ, a1 = alongX ? box.maxX : box.maxZ;
      for (let a = a0; a < a1; a += 1000) {
        const e = Math.min(a1, a + 1000);
        b.box(alongX ? { ...box, minX: a, maxX: e } : { ...box, minZ: a, maxZ: e }, color, "world", faces);
      }
    };
    const wall: RGB = [0.55, 0.53, 0.5];
    const W0 = ISLAND_MIN, W1 = ISLAND_MAX, wy0 = WATER_Y - 3;
    piece({ minX: W0, minY: wy0, minZ: W0, maxX: W1, maxY: 0, maxZ: W0 + 0.5 }, wall, { sides: true });
    piece({ minX: W0, minY: wy0, minZ: W1 - 0.5, maxX: W1, maxY: 0, maxZ: W1 }, wall, { sides: true });
    piece({ minX: W0, minY: wy0, minZ: W0, maxX: W0 + 0.5, maxY: 0, maxZ: W1 }, wall, { sides: true });
    piece({ minX: W1 - 0.5, minY: wy0, minZ: W0, maxX: W1, maxY: 0, maxZ: W1 }, wall, { sides: true });
    const inner = ROAD_WIDTH / 2;
    const prom: RGB = [0.78, 0.76, 0.72];
    const slabs = [
      { minX: ISLAND_MIN, minZ: ISLAND_MIN, maxX: ISLAND_MAX, maxZ: DISTRICT_MIN - inner },
      { minX: ISLAND_MIN, minZ: DISTRICT_MAX + inner, maxX: ISLAND_MAX, maxZ: ISLAND_MAX },
      { minX: ISLAND_MIN, minZ: DISTRICT_MIN - inner, maxX: DISTRICT_MIN - inner, maxZ: DISTRICT_MAX + inner },
      { minX: DISTRICT_MAX + inner, minZ: DISTRICT_MIN - inner, maxX: ISLAND_MAX, maxZ: DISTRICT_MAX + inner },
    ];
    for (const sl of slabs) piece({ ...sl, minY: 0, maxY: SIDEWALK_HEIGHT }, prom, { top: true, sides: true });
    const rail: RGB = [0.2, 0.22, 0.24];
    const r0 = ISLAND_MIN + 0.3, r1 = ISLAND_MAX - 0.3;
    piece({ minX: r0, minY: 0.9, minZ: r0, maxX: r1, maxY: 1.0, maxZ: r0 + 0.08 }, rail);
    piece({ minX: r0, minY: 0.9, minZ: r1 - 0.08, maxX: r1, maxY: 1.0, maxZ: r1 }, rail);
    piece({ minX: r0, minY: 0.9, minZ: r0, maxX: r0 + 0.08, maxY: 1.0, maxZ: r1 }, rail);
    piece({ minX: r1 - 0.08, minY: 0.9, minZ: r0, maxX: r1, maxY: 1.0, maxZ: r1 }, rail);
    const m = b.build("promenade", this.scene, this.mats.concrete);
    if (m) m.receiveShadows = true;
  }
}
