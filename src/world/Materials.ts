import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Scene } from "@babylonjs/core/scene";
import { Rng } from "../core/math";

export const FACADE_TILE = { masonryU: 28, masonryV: 28.8, glassU: 24, glassV: 28.8 };

function canvasTexture(name: string, scene: Scene, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, mips = true): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, mips, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  draw(ctx, size);
  tex.update(false);
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 4;
  return tex;
}

function noise(ctx: CanvasRenderingContext2D, s: number, rng: Rng, amount: number, alpha: number): void {
  for (let k = 0; k < amount; k++) {
    const v = Math.floor(rng.range(0, 255));
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rng.range(0, s), rng.range(0, s), rng.range(1, 3), rng.range(1, 3));
  }
}

/**
 * Shared materials for the whole world. Every texture is generated on a canvas
 * at startup (no downloaded assets) and kept small for mobile GPUs.
 */
export class WorldMaterials {
  masonry: StandardMaterial;
  glass: StandardMaterial;
  concrete: StandardMaterial;
  asphalt: StandardMaterial;
  markings: StandardMaterial;
  water: StandardMaterial;
  propLit: StandardMaterial;
  propGlow: StandardMaterial;
  beacon: StandardMaterial;
  skyline: StandardMaterial;
  private textures: DynamicTexture[] = [];

