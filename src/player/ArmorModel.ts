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
import { pieceTiming, suitUpPose, SuitStage, SUIT_UP_STAGES, type JointName, type Pose } from "./SuitUpChoreography";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { FlightMode } from "./PlayerController";

/** Everything the armour model needs to pose itself (player or autonomous suit). */
export interface AvatarState {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  mode: FlightMode;
  suited: boolean;
  bodyYaw: number;
  bodyPitch: number;
  bodyRoll: number;
  rollSpin: number;
  trickPitch: number;
  trickYaw: number;
  walkPhase: number;
  landingTimer: number;
  viewPitch: number;
  rocketTimer: number;
  aimTimer: number;
  thrust: number;
  afterburner: boolean;
  agl: number;
  suit: { energy: number };
  /** Unpowered fall (skydive pose). */
  readonly falling?: boolean;
  /** Flight bank about the body's long axis (radians). */
  readonly bank?: number;
  /** Unibeam firing pose timer. */
  readonly beamTimer?: number;
  /** Flight extras: air-braking, hypersonic stage and the RUSH meter (0..1). */
  readonly braking?: boolean;
  readonly hypersonic?: boolean;
  readonly rush?: number;
  /** Where the pilot is looking (head and torso turn toward it). */
  readonly viewYaw?: number;
  /** Superhero landing (1 on touchdown, decays to 0). */
  readonly superLanding?: number;
  /** Victory celebration (1 when it starts, decays to 0). */
  readonly cheer?: number;
  /** Scanning a point (bomb defusal): right palm held out at it. */
  readonly scanAt?: { x: number; y: number; z: number } | null;
  /** Reaching for a pickup with the left hand. */
  readonly reachAt?: { x: number; y: number; z: number } | null;
  /** Repulsor recoil 0..1, and the hand that fired (+1 right, -1 left). */
  readonly recoil?: number;
  readonly fireHand?: number;
  /** Hit flinch 0..1 and side. */
  readonly flinch?: number;
  readonly flinchSide?: number;
  /** Flares just popped. */
  readonly flareTimer?: number;
  /** Unconscious (no oxygen). */
  readonly blackout?: boolean;
  /** Dead: slump to the ground. */
  readonly dead?: boolean;
  readonly deadTime?: number;
}
import { clamp, damp } from "../core/math";

export type SuitScheme = "classic" | "silver" | "warmachine" | "stealth" | "midas";

/** Primary / trim colours (and eye + reactor glow) of each armour scheme. */
export const SUIT_SCHEMES: Record<SuitScheme, { label: string; primary: Color3; trim: Color3; glow: Color3 }> = {
  classic: { label: "Classic", primary: new Color3(0.62, 0.05, 0.04), trim: new Color3(0.88, 0.62, 0.22), glow: new Color3(0.7, 0.95, 1) },
  silver: { label: "Mark II", primary: new Color3(0.6, 0.62, 0.66), trim: new Color3(0.42, 0.44, 0.48), glow: new Color3(0.7, 0.95, 1) },
  warmachine: { label: "War Machine", primary: new Color3(0.2, 0.21, 0.23), trim: new Color3(0.42, 0.43, 0.45), glow: new Color3(1, 0.85, 0.6) },
  stealth: { label: "Stealth", primary: new Color3(0.06, 0.06, 0.08), trim: new Color3(0.16, 0.18, 0.22), glow: new Color3(0.45, 0.7, 1) },
  midas: { label: "Midas", primary: new Color3(0.86, 0.64, 0.18), trim: new Color3(0.98, 0.84, 0.45), glow: new Color3(1, 0.95, 0.75) },
};

interface Joint {
  node: TransformNode;
  x: number;
  z: number;
}

/**
 * Original procedurally-modelled powered armour (red & gold) with a simple
 * joint hierarchy and procedural pose blending for walk / hover / flight.
 */
export class ArmorModel {
  readonly root: TransformNode;
  private pivot: TransformNode;
  private joints = {} as Record<JointName, Joint>;
  private flames: { mesh: Mesh; kind: "boot" | "palm"; seed: number; side: number }[] = [];
  /** Repulsor blast flash per palm (decays fast), torso twist into the shot, and the last recoil seen. */
  private blastL = 0;
  private blastR = 0;
  private twist = 0;
  private lastRecoil = 0;
  private glowMat: StandardMaterial;
  private primaryMat: StandardMaterial;
  private trimMat: StandardMaterial;
  private glowBase = new Color3(0.7, 0.95, 1);
  private parts: { mesh: AbstractMesh; delay: number }[] = [];
  private particles: ParticleSystem[] = [];
  private emitters: Mesh[] = [];
  private shadow: Mesh;
  private time = 0;
  /** Armour assemble/disassemble animation: progress seconds, -1 = idle. */
  private armorT = -1;
  private armorIn = true;
  private armorShown = true;
  private civ: AbstractMesh[] = [];
  /** Hierarchy nodes in creation (parent-first) order. */
  private nodes: TransformNode[] = [];
  /** Piece-by-piece latch suit-up: per-part local start positions. */
  private latch: {
    t: number;
    starts: Vector3[];
    landed: boolean[];
    lastDelay: number;
    speed: number;
    /** Choreographed section-by-section suit-up (on the ground) vs. the fast all-at-once catch. */
    staged: boolean;
    /** World start positions (staged: plates wait in place until their section is called). */
    world: Vector3[];
    lastStage: number;
  } | null = null;
  /** Suit-up section of each part and its order within the section (0 = first). */
  private stageOf: number[] = [];
  private orderOf: number[] = [];
  /** Head turn toward the limb being armoured. */
  private suitLook = 0;
  private tmpV = new Vector3();
  private tmpM = new Matrix();
  private qBank = new Quaternion();
  private static readonly UP = new Vector3(0, 1, 0);
  /** Called when a piece clamps on (world position, part index). */
  onLatch: ((world: Vector3, index: number) => void) | null = null;
  /** Step-out: the empty suit opens up, then closes again (progress seconds). */
  private open: { t: number; closed: boolean[]; lastDelay: number } | null = null;
  private civShown = false;
  private crouch = 0;
  /** Smoothed head / torso turn toward the aim. */
  private lookYaw = 0;
  private beamGlow = 0;
  /** Take-off spring (1 at lift-off, decays) and the last mode seen. */
  private launch = 0;
  /** Afterburner surge (1 when the burner lights, decays) and its last state. */
  private surge = 0;
  private lastBurn = false;
  private lastMode = "ground";
  /** Slow idle weight shift on the ground. */
  private idleT = 0;
  /** Seconds hovering still (the head starts looking around). */
  private hoverIdle = 0;
  /** Torso turn toward a scanned bomb. */
  private scanTurn = 0;
  readonly meshes: AbstractMesh[] = [];

