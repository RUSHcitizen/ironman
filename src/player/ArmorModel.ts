import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { PlayerController } from "./PlayerController";
import { clamp, damp } from "../core/math";

interface Joint {
  node: TransformNode;
  x: number;
  z: number;
}

type JointName = "spine" | "neck" | "shL" | "shR" | "elL" | "elR" | "hipL" | "hipR" | "knL" | "knR";
type Pose = Partial<Record<JointName, [number, number]>>;

/**
 * Original procedurally-modelled powered armour (red & gold) with a simple
 * joint hierarchy and procedural pose blending for walk / hover / flight.
 */
export class ArmorModel {
  readonly root: TransformNode;
  private pivot: TransformNode;
  private joints = {} as Record<JointName, Joint>;
  private flames: { mesh: Mesh; kind: "boot" | "palm"; seed: number }[] = [];
  private glowMat: StandardMaterial;
  private parts: { mesh: AbstractMesh; delay: number }[] = [];
  private particles: ParticleSystem[] = [];
  private emitters: Mesh[] = [];
  private shadow: Mesh;
  private time = 0;
  private suitUpT = -1;
  private crouch = 0;
  readonly meshes: AbstractMesh[] = [];

  constructor(private scene: Scene) {
    const red = new StandardMaterial("armorRed", scene);
    red.diffuseColor = new Color3(0.62, 0.05, 0.04);
    red.specularColor = new Color3(1, 0.75, 0.7);
    red.specularPower = 80;
    red.emissiveFresnelParameters = rim(new Color3(0.55, 0.12, 0.08));
    const gold = new StandardMaterial("armorGold", scene);
    gold.diffuseColor = new Color3(0.88, 0.62, 0.22);
    gold.specularColor = new Color3(1, 0.9, 0.6);
    gold.specularPower = 64;
    gold.emissiveFresnelParameters = rim(new Color3(0.5, 0.35, 0.1));
    const dark = new StandardMaterial("armorDark", scene);
    dark.diffuseColor = new Color3(0.3, 0.3, 0.34);
    dark.specularColor = new Color3(0.6, 0.6, 0.6);
    this.glowMat = new StandardMaterial("armorGlow", scene);
    this.glowMat.disableLighting = true;
    this.glowMat.emissiveColor = new Color3(0.7, 0.95, 1);

    this.root = new TransformNode("player", scene);
    this.pivot = new TransformNode("pivot", scene);
    this.pivot.parent = this.root;
    this.pivot.position.y = 1.0;
    this.pivot.rotationQuaternion = Quaternion.Identity();

    const add = (m: Mesh, parent: TransformNode, mat: StandardMaterial, x: number, y: number, z: number, delay: number) => {
      m.parent = parent;
      m.position.set(x, y, z);
      m.material = mat;
      m.isPickable = false;
      this.parts.push({ mesh: m, delay });
      this.meshes.push(m);
      return m;
    };
    const sphere = (r: number, sx = 1, sy = 1, sz = 1, seg = 12) => {
      const m = CreateSphere("p", { diameter: r * 2, segments: seg }, scene);
      m.scaling.set(sx, sy, sz);
      return m;
    };
    const capsule = (len: number, r: number) => CreateCapsule("c", { height: len, radius: r, tessellation: 12, subdivisions: 2 }, scene);
    const box = (w: number, h: number, d: number) => CreateBox("b", { width: w, height: h, depth: d }, scene);
    const joint = (name: JointName, parent: TransformNode, x: number, y: number, z: number): TransformNode => {
      const n = new TransformNode(name, scene);
      n.parent = parent;
      n.position.set(x, y, z);
      this.joints[name] = { node: n, x: 0, z: 0 };
      return n;
    };

    // Pelvis & torso.
    add(sphere(0.18, 1, 0.6, 0.7), this.pivot, dark, 0, 0, -0.01, 0.45);
    add(box(0.34, 0.08, 0.24), this.pivot, gold, 0, 0.05, 0, 0.45);
    const spine = joint("spine", this.pivot, 0, 0.1, 0);
    add(sphere(0.16, 1, 0.75, 0.75), spine, dark, 0, 0.12, -0.01, 0.5);
    add(box(0.3, 0.05, 0.22), spine, gold, 0, 0.14, 0.01, 0.52);
    add(box(0.28, 0.05, 0.21), spine, gold, 0, 0.22, 0.01, 0.54);
    add(sphere(0.27, 1, 0.82, 0.62), spine, red, 0, 0.45, 0, 0.6);
    add(sphere(0.2, 1, 0.7, 0.45), spine, gold, 0, 0.47, 0.07, 0.62);
    const reactor = CreateCylinder("reactor", { diameter: 0.13, height: 0.04, tessellation: 18 }, scene);
    reactor.rotation.x = Math.PI / 2;
    add(reactor, spine, this.glowMat, 0, 0.47, 0.155, 0.7);
    const reactorRim = CreateCylinder("reactorRim", { diameter: 0.17, height: 0.03, tessellation: 18 }, scene);
    reactorRim.rotation.x = Math.PI / 2;
    add(reactorRim, spine, dark, 0, 0.47, 0.145, 0.68);
    // Back thruster pack.
    add(box(0.3, 0.3, 0.1), spine, red, 0, 0.47, -0.16, 0.62);
    add(sphere(0.13, 1, 0.8, 1), spine, red, -0.31, 0.6, 0, 0.66);
    add(sphere(0.13, 1, 0.8, 1), spine, red, 0.31, 0.6, 0, 0.66);
    add(box(0.12, 0.1, 0.16), spine, gold, -0.3, 0.69, 0, 0.67);
    add(box(0.12, 0.1, 0.16), spine, gold, 0.3, 0.69, 0, 0.67);

    // Head.
    const neck = joint("neck", spine, 0, 0.7, 0);
    add(capsule(0.12, 0.06), neck, dark, 0, 0.03, 0, 0.8);
    add(sphere(0.135, 1, 1.12, 1.1, 16), neck, red, 0, 0.17, -0.005, 0.85);
    add(sphere(0.12, 0.88, 1.0, 0.7, 16), neck, gold, 0, 0.15, 0.065, 0.88);
    add(box(0.05, 0.016, 0.012), neck, this.glowMat, -0.045, 0.185, 0.145, 0.95);
    add(box(0.05, 0.016, 0.012), neck, this.glowMat, 0.045, 0.185, 0.145, 0.95);
    add(box(0.06, 0.012, 0.01), neck, dark, 0, 0.1, 0.145, 0.9);

    // Arms.
    for (const side of [-1, 1] as const) {
      const sh = joint(side < 0 ? "shL" : "shR", spine, side * 0.33, 0.56, 0);
      add(capsule(0.32, 0.068), sh, red, 0, -0.15, 0, 0.7);
      add(box(0.1, 0.12, 0.1), sh, gold, side * 0.01, -0.13, 0, 0.71);
      const el = joint(side < 0 ? "elL" : "elR", sh, 0, -0.3, 0);
      add(sphere(0.062), el, dark, 0, 0, 0, 0.72);
      add(capsule(0.28, 0.062), el, gold, 0, -0.14, 0, 0.74);
      add(capsule(0.2, 0.068), el, red, 0, -0.17, 0.005, 0.75);
      add(box(0.085, 0.11, 0.06), el, red, 0, -0.33, 0, 0.76);
      const palm = CreateDisc("palm", { radius: 0.03, tessellation: 12 }, scene);
      palm.rotation.x = -Math.PI / 2;
      add(palm, el, this.glowMat, 0, -0.39, 0, 0.9);
      this.flame(el, 0, -0.39, 0, 0.09, "palm");
    }

    // Legs.
    for (const side of [-1, 1] as const) {
      const hip = joint(side < 0 ? "hipL" : "hipR", this.pivot, side * 0.115, -0.04, 0);
      add(capsule(0.46, 0.088), hip, red, 0, -0.22, 0, 0.25);
      add(box(0.12, 0.2, 0.1), hip, gold, side * 0.03, -0.22, 0.04, 0.27);
      const kn = joint(side < 0 ? "knL" : "knR", hip, 0, -0.46, 0);
      add(sphere(0.07), kn, gold, 0, 0, 0.02, 0.2);
      add(capsule(0.42, 0.078), kn, red, 0, -0.21, 0, 0.12);
      add(box(0.1, 0.24, 0.07), kn, gold, 0, -0.2, 0.05, 0.14);
      add(box(0.13, 0.1, 0.25), kn, red, 0, -0.46, 0.035, 0.05);
      const sole = CreateDisc("sole", { radius: 0.045, tessellation: 12 }, scene);
      sole.rotation.x = -Math.PI / 2;
      add(sole, kn, this.glowMat, 0, -0.515, 0.0, 0.3);
      const emitter = this.flame(kn, 0, -0.52, 0, 0.16, "boot");
      this.emitters.push(emitter);
    }

    // Blob shadow (cheap on every quality level).
    const st = new DynamicTexture("blob", { width: 64, height: 64 }, scene, false);
    const ctx = st.getContext() as unknown as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, "rgba(0,0,0,0.65)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    st.hasAlpha = true;
    st.update(false);
    const sm = new StandardMaterial("blobMat", scene);
    sm.diffuseTexture = st;
    sm.useAlphaFromDiffuseTexture = true;
    sm.disableLighting = true;
    sm.emissiveColor = Color3.Black();
    sm.zOffset = -3;
    this.shadow = CreateDisc("blobShadow", { radius: 0.8, tessellation: 16 }, scene);
    this.shadow.rotation.x = Math.PI / 2;
    this.shadow.material = sm;
    this.shadow.isPickable = false;
  }

