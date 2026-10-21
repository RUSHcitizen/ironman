import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { RenderingGroup } from "@babylonjs/core/Rendering/renderingGroup";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { setInstanceCount } from "../world/instancing";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { EventBus, type GameEvents } from "./EventBus";
import { Settings, QUALITY_PRESETS, type Quality } from "./Settings";
import type { DeviceInfo } from "./device";
import { CollisionWorld } from "../world/Collision";
import { WorldMaterials } from "../world/Materials";
import { Environment } from "../world/Environment";
import { PropSystem } from "../world/Props";
import { ChunkManager } from "../world/ChunkManager";
import { TrafficSystem } from "../world/Traffic";
import { PedestrianSystem } from "../world/Pedestrians";
import { CHUNK_SIZE, HERO_BLOCK, BLOCK_SIZE, blockOrigin } from "../world/WorldConfig";
import { PlayerController, TUNING } from "../player/PlayerController";
import { ArmorModel } from "../player/ArmorModel";
import { SpeedFx } from "../player/SpeedFx";
import { SuitUnit } from "../player/SuitUnit";
import type { CombatTarget } from "../combat/Targets";
import type { AvatarState } from "../player/ArmorModel";
import { ThirdPersonCamera } from "../camera/ThirdPersonCamera";
import { InputManager } from "../input/InputManager";
import { Hud, type HudMarker, type HudTarget } from "../ui/Hud";
import { SettingsMenu } from "../ui/SettingsMenu";
import { SuitAudio } from "../audio/SuitAudio";
import { CityEvents } from "../gameplay/CityEvents";
import { EnemyManager, ENEMY_STATS, AIR_KINDS, type EnemyKind } from "../combat/Enemies";
import { ProjectileSystem } from "../combat/Projectiles";
import { Combat, MAX_ROCKETS, aimDirection } from "../combat/Combat";
import { EnemyRenderer } from "../combat/EnemyRenderer";
import { ProjectileRenderer } from "../combat/ProjectileRenderer";
import { DEG } from "./math";

export type Progress = (fraction: number, label: string) => Promise<void>;

const HERO_X = blockOrigin(HERO_BLOCK.i) + BLOCK_SIZE / 2;
const HERO_Z = blockOrigin(HERO_BLOCK.j) + BLOCK_SIZE / 2;
export const SPAWN = { x: HERO_X - 4, y: 147.2, z: HERO_Z - 6, yaw: 35 * DEG };

const QUALITY_ORDER: Quality[] = ["low", "medium", "high"];

