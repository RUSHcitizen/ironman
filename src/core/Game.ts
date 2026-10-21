import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { RenderingGroup } from "@babylonjs/core/Rendering/renderingGroup";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
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
import { PlayerController } from "../player/PlayerController";
import { ArmorModel } from "../player/ArmorModel";
import { ThirdPersonCamera } from "../camera/ThirdPersonCamera";
import { InputManager } from "../input/InputManager";
import { Hud, type HudMarker } from "../ui/Hud";
import { SettingsMenu } from "../ui/SettingsMenu";
import { SuitAudio } from "../audio/SuitAudio";
import { CityEvents } from "../gameplay/CityEvents";
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
    await progress(0.12, "Building skyline and harbour");
    this.env = new Environment(scene, this.mats, this.world);
    this.props = new PropSystem(scene, this.mats);
    this.chunks = new ChunkManager(scene, this.mats, this.world, this.props);
    const list = this.chunks.districtChunks();
    for (let k = 0; k < list.length; k++) {
      this.chunks.load(list[k][0], list[k][1]);
      if (k % 3 === 2) await progress(0.15 + (0.45 * k) / list.length, `Constructing district ${k + 1}/${list.length}`);
    }
    await progress(0.62, "Populating streets");
    this.traffic = new TrafficSystem(scene, this.mats, QUALITY_PRESETS.high.cars);
    this.peds = new PedestrianSystem(scene, this.mats, QUALITY_PRESETS.high.pedestrians);

    await progress(0.7, "Calibrating armour");
    this.player = new PlayerController(this.world, this.bus);
    this.player.spawn(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw);
    this.avatar = new ArmorModel(scene);
    this.cam = new ThirdPersonCamera(scene);
    this.events = new CityEvents(scene, this.mats, this.world, this.bus);

    this.input = new InputManager(this.canvas, this.uiRoot, this.settings, this.device.isTouch);
    this.hud = new Hud(this.uiRoot, this.bus);
    this.hud.onMenu = () => this.setPaused(true);
    this.menu = new SettingsMenu(this.uiRoot, this.settings, { onResume: () => this.setPaused(false), onRespawn: () => this.respawn() }, this.device.isTouch);
    this.audio = new SuitAudio(this.bus);
    this.hud.setVisible(false);
    this.input.touch.setVisible(false);

    this.bus.on("modeChanged", (m) => {
      this.input.touch.setMode(m.mode);
      this.updateHint();
    });
    this.bus.on("impact", (e) => this.cam.addShake(Math.min(1, e.speed / 60)));
    this.bus.on("landed", (e) => this.cam.addShake(e.hard ? 0.7 : 0.15));
    this.settings.onChange(() => this.applySettings());
    this.applySettings();
    this.updateHint();

    // Prime one simulation step so the first frame is posed correctly.
    this.avatar.update(0.016, this.player);
    this.cam.update(0.016, this.player, this.world);
    this.chunks.updateVisibility(this.cam.position.x, this.cam.position.z, this.settings.preset.viewDistance);
    this.props.update(this.cam.position.x, this.cam.position.z, this.settings.preset.propDistance, this.settings.preset.viewDistance, CHUNK_SIZE);

    await progress(0.8, "Compiling shaders");
    await scene.whenReadyAsync();
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

  /** Called from the "Engage" user gesture. */
  start(): void {
    this.started = true;
    this.audio.unlock();
    this.audio.setVolume(this.settings.data.volume);
    this.hud.setVisible(true);
    this.input.touch.setVisible(this.device.isTouch);
    this.avatar.playSuitUp();
    this.setPaused(false);
    this.bus.emit("alert", { text: "Good evening. All suit systems nominal.", level: "info", ttl: 5 });
    this.bus.emit("alert", { text: this.device.isTouch ? "Tap LIFT to take off, FLY for high-speed flight" : "Space to take off · Shift for flight · W afterburner", level: "info", ttl: 7 });
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
      this.input.touch.setMode(mode);
    }
    this.cam.snap();
    this.cam.update(0.016, p, this.world);
  }

  respawn(): void {
    this.teleport(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw);
    this.bus.emit("alert", { text: "Returned to Apex Tower landing pad", level: "info" });
  }

  private updateHint(): void {
    if (this.device.isTouch) return this.hud.setHint("");
    const m = this.player.mode;
    this.hud.setHint(
      m === "ground" ? "SPACE lift-off · SHIFT launch" : m === "hover" ? "SPACE/C altitude · SHIFT flight" : "W afterburner · S brake · SHIFT hover",
    );
  }

  private applySettings(): void {
    const s = this.settings.data;
    const q = this.settings.preset;
    const ratio = Math.min(this.device.dpr, q.pixelRatio);
    this.engine.setHardwareScalingLevel(1 / ratio);
    this.env.setViewDistance(q.viewDistance);
    this.cam.camera.maxZ = Math.max(q.viewDistance + 200, 2200);
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
    this.player.update(dt, input);
    this.avatar.update(dt, this.player);
    this.cam.update(dt, this.player, this.world);
    this.env.update(this.time);
    this.traffic.update(dt);
    this.props.setSignalPhase(this.traffic.phase);
    this.props.setBeaconOn(Math.sin(this.time * 3) > 0.3);
    this.peds.update(dt);

    const camPos = this.cam.position;
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.25;
      const q = this.settings.preset;
      this.chunks.updateVisibility(camPos.x, camPos.z, q.viewDistance);
      this.props.update(camPos.x, camPos.z, q.propDistance, q.viewDistance, CHUNK_SIZE);
    }
    this.areaTimer -= dt;
    if (this.areaTimer <= 0) {
      this.areaTimer = 0.5;
      const a = this.chunks.areaAt(this.player.pos.x, this.player.pos.z);
      if (a !== this.area) {
        this.area = a;
        this.bus.emit("areaChanged", { name: a });
      }
    }
    if (this.events.update(dt, this.player)) this.refreshMarkers();
    const [title, detail] = this.events.objective;
    const d = this.events.distanceTo(this.player);
    this.hud.setObjective(title, title ? `${detail} · ${Math.round(d)} m` : "");
    if (this.shadowGen) this.env.sun.position.set(this.player.pos.x + 60, this.player.pos.y + 25, this.player.pos.z + 20);

    this.hud.update(dt, this.player);
    this.audio.update(this.player);
    this.autoQuality(dt);
  }

  private refreshMarkers(): void {
    const markers: HudMarker[] = [{ id: "apex", label: "APEX", x: HERO_X, z: HERO_Z, kind: "poi" }, ...this.events.markers];
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
      pos: { ...p.pos },
      speed: p.speed,
      energy: p.suit.energy,
      fps: this.hud.fps,
      paused: this.paused,
      started: this.started,
      quality: this.settings.data.quality,
      activeMeshes: this.scene.getActiveMeshes().length,
      chunks: this.chunks.count,
      props: this.props.scenePropCount,
    };
  }
}
