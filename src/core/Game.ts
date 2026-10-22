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
import { Hud, type HudMarker, type HudTarget, type RadarBlip } from "../ui/Hud";
import { SettingsMenu } from "../ui/SettingsMenu";
import { SuitAudio } from "../audio/SuitAudio";
import { CityEvents } from "../gameplay/CityEvents";
import { EnemyManager, ENEMY_STATS, AIR_KINDS, isCloaked, type EnemyKind } from "../combat/Enemies";
import { ProjectileSystem } from "../combat/Projectiles";
import { Combat, MAX_ROCKETS, aimDirection } from "../combat/Combat";
import { EnemyRenderer } from "../combat/EnemyRenderer";
import { ProjectileRenderer } from "../combat/ProjectileRenderer";
import { DEG } from "./math";
import { Clouds } from "../world/Clouds";
import { Progress as HeroProgress, RANKS } from "../gameplay/Progress";

const rankLow = (i: number) => RANKS[i][0];
import { Contrails } from "../player/Contrails";
import { KillStreak } from "../gameplay/Streaks";
import { Pickups, type Pickup } from "../gameplay/Pickups";
import { PickupRenderer } from "../gameplay/PickupRenderer";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";

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
  /** Kill streaks (chained kills: call-outs and an XP multiplier). */
  readonly streak = new KillStreak();
  pickups!: Pickups;
  private pickupRenderer!: PickupRenderer;
  /** Slow-motion "hero moment" (real seconds left) after a big kill. */
  private slowmo = 0;
  private projRenderer!: ProjectileRenderer;
  private speedFx!: SpeedFx;
  /** The armour as an independent unit (parked, sentry, flying in). */
  suitUnit!: SuitUnit;
  private suitAvatar!: ArmorModel;
  private targets: CombatTarget[] = [];
  private suitMarker: HudMarker = { id: "suit", label: "SUIT", x: 0, z: 0, kind: "suit" };
  private lastSuitState = "worn";
  private shadowGen: ShadowGenerator | null = null;
  private clouds!: Clouds;
  progress!: HeroProgress;
  private contrails!: Contrails;
  private pipeline: DefaultRenderingPipeline | null = null;
  private paused = true;
  private started = false;
  private visTimer = 0;
  private areaTimer = 0;
  private area = "";
  private perfTime = 0;
  private perfFrames = 0;
  private lowPerfStrikes = 0;
  private highPerfStrikes = 0;
  private downgraded = false;
  private runTime = 0;
  private time = 0;
  private failTimer = 0;
  /** Smoothed / decaying-peak CPU time of one simulation update (ms). */
  updateMs = 0;
  updateMsMax = 0;
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
    await progress(0.1, "Building harbour");
    this.env = new Environment(scene, this.mats);
    this.props = new PropSystem(scene, this.mats);
    this.chunks = new ChunkManager(scene, this.mats, this.world, this.props);
    await progress(0.15, "Surveying 299 km² of city");
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
    this.pickups = new Pickups(this.world);
    this.pickupRenderer = new PickupRenderer(scene, this.mats);
    this.projRenderer = new ProjectileRenderer(scene, this.mats);
    this.speedFx = new SpeedFx(scene, this.mats);
    this.clouds = new Clouds(scene);
    this.contrails = new Contrails(this.projectiles, this.avatar.bootAnchors());
    this.setupGrading();
    this.events = new CityEvents(scene, this.mats, this.world, this.bus, this.enemies);
    this.progress = new HeroProgress(this.bus);
    this.events.onComplete = (combat) => {
      this.progress.add(combat ? 500 : 200);
      this.player.suit.repair(combat ? 40 : 15);
      this.player.suit.charge(50);
      this.combat.refill();
    };

    this.input = new InputManager(this.canvas, this.uiRoot, this.settings, this.device.isTouch);
    this.input.onModeChange = () => this.updateHint();
    this.hud = new Hud(this.uiRoot, this.bus);
    this.hud.onMenu = () => this.setPaused(true);
    this.menu = new SettingsMenu(this.uiRoot, this.settings, {
        onResume: () => this.setPaused(false),
        onRespawn: () => this.respawn(),
        onChallenge: () => {
          this.enemies.clear();
          this.events.spawnNow(this.player, "Flight challenge");
        },
      }, this.device.isTouch);
    this.audio = new SuitAudio(this.bus);
    this.hud.setVisible(false);
    this.input.touch.setVisible(false);
    this.wireEvents();
    this.menu.setDeviceInfo(deviceLine(this.engine));
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
    // Phones report the rotated size late: resize again once it has settled.
    const settle = () => {
      for (const ms of [100, 300, 700]) setTimeout(() => this.resize(), ms);
    };
    window.addEventListener("orientationchange", settle);
    screen.orientation?.addEventListener?.("change", settle);
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
    bus.on("modeChanged", (e) => {
      this.syncTouchMode();
      // Take-off blast kicks up dust when leaving the ground.
      const p = this.player;
      if (e.mode !== "ground" && p.agl < 3 && p.suited) this.projectiles.dust({ x: p.pos.x, y: p.pos.y - p.agl, z: p.pos.z }, e.mode === "flight" ? 0.7 : 0.45);
    });
    bus.on("unibeam", (e) => {
      if (!e.charging) {
        this.cam.addShake(0.5);
        this.cam.addKick(0.15);
        this.hud.popup("UNIBEAM");
      }
    });
    bus.on("impact", (e) => this.cam.addShake(Math.min(1, e.speed / 60)));
    bus.on("landed", (e) => {
      this.cam.addShake(e.hard ? 0.7 : 0.15);
      const p = this.player;
      this.projectiles.dust({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, e.hard ? 0.9 : 0.35);
      if (e.hard && e.suited && !this.remote) this.superheroLanding(e.speed);
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
    bus.on("sonicBoom", () => {
      this.cam.addShake(0.6);
      this.cam.addKick(0.2);
      this.hud.popup("SONIC BOOM");
    });
    bus.on("trick", (e) => this.hud.popup(e.combo > 1 ? `${e.name} ×${e.combo}` : e.name));
    bus.on("nearMiss", (e) => this.hud.popup(e.streak > 1 ? `CLOSE CALL ×${e.streak}` : "CLOSE CALL"));
    bus.on("kill", (e) => {
      const stats = ENEMY_STATS[e.kind as EnemyKind];
      const st = this.streak.kill(this.time);
      const score = Math.round(stats.score * st.multiplier);
      this.hud.popup(st.label ? `${st.label} ×${st.multiplier.toFixed(2).replace(/0$/, "")} · +${score}` : `${e.kind.toUpperCase()} DOWN · +${score}`);
      this.progress.add(score);
      if (st.label) {
        this.cam.addKick(0.05 + Math.min(0.1, st.chain * 0.01));
        this.bus.emit("streak", { chain: st.chain, label: st.label });
      }
      this.pickups.onKill(e.kind as EnemyKind, e.x, e.y, e.z);
      // Bosses go down in slow motion.
      if (stats.hp >= 600) {
        this.slowmo = 1.1;
        this.cam.addShake(0.8);
        this.hud.popup(`${e.kind.toUpperCase()} DESTROYED · +${score}`);
      }
    });
    bus.on("rescue", (e) => {
      if (e.saved) {
        this.hud.popup("CIVILIAN SAVED · +600");
        this.progress.add(600);
      }
    });
    bus.on("ringPassed", (e) => {
      // Every ring is a boost: speed, a sip of power, and a punchy FOV kick.
      const p = this.player;
      if (p.mode === "flight") p.flightSpeed += 26;
      p.suit.charge(6);
      this.cam.addKick(0.14);
      this.hud.popup(e.index >= e.total ? "COURSE COMPLETE" : `RING ${e.index}/${e.total}`);
      this.progress.add(e.index >= e.total ? 400 : 40);
    });
    bus.on("hypersonic", () => {
      this.hud.popup("HYPERSONIC");
      this.cam.addKick(0.25);
      this.cam.addShake(0.5);
    });
    bus.on("rush", (e) => {
      this.hud.popup(e.level >= 2 ? "MAX RUSH" : "RUSH");
      this.cam.addKick(e.level >= 2 ? 0.12 : 0.07);
    });
    bus.on("scrape", (e) => {
      this.projectiles.scrape(e, e.speed);
      this.cam.addShake(Math.min(0.5, 0.15 + e.speed / 120));
    });
    bus.on("rankUp", (e) => {
      this.hud.popup(`RANK UP · ${e.name}`);
      this.cam.addKick(0.12);
    });
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
      this.hud.setVisible(true);
      this.hud.showDeath(e.cause === "water" ? "IMPACT · WATER" : "FATAL FALL", `Hit at ${fast} km/h · F.R.I.D.A.Y. is bringing you back to Avengers Tower`);
      this.cam.addShake(1.2);
      this.bus.emit("impact", { speed: e.speed });
      const pp = this.player.pos;
      this.projectiles.dust({ x: pp.x, y: pp.y, z: pp.z }, 1);
      this.projectiles.fx.push({ kind: "shock", x: pp.x, y: pp.y + 0.3, z: pp.z, size: 14, t: 0, life: 0.6, yaw: 0, pitch: 0 });
      this.peds.panic(this.player.pos.x, this.player.pos.z, 60);
      this.failTimer = 2.6;
    });
    bus.on("suitFailure", () => this.destroySuit());
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

  /** Seconds until a replacement suit is sent (0 = none pending). */
  newSuitTimer = 0;
  static readonly NEW_SUIT_DELAY = 15;

  /**
   * Full damage: the armour blows apart. You're left as a civilian where it
   * happened (drifting down safely if in the air) and a replacement suit is
   * sent after 15 seconds.
   */
  private destroySuit(): void {
    const p = this.player;
    if (this.remote) this.leaveRemote("parked");
    const c = p.center;
    this.projectiles.explode(c, 7, 0, false);
    this.projectiles.wreck(c, 7);
    this.cam.addShake(1);
    p.suitDestroyed();
    this.avatar.exitArmor();
    this.suitUnit.state = "parked";
    this.suitAvatar.setVisible(false);
    this.suitUnit.pos.y = -1000; // the wreck is gone
    this.newSuitTimer = Game.NEW_SUIT_DELAY;
    this.refreshMarkers();
    this.syncTouchMode(false);
    this.bus.emit("alert", { text: `SUIT DESTROYED - replacement inbound in ${Game.NEW_SUIT_DELAY} s`, level: "critical", ttl: 5 });
  }

  /** Count down to the replacement suit, then fly it in to latch on. */
  private updateNewSuit(dt: number): void {
    if (this.newSuitTimer <= 0) return;
    this.newSuitTimer -= dt;
    if (this.newSuitTimer > 0) return;
    this.newSuitTimer = 0;
    const p = this.player;
    const u = this.suitUnit;
    p.suit.restore();
    // It launches from a few hundred metres away, high above the rooftops.
    const a = p.bodyYaw + Math.PI;
    u.park(p.pos.x + Math.sin(a) * 260, Math.max(p.pos.y, 0) + 120, p.pos.z + Math.cos(a) * 260, p.bodyYaw);
    this.suitAvatar.setVisible(true);
    u.call();
    this.refreshMarkers();
    this.bus.emit("alert", { text: "New suit inbound - hold still, boss", level: "success", ttl: 4 });
  }

  /** G / V routing between the player and the autonomous suit. */
  private handleSuitCommands(input: { toggleSuit: boolean; sentry: boolean }): void {
    const p = this.player;
    const u = this.suitUnit;
    if (this.newSuitTimer > 0 && (input.toggleSuit || input.sentry)) {
      this.bus.emit("alert", { text: `Replacement suit in ${Math.ceil(this.newSuitTimer)} s`, level: "info", ttl: 2 });
      input.toggleSuit = input.sentry = false;
    }
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
    this.hud.setVisible(this.settings.data.hud);
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
    this.contrails?.reset();
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
    if (this.started) this.hud.setVisible(this.settings.data.hud);
    this.teleport(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw);
    // Fresh armour flies in and latches on, piece by piece.
    this.avatar.playSuitUp();
    this.bus.emit("alert", { text: "Returned to Avengers Tower landing pad", level: "info" });
  }

  /**
   * Superhero landing: slamming down in the suit sends out a shockwave that
   * damages and throws nearby hostiles (harder landings hit harder).
   */
  private superheroLanding(speed: number): void {
    const p = this.player;
    const radius = 16;
    const power = Math.min(1.6, 0.7 + speed / 60);
    let hit = 0;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const c = this.enemies.center(e);
      const d = Math.hypot(c.x - p.pos.x, c.y - p.pos.y, c.z - p.pos.z);
      if (d > radius) continue;
      const k = 1 - d / radius;
      this.enemies.damage(e, 70 * power * k);
      const push = 18 * k;
      e.vx += ((c.x - p.pos.x) / (d || 1)) * push;
      e.vz += ((c.z - p.pos.z) / (d || 1)) * push;
      e.vy += 8 * k;
      hit++;
    }
    const at = { x: p.pos.x, y: p.pos.y + 0.2, z: p.pos.z };
    this.projectiles.dust(at, 1.8);
    this.projectiles.scrape(at, 80);
    this.cam.addShake(0.9);
    this.cam.addKick(0.1);
    this.hud.popup(hit > 0 ? `SUPERHERO LANDING · ${hit} HIT` : "SUPERHERO LANDING");
    if (hit > 0) this.progress.add(50 * hit);
    this.bus.emit("superLanding", { hits: hit });
  }

  /** Apply collected salvage. */
  private collect(item: Pickup): void {
    const p = this.player;
    if (item.kind === "repair") {
      p.suit.repair(18);
      this.hud.popup("+ REPAIR");
    } else if (item.kind === "power") {
      p.suit.charge(30);
      this.hud.popup("+ POWER");
    } else {
      this.combat.refill();
      this.hud.popup("+ ROCKETS REARMED");
    }
    this.cam.addKick(0.04);
    this.projectiles.fx.push({ kind: "spark", x: item.x, y: item.y, z: item.z, size: 1.4, t: 0, life: 0.2, yaw: 0, pitch: 0 });
    this.bus.emit("pickup", { kind: item.kind });
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
    this.cam.camera.maxZ = 12000;
    this.traffic.setCount(q.cars);
    this.peds.setCount(q.pedestrians);
    this.avatar.setParticles(q.particles);
    this.setShadows(q.shadows);
    this.clouds.setCount(q.clouds);
    this.contrails.enabled = q.contrails;
    this.setBloom(q.bloom);
    this.avatar.setScheme(s.suit);
    this.suitAvatar.setScheme(s.suit);
    if (this.env.time !== s.timeOfDay) this.env.setTimeOfDay(s.timeOfDay);
    if (this.started) this.hud.setVisible(s.hud);
    this.hud.setShowFps(s.showFps);
    this.audio.setVolume(s.volume);
    this.visTimer = 0;
    this.chunks.updateVisibility(this.cam.position.x, this.cam.position.z, q.viewDistance);
    this.bus.emit("qualityChanged", { quality: s.quality });
  }

  /** Filmic colour grading: ACES tone mapping, a touch more contrast, vignette. */
  private setupGrading(): void {
    const ip = this.scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.25;
    ip.contrast = 1.12;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.4;
    ip.vignetteStretch = 0.4;
    ip.vignetteCameraFov = 0.9;
  }

  /** High quality: bloom (glowing thrusters, beams, windows) and FXAA. */
  private setBloom(on: boolean): void {
    if (!on) {
      this.pipeline?.dispose();
      this.pipeline = null;
      return;
    }
    if (this.pipeline) return;
    const pl = new DefaultRenderingPipeline("post", false, this.scene, [this.cam.camera]);
    pl.bloomEnabled = true;
    pl.bloomThreshold = 0.72;
    pl.bloomWeight = 0.45;
    pl.bloomKernel = 48;
    pl.bloomScale = 0.5;
    pl.fxaaEnabled = true;
    pl.imageProcessingEnabled = true;
    this.pipeline = pl;
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

  private canvasW = 1;
  private canvasH = 1;

  private resize(): void {
    this.engine.resize();
    this.canvasW = this.canvas.clientWidth;
    this.canvasH = this.canvas.clientHeight;
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    if (this.cam) this.cam.camera.fovMode = aspect < 1 ? Camera.FOVMODE_HORIZONTAL_FIXED : Camera.FOVMODE_VERTICAL_FIXED;
  }

  private frame(): void {
    const real = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    // Hero moment: time slows briefly after a boss goes down.
    const dt = this.slowmo > 0 ? real * 0.3 : real;
    this.slowmo = Math.max(0, this.slowmo - real);
    if (!this.paused) {
      // Track the simulation's own CPU cost per frame (excludes GPU work).
      const t0 = performance.now();
      this.update(dt);
      const ms = performance.now() - t0;
      this.updateMs += (ms - this.updateMs) * 0.05;
      this.updateMsMax = Math.max(this.updateMsMax * 0.995, ms);
    }
    else if (!this.started) {
      // Attract mode behind the loading screen: slow orbit.
      this.player.viewYaw += dt * 0.08;
      this.cam.update(dt, this.player, this.world);
    }
    this.scene.render();
  }

  /** Per-section CPU timings (ms, smoothed / decaying peak) for profiling. */
  readonly prof: Record<string, { avg: number; max: number }> = {};
  private markT = 0;
  private mark(name: string): void {
    const now = performance.now();
    const ms = now - this.markT;
    this.markT = now;
    const e = (this.prof[name] ??= { avg: 0, max: 0 });
    e.avg += (ms - e.avg) * 0.05;
    e.max = Math.max(e.max * 0.995, ms);
  }

  private update(dt: number): void {
    this.markT = performance.now();
    this.time += dt;
    this.runTime += dt;
    const input = this.input.poll();
    if (input.menu) {
      this.setPaused(!this.paused);
      return;
    }
    if (input.cinematic) {
      const on = !this.settings.data.hud;
      this.settings.update({ hud: on });
      if (on) this.bus.emit("alert", { text: "HUD on", level: "info", ttl: 1.5 });
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

    this.mark("player");
    // Combat.
    this.combat.aimAssist = this.input.mouseMode ? 0.06 : 0.16;
    this.combat.update(dt, input, p, camPos);
    this.enemies.update(dt, this.targets);
    this.projectiles.update(dt);
    if (this.projectiles.hitsThisFrame > 0) this.hud.hitMarker();
    this.enemyRenderer.update(this.enemies);
    const c = p.center;
    for (const item of this.pickups.update(dt, c.x, c.y, c.z, p.suited && !this.remote && !p.dead)) this.collect(item);
    this.pickupRenderer.update(this.pickups.items, this.time);
    this.projRenderer.update(this.projectiles, camPos);
    this.speedFx.update(camPos, p);
    this.clouds.update(dt, camPos);
    this.contrails.update(dt, p.suited && !this.remote && (p.mode === "flight" || (p.mode === "hover" && p.speed > 40)), p.speed, p.pos.y);
    if (this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) {
        this.projectiles.clearHostile();
        p.suit.restore();
        this.respawn();
      }
    }

    this.mark("combat");
    // World.
    this.env.update(this.time);
    this.env.setAltitude(camPos.y);
    this.traffic.update(dt, p.pos.x, p.pos.z, p.pos.y);
    this.props.setSignalPhase(this.traffic.phase);
    this.props.setBeaconOn(Math.sin(this.time * 3) > 0.3);
    this.peds.update(dt, p.pos.x, p.pos.z);
    const q = this.settings.preset;
    // Fast flight: stream the city where you're heading, with more build time.
    const fast = p.speed > 120;
    const look = fast ? Math.min(2.5, 600 / Math.max(1, p.speed)) * 0.8 : 0;
    this.chunks.stream(camPos.x + p.vel.x * look, camPos.z + p.vel.z * look, q.viewDistance, 1, fast && q.viewDistance > 600 ? 4 : 3);
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

    this.mark("world");
    // HUD.
    this.hud.update(dt, p);
    // Target brackets at 30 Hz (smooth enough, half the DOM work).
    this.targetsTimer -= dt;
    if (this.targetsTimer <= 0) {
      this.targetsTimer = 1 / 30;
      this.updateTargetsHud(camPos);
    }
    this.input.touch.setCharging(this.combat.beamCharge >= 0);
    this.updateThrusterWash(dt);
    this.updateNewSuit(dt);
    this.updateBuffeting(dt);
    this.evictFar(dt);
    this.updateRadar(dt);
    this.updateBossBar(dt);
    // Slow-changing HUD values: 10 Hz is plenty.
    this.slowHud -= dt;
    if (this.slowHud <= 0) {
      this.slowHud = 0.1;
      this.hud.setWeapons(this.combat.rockets, MAX_ROCKETS, this.enemies.kills, p.suit.energy > 0, this.combat.rocketReload);
      this.hud.setStreak(this.streak.chain, this.streak.remaining(this.time) / 3.5);
      this.hud.setSpecials(Math.max(0, this.combat.beamCooldown), this.combat.beamCharge >= 0, Math.max(0, this.combat.flareCooldown));
      const rank = this.progress.rank;
      const lo = rankLow(rank.index);
      this.hud.perfNote = `sim ${this.updateMs.toFixed(1)} ms · ${this.settings.data.quality.toUpperCase()}`;
      this.hud.setRank(rank.name, rank.next === null ? 1 : (this.progress.xp - lo) / (rank.next - lo));
      this.input.touch.setRockets(this.combat.rockets, this.combat.rocketReload);
      this.hud.setCapturePrompt(this.input.needsCapture && p.suited);
    }
    // Audio parameters at 20 Hz (they glide smoothly anyway).
    this.audioTimer -= dt;
    if (this.audioTimer <= 0) {
      this.audioTimer = 0.05;
      this.audio.update(p);
    }
    this.autoQuality(dt);
    this.mark("hud");
  }

  /** The toughest engaged heavy unit nearby gets a boss bar. */
  private updateBossBar(dt: number): void {
    const names: Partial<Record<EnemyKind, string>> = { titan: "TITAN", carrier: "DREADNOUGHT CARRIER", rival: "ROGUE ARMOUR", bomber: "HEAVY BOMBER", warbot: "WARBOT", spider: "SPIDER WALKER", gunship: "GUNSHIP", tank: "HOVER TANK" };
    let best: (typeof this.enemies.enemies)[number] | null = null;
    const p = this.player.pos;
    for (const e of this.enemies.enemies) {
      if (!e.alive || !names[e.kind] || !e.aware) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) > 600) continue;
      if (!best || e.maxHp > best.maxHp) best = e;
    }
    this.hud.setBoss(best ? names[best.kind]! : null, best ? Math.max(0, best.hp / best.maxHp) : 0, dt);
  }

  private targetsTimer = 0;
  private slowHud = 0;
  private audioTimer = 0;
  private radarBlips: RadarBlip[] = [];
  private radarTimer = 0;
  private updateRadar(dt: number): void {
    // Only gather blips when the radar is about to redraw (10 Hz).
    this.radarTimer -= dt;
    if (this.radarTimer > 0) return;
    this.radarTimer = 0.1;
    const b = this.radarBlips;
    b.length = 0;
    for (const e of this.enemies.enemies) {
      if (!e.alive || isCloaked(e)) continue;
      b.push({ x: e.x, z: e.z, kind: AIR_KINDS.has(e.kind) ? "air" : "hostile", big: e.kind === "carrier" || e.kind === "warbot" || e.kind === "gunship" || e.kind === "tank" || e.kind === "titan" || e.kind === "spider" || e.kind === "bomber" || e.kind === "rival" });
    }
    for (const m of this.hud.markers) b.push({ x: m.x, z: m.z, kind: m.kind === "event" ? "event" : m.kind === "suit" ? "suit" : "poi" });
    this.hud.updateRadar(1, this.player, b);
  }

  private evictTimer = 0;
  /** Keep memory bounded on the huge map: drop far collider / layout data. */
  private evictFar(dt: number): void {
    this.evictTimer -= dt;
    if (this.evictTimer > 0) return;
    this.evictTimer = 5;
    const p = this.player.pos;
    this.chunks.dropSpecs(this.world.evictFar(p.x, p.z, 2600));
  }

  /** Hypersonic: a little camera buffeting. */
  private updateBuffeting(dt: number): void {
    const p = this.player;
    if (!p.hypersonic || p.mode !== "flight") return;
    this.cam.addShake(dt * 0.6);
  }

  private washTimer = 0;
  /** Hovering low: the boot thrusters blow dust off the ground below. */
  private updateThrusterWash(dt: number): void {
    const p = this.player;
    this.washTimer -= dt;
    if (this.washTimer > 0 || !p.suited || p.mode === "ground" || p.agl > 7 || p.thrust < 0.2) return;
    this.washTimer = 0.18;
    this.projectiles.dust({ x: p.pos.x, y: p.pos.y - p.agl, z: p.pos.z }, 0.12 * (1 - p.agl / 7) + 0.05);
  }

  private updateTargetsHud(camPos: Vector3): void {
    const items: HudTarget[] = [];
    const locks = new Set(this.combat.locks);
    const aim = aimDirection(this.player);
    for (const e of this.enemies.enemies) {
      if (!e.alive || isCloaked(e)) continue;
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
    // Cached size: reading clientWidth here would force a full page layout
    // right after the HUD's DOM writes (a big cost on slow phones).
    const w = this.canvasW, h = this.canvasH;
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
    if (this.newSuitTimer > 0) {
      this.hud.setCivilianHint(`Suit destroyed · replacement in ${Math.ceil(this.newSuitTimer)} s`);
      return;
    }
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
    else if (this.suitUnit && this.suitUnit.state !== "worn" && this.newSuitTimer <= 0) markers.push(this.suitMarker);
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
    this.highPerfStrikes = fps >= 57 ? this.highPerfStrikes + 1 : 0;
    const idx = QUALITY_ORDER.indexOf(this.settings.data.quality);
    // Fast devices (iPhone 15, quick Chromebooks) started on Low step up to
    // Medium once they hold ~60 fps for a while; never after a downgrade.
    if (this.highPerfStrikes >= 3 && idx === 0 && !this.downgraded && !this.settings.data.qualityPicked) {
      this.highPerfStrikes = 0;
      this.settings.update({ quality: "medium" });
      this.bus.emit("alert", { text: `Running smoothly (${fps.toFixed(0)} fps) · graphics raised to medium`, level: "info" });
      return;
    }
    if (this.lowPerfStrikes >= 2 && idx > 0) {
      this.lowPerfStrikes = 0;
      this.downgraded = true;
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
      rocketReload: this.combat.rocketReload,
      suitState: this.suitUnit.state,
      trick: p.trick?.kind ?? null,
      oxygen: p.suit.oxygen,
      newSuitIn: this.newSuitTimer,
      chute: p.chute,
      colliderChunks: this.world.chunksLoaded,
      updateMs: this.updateMs,
      updateMsMax: this.updateMsMax,
      heapMB: ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576,
      specChunks: this.chunks.specCount,
      rescue: this.events.rescue,
      course: this.events.courseState,
      topSpeed: p.topSpeed,
      rush: p.rush,
      hypersonic: p.hypersonic,
      saved: this.events.saved,
      timeOfDay: this.env.time,
      hudShown: this.settings.data.hud,
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

/** "GPU · WebGL2 · Safari/Chrome" line for the settings menu. */
function deviceLine(engine: Engine): string {
  const info = engine.getGlInfo();
  const ua = navigator.userAgent;
  const browser = /CrOS/.test(ua) ? "ChromeOS" : /iPhone|iPad/.test(ua) ? "iOS Safari" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `Device: ${info.renderer || "unknown GPU"} · WebGL${engine.webGLVersion} · ${browser}`;
}