  /** Additive flame cone hanging below a joint. Returns the flame mesh. */
  private flame(parent: TransformNode, x: number, y: number, z: number, width: number, kind: "boot" | "palm"): Mesh {
    const outer = CreateCylinder("flame", { diameterTop: width, diameterBottom: 0, height: 1, tessellation: 10 }, this.scene);
    outer.bakeTransformIntoVertices(Matrix.Translation(0, -0.5, 0));
    const outerMat = new StandardMaterial("flameOuter", this.scene);
    outerMat.disableLighting = true;
    outerMat.emissiveColor = kind === "boot" ? new Color3(1, 0.55, 0.22) : new Color3(0.5, 0.8, 1);
    outerMat.alpha = 0.55;
    outerMat.alphaMode = 1; // ALPHA_ADD
    outerMat.backFaceCulling = false;
    outerMat.fogEnabled = false;
    outer.material = outerMat;
    outer.parent = parent;
    outer.position.set(x, y, z);
    outer.isPickable = false;
    const inner = CreateCylinder("flameCore", { diameterTop: width * 0.55, diameterBottom: 0, height: 0.6, tessellation: 8 }, this.scene);
    inner.bakeTransformIntoVertices(Matrix.Translation(0, -0.3, 0));
    const innerMat = outerMat.clone("flameInner");
    innerMat.emissiveColor = new Color3(0.85, 0.95, 1);
    innerMat.alpha = 0.8;
    inner.material = innerMat;
    inner.parent = outer;
    inner.isPickable = false;
    this.flames.push({ mesh: outer, kind, seed: Math.random() * 10 });
    return outer;
  }

