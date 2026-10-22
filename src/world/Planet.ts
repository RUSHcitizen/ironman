import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Planet appears above this altitude and is fully opaque at PLANET_FULL. */
export const PLANET_START = 2000;
export const PLANET_FULL = 2500;
const R = 4000;

/** Seeded 2D value noise with smooth interpolation (wraps in x for a seamless globe). */
function makeNoise(seed: number, period: number) {
  const hash = (x: number, y: number) => {
    let h = (((x % period) + period) % period) * 374761393 + y * 668265263 + seed * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Fractal noise over `oct` octaves; x wraps at `w` cells of the base octave. */
function fbm(noise: (x: number, y: number) => number, x: number, y: number, oct: number): number {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let k = 0; k < oct; k++) {
    s += noise(x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

/**
 * The Earth seen from space: a procedurally painted globe (oceans,
 * continents, deserts, forests, ice caps) lit by the sun, a slowly drifting
 * cloud shell, and a glowing blue atmosphere rim. It hangs below the camera
 * and fades in as you climb past the edge of space, hiding the city below.
 * Textures are painted on first use so they cost nothing until you go up.
 */
export class Planet {
  private globe: Mesh;
  private clouds: Mesh;
  private atmo: Mesh;
  private globeMat: StandardMaterial;
  private cloudMat: StandardMaterial;
  private painted = false;
  private spin = 0;

  constructor(private scene: Scene) {
    this.globeMat = new StandardMaterial("earthMat", scene);
    this.globeMat.specularColor = new Color3(0.12, 0.14, 0.18);
    this.globeMat.specularPower = 24;
    // A little self-light so the night side is not pitch black.
    this.globeMat.emissiveColor = new Color3(0.05, 0.06, 0.09);
    this.globeMat.fogEnabled = false;
    this.globe = CreateSphere("earth", { diameter: 2, segments: 48 }, scene);
    this.globe.material = this.globeMat;

    this.cloudMat = new StandardMaterial("earthCloudMat", scene);
    this.cloudMat.specularColor = Color3.Black();
    this.cloudMat.emissiveColor = new Color3(0.08, 0.08, 0.1);
    this.cloudMat.fogEnabled = false;
    this.clouds = CreateSphere("earthClouds", { diameter: 2.012, segments: 48 }, scene);
    this.clouds.material = this.cloudMat;

    // Atmosphere: a slightly larger shell, transparent in the middle and
    // glowing blue toward the limb.
    const atmoMat = new StandardMaterial("earthAtmoMat", scene);
    atmoMat.disableLighting = true;
    atmoMat.emissiveColor = new Color3(0.35, 0.6, 1.0);
    atmoMat.fogEnabled = false;
    atmoMat.alpha = 1;
    const f = new FresnelParameters();
    f.leftColor = Color3.White();
    f.rightColor = Color3.Black();
    f.bias = 0.1;
    f.power = 3;
    atmoMat.opacityFresnelParameters = f;
    this.atmo = CreateSphere("earthAtmo", { diameter: 2.08, segments: 48 }, scene);
    this.atmo.material = atmoMat;

    for (const m of [this.globe, this.clouds, this.atmo]) {
      m.isPickable = false;
      m.infiniteDistance = true; // stays below the camera however you move
      m.setEnabled(false);
    }
  }

  /** Paint the globe and cloud textures (equirectangular), once. */
  private paint(): void {
    this.painted = true;
    const W = 512, H = 256;
    const land = new DynamicTexture("earthTex", { width: W, height: H }, this.scene, true);
    const ctx = land.getContext() as unknown as CanvasRenderingContext2D;
    const img = ctx.createImageData(W, H);
    const cells = 6;
    const n1 = makeNoise(11, cells), n2 = makeNoise(29, cells * 4), n3 = makeNoise(53, cells);
    for (let y = 0; y < H; y++) {
      const lat = (y / H - 0.5) * Math.PI; // -pi/2 .. pi/2
      const polar = Math.abs(lat) / (Math.PI / 2);
      for (let x = 0; x < W; x++) {
        const u = (x / W) * cells, v = (y / H) * cells * 0.5;
        const h = fbm(n1, u, v, 5);
        const detail = fbm(n2, u * 4, v * 4, 3);
        const dry = fbm(n3, u + 3.7, v + 1.3, 3);
        let r: number, g: number, b: number;
        const sea = 0.52;
        if (h < sea) {
          // Ocean: deeper blue offshore, turquoise in the shallows.
          const depth = (sea - h) / sea;
          const shallow = Math.max(0, 1 - depth * 9);
          r = 8 + shallow * 30;
          g = 40 + shallow * 80 - depth * 10;
          b = 92 + shallow * 60 - depth * 30;
        } else {
          // Land: forest green, drier tan / desert bands, darker highlands.
          const elev = (h - sea) / (1 - sea);
          const desert = Math.max(0, Math.min(1, (dry - 0.5) * 3 + (1 - Math.abs(Math.abs(lat) - 0.4) * 4) * 0.3));
          r = 52 + desert * 140 - elev * 20 + detail * 20;
          g = 92 + desert * 70 - elev * 30 + detail * 20;
          b = 42 + desert * 40 - elev * 10 + detail * 10;
        }
        // Ice caps.
        const ice = Math.max(0, Math.min(1, (polar - 0.78) * 6 + (detail - 0.5) * 0.8));
        r += (235 - r) * ice;
        g += (240 - g) * ice;
        b += (248 - b) * ice;
        const i = (y * W + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    land.update(false);
    this.globeMat.diffuseTexture = land;

    // Cloud shell: white swirls with alpha.
    const cl = new DynamicTexture("earthCloudTex", { width: W, height: H }, this.scene, true);
    cl.hasAlpha = true;
    const cctx = cl.getContext() as unknown as CanvasRenderingContext2D;
    const cimg = cctx.createImageData(W, H);
    const c1 = makeNoise(71, cells * 2), c2 = makeNoise(97, cells * 8);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x / W) * cells * 2, v = (y / H) * cells;
        // Streaky: stretched along longitude like real weather bands.
        const c = fbm(c1, u, v * 1.6, 5) * 0.75 + fbm(c2, u * 4, v * 6, 2) * 0.25;
        const a = Math.max(0, Math.min(1, (c - 0.55) * 4));
        const i = (y * W + x) * 4;
        cimg.data[i] = cimg.data[i + 1] = cimg.data[i + 2] = 250;
        cimg.data[i + 3] = a * 235;
      }
    }
    cctx.putImageData(cimg, 0, 0);
    cl.update(false);
    this.cloudMat.diffuseTexture = cl;
    this.cloudMat.useAlphaFromDiffuseTexture = true;
  }

  /** How visible the planet is at this altitude (0..1). */
  static fade(y: number): number {
    const k = Math.max(0, Math.min(1, (y - PLANET_START) / (PLANET_FULL - PLANET_START)));
    return k * k * (3 - 2 * k);
  }

  update(dt: number, cam: Vector3): void {
    const f = Planet.fade(cam.y);
    const on = f > 0.001;
    for (const m of [this.globe, this.clouds, this.atmo]) m.setEnabled(on);
    if (!on) return;
    if (!this.painted) this.paint();
    // Sits below you; the higher you go the further away (and smaller) it is.
    const d = R + 0.6 * cam.y;
    for (const m of [this.globe, this.clouds, this.atmo]) {
      m.position.set(0, -d, 0);
      m.scaling.setAll(R);
    }
    // Slow rotation; the clouds drift a little faster.
    this.spin += dt * 0.004;
    this.globe.rotation.set(0.35, this.spin, 0.1);
    this.clouds.rotation.set(0.35, this.spin * 1.6, 0.1);
    this.globe.visibility = this.clouds.visibility = this.atmo.visibility = f;
  }
}