export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly scene: Scene;
  readonly world = new CollisionWorld();
  mats!: WorldMaterials;
  env!: Environment;
  props!: PropSystem;
  chunks!: ChunkManager;
  traffic!: TrafficSystem;
  peds!: PedestrianSystem;
  player!: PlayerController;
  avatar!: ArmorModel;
  cam!: ThirdPersonCamera;
  input!: InputManager;
  hud!: Hud;
  menu!: SettingsMenu;
  audio!: SuitAudio;
  events!: CityEvents;
  enemies!: EnemyManager;
  projectiles!: ProjectileSystem;
  combat!: Combat;
  private enemyRenderer!: EnemyRenderer;
  private projRenderer!: ProjectileRenderer;
  private speedFx!: SpeedFx;
  /** The armour as an independent unit (parked, sentry, flying in). */
  suitUnit!: SuitUnit;
  private suitAvatar!: ArmorModel;
  private targets: CombatTarget[] = [];
  private suitMarker: HudMarker = { id: "suit", label: "SUIT", x: 0, z: 0, kind: "suit" };
  private lastSuitState = "worn";
  private shadowGen: ShadowGenerator | null = null;
  private paused = true;
  private started = false;
  private visTimer = 0;
  private areaTimer = 0;
  private area = "";
  private perfTime = 0;
  private perfFrames = 0;
  private lowPerfStrikes = 0;
  private runTime = 0;
  private time = 0;
  private failTimer = 0;
  /** Sentry mode: you pilot the empty suit while your body stands where you left it. */
  remote = false;
  private body: AvatarState = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    mode: "ground",
    suited: false,
    bodyYaw: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    rollSpin: 0,
    trickPitch: 0,
    trickYaw: 0,
    walkPhase: 0,
    landingTimer: 0,
    viewPitch: 0,
    rocketTimer: 0,
    aimTimer: 0,
    thrust: 0,
    afterburner: false,
    agl: 0,
    suit: { energy: 100 },
  };
  private bodyMarker: HudMarker = { id: "body", label: "YOU", x: 0, z: 0, kind: "suit" };
  private projectM = Matrix.Identity();
  private projectV = new Vector3();

  constructor(
    readonly engine: Engine,
    private canvas: HTMLCanvasElement,
    private uiRoot: HTMLElement,
    readonly settings: Settings,
    readonly device: DeviceInfo,
  ) {
    this.scene = new Scene(engine);
    this.scene.skipPointerMovePicking = true;
    // Draw near geometry first and large backdrops (ground, water, sky) last
    // to minimise overdraw - fill rate is the main cost on mobile GPUs.
    const order = (m: SubMesh) => (m.getMesh().metadata?.drawOrder as number | undefined) ?? 0;
    this.scene.setRenderingOrder(0, (a, b) => order(a) - order(b) || RenderingGroup.frontToBackSortCompare(a, b));
  }

  async init(progress: Progress): Promise<void> {
    const scene = this.scene;
    await progress(0.05, "Generating materials");
    this.mats = new WorldMaterials(scene);
    await progress(0.1, "Building skyline and harbour");
    this.env = new Environment(scene, this.mats);
    this.props = new PropSystem(scene, this.mats);
    this.chunks = new ChunkManager(scene, this.mats, this.world, this.props);
    await progress(0.15, "Surveying 33 km² of city");
    this.chunks.registerWorld();
    await progress(0.3, "Constructing nearby districts");
    this.chunks.loadAround(SPAWN.x, SPAWN.z, this.settings.preset.viewDistance);
    await progress(0.6, "Populating streets");
    this.traffic = new TrafficSystem(scene, this.mats, QUALITY_PRESETS.high.cars);
    this.peds = new PedestrianSystem(scene, this.mats, QUALITY_PRESETS.high.pedestrians);
    this.traffic.scatter(SPAWN.x, SPAWN.z);
    this.peds.scatter(SPAWN.x, SPAWN.z);

    await progress(0.68, "Calibrating armour and weapons");
    this.player = new PlayerController(this.world, this.bus);
    this.player.spawn(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw);
    this.avatar = new ArmorModel(scene);
    this.cam = new ThirdPersonCamera(scene);
    this.enemies = new EnemyManager(this.world, this.bus);
    this.projectiles = new ProjectileSystem(this.world, this.enemies, this.targets, this.bus);
    this.suitUnit = new SuitUnit(this.world, this.player.suit, this.enemies, this.projectiles, this.bus);
    this.targets.push(this.player, this.suitUnit);
    this.suitAvatar = new ArmorModel(scene, false);
    // Plates clamping shut after the step-out.
    this.suitAvatar.onLatch = (w, i) => this.bus.emit("suitLatch", { x: w.x, y: w.y, z: w.z, part: i });
    this.avatar.onLatch = (w, i) => {
      this.projectiles.fx.push({ kind: "spark", x: w.x, y: w.y, z: w.z, size: 0.9, t: 0, life: 0.18, yaw: 0, pitch: 0 });
      this.bus.emit("suitLatch", { x: w.x, y: w.y, z: w.z, part: i });
    };
    this.combat = new Combat(this.world, this.enemies, this.projectiles, this.bus);
    this.enemyRenderer = new EnemyRenderer(scene, this.mats);
    this.projRenderer = new ProjectileRenderer(scene, this.mats);
    this.speedFx = new SpeedFx(scene, this.mats);
    this.events = new CityEvents(scene, this.mats, this.world, this.bus, this.enemies);
    this.events.onComplete = (combat) => {
      this.player.suit.repair(combat ? 40 : 15);
      this.player.suit.charge(50);
      this.combat.refill();
    };

    this.input = new InputManager(this.canvas, this.uiRoot, this.settings, this.device.isTouch);
    this.input.onModeChange = () => this.updateHint();
    this.hud = new Hud(this.uiRoot, this.bus);
    this.hud.onMenu = () => this.setPaused(true);
    this.menu = new SettingsMenu(this.uiRoot, this.settings, { onResume: () => this.setPaused(false), onRespawn: () => this.respawn() }, this.device.isTouch);
    this.audio = new SuitAudio(this.bus);
    this.hud.setVisible(false);
    this.input.touch.setVisible(false);
    this.wireEvents();
    this.settings.onChange(() => this.applySettings());
    this.applySettings();
    this.updateHint();

    // Prime one simulation step so the first frame is posed correctly.
    this.avatar.update(0.016, this.player);
    this.cam.update(0.016, this.player, this.world);
    this.chunks.updateVisibility(this.cam.position.x, this.cam.position.z, this.settings.preset.viewDistance);
    this.props.update(this.cam.position.x, this.cam.position.z, this.settings.preset.propDistance, this.settings.preset.viewDistance, CHUNK_SIZE);

    await progress(0.8, "Compiling shaders");
    await this.prewarmShaders();
    this.suitAvatar.setVisible(false);
    await progress(1, "Systems online");

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 250));
    window.visualViewport?.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.started) this.setPaused(true);
    });
    this.resize();
    this.engine.runRenderLoop(() => this.frame());
  }

  /**
   * Compile every shader variant up front (civilian, enemies, projectiles,
   * effects) so nothing hitches the first time it appears mid-game.
   */
  private async prewarmShaders(): Promise<void> {
    const restore: (() => void)[] = [];
    for (const m of this.scene.meshes) {
      if (!m.isEnabled()) {
        m.setEnabled(true);
        restore.push(() => m.setEnabled(false));
      }
      const mesh = m as unknown as { thinInstanceCount?: number; hasThinInstances?: boolean };
      if (mesh.hasThinInstances === false && typeof mesh.thinInstanceCount === "number" && (m as unknown as { _thinInstanceDataStorage?: { matrixData?: unknown } })._thinInstanceDataStorage?.matrixData) {
        mesh.thinInstanceCount = 1;
        restore.push(() => setInstanceCount(m as Mesh, 0));
      }
    }
    await this.scene.whenReadyAsync();
    this.scene.render();
    for (const r of restore) r();
  }

  private wireEvents(): void {
    const bus = this.bus;
    bus.on("modeChanged", () => this.syncTouchMode());
    bus.on("impact", (e) => this.cam.addShake(Math.min(1, e.speed / 60)));
    bus.on("landed", (e) => {
      this.cam.addShake(e.hard ? 0.7 : 0.15);
      this.updateHint();
    });
    bus.on("suitTransform", (e) => {
      if (e.toSuited) {
        if (!this.avatar.latching) this.avatar.startTransform(true);
        bus.emit("alert", { text: "Suit's here, boss - locking on", level: "info", ttl: 3 });
      } else {
        this.stepOutOfSuit();
        if (!e.airborne) bus.emit("alert", { text: "Stepped out of the suit · G to call it · V to pilot it as a sentry", level: "info", ttl: 4 });
      }
      this.syncTouchMode(e.toSuited);
    });
    bus.on("suitChanged", () => this.syncTouchMode());
    bus.on("playerHit", (e) => {
      this.hud.damageFlash(e.damage);
      this.cam.addShake(Math.min(0.6, e.damage / 25));
    });
    bus.on("evaded", () => this.hud.popup("EVADED"));
    bus.on("boost", () => this.cam.addKick(0.1));
    bus.on("sonicBoom", (e) => {
      const p = this.player;
      this.projectiles.sonicBoom(e, p.viewYaw, p.viewPitch);
      this.cam.addShake(0.6);
      this.cam.addKick(0.2);
      this.hud.popup("SONIC BOOM");
    });
    bus.on("trick", (e) => this.hud.popup(e.combo > 1 ? `${e.name} ×${e.combo}` : e.name));
    bus.on("nearMiss", (e) => this.hud.popup(e.streak > 1 ? `CLOSE CALL ×${e.streak}` : "CLOSE CALL"));
    bus.on("kill", (e) => this.hud.popup(`${e.kind.toUpperCase()} DOWN · +${ENEMY_STATS[e.kind as EnemyKind].score}`));
    bus.on("weapon", (w) => {
      if (w.kind !== "repulsor") this.peds.panic(w.x, w.z, w.kind === "laser" ? 60 : 35);
    });
    bus.on("explosion", (e) => {
      this.peds.panic(e.x, e.z, 40 + e.size * 4);
      const d = Math.hypot(e.x - this.player.pos.x, e.y - this.player.pos.y, e.z - this.player.pos.z);
      if (d < 60) this.cam.addShake(Math.min(0.8, (e.size / 10) * (1 - d / 60)));
    });
    bus.on("playerDied", (e) => {
      const fast = Math.round(e.speed * 3.6);
      this.hud.showDeath(e.cause === "water" ? "IMPACT · WATER" : "FATAL FALL", `Hit at ${fast} km/h · F.R.I.D.A.Y. is bringing you back to Avengers Tower`);
      this.cam.addShake(1.2);
      this.bus.emit("impact", { speed: e.speed });
      this.peds.panic(this.player.pos.x, this.player.pos.z, 60);
      this.failTimer = 2.6;
    });
    bus.on("suitFailure", () => {
      if (this.remote) {
        // Nobody inside: the wrecked suit just drops offline.
        bus.emit("alert", { text: "Sentry suit critical - it's offline. Back to your body", level: "critical", ttl: 4 });
        this.leaveRemote("parked");
        return;
      }
      bus.emit("alert", { text: "SUIT FAILURE - emergency return to Avengers Tower", level: "critical", ttl: 4 });
      this.failTimer = 1.6;
    });
  }

  /**
   * The empty armour stays standing where the player was and splits open; the
   * civilian backs out of it (PlayerController drives the walk), then the
   * plates clamp shut again.
   */
  private stepOutOfSuit(): void {
    const p = this.player;
    this.suitUnit.park(p.pos.x, p.pos.y, p.pos.z, p.bodyYaw);
    this.suitAvatar.setVisible(true);
    this.suitAvatar.playOpen();
    this.suitAvatar.update(0.016, this.suitUnit);
    this.avatar.exitArmor();
  }

  /**
   * Sentry mode: you take direct control of the empty suit (fly, fight, the
   * lot) while your body stays where it is. From the suit you step out of it
   * first; on foot you take over the suit wherever it is.
   */
  enterRemote(): boolean {
    const p = this.player;
    const u = this.suitUnit;
    if (this.remote || p.transformTimer > 0 || p.dead) return false;
    const b = this.body;
    if (p.suited) {
      if (p.mode !== "ground" || !p.grounded || p.landingTimer > 0) {
        this.bus.emit("alert", { text: "Land first to leave the suit as a sentry", level: "warn" });
        return false;
      }
      // Step back out of the open suit; you keep piloting the armour.
      let bx = p.pos.x - Math.sin(p.bodyYaw) * 1.3, bz = p.pos.z - Math.cos(p.bodyYaw) * 1.3;
      if (this.world.overlaps(bx - 0.45, p.pos.y + 0.4, bz - 0.45, bx + 0.45, p.pos.y + 1.9, bz + 0.45)) {
        bx = p.pos.x + Math.cos(p.bodyYaw) * 1.3;
        bz = p.pos.z - Math.sin(p.bodyYaw) * 1.3;
      }
      b.pos.x = bx;
      b.pos.z = bz;
      b.pos.y = this.world.surfaceBelow(bx, p.pos.y + 0.5, bz, 0.4);
      b.bodyYaw = p.bodyYaw;
      this.suitAvatar.setVisible(true);
      this.suitAvatar.playOpen();
    } else {
      if (u.state === "worn") return false;
      if (!u.operational) {
        this.bus.emit("alert", { text: `Suit offline - self-repair at ${Math.round(p.suit.overallIntegrity)}%`, level: "warn" });
        return false;
      }
      if (!p.grounded) {
        this.bus.emit("alert", { text: "Can't take remote control while falling - call the suit (G)!", level: "warn" });
        return false;
      }
      b.pos.x = p.pos.x;
      b.pos.y = p.pos.y;
      b.pos.z = p.pos.z;
      b.bodyYaw = p.bodyYaw;
      p.possess({ x: u.pos.x, y: u.pos.y, z: u.pos.z, yaw: u.bodyYaw, suited: true, mode: u.mode, vel: u.vel });
      this.suitAvatar.setVisible(true);
    }
    this.avatar.exitArmor();
    u.state = "remote";
    p.remote = true;
    this.remote = true;
    this.cam.snap();
    this.refreshMarkers();
    this.syncTouchMode();
    this.input.touch.setSuitState("remote");
    this.bus.emit("suitChanged", { suited: true });
    this.bus.emit("alert", { text: "Sentry mode: you're piloting the empty suit · G brings it back to you · V back to your body", level: "success", ttl: 5 });
    return true;
  }

  /** Hand the suit back to its own systems and return to your body. */
  leaveRemote(next: "sentry" | "inbound" | "parked"): void {
    if (!this.remote) return;
    const p = this.player;
    const u = this.suitUnit;
    u.state = "parked";
    u.pos.x = p.pos.x;
    u.pos.y = p.pos.y;
    u.pos.z = p.pos.z;
    u.vel.x = p.vel.x;
    u.vel.y = p.vel.y;
    u.vel.z = p.vel.z;
    u.mode = p.mode;
    u.bodyYaw = p.bodyYaw;
    u.bodyPitch = p.bodyPitch;
    u.bodyRoll = 0;
    this.remote = false;
    p.remote = false;
    const b = this.body;
    p.possess({ x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.bodyYaw, suited: false });
    if (next === "sentry") u.setSentry(true);
    else if (next === "inbound") {
      if (u.call()) this.bus.emit("alert", { text: "Suit coming back to you - locking on when it arrives", level: "success", ttl: 3 });
    }
    this.cam.snap();
    this.refreshMarkers();
    this.lastSuitState = "";
    this.syncTouchMode(false);
    this.bus.emit("suitChanged", { suited: false });
  }

  /** G / V routing between the player and the autonomous suit. */
  private handleSuitCommands(input: { toggleSuit: boolean; sentry: boolean }): void {
    const p = this.player;
    const u = this.suitUnit;
    if (input.toggleSuit) {
      if (this.remote) this.leaveRemote("inbound");
      else if (p.suited) {
        // In the air, G ejects you - the suit stays behind and you fall.
        if (p.mode !== "ground" || !p.grounded) p.eject();
        else p.exitSuit();
      } else if (p.transformTimer <= 0) {
        if (u.state === "inbound") this.bus.emit("alert", { text: `Suit inbound · ${Math.round(Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z))} m`, level: "info", ttl: 2 });
        else if (u.call()) this.bus.emit("alert", { text: `Suit called - inbound from ${Math.round(Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z))} m`, level: "success", ttl: 3 });
      }
    }
    if (input.sentry) {
      // V toggles between piloting the empty suit and your body (the suit
      // keeps guarding you on its own when you go back).
      if (this.remote) this.leaveRemote("sentry");
      else if (p.transformTimer <= 0) this.enterRemote();
    }
    input.toggleSuit = false;
    input.sentry = false;
  }

  private syncTouchMode(suited = this.player.suited): void {
    this.input.touch.setMode(this.player.mode, suited);
    this.updateHint();
  }

  /** Called from the "Engage" user gesture. */
  start(): void {
    this.started = true;
    this.audio.unlock();
    this.audio.setVolume(this.settings.data.volume);
    this.hud.setVisible(true);
    this.input.touch.setVisible(!this.input.mouseMode);
    this.avatar.playSuitUp();
    this.setPaused(false);
    this.bus.emit("alert", { text: "Evening, boss. All suit systems online.", level: "info", ttl: 5 });
    this.bus.emit("alert", {
      text: this.input.mouseMode ? "Click to capture the mouse · LMB repulsors · RMB rockets · G suit off" : "LIFT to take off · BLAST / MSL to fight · SUIT to walk as a civilian",
      level: "info",
      ttl: 8,
    });
  }

  setPaused(p: boolean): void {
    if (!this.started) return;
    this.paused = p;
    this.menu.show(p);
    this.input.enabled = !p;
    this.input.reset();
    if (p) this.input.releasePointer();
  }

  /** Move the player and snap the camera. Optional mode is for debugging/screenshots. */
  teleport(x: number, y: number, z: number, yaw: number, mode?: "ground" | "hover" | "flight", speed = 0): void {
    const p = this.player;
    p.spawn(x, y, z, yaw);
    if (mode && mode !== "ground") {
      p.mode = mode;
      p.grounded = false;
      p.flightSpeed = speed;
      p.vel.x = Math.sin(yaw) * speed;
      p.vel.z = Math.cos(yaw) * speed;
    }
    this.syncTouchMode();
    this.chunks.loadAround(x, z, Math.min(400, this.settings.preset.viewDistance));
    this.traffic.scatter(x, z);
    this.peds.scatter(x, z);
    this.cam.snap();
    this.cam.update(0.016, p, this.world);
  }

  respawn(): void {
    if (this.remote) {
      this.remote = false;
      this.player.remote = false;
      this.player.suited = false;
    }
    if (!this.player.suited) {
      // Respawn always returns you in the armour.
      this.suitUnit.state = "worn";
      this.suitAvatar.setVisible(false);
      this.player.suited = true;
      this.avatar.startTransform(true);
      this.refreshMarkers();
    }
    this.failTimer = 0;
    this.hud.showDeath(null);
    this.teleport(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw);
    this.bus.emit("alert", { text: "Returned to Avengers Tower landing pad", level: "info" });
  }

  /** Debug/test helper: spawn an enemy relative to the player's facing. */
  spawnEnemy(kind: EnemyKind, forward: number, up: number, right = 0): void {
    const p = this.player;
    const s = Math.sin(p.viewYaw), c = Math.cos(p.viewYaw);
    const x = p.pos.x + s * forward + c * right, z = p.pos.z + c * forward - s * right;
    const y = AIR_KINDS.has(kind) ? p.pos.y + up : this.world.surfaceBelow(x, p.pos.y + up + 1, z, 0.4);
    this.enemies.spawn(kind, x, y, z, 0);
  }

  private updateHint(): void {
    const p = this.player;
    if (!p.suited) {
      this.hud.setHint(this.input.mouseMode ? (p.grounded ? "WASD walk · SHIFT sprint · SPACE jump · G call suit · V pilot the suit (sentry)" : "FALLING · G call the suit NOW") : "");
      return;
    }
    if (!this.input.mouseMode) return this.hud.setHint("");
    const m = p.mode;
    if (this.remote) return this.hud.setHint("SENTRY · piloting the empty suit · G bring it to you · V back to your body");
    if (p.freefall) return this.hud.setHint("FREE FALL · H / SPACE re-engage thrusters · SHIFT fly · WASD steer");
    this.hud.setHint(
      m === "ground"
        ? "SPACE lift-off · SHIFT launch · LMB blast · RMB rockets · G step out · V sentry"
        : m === "hover"
          ? "SPACE/C altitude · SHIFT flight · H cut thrust · G eject · Q/E dodge · LMB/RMB fire"
          : "A/D bank & turn · W afterburner · S brake · H cut thrust · G eject",
    );
  }

  private applySettings(): void {
    const s = this.settings.data;
    const q = this.settings.preset;
    const ratio = Math.min(this.device.dpr, q.pixelRatio);
    this.engine.setHardwareScalingLevel(1 / ratio);
    this.env.setViewDistance(q.viewDistance);
    this.cam.camera.maxZ = 8000;
    this.traffic.setCount(q.cars);
    this.peds.setCount(q.pedestrians);
    this.avatar.setParticles(q.particles);
    this.setShadows(q.shadows);
    this.hud.setShowFps(s.showFps);
    this.audio.setVolume(s.volume);
    this.visTimer = 0;
    this.chunks.updateVisibility(this.cam.position.x, this.cam.position.z, q.viewDistance);
    this.bus.emit("qualityChanged", { quality: s.quality });
  }

  private setShadows(on: boolean): void {
    if (!on) {
      this.shadowGen?.dispose();
      this.shadowGen = null;
      return;
    }
    if (this.shadowGen) return;
    const sg = new ShadowGenerator(1024, this.env.sun);
    sg.usePoissonSampling = true;
    sg.bias = 0.002;
    sg.setDarkness(0.35);
    for (const m of this.avatar.meshes) sg.addShadowCaster(m, false);
    this.env.sun.autoUpdateExtends = true;
    this.shadowGen = sg;
  }

  private resize(): void {
    this.engine.resize();
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    if (this.cam) this.cam.camera.fovMode = aspect < 1 ? Camera.FOVMODE_HORIZONTAL_FIXED : Camera.FOVMODE_VERTICAL_FIXED;
  }

  private frame(): void {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    if (!this.paused) this.update(dt);
    else if (!this.started) {
      // Attract mode behind the loading screen: slow orbit.
      this.player.viewYaw += dt * 0.08;
      this.cam.update(dt, this.player, this.world);
    }
    this.scene.render();
  }

  private update(dt: number): void {
    this.time += dt;
    this.runTime += dt;
    const input = this.input.poll();
    if (input.menu) {
      this.setPaused(!this.paused);
      return;
    }
    const p = this.player;
    if (p.dead) input.fire = input.rockets = input.toggleSuit = input.sentry = false;
    this.handleSuitCommands(input);
    p.update(dt, input);
    if (this.remote) {
      // The controller is the suit; your body stands where you left it.
      this.suitAvatar.update(dt, p);
      this.avatar.update(dt, this.body);
      this.suitUnit.pos.x = p.pos.x;
      this.suitUnit.pos.y = p.pos.y;
      this.suitUnit.pos.z = p.pos.z;
      this.bodyMarker.x = this.body.pos.x;
      this.bodyMarker.z = this.body.pos.z;
    } else {
      this.avatar.update(dt, p);
      if (this.suitUnit.update(dt, p)) {
        // Suit arrived: it breaks apart and each piece flies onto the civilian
        // (much faster when it catches you mid-air).
        const starts = this.suitAvatar.pieceWorldPositions();
        this.suitAvatar.setVisible(false);
        const air = !p.grounded;
        const dur = air ? TUNING.airLatchTime : TUNING.latchTime;
        this.avatar.latchFrom(starts, TUNING.latchTime / dur);
        p.beginSuitUp(dur);
        if (air) this.bus.emit("alert", { text: "Caught you, boss!", level: "success", ttl: 3 });
      }
      if (this.suitUnit.state !== "worn") this.suitAvatar.update(dt, this.suitUnit);
    }
    this.updateSuitStatus();
    this.cam.update(dt, p, this.world);
    const camPos = this.cam.position;

    // Combat.
    this.combat.aimAssist = this.input.mouseMode ? 0.06 : 0.16;
    this.combat.update(dt, input, p, camPos);
    this.enemies.update(dt, this.targets);
    this.projectiles.update(dt);
    if (this.projectiles.hitsThisFrame > 0) this.hud.hitMarker();
    this.enemyRenderer.update(this.enemies);
    this.projRenderer.update(this.projectiles, camPos);
    this.speedFx.update(camPos, p);
    if (this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) {
        this.projectiles.clearHostile();
        p.suit.restore();
        this.respawn();
      }
    }

    // World.
    this.env.update(this.time);
    this.env.setAltitude(camPos.y);
    this.traffic.update(dt, p.pos.x, p.pos.z, p.pos.y);
    this.props.setSignalPhase(this.traffic.phase);
    this.props.setBeaconOn(Math.sin(this.time * 3) > 0.3);
    this.peds.update(dt, p.pos.x, p.pos.z);
    const q = this.settings.preset;
    this.chunks.stream(camPos.x, camPos.z, q.viewDistance, 1);
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.25;
      this.chunks.updateVisibility(camPos.x, camPos.z, q.viewDistance);
      this.props.update(camPos.x, camPos.z, q.propDistance, q.viewDistance, CHUNK_SIZE);
    }
    this.areaTimer -= dt;
    if (this.areaTimer <= 0) {
      this.areaTimer = 0.5;
      const a = this.chunks.areaAt(p.pos.x, p.pos.z);
      if (a !== this.area) {
        this.area = a;
        this.bus.emit("areaChanged", { name: a });
      }
    }
    if (this.events.update(dt, p)) this.refreshMarkers();
    const [title, detail] = this.events.objective;
    const d = this.events.distanceTo(p);
    this.hud.setObjective(title, title ? `${detail} · ${Math.round(d)} m` : "");
    if (this.shadowGen) this.env.sun.position.set(p.pos.x + 60, p.pos.y + 25, p.pos.z + 20);

    // HUD.
    this.hud.update(dt, p);
    this.updateTargetsHud(camPos);
    this.hud.setWeapons(this.combat.rockets, MAX_ROCKETS, this.enemies.kills, p.suit.energy > 1);
    this.input.touch.setRockets(this.combat.rockets);
    this.hud.setCapturePrompt(this.input.needsCapture && p.suited);
    this.audio.update(p);
    this.autoQuality(dt);
  }

  private updateTargetsHud(camPos: Vector3): void {
    const items: HudTarget[] = [];
    const locks = new Set(this.combat.locks);
    const aim = aimDirection(this.player);
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const c = this.enemies.center(e);
      const dx = c.x - camPos.x, dy = c.y - camPos.y, dz = c.z - camPos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 420 || dx * aim.x + dy * aim.y + dz * aim.z < 1) continue;
      items.push({
        x: c.x,
        y: c.y,
        z: c.z,
        hp: e.hp / e.maxHp,
        locked: locks.has(e),
        assist: e === this.combat.assistTarget,
        kind: e.kind,
        scale: Math.max(0.6, Math.min(1.3, 60 / d + 0.5)),
      });
    }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const viewport = this.cam.camera.viewport.toGlobal(w, h);
    const tm = this.scene.getTransformMatrix();
    this.hud.updateTargets(items, (x, y, z) => {
      this.projectV.set(x, y, z);
      const v = Vector3.Project(this.projectV, this.projectM, tm, viewport);
      return { x: v.x, y: v.y, ok: v.z > 0 && v.z < 1 && v.x > -50 && v.x < w + 50 && v.y > -50 && v.y < h + 50 };
    });
  }

  /** Civilian HUD line, touch labels and compass marker for the suit. */
  private updateSuitStatus(): void {
    const p = this.player;
    const u = this.suitUnit;
    if (u.state !== this.lastSuitState) {
      this.lastSuitState = u.state;
      this.input.touch.setSuitState(u.state);
      this.refreshMarkers();
    }
    this.suitMarker.x = u.pos.x;
    this.suitMarker.z = u.pos.z;
    if (p.suited || p.transformTimer > 0) return;
    const d = Math.round(Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z));
    const integ = Math.round(p.suit.overallIntegrity);
    const keys = this.input.mouseMode;
    const text =
      u.state === "inbound"
        ? `Suit inbound · ${d} m`
        : u.state === "sentry"
          ? `Sentry active · ${integ}% · ${keys ? "V to stand down · G to suit up" : "tap CALL SUIT to suit up"}`
          : !u.operational
            ? `Suit offline · self-repair ${integ}%`
            : `Suit parked ${d} m away · ${keys ? "G call · V sentry" : "CALL SUIT · SENTRY"}`;
    this.hud.setCivilianHint(text);
  }

  private refreshMarkers(): void {
    const markers: HudMarker[] = [{ id: "tower", label: "TOWER", x: HERO_X, z: HERO_Z, kind: "poi" }, ...this.events.markers];
    if (this.remote) markers.push(this.bodyMarker);
    else if (this.suitUnit && this.suitUnit.state !== "worn") markers.push(this.suitMarker);
    this.hud.setMarkers(markers);
  }

  private autoQuality(dt: number): void {
    if (this.runTime < 1) this.refreshMarkers();
    this.perfTime += dt;
    this.perfFrames++;
    if (this.perfTime < 4) return;
    const fps = this.perfFrames / this.perfTime;
    this.perfTime = 0;
    this.perfFrames = 0;
    if (!this.settings.data.autoQuality || this.runTime < 6) return;
    this.lowPerfStrikes = fps < 26 ? this.lowPerfStrikes + 1 : 0;
    const idx = QUALITY_ORDER.indexOf(this.settings.data.quality);
    if (this.lowPerfStrikes >= 2 && idx > 0) {
      this.lowPerfStrikes = 0;
      const next = QUALITY_ORDER[idx - 1];
      this.settings.update({ quality: next });
      this.bus.emit("alert", { text: `Performance low (${fps.toFixed(0)} fps) · graphics set to ${next}`, level: "warn" });
    }
  }

  /** Snapshot for automated tests and debugging. */
  debugState() {
    const p = this.player;
    return {
      mode: p.mode,
      suited: p.suited,
      transforming: p.transformTimer > 0,
      pos: { ...p.pos },
      speed: p.speed,
      energy: p.suit.energy,
      integrity: p.suit.overallIntegrity,
      viewYaw: p.viewYaw,
      viewPitch: p.viewPitch,
      fps: this.hud.fps,
      paused: this.paused,
      started: this.started,
      quality: this.settings.data.quality,
      activeMeshes: this.scene.getActiveMeshes().length,
      chunks: this.chunks.count,
      props: this.props.scenePropCount,
      enemies: this.enemies.alive.length,
      kills: this.enemies.kills,
      rockets: this.combat.rockets,
      suitState: this.suitUnit.state,
      trick: p.trick?.kind ?? null,
      oxygen: p.suit.oxygen,
      remote: this.remote,
      bank: p.bank,
      grounded: p.grounded,
      bodyPos: { ...this.body.pos },
      freefall: p.freefall,
      blackout: p.blackout,
      dead: p.dead,
      inSpace: p.inSpace,
      space: this.env.space,
      stepOut: this.suitAvatar.opening,
      styleCombo: p.styleCombo,
      suitPos: { ...this.suitUnit.pos },
      mouseMode: this.input.mouseMode,
      pointerLocked: this.input.isPointerLocked,
    };
  }
}