  /** Enable/disable thruster particle trails (quality dependent). */
  setParticles(capacity: number): void {
    for (const p of this.particles) p.dispose();
    this.particles = [];
    if (capacity <= 0) return;
    const tex = new DynamicTexture("spark", { width: 32, height: 32 }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,200,140,0.6)");
    g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    tex.hasAlpha = true;
    tex.update(false);
    for (const e of this.emitters) {
      const ps = new ParticleSystem("trail", Math.floor(capacity / 2), this.scene);
      ps.particleTexture = tex;
      ps.emitter = e;
      ps.createPointEmitter(new Vector3(-0.05, -1, -0.05), new Vector3(0.05, -1, 0.05));
      ps.color1 = new Color4(1, 0.7, 0.4, 0.8);
      ps.color2 = new Color4(0.6, 0.85, 1, 0.6);
      ps.colorDead = new Color4(0.3, 0.3, 0.35, 0);
      ps.minSize = 0.08;
      ps.maxSize = 0.28;
      ps.minLifeTime = 0.12;
      ps.maxLifeTime = 0.35;
      ps.minEmitPower = 3;
      ps.maxEmitPower = 7;
      ps.emitRate = 0;
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.updateSpeed = 1 / 60;
      ps.start();
      this.particles.push(ps);
    }
  }

