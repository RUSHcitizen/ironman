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
  /** Where the pilot is looking (head and torso turn toward it). */
  readonly viewYaw?: number;
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
  private latch: { t: number; starts: Vector3[]; landed: boolean[]; lastDelay: number; speed: number } | null = null;
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

    if (this.withCivilian) this.buildCivilian();
    // Remember every part's rest transform (used by the suit-up animations).
    for (const part of this.parts) part.mesh.metadata = { s: part.mesh.scaling.clone(), p: part.mesh.position.clone() };

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

  playSuitUp(): void {
    this.latchFrom(null);
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
    this.latch = { t: 0, starts, landed: this.parts.map(() => false), lastDelay: -1, speed };
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
    if (p.mode === "ground" && p.falling) {
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
      // Steer with the arms: in a bank the lower arm tucks in, the upper one
      // flares out like a wing, and the legs trail toward the outside.
      const bk = Math.max(-1, Math.min(1, (p.bank ?? 0) / 1.5));
      pose.shL = [pose.shL![0] + Math.abs(bk) * 0.15, pose.shL![1] - Math.max(0, -bk) * 0.55 + Math.max(0, bk) * 0.12];
      pose.shR = [pose.shR![0] + Math.abs(bk) * 0.15, pose.shR![1] + Math.max(0, bk) * 0.55 - Math.max(0, -bk) * 0.12];
      pose.hipL = [pose.hipL![0], pose.hipL![1] - bk * 0.12];
      pose.hipR = [pose.hipR![0], pose.hipR![1] - bk * 0.12];
    }
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
        pose.shR = [p.mode === "flight" ? -2.95 : -1.5 - up, 0.12];
        pose.elR = [-0.05, 0];
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
    this.lookYaw += (look - this.lookYaw) * damp(6, dt);
    this.joints.neck.node.rotation.y = this.lookYaw * 0.65;
    this.joints.spine.node.rotation.y = this.lookYaw * 0.3;

    // Thrusters.
    const airborne = p.mode !== "ground" && p.suited && this.armorShown;
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