  constructor(private scene: Scene) {
    const T = 512;
    // Masonry facade: 8x8 punched windows on a light wall (tinted via vertex colour).
    const masonryDiffuse = this.tex("masonryD", T, (ctx, s) => {
      ctx.fillStyle = "#d8d2c6";
      ctx.fillRect(0, 0, s, s);
      noise(ctx, s, new Rng(1), 3000, 0.08);
      const cw = s / 8, ch = s / 8;
      for (let fx = 0; fx < 8; fx++) {
        for (let fy = 0; fy < 8; fy++) {
          const x = fx * cw, y = fy * ch;
          ctx.fillStyle = "rgba(0,0,0,0.12)";
          ctx.fillRect(x, y + ch - 4, cw, 3); // floor band
          ctx.fillStyle = "#2b3442";
          ctx.fillRect(x + cw * 0.22, y + ch * 0.2, cw * 0.56, ch * 0.58);
          ctx.fillStyle = "#4b5a6e";
          ctx.fillRect(x + cw * 0.22, y + ch * 0.2, cw * 0.56, ch * 0.12);
          ctx.fillStyle = "#c9c2b4";
          ctx.fillRect(x + cw * 0.48, y + ch * 0.2, cw * 0.04, ch * 0.58);
          ctx.fillRect(x + cw * 0.18, y + ch * 0.78, cw * 0.64, ch * 0.05);
        }
      }
    });
    const masonryEmissive = this.tex("masonryE", T, (ctx, s) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, s, s);
      const rng = new Rng(7);
      const cw = s / 8, ch = s / 8;
      for (let fx = 0; fx < 8; fx++) {
        for (let fy = 0; fy < 8; fy++) {
          if (!rng.chance(0.32)) continue;
          const b = rng.range(0.45, 1);
          const warm = rng.chance(0.8);
          ctx.fillStyle = warm ? `rgba(255,${190 + rng.int(0, 40)},${110 + rng.int(0, 50)},${b})` : `rgba(190,220,255,${b})`;
          ctx.fillRect(fx * cw + cw * 0.22, fy * ch + ch * 0.2, cw * 0.56, ch * 0.58);
        }
      }
    });
    this.masonry = new StandardMaterial("masonry", scene);
    this.masonry.diffuseTexture = masonryDiffuse;
    this.masonry.emissiveTexture = masonryEmissive;
    this.masonry.useEmissiveAsIllumination = true;
    this.masonry.specularColor = new Color3(0.08, 0.08, 0.08);

    // Glass curtain wall.
    const glassDiffuse = this.tex("glassD", T, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, "#9fb6cc");
      g.addColorStop(0.5, "#6f86a0");
      g.addColorStop(1, "#8ea6bf");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      const rng = new Rng(3);
      const cw = s / 8, ch = s / 8;
      for (let fx = 0; fx < 8; fx++) {
        for (let fy = 0; fy < 8; fy++) {
          const v = rng.range(-18, 18);
          ctx.fillStyle = `rgba(${120 + v},${150 + v},${180 + v},0.35)`;
          ctx.fillRect(fx * cw + 2, fy * ch + 2, cw - 4, ch - 4);
        }
      }
      ctx.fillStyle = "#3d4652";
      for (let k = 0; k <= 8; k++) {
        ctx.fillRect(k * cw - 2, 0, 4, s);
        ctx.fillRect(0, k * ch - 3, s, 6);
      }
    });
    const glassEmissive = this.tex("glassE", T, (ctx, s) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, s, s);
      const rng = new Rng(11);
      const cw = s / 8, ch = s / 8;
      for (let fy = 0; fy < 8; fy++) {
        // Lit floors come in runs, like open-plan offices.
        let fx = 0;
        while (fx < 8) {
          const run = rng.int(1, 4);
          if (rng.chance(0.38)) {
            const b = rng.range(0.35, 0.85);
            ctx.fillStyle = rng.chance(0.6) ? `rgba(210,232,255,${b})` : `rgba(255,214,150,${b})`;
            ctx.fillRect(fx * cw + 2, fy * ch + ch * 0.15, run * cw - 4, ch * 0.7);
          }
          fx += run;
        }
      }
    });
    this.glass = new StandardMaterial("glass", scene);
    this.glass.diffuseTexture = glassDiffuse;
    this.glass.emissiveTexture = glassEmissive;
    this.glass.useEmissiveAsIllumination = true;
    this.glass.specularColor = new Color3(0.9, 0.8, 0.7);
    this.glass.specularPower = 48;

    // Concrete / paving for roofs, sidewalks and trims (world-space UVs, 2m tiles).
    const concreteTex = this.tex("concrete", 256, (ctx, s) => {
      ctx.fillStyle = "#bdbab3";
      ctx.fillRect(0, 0, s, s);
      noise(ctx, s, new Rng(5), 2500, 0.1);
      ctx.fillStyle = "rgba(60,60,60,0.25)";
      for (let k = 0; k < 4; k++) {
        ctx.fillRect(k * (s / 4), 0, 2, s);
        ctx.fillRect(0, k * (s / 4), s, 2);
      }
    });
    this.concrete = new StandardMaterial("concrete", scene);
    this.concrete.diffuseTexture = concreteTex;
    this.concrete.specularColor = new Color3(0.05, 0.05, 0.05);

    const asphaltTex = this.tex("asphalt", 256, (ctx, s) => {
      ctx.fillStyle = "#3a3b3f";
      ctx.fillRect(0, 0, s, s);
      noise(ctx, s, new Rng(9), 5000, 0.12);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      const rng = new Rng(4);
      for (let k = 0; k < 6; k++) ctx.fillRect(rng.range(0, s), rng.range(0, s), rng.range(20, 80), rng.range(3, 10));
    });
    this.asphalt = new StandardMaterial("asphalt", scene);
    this.asphalt.diffuseTexture = asphaltTex;
    this.asphalt.specularColor = new Color3(0.1, 0.1, 0.1);

    this.markings = new StandardMaterial("markings", scene);
    this.markings.specularColor = Color3.Black();
    this.markings.emissiveColor = new Color3(0.12, 0.12, 0.12);
    this.markings.zOffset = -2;

    const waterTex = this.tex("water", 256, (ctx, s) => {
      ctx.fillStyle = "#29506b";
      ctx.fillRect(0, 0, s, s);
      const rng = new Rng(21);
      for (let k = 0; k < 500; k++) {
        ctx.fillStyle = `rgba(${rng.chance(0.5) ? "160,200,230" : "20,40,60"},${rng.range(0.1, 0.3)})`;
        ctx.fillRect(rng.range(0, s), rng.range(0, s), rng.range(8, 30), rng.range(1, 3));
      }
    });
    this.water = new StandardMaterial("water", scene);
    this.water.diffuseTexture = waterTex;
    this.water.specularColor = new Color3(1, 0.75, 0.5);
    this.water.specularPower = 96;

    this.propLit = new StandardMaterial("propLit", scene);
    this.propLit.diffuseColor = Color3.White();
    this.propLit.specularColor = new Color3(0.25, 0.25, 0.25);

    // Unlit, vertex/instance-coloured material for lamps and signals.
    this.propGlow = new StandardMaterial("propGlow", scene);
    this.propGlow.disableLighting = true;
    this.propGlow.emissiveColor = Color3.White();

    this.beacon = new StandardMaterial("beacon", scene);
    this.beacon.disableLighting = true;
    this.beacon.emissiveColor = new Color3(1, 0.15, 0.1);

    // Distant skyline silhouettes ignore fog; vertex colours pre-mix them with the haze.
    this.skyline = new StandardMaterial("skyline", scene);
    this.skyline.diffuseTexture = masonryDiffuse;
    this.skyline.emissiveTexture = masonryEmissive;
    this.skyline.useEmissiveAsIllumination = true;
    this.skyline.specularColor = Color3.Black();
    this.skyline.fogEnabled = false;
  }

  /** Additive, unlit material for thruster flames and holographic effects. */
  additive(name: string, color: Color3, alpha = 0.85): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.disableLighting = true;
    m.emissiveColor = color;
    m.alpha = alpha;
    m.alphaMode = Constants.ALPHA_ADD;
    // Force blending even at alpha 1 (otherwise the material renders opaque).
    m.transparencyMode = 2; // Material.MATERIAL_ALPHABLEND
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
    m.fogEnabled = false;
    return m;
  }

  private tex(name: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
    const t = canvasTexture(name, this.scene, size, draw);
    this.textures.push(t);
    return t;
  }
}