  playSuitUp(): void {
    this.suitUpT = 0;
  }

  get suitingUp(): boolean {
    return this.suitUpT >= 0;
  }

  update(dt: number, p: PlayerController): void {
    this.time += dt;
    const t = this.time;
    this.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    Quaternion.RotationYawPitchRollToRef(p.bodyYaw, p.bodyPitch, p.bodyRoll, this.pivot.rotationQuaternion!);

    // Pose selection.
    const planar = Math.hypot(p.vel.x, p.vel.z);
    let pose: Pose;
    let pivotY = 1.0;
    if (p.mode === "ground") {
      const a = clamp(planar / 8, 0, 1);
      const ph = p.walkPhase;
      const s = Math.sin(ph);
      const breathe = Math.sin(t * 1.8) * 0.02;
      pose = {
        spine: [0.12 * a + breathe, 0],
        neck: [-0.08 * a, 0],
        hipL: [-s * 0.75 * a, -0.02],
        hipR: [s * 0.75 * a, 0.02],
        knL: [Math.max(0, Math.cos(ph)) * 1.1 * a + 0.04, 0],
        knR: [Math.max(0, -Math.cos(ph)) * 1.1 * a + 0.04, 0],
        shL: [s * 0.6 * a, -0.1],
        shR: [-s * 0.6 * a, 0.1],
        elL: [-0.25 - 0.45 * a, 0],
        elR: [-0.25 - 0.45 * a, 0],
      };
      pivotY = 1.0 - Math.abs(Math.cos(ph)) * 0.04 * a;
      const w = clamp(p.landingTimer / 0.5, 0, 1);
      this.crouch += (w - this.crouch) * damp(w > this.crouch ? 30 : 6, dt);
      if (this.crouch > 0.01) {
        const c = this.crouch;
        const L: Pose = {
          spine: [0.55, 0],
          neck: [-0.5, 0],
          hipL: [-1.5, -0.1],
          knL: [2.1, 0],
          hipR: [0.35, 0.15],
          knR: [1.9, 0],
          shR: [-0.75, 0.35],
          elR: [-0.15, 0],
          shL: [0.7, -0.9],
          elL: [-0.4, 0],
        };
        for (const k of Object.keys(L) as JointName[]) {
          const a0 = pose[k] ?? [0, 0];
          const b0 = L[k]!;
          pose[k] = [a0[0] + (b0[0] - a0[0]) * c, a0[1] + (b0[1] - a0[1]) * c];
        }
        pivotY -= 0.5 * c;
      }
    } else if (p.mode === "hover") {
      const sway = Math.sin(t * 1.6) * 0.04;
      pose = {
        spine: [0.04, 0],
        neck: [-0.05, 0],
        hipL: [0.05 + sway, -0.07],
        hipR: [0.08 - sway, 0.07],
        knL: [0.18, 0],
        knR: [0.12, 0],
        shL: [0.12, -0.38],
        shR: [0.12, 0.38],
        elL: [-0.3, 0],
        elR: [-0.3, 0],
      };
      pivotY = 1.0 + Math.sin(t * 2.1) * 0.05;
    } else {
      const ab = p.afterburner ? 1 : 0;
      pose = {
        spine: [0, 0],
        neck: [-1.05, 0],
        hipL: [0.02, -0.03],
        hipR: [0.02, 0.03],
        knL: [0.08 + Math.sin(t * 3) * 0.03, 0],
        knR: [0.08 - Math.sin(t * 3) * 0.03, 0],
        shL: [0.1 + ab * 0.1, -0.16 + ab * 0.06],
        shR: [0.1 + ab * 0.1, 0.16 - ab * 0.06],
        elL: [-0.06, 0],
        elR: [-0.06, 0],
      };
    }
    if (p.mode !== "ground") this.crouch = 0;
    this.pivot.position.y += (pivotY - this.pivot.position.y) * damp(12, dt);

    const rate = p.mode === "flight" ? 6 : 10;
    for (const name of Object.keys(this.joints) as JointName[]) {
      const j = this.joints[name];
      const target = pose[name] ?? [0, 0];
      const k = damp(name === "knL" || name === "knR" || name === "hipL" || name === "hipR" ? rate * 1.4 : rate, dt);
      j.x += (target[0] - j.x) * k;
      j.z += (target[1] - j.z) * k;
      j.node.rotation.set(j.x, 0, j.z);
    }

    // Thrusters.
    const airborne = p.mode !== "ground";
    const boot = airborne ? 0.25 + p.thrust * (p.afterburner ? 1.9 : 1.1) : 0;
    const palm = p.mode === "hover" ? 0.25 + p.thrust * 0.45 : p.mode === "flight" ? 0.12 + (p.afterburner ? 0.35 : 0) : 0;
    for (const f of this.flames) {
      const base = f.kind === "boot" ? boot : palm;
      const flick = 0.82 + 0.18 * Math.sin(t * 47 + f.seed * 7) + 0.08 * Math.sin(t * 91 + f.seed);
      const len = base * flick;
      f.mesh.setEnabled(len > 0.02);
      f.mesh.scaling.set(1 + base * 0.2, Math.max(0.01, len), 1 + base * 0.2);
    }
    for (const ps of this.particles) ps.emitRate = airborne ? 40 + p.thrust * (p.afterburner ? 260 : 120) : 0;

    const energy = p.suit.energy / 100;
    const pulse = 0.85 + 0.15 * Math.sin(t * 3);
    this.glowMat.emissiveColor.set(0.45 + 0.3 * energy * pulse, 0.75 + 0.2 * energy * pulse, 1);

    // Blob shadow on the surface below.
    const groundY = p.pos.y - p.agl;
    this.shadow.position.set(p.pos.x, groundY + 0.04, p.pos.z);
    const sh = clamp(1 - p.agl / 35, 0, 1);
    this.shadow.setEnabled(sh > 0.02);
    const sz = 0.8 + p.agl * 0.04;
    this.shadow.scaling.set(sz, sz, sz);
    this.shadow.visibility = sh;

    this.updateSuitUp(dt);
  }

  private updateSuitUp(dt: number): void {
    if (this.suitUpT < 0) return;
    this.suitUpT += dt;
    const total = 1.9;
    for (const part of this.parts) {
      const local = clamp((this.suitUpT - part.delay * 1.2) / 0.35, 0, 1);
      const e = 1 - Math.pow(1 - local, 3);
      const m = part.mesh;
      m.setEnabled(local > 0);
      if (!part.mesh.metadata) part.mesh.metadata = { s: m.scaling.clone() };
      const s0 = part.mesh.metadata.s as Vector3;
      m.scaling.set(s0.x * e, s0.y * e, s0.z * e);
    }
    if (this.suitUpT > total) {
      for (const part of this.parts) {
        const s0 = part.mesh.metadata?.s as Vector3 | undefined;
        if (s0) part.mesh.scaling.copyFrom(s0);
        part.mesh.setEnabled(true);
      }
      this.suitUpT = -1;
    }
  }
}

function rim(color: Color3): FresnelParameters {
  const f = new FresnelParameters();
  f.bias = 0.2;
  f.power = 2.5;
  f.leftColor = color;
  f.rightColor = Color3.Black();
  return f;
}