  constructor(
    private scene: Scene,
    private withCivilian = true,
  ) {
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
    this.primaryMat = red;
    this.trimMat = gold;
    this.glowMat = new StandardMaterial("armorGlow", scene);
    this.glowMat.disableLighting = true;
    this.glowMat.emissiveColor = new Color3(0.7, 0.95, 1);

    this.root = new TransformNode("player", scene);
    this.pivot = new TransformNode("pivot", scene);
    this.pivot.parent = this.root;
    this.pivot.position.y = 1.0;
    this.pivot.rotationQuaternion = Quaternion.Identity();
    this.nodes.push(this.root, this.pivot);

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
      this.nodes.push(n);
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
      this.flame(el, 0, -0.39, 0, 0.09, "palm", side);
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

    if (this.withCivilian) this.buildCivilian();
    // Remember every part's rest transform (used by the suit-up animations).
    for (const part of this.parts) part.mesh.metadata = { s: part.mesh.scaling.clone(), p: part.mesh.position.clone() };
    this.classifyParts();

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
  private flame(parent: TransformNode, x: number, y: number, z: number, width: number, kind: "boot" | "palm", side = 0): Mesh {
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
    this.flames.push({ mesh: outer, kind, seed: Math.random() * 10, side });
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

  /** Civilian alter ego, rigged to the same joints so it shares the walk cycle. */
  private buildCivilian(): void {
    const scene = this.scene;
    const mat = (name: string, c: Color3, spec = 0.1) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = c;
      m.specularColor = new Color3(spec, spec, spec);
      return m;
    };
    const skin = mat("civSkin", new Color3(0.8, 0.6, 0.47), 0.15);
    const jacket = mat("civJacket", new Color3(0.13, 0.14, 0.18), 0.2);
    const shirt = mat("civShirt", new Color3(0.55, 0.57, 0.6));
    const jeans = mat("civJeans", new Color3(0.17, 0.23, 0.36));
    const dark = mat("civDark", new Color3(0.06, 0.05, 0.05), 0.4);
    const hair = mat("civHair", new Color3(0.12, 0.08, 0.06));
    const J = (n: JointName) => this.joints[n].node;
    const put = (m: Mesh, parent: TransformNode, material: StandardMaterial, x: number, y: number, z: number) => {
      m.parent = parent;
      m.position.set(x, y, z);
      m.material = material;
      m.isPickable = false;
      m.setEnabled(false);
      this.civ.push(m);
      return m;
    };
    const cap = (len: number, r: number) => CreateCapsule("civ", { height: len, radius: r, tessellation: 10, subdivisions: 1 }, scene);
    const box = (w: number, h: number, d: number) => CreateBox("civ", { width: w, height: h, depth: d }, scene);
    const sph = (r: number, sx = 1, sy = 1, sz = 1) => {
      const m = CreateSphere("civ", { diameter: r * 2, segments: 10 }, scene);
      m.scaling.set(sx, sy, sz);
      return m;
    };
    put(box(0.32, 0.18, 0.2), this.pivot, jeans, 0, 0.02, 0);
    put(box(0.4, 0.5, 0.22), J("spine"), jacket, 0, 0.36, 0);
    put(box(0.15, 0.42, 0.02), J("spine"), shirt, 0, 0.36, 0.112);
    put(cap(0.12, 0.05), J("neck"), skin, 0, 0.02, 0);
    put(sph(0.105, 1, 1.18, 1.05), J("neck"), skin, 0, 0.15, 0);
    put(sph(0.11, 1.02, 0.6, 1.08), J("neck"), hair, 0, 0.215, -0.012);
    put(box(0.12, 0.05, 0.05), J("neck"), hair, 0, 0.065, 0.085);
    put(box(0.17, 0.035, 0.02), J("neck"), dark, 0, 0.165, 0.105);
    for (const side of [-1, 1] as const) {
      const sh = J(side < 0 ? "shL" : "shR");
      const el = J(side < 0 ? "elL" : "elR");
      // Civilian shoulders are narrower than the armour's.
      put(cap(0.32, 0.055), sh, jacket, -side * 0.1, -0.15, 0);
      put(cap(0.28, 0.048), el, jacket, -side * 0.1, -0.12, 0);
      put(sph(0.045, 1, 1.3, 0.8), el, skin, -side * 0.1, -0.3, 0);
      put(cap(0.46, 0.068), J(side < 0 ? "hipL" : "hipR"), jeans, 0, -0.22, 0);
      put(cap(0.42, 0.06), J(side < 0 ? "knL" : "knR"), jeans, 0, -0.21, 0);
      put(box(0.11, 0.08, 0.26), J(side < 0 ? "knL" : "knR"), dark, 0, -0.47, 0.04);
    }
  }

  /**
   * Sort every plate into its suit-up section (chest, right arm, left arm,
   * right leg, left leg, helmet, faceplate) and order it inside the section:
   * gloves come in hand-first, boots foot-first, the faceplate eyes last.
   */
  private classifyParts(): void {
    this.stageOf = this.parts.map(({ mesh }) => {
      const par = (mesh.parent as TransformNode).name;
      const p = mesh.position;
      if (par === "shR" || par === "elR" || (par === "spine" && p.x > 0.25 && p.y > 0.55)) return SuitStage.RightArm;
      if (par === "shL" || par === "elL" || (par === "spine" && p.x < -0.25 && p.y > 0.55)) return SuitStage.LeftArm;
      if (par === "hipR" || par === "knR") return SuitStage.RightLeg;
      if (par === "hipL" || par === "knL") return SuitStage.LeftLeg;
      if (par === "neck") return p.z > 0.05 ? SuitStage.Faceplate : SuitStage.Helmet;
      return SuitStage.Core;
    });
    this.orderOf = this.parts.map((part, i) => {
      const st = this.stageOf[i];
      const arm = st === SuitStage.RightArm || st === SuitStage.LeftArm;
      const same = this.parts.filter((_, j) => this.stageOf[j] === st);
      // Arms: highest delay (the glove) first; everything else lowest first.
      const rank = same.filter((q) => (arm ? q.delay > part.delay : q.delay < part.delay)).length;
      return same.length > 1 ? rank / (same.length - 1) : 0;
    });
  }

  playSuitUp(): void {
    this.latchFrom(null);
  }

  /** Brief power-up glow through the reactor, eyes and palms (pickups). */
  flashGlow(level = 0.9): void {
    this.beamGlow = Math.max(this.beamGlow, level);
  }

  /** Refresh world matrices top-down so absolute positions are current this frame. */
  refreshWorld(): void {
    for (const n of this.nodes) n.computeWorldMatrix(true);
    for (const part of this.parts) part.mesh.computeWorldMatrix(true);
  }

  /** Current world position of every armour piece (for handing pieces over). */
  pieceWorldPositions(): Vector3[] {
    this.refreshWorld();
    return this.parts.map((p) => p.mesh.getAbsolutePosition().clone());
  }

  /**
   * Suit-up where each armour piece flies in and clamps onto the body, from
   * the given world positions (the arriving suit) or from all around (null).
   * Feet first, helmet last.
   */
  latchFrom(worldStarts: Vector3[] | null, speed = 1): void {
    this.armorT = -1;
    this.open = null;
    this.refreshWorld();
    const starts: Vector3[] = [];
    this.parts.forEach((part, i) => {
      const parent = part.mesh.parent as TransformNode;
      const rest = (part.mesh.metadata as { p: Vector3 }).p;
      let world = worldStarts?.[i];
      if (!world) {
        // Scatter around the body: pieces swirl in from 3-7 m away.
        const a = i * 2.39996 + Math.random() * 0.5;
        const r = 3 + Math.random() * 4;
        const restWorld = Vector3.TransformCoordinates(rest, parent.getWorldMatrix());
        world = restWorld.add(new Vector3(Math.cos(a) * r, 1 + Math.random() * 3, Math.sin(a) * r));
      }
      const inv = parent.getWorldMatrix().clone().invert();
      starts.push(Vector3.TransformCoordinates(world, inv));
      part.mesh.setEnabled(true);
      part.mesh.scaling.copyFrom((part.mesh.metadata as { s: Vector3 }).s);
      part.mesh.position.copyFrom(starts[i]);
    });
    this.armorShown = true;
    this.setCivilian(this.withCivilian);
    const world = this.parts.map((part, i) => worldStarts?.[i]?.clone() ?? Vector3.TransformCoordinates(starts[i], (part.mesh.parent as TransformNode).getWorldMatrix()));
    // On the ground (normal speed) the suit goes on section by section; a
    // mid-air catch stays a fast all-at-once snap.
    const staged = speed <= 1.2;
    this.latch = { t: 0, starts, landed: this.parts.map(() => false), lastDelay: -1, speed, staged, world, lastStage: -1 };
  }

  /**
   * Step-out animation for the empty suit: plates split open from the helmet
   * down, hold while the wearer backs out, then clamp shut again.
   */
  playOpen(): void {
    this.resetParts();
    this.open = { t: 0, closed: this.parts.map(() => false), lastDelay: -1 };
  }

  get opening(): boolean {
    return this.open !== null;
  }

  private resetParts(): void {
    for (const part of this.parts) {
      const md = part.mesh.metadata as { s: Vector3; p: Vector3 } | undefined;
      if (md) {
        part.mesh.scaling.copyFrom(md.s);
        part.mesh.position.copyFrom(md.p);
      }
    }
  }

  private updateOpen(dt: number): void {
    const o = this.open;
    if (!o) return;
    o.t += dt;
    let done = true;
    this.parts.forEach((part, i) => {
      const m = part.mesh;
      const rest = (m.metadata as { p: Vector3 }).p;
      const t0 = (1 - part.delay) * 0.3;
      const tc = 1.0 + part.delay * 0.3;
      const u = clamp((o.t - t0) / 0.2, 0, 1);
      const c = clamp((o.t - tc) / 0.16, 0, 1);
      if (c < 1) done = false;
      const a = (1 - Math.pow(1 - u, 3)) * (1 - c * c * c);
      // Front plates swing forward, side plates outward, the back pack lifts.
      const side = Math.abs(rest.x) > 0.03 ? Math.sign(rest.x) : 0;
      const back = rest.z < -0.08;
      m.position.set(rest.x + side * 0.16 * a, rest.y + (back ? 0.22 : 0.03) * a, rest.z + (back ? -0.08 : 0.2) * a);
      if (c >= 1 && !o.closed[i]) {
        o.closed[i] = true;
        if (Math.abs(part.delay - o.lastDelay) > 0.1) {
          o.lastDelay = part.delay;
          m.computeWorldMatrix(true);
          this.onLatch?.(m.getAbsolutePosition().clone(), i);
        }
      }
    });
    if (done) {
      this.resetParts();
      this.open = null;
    }
  }

  get latching(): boolean {
    return this.latch !== null;
  }

  private updateLatch(dt: number): void {
    const l = this.latch;
    if (!l) return;
    if (l.staged) return this.updateStagedLatch(dt);
    l.t += dt * l.speed;
    const flight = 0.42;
    let done = true;
    this.parts.forEach((part, i) => {
      const m = part.mesh;
      const rest = (m.metadata as { p: Vector3 }).p;
      const start = l.starts[i];
      const t0 = part.delay * 1.75;
      const u = clamp((l.t - t0) / flight, 0, 1);
      if (u < 1) done = false;
      // Ease-out-back: overshoot slightly, then snap into place.
      const c1 = 1.9;
      const e = u <= 0 ? 0 : 1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
      const arc = Math.sin(u * Math.PI) * 0.35;
      m.position.set(start.x + (rest.x - start.x) * e, start.y + (rest.y - start.y) * e + arc, start.z + (rest.z - start.z) * e);
      if (u >= 1 && !l.landed[i]) {
        l.landed[i] = true;
        // One clank per body section, not per mesh.
        if (Math.abs(part.delay - l.lastDelay) > 0.04) {
          l.lastDelay = part.delay;
          m.computeWorldMatrix(true);
          this.onLatch?.(m.getAbsolutePosition().clone(), i);
        }
      }
    });
    if (done) {
      for (const part of this.parts) part.mesh.position.copyFrom((part.mesh.metadata as { p: Vector3 }).p);
      this.setCivilian(false);
      this.latch = null;
    }
  }

  /**
   * Section-by-section suit-up. Plates wait where they started (bobbing
   * gently), then fly in world space onto the presented limb and clamp on;
   * the faceplate drops down over the face last and the eyes flare on.
   */
  private updateStagedLatch(dt: number): void {
    const l = this.latch!;
    l.t += dt * l.speed;
    this.refreshWorld();
    let done = true;
    const t = l.t;
    this.parts.forEach((part, i) => {
      const m = part.mesh;
      const parent = m.parent as TransformNode;
      const pw = parent.getWorldMatrix();
      const rest = (m.metadata as { p: Vector3 }).p;
      const st = this.stageOf[i];
      const { t0, flight } = pieceTiming(st, this.orderOf[i]);
      const u = clamp((t - t0) / flight, 0, 1);
      if (u < 1) done = false;
      if (st === SuitStage.Faceplate) {
        // Slides down from above the brow and swings shut onto the face.
        const e = 1 - Math.pow(1 - u, 3);
        m.position.set(rest.x, rest.y + (1 - e) * 0.22, rest.z + (1 - e) * 0.06 + Math.sin(e * Math.PI) * 0.03);
        m.setEnabled(t > SUIT_UP_STAGES[SuitStage.Helmet].start);
      } else {
        const restWorld = Vector3.TransformCoordinatesToRef(rest, pw, this.tmpV);
        const s = l.world[i];
        // Ease-out-back: overshoot slightly, then snap into place.
        const c1 = 1.7;
        const e = u <= 0 ? 0 : 1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
        const bob = u <= 0 ? Math.sin(this.time * 3 + i) * 0.04 : 0;
        const arc = Math.sin(u * Math.PI) * 0.45;
        const wx = s.x + (restWorld.x - s.x) * e;
        const wy = s.y + (restWorld.y - s.y) * e + arc + bob;
        const wz = s.z + (restWorld.z - s.z) * e;
        pw.invertToRef(this.tmpM);
        Vector3.TransformCoordinatesFromFloatsToRef(wx, wy, wz, this.tmpM, this.tmpV);
        m.position.copyFrom(this.tmpV);
      }
      if (u >= 1 && !l.landed[i]) {
        l.landed[i] = true;
        // One clank and spark per section (first plate to land), plus the faceplate.
        if (st !== l.lastStage) {
          l.lastStage = st;
          m.computeWorldMatrix(true);
          this.onLatch?.(m.getAbsolutePosition().clone(), i);
        }
        if (st === SuitStage.Faceplate) this.beamGlow = 1.3;
      }
    });
    if (done) {
      for (const part of this.parts) {
        part.mesh.position.copyFrom((part.mesh.metadata as { p: Vector3 }).p);
        part.mesh.setEnabled(true);
      }
      this.setCivilian(false);
      this.latch = null;
    }
  }

  /** Animate the armour on (assemble) or off (peel away). */
  startTransform(toSuited: boolean): void {
    this.armorIn = toSuited;
    this.armorT = 0;
    this.setCivilian(true);
  }

  /** Instantly swap to the civilian (stepping out of the suit, which stays behind). */
  exitArmor(): void {
    this.armorT = -1;
    this.setArmorVisible(false);
    this.setCivilian(true);
  }

  /**
   * Unscaled nodes at the boot soles (contrail anchors). The flame meshes
   * themselves are rescaled every frame, which would distort a trail.
   */
  bootAnchors(): TransformNode[] {
    return this.emitters.map((e) => {
      const n = new TransformNode("bootAnchor", this.scene);
      n.parent = e.parent;
      n.position.copyFrom(e.position);
      return n;
    });
  }

  /** Repaint the armour in one of the schemes. */
  setScheme(name: SuitScheme): void {
    const sc = SUIT_SCHEMES[name] ?? SUIT_SCHEMES.classic;
    this.primaryMat.diffuseColor = sc.primary.clone();
    this.trimMat.diffuseColor = sc.trim.clone();
    this.primaryMat.emissiveFresnelParameters = rim(sc.primary.scale(0.8));
    this.trimMat.emissiveFresnelParameters = rim(sc.trim.scale(0.55));
    this.glowBase = sc.glow.clone();
  }

  /** Show / hide the whole character (used for the autonomous suit). */
  setVisible(v: boolean): void {
    this.root.setEnabled(v);
    this.shadow.setEnabled(v);
    for (const ps of this.particles) ps.emitRate = 0;
  }

  get transforming(): boolean {
    return this.armorT >= 0;
  }

  private setCivilian(on: boolean): void {
    if (on === this.civShown) return;
    this.civShown = on;
    for (const m of this.civ) m.setEnabled(on);
  }

  private setArmorVisible(on: boolean): void {
    this.armorShown = on;
    for (const part of this.parts) part.mesh.setEnabled(on);
  }

  update(dt: number, p: AvatarState): void {
    this.time += dt;
    const t = this.time;
    this.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    // In flight, barrel rolls and banking turn about the body's long axis
    // (head to toe), so a right turn drops the right arm and lifts the left.
    const flying = p.mode === "flight";
    const q = this.pivot.rotationQuaternion!;
    Quaternion.RotationYawPitchRollToRef(p.bodyYaw + p.trickYaw, p.bodyPitch + p.trickPitch, p.bodyRoll + (flying ? 0 : p.rollSpin), q);
    const bank = (p.bank ?? 0) + (flying ? p.rollSpin : 0);
    if (Math.abs(bank) > 1e-4) {
      Quaternion.RotationAxisToRef(ArmorModel.UP, bank, this.qBank);
      q.multiplyInPlace(this.qBank);
    }
    // Keep visuals consistent if state changed without an animation (respawn etc.).
    if (this.armorT < 0 && !this.latch) {
      if (this.armorShown !== p.suited) this.setArmorVisible(p.suited);
      this.setCivilian(!p.suited && this.withCivilian);
    }

    // Pose selection.
    const planar = Math.hypot(p.vel.x, p.vel.z);
    let pose: Pose;
    let pivotY = 1.0;
    if (p.mode === "ground" && p.falling && p.blackout) {
      // Unconscious: limp, arms trailing up, head lolling.
      pose = {
        spine: [0.1, Math.sin(t * 1.3) * 0.1],
        neck: [0.5, Math.sin(t * 0.9) * 0.3],
        shL: [-2.6, -0.4],
        shR: [-2.5, 0.4],
        elL: [-0.3, 0],
        elR: [-0.4, 0],
        hipL: [-0.4, -0.1],
        hipR: [-0.2, 0.1],
        knL: [0.5, 0],
        knR: [0.9, 0],
      };
    } else if (p.mode === "ground" && p.falling) {
      // Skydive: arched back, arms and legs spread (civilians flail).
      const flail = p.suited ? 0 : Math.sin(t * 9) * 0.35;
      pose = {
        spine: [-0.25, 0],
        neck: [-0.75, 0],
        shL: [-0.5 + flail, -1.35],
        shR: [-0.5 - flail, 1.35],
        elL: [-0.9, 0],
        elR: [-0.9, 0],
        hipL: [-0.15 - flail * 0.5, -0.28],
        hipR: [-0.15 + flail * 0.5, 0.28],
        knL: [0.85, 0],
        knR: [0.85, 0],
      };
    } else if (p.mode === "ground" && p.agl > 0.35 && p.vel.y !== 0) {
      // Jump / short drop: knees tucked, arms up for balance.
      const up = p.vel.y > 0;
      pose = {
        spine: [up ? 0.15 : 0.05, 0],
        neck: [-0.1, 0],
        hipL: [-0.7, -0.08],
        hipR: [-0.45, 0.08],
        knL: [1.2, 0],
        knR: [0.8, 0],
        shL: [-0.6, -0.5],
        shR: [-0.5, 0.5],
        elL: [-0.6, 0],
        elR: [-0.6, 0],
      };
    } else if (p.mode === "ground") {
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
      // Superhero landing: knee and fist planted, head bowed... then the slow
      // rise, head coming up last.
      const sl = p.superLanding ?? 0;
      if (sl > 0 && p.suited) {
        const hold = clamp((sl - 0.25) / 0.3, 0, 1);
        const SL: Pose = {
          spine: [0.7, -0.08],
          neck: [0.45 - (1 - hold) * 0.9, 0],
          hipL: [-1.65, -0.12],
          knL: [2.25, 0],
          hipR: [0.5, 0.2],
          knR: [2.2, 0],
          // The torso leans ~0.7 rad forward, so the planted arm swings back
          // relative to it to point straight down at the ground.
          shR: [0.5, 0.15],
          elR: [-0.05, 0],
          // Other arm swept back and up.
          shL: [1.5, -0.75],
          elL: [-0.25, 0],
        };
        const k = clamp(sl / 0.25, 0, 1);
        for (const j of Object.keys(SL) as JointName[]) {
          const a0 = pose[j] ?? [0, 0];
          const b0 = SL[j]!;
          pose[j] = [a0[0] + (b0[0] - a0[0]) * k, a0[1] + (b0[1] - a0[1]) * k];
        }
        pivotY = Math.min(pivotY, 1.0 - 0.48 * k);
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
      // Climbing: legs straight, arms pushing down. Sinking: knees bend.
      const vy = clamp(p.vel.y / 10, -1, 1);
      if (vy > 0.15) {
        pose.shL = [0.25 * vy, -0.25];
        pose.shR = [0.25 * vy, 0.25];
        pose.elL = [-0.05, 0];
        pose.elR = [-0.05, 0];
        pose.knL = [0.04, 0];
        pose.knR = [0.04, 0];
      } else if (vy < -0.15) {
        pose.knL = [0.18 - vy * 0.5, 0];
        pose.knR = [0.12 - vy * 0.4, 0];
        pose.hipL = [(pose.hipL?.[0] ?? 0) + vy * 0.3, pose.hipL?.[1] ?? 0];
        pose.hipR = [(pose.hipR?.[0] ?? 0) + vy * 0.25, pose.hipR?.[1] ?? 0];
      }
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
      // Steer with the arms: in a bank the lower arm tucks in, the upper one
      // flares out like a wing, and the legs trail toward the outside.
      const bk = Math.max(-1, Math.min(1, (p.bank ?? 0) / 1.5));
      pose.shL = [pose.shL![0] + Math.abs(bk) * 0.15, pose.shL![1] - Math.max(0, -bk) * 0.55 + Math.max(0, bk) * 0.12];
      pose.shR = [pose.shR![0] + Math.abs(bk) * 0.15, pose.shR![1] + Math.max(0, bk) * 0.55 - Math.max(0, -bk) * 0.12];
      pose.hipL = [pose.hipL![0], pose.hipL![1] - bk * 0.12];
      pose.hipR = [pose.hipR![0], pose.hipR![1] - bk * 0.12];

      // Speed streamlines the body: at cruise the legs paddle and the arms
      // hang loose; flat out, the arms tuck in and the legs lock straight.
      const spd = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      const fast = clamp((spd - 50) / 150, 0, 1);
      const paddle = Math.sin(t * 2.4) * 0.09 * (1 - fast);
      pose.knL = [pose.knL![0] * (1 - fast) + Math.max(0, paddle) * 1.5, 0];
      pose.knR = [pose.knR![0] * (1 - fast) + Math.max(0, -paddle) * 1.5, 0];
      pose.hipL = [pose.hipL![0] + paddle, pose.hipL![1]];
      pose.hipR = [pose.hipR![0] - paddle, pose.hipR![1]];
      pose.shL = [pose.shL![0] + fast * 0.12, pose.shL![1] * (1 - fast * 0.5)];
      pose.shR = [pose.shR![0] + fast * 0.12, pose.shR![1] * (1 - fast * 0.5)];
      pose.elL = [-0.06 - (1 - fast) * 0.2, 0];
      pose.elR = [-0.06 - (1 - fast) * 0.2, 0];

      // Dives: arms sweep right back and the legs press together. Climbs:
      // the arms open a little for lift and the knees drive.
      const climb = clamp(p.vel.y / Math.max(30, spd), -1, 1);
      if (climb < 0) {
        const d = -climb;
        pose.shL = [pose.shL![0] + d * 0.3, pose.shL![1] * (1 - d * 0.6)];
        pose.shR = [pose.shR![0] + d * 0.3, pose.shR![1] * (1 - d * 0.6)];
        pose.hipL = [pose.hipL![0], pose.hipL![1] + d * 0.05];
        pose.hipR = [pose.hipR![0], pose.hipR![1] - d * 0.05];
        pose.neck = [pose.neck![0] - d * 0.15, 0];
      } else {
        pose.shL = [pose.shL![0], pose.shL![1] - climb * 0.3];
        pose.shR = [pose.shR![0], pose.shR![1] + climb * 0.3];
        pose.knL = [pose.knL![0] + climb * 0.25, 0];
        pose.knR = [pose.knR![0] + climb * 0.15, 0];
      }

      // Afterburner surge: the arms whip back, the chest pushes out and the
      // legs snap together as the boots light.
      if (p.afterburner && !this.lastBurn) this.surge = 1;
      this.lastBurn = p.afterburner;
      if (this.surge > 0.01) {
        const k = Math.sin(this.surge * Math.PI);
        pose.spine = [pose.spine![0] - k * 0.2, 0];
        pose.shL = [pose.shL![0] + k * 0.45, pose.shL![1] * (1 - k * 0.7)];
        pose.shR = [pose.shR![0] + k * 0.45, pose.shR![1] * (1 - k * 0.7)];
        pose.knL = [pose.knL![0] * (1 - k), 0];
        pose.knR = [pose.knR![0] * (1 - k), 0];
        this.surge = Math.max(0, this.surge - dt * 2.2);
      }

      // RUSH: chin up, chest proud.
      const rush = p.rush ?? 0;
      pose.spine = [pose.spine![0] - rush * 0.12, pose.spine![1]];
      pose.neck = [pose.neck![0] - rush * 0.1, 0];

      // Afterburner and hypersonic buffeting: a fast shimmer through the body.
      const buzz = (p.hypersonic ? 1 : p.afterburner ? 0.35 : 0) * fast;
      if (buzz > 0) {
        pose.spine = [pose.spine![0] + Math.sin(t * 37) * 0.025 * buzz, pose.spine![1] + Math.sin(t * 29) * 0.02 * buzz];
        pose.shL = [pose.shL![0] + Math.sin(t * 41) * 0.05 * buzz, pose.shL![1]];
        pose.shR = [pose.shR![0] + Math.sin(t * 43 + 1) * 0.05 * buzz, pose.shR![1]];
      }

      // Air-braking: flare out. The arms swing forward and spread, palms
      // pushing against the air, and the legs swing down under the body.
      if (p.braking) {
        pose.shL = [-1.15, -0.65];
        pose.shR = [-1.15, 0.65];
        pose.elL = [-0.35, 0];
        pose.elR = [-0.35, 0];
        pose.hipL = [-0.85, -0.08];
        pose.hipR = [-0.75, 0.08];
        pose.knL = [0.55, 0];
        pose.knR = [0.45, 0];
        pose.neck = [-0.8, 0];
      }
    }
    if (!flying) {
      this.surge = 0;
      this.lastBurn = false;
    }
    // Victory: a fist punched to the sky, pumping, other fist at the hip.
    const cheer = p.cheer ?? 0;
    if (cheer > 0 && p.suited && p.mode !== "flight") {
      const k = Math.min(1, cheer * 4);
      const pump = cheer > 0.5 ? Math.max(0, Math.sin(t * 11)) * 0.45 : 0;
      const C: Pose = { shR: [-2.95, 0.18], elR: [-0.05 - pump, 0], shL: [0.15, -0.35], elL: [-1.3, 0], neck: [-0.3, 0], spine: [-0.1, 0] };
      for (const j of Object.keys(C) as JointName[]) {
        const a0 = pose[j] ?? [0, 0];
        const b0 = C[j]!;
        pose[j] = [a0[0] + (b0[0] - a0[0]) * k, a0[1] + (b0[1] - a0[1]) * k];
      }
    }
    // Scanning a bomb (right palm out at it) / reaching for a pickup (left hand).
    let turnTo = 0;
    for (const [at, side] of [[p.scanAt, 1], [p.reachAt, -1]] as const) {
      if (!at || !p.suited || p.mode === "flight") continue;
      const dx = at.x - p.pos.x, dy = at.y - (p.pos.y + 1.5), dz = at.z - p.pos.z;
      const el = Math.atan2(dy, Math.hypot(dx, dz));
      const bearing = Math.atan2(Math.sin(Math.atan2(dx, dz) - p.bodyYaw), Math.cos(Math.atan2(dx, dz) - p.bodyYaw));
      const sh = side > 0 ? "shR" : "shL", elb = side > 0 ? "elR" : "elL";
      pose[sh] = [clamp(-Math.PI / 2 - el, -2.7, -0.3), side * (0.12 + Math.max(0, side * bearing) * 0.6)];
      pose[elb] = [side > 0 ? -0.05 : -0.25, 0];
      if (side > 0) turnTo = bearing;
    }
    this.scanTurn += (clamp(turnTo, -0.8, 0.8) * 0.5 - this.scanTurn) * damp(6, dt);
    // Choreographed suit-up: present each limb as its plates arrive.
    let suitLook = 0;
    if (this.latch?.staged && p.mode === "ground" && planar < 0.5 && !p.dead) {
      const c = suitUpPose(this.latch.t);
      pose = { ...pose, ...c.pose };
      suitLook = c.look;
    }
    this.suitLook += (suitLook - this.suitLook) * damp(6, dt);
    // Firing poses: repulsor palm out, both forearms up for rockets.
    if (p.suited) {
      const up = p.mode === "flight" ? 0 : p.viewPitch;
      if (p.rocketTimer > 0) {
        const a = p.mode === "flight" ? -2.7 : -1.3 - up;
        pose.shL = [a, -0.28];
        pose.shR = [a, 0.28];
        pose.elL = [-0.35, 0];
        pose.elR = [-0.35, 0];
      } else if (p.aimTimer > 0) {
        // Repulsors alternate hands: the firing arm punches straight out at
        // the target, palm open, while the other is held cocked at the ready.
        const h = p.fireHand ?? 1;
        const flight = p.mode === "flight";
        const shot: [number, number] = [flight ? -2.95 : -1.5 - up, 0.12 * h];
        const ready: [number, number] = [flight ? -2.2 : -1.05 - up * 0.8, 0.22 * h];
        const elShot: [number, number] = [-0.05, 0];
        const elReady: [number, number] = [-1.0, 0];
        if (h > 0) {
          pose.shR = shot;
          pose.elR = elShot;
          pose.shL = ready;
          pose.elL = elReady;
        } else {
          pose.shL = shot;
          pose.elL = elShot;
          pose.shR = ready;
          pose.elR = elReady;
        }
        // Lean into the shooting stance.
        pose.spine = [(pose.spine?.[0] ?? 0) + (flight ? 0 : -0.06), (pose.spine?.[1] ?? 0) - h * 0.05];
      }
    }
    // Unibeam: chest thrust forward, arms swept back and out.
    const beam = p.beamTimer ?? 0;
    if (beam > 0 && p.suited) {
      pose.spine = [-0.3, 0];
      pose.neck = [p.mode === "flight" ? -1.0 : 0.15, 0];
      pose.shL = [0.75, -0.75];
      pose.shR = [0.75, 0.75];
      pose.elL = [-0.5, 0];
      pose.elR = [-0.5, 0];
    }
    this.beamGlow += ((beam > 0 ? 1 : 0) - this.beamGlow) * damp(beam > 0 ? 14 : 4, dt);
    // Take-off: a quick crouch-and-spring as the thrusters fire.
    if (p.mode !== this.lastMode) {
      if (this.lastMode === "ground" && p.suited && p.agl < 3) this.launch = 1;
      this.lastMode = p.mode;
    }
    if (this.launch > 0.01) {
      const l = this.launch;
      const k = Math.sin(l * Math.PI) * 0.9;
      pose.hipL = [(pose.hipL?.[0] ?? 0) - k * 0.9, pose.hipL?.[1] ?? 0];
      pose.hipR = [(pose.hipR?.[0] ?? 0) - k * 0.9, pose.hipR?.[1] ?? 0];
      pose.knL = [(pose.knL?.[0] ?? 0) + k * 1.4, 0];
      pose.knR = [(pose.knR?.[0] ?? 0) + k * 1.4, 0];
      pose.shL = [0.5 * l, -0.35];
      pose.shR = [0.5 * l, 0.35];
      pivotY -= k * 0.35;
      this.launch = Math.max(0, this.launch - dt * 2.8);
    }
    // Idle on the ground: slowly shift weight from leg to leg.
    if (p.mode === "ground" && Math.hypot(p.vel.x, p.vel.z) < 0.3 && p.landingTimer <= 0) {
      this.idleT += dt;
      const w = Math.sin(this.idleT * 0.7) * Math.min(1, this.idleT / 3);
      pose.hipL = [(pose.hipL?.[0] ?? 0) + Math.max(0, w) * 0.12, (pose.hipL?.[1] ?? 0) - w * 0.05];
      pose.knL = [(pose.knL?.[0] ?? 0) + Math.max(0, w) * 0.2, 0];
      pose.hipR = [(pose.hipR?.[0] ?? 0) + Math.max(0, -w) * 0.12, (pose.hipR?.[1] ?? 0) - w * 0.05];
      pose.knR = [(pose.knR?.[0] ?? 0) + Math.max(0, -w) * 0.2, 0];
      pose.spine = [(pose.spine?.[0] ?? 0), (pose.spine?.[1] ?? 0) + w * 0.04];
    } else this.idleT = 0;
    // Repulsor recoil: the firing forearm kicks back.
    const rc = p.recoil ?? 0;
    const hand = p.fireHand ?? 1;
    if (p.suited && rc > (this.lastRecoil ?? 0) + 0.3) {
      // A new shot: flash that palm.
      if (hand > 0) this.blastR = 1;
      else this.blastL = 1;
    }
    this.lastRecoil = rc;
    this.blastL = Math.max(0, this.blastL - dt * 9);
    this.blastR = Math.max(0, this.blastR - dt * 9);
    if (rc > 0) {
      // The firing arm kicks back at the elbow, the shoulder jolts and the
      // torso rocks away from the blast.
      const sh = hand > 0 ? "shR" : "shL", el = hand > 0 ? "elR" : "elL";
      const s0 = pose[sh] ?? [0, 0];
      pose[sh] = [s0[0] + rc * 0.25, s0[1] + hand * rc * 0.08];
      pose[el] = [(pose[el]?.[0] ?? 0) - rc * 0.45, 0];
      pose.spine = [(pose.spine?.[0] ?? 0) - rc * 0.06, (pose.spine?.[1] ?? 0) + hand * rc * 0.05];
      pose.neck = [(pose.neck?.[0] ?? 0) - rc * 0.04, pose.neck?.[1] ?? 0];
    }
    // Flares: arms flung out wide.
    const fl0 = p.flareTimer ?? 0;
    if (fl0 > 0 && p.suited) {
      const k = Math.min(1, fl0 / 0.25);
      pose.shL = [0.2, -1.4 * k];
      pose.shR = [0.2, 1.4 * k];
      pose.elL = [-0.1, 0];
      pose.elR = [-0.1, 0];
    }
    // Hit flinch: torso jolts away from the impact.
    const fl = p.flinch ?? 0;
    if (fl > 0) {
      const sd = p.flinchSide ?? 1;
      pose.spine = [(pose.spine?.[0] ?? 0) - fl * 0.35, (pose.spine?.[1] ?? 0) + sd * fl * 0.3];
      pose.neck = [(pose.neck?.[0] ?? 0) - fl * 0.3, sd * fl * 0.2];
    }
    // Dead: crumple to the ground.
    if (p.dead) {
      const u = Math.min(1, (p.deadTime ?? 0) / 0.6);
      pose = {
        spine: [0.9 * u, 0.2 * u],
        neck: [0.6 * u, 0.3 * u],
        hipL: [-1.4 * u, -0.3 * u],
        hipR: [-1.2 * u, 0.25 * u],
        knL: [2.0 * u, 0],
        knR: [1.6 * u, 0],
        shL: [0.4 * u, -1.0 * u],
        shR: [0.6 * u, 0.8 * u],
        elL: [-0.6 * u, 0],
        elR: [-0.3 * u, 0],
      };
      pivotY = 1.0 - 0.7 * u;
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
    // Head (and a little of the torso) turn toward where you're looking.
    let look = 0;
    if (p.viewYaw !== undefined && p.mode !== "flight") {
      const d = Math.atan2(Math.sin(p.viewYaw - p.bodyYaw), Math.cos(p.viewYaw - p.bodyYaw));
      look = clamp(d, -1.1, 1.1);
    }
    // Hovering still for a while: the head scans the city.
    this.hoverIdle = p.mode === "hover" && planar < 1 && p.aimTimer <= 0 ? this.hoverIdle + dt : 0;
    if (this.hoverIdle > 3) look += Math.sin((this.hoverIdle - 3) * 0.7) * 0.7 * Math.min(1, (this.hoverIdle - 3) / 1.5);
    this.lookYaw += (look - this.lookYaw) * damp(6, dt);
    this.joints.neck.node.rotation.y = this.lookYaw * 0.65 + this.suitLook;
    // Torso twists toward the firing hand, swinging side to side as the hands alternate.
    this.twist += ((p.aimTimer > 0 && p.suited && p.mode !== "flight" ? (p.fireHand ?? 1) * -0.16 : 0) - this.twist) * damp(10, dt);
    this.joints.spine.node.rotation.y = this.lookYaw * 0.3 + this.twist + this.scanTurn;

    // Thrusters.
    const airborne = p.mode !== "ground" && p.suited && this.armorShown;
    const boot = airborne ? 0.25 + p.thrust * (p.afterburner ? 1.9 : 1.1) : 0;
    const palm = p.mode === "hover" ? 0.25 + p.thrust * 0.45 : p.mode === "flight" ? 0.12 + (p.afterburner ? 0.35 : 0) : 0;
    const charged = (p.aimTimer > 0 || p.scanAt) && p.suited ? 0.12 : 0;
    for (const f of this.flames) {
      // Palms: a hot repulsor blast from the hand that just fired, and a faint
      // charged glow on both while the repulsors are hot.
      const blast = f.kind === "palm" ? (f.side > 0 ? this.blastR : this.blastL) : 0;
      const base = f.kind === "boot" ? boot : Math.max(palm, charged) + blast * 1.4;
      const flick = 0.82 + 0.18 * Math.sin(t * 47 + f.seed * 7) + 0.08 * Math.sin(t * 91 + f.seed);
      const len = base * flick;
      f.mesh.setEnabled(len > 0.02);
      f.mesh.scaling.set(1 + base * 0.2, Math.max(0.01, len), 1 + base * 0.2);
    }
    for (const ps of this.particles) ps.emitRate = airborne ? 40 + p.thrust * (p.afterburner ? 260 : 120) : 0;

    const energy = p.suit.energy / 100;
    const pulse = 0.85 + 0.15 * Math.sin(t * 3);
    const bg = this.beamGlow;
    const gb = this.glowBase;
    const lvl = 0.65 + 0.35 * energy * pulse;
    this.glowMat.emissiveColor.set(gb.r * lvl + bg * 0.5, gb.g * lvl + bg * 0.5, gb.b * lvl + bg * 0.6);

    // Blob shadow on the surface below.
    const groundY = p.pos.y - p.agl;
    this.shadow.position.set(p.pos.x, groundY + 0.04, p.pos.z);
    const sh = clamp(1 - p.agl / 35, 0, 1);
    this.shadow.setEnabled(sh > 0.02);
    const sz = 0.8 + p.agl * 0.04;
    this.shadow.scaling.set(sz, sz, sz);
    this.shadow.visibility = sh;

    this.updateArmorAnim(dt);
    this.updateLatch(dt);
    this.updateOpen(dt);
  }

  private updateArmorAnim(dt: number): void {
    if (this.armorT < 0) return;
    this.armorT += dt;
    const total = 1.3;
    for (const part of this.parts) {
      const m = part.mesh;
      const s0 = m.metadata.s as Vector3;
      const p0 = m.metadata.p as Vector3;
      // Assemble from the feet up; peel away from the head down.
      const delay = this.armorIn ? part.delay : 1 - part.delay;
      const local = clamp((this.armorT - delay * 0.8) / 0.35, 0, 1);
      const e = this.armorIn ? 1 - Math.pow(1 - local, 3) : 1 - local * local;
      m.setEnabled(e > 0.01);
      m.scaling.set(s0.x * e, s0.y * e, s0.z * e);
      const spread = 1 + (1 - e) * 2.2;
      m.position.set(p0.x * spread, p0.y + (1 - e) * (this.armorIn ? -0.3 : 0.4), p0.z * spread + (1 - e) * 0.15);
    }
    if (this.armorIn && this.armorT > total * 0.75) this.setCivilian(false);
    if (this.armorT > total) {
      for (const part of this.parts) {
        const md = part.mesh.metadata as { s: Vector3; p: Vector3 } | undefined;
        if (md) {
          part.mesh.scaling.copyFrom(md.s);
          part.mesh.position.copyFrom(md.p);
        }
      }
      this.setArmorVisible(this.armorIn);
      this.setCivilian(!this.armorIn);
      this.armorT = -1;
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
