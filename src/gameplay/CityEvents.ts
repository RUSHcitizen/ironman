import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { EventBus, GameEvents } from "../core/EventBus";
import type { CollisionWorld } from "../world/Collision";
import type { WorldMaterials } from "../world/Materials";
import type { PlayerController } from "../player/PlayerController";
import type { HudMarker } from "../ui/Hud";
import { Rng } from "../core/math";
import { DISTRICT_MIN, DISTRICT_MAX } from "../world/WorldConfig";

interface CityEvent {
  title: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

const TEMPLATES = [
  { title: "Rooftop distress beacon", detail: "Civilian signal from a rooftop", roof: true },
  { title: "Stalled cab on the avenue", detail: "Traffic incident reported", roof: false },
  { title: "Crane sensor fault", detail: "Inspect the construction site", roof: true },
  { title: "Water tower leak", detail: "Structural alert on a rooftop", roof: true },
  { title: "Lost tourist", detail: "Assist at street level", roof: false },
];

/**
 * Optional free-roam activities. ARIA generates a nearby incident, marks it
 * on the compass and in the world; reaching it completes the event.
 */
export class CityEvents {
  private current: (CityEvent & { detail: string }) | null = null;
  private cooldown = 6;
  private beam: Mesh;
  private ring: Mesh;
  private rng = new Rng(Date.now() >>> 0);
  completed = 0;
  private time = 0;

  constructor(
    scene: Scene,
    mats: WorldMaterials,
    private world: CollisionWorld,
    private bus: EventBus<GameEvents>,
  ) {
    const mat = mats.additive("eventBeam", new Color3(1.0, 0.65, 0.2), 0.35);
    this.beam = CreateCylinder("eventBeam", { diameter: 3, height: 400, tessellation: 12, cap: 0 }, scene);
    this.beam.material = mat;
    this.ring = CreateTorus("eventRing", { diameter: 14, thickness: 0.5, tessellation: 32 }, scene);
    this.ring.material = mats.additive("eventRing", new Color3(1, 0.75, 0.3), 0.9);
    for (const m of [this.beam, this.ring]) {
      m.isPickable = false;
      m.setEnabled(false);
    }
  }

  get markers(): HudMarker[] {
    return this.current ? [{ id: "event", label: "◆", x: this.current.x, z: this.current.z, kind: "event" }] : [];
  }

  get objective(): [string, string] {
    if (!this.current) return ["", ""];
    return [this.current.title.toUpperCase(), this.current.detail];
  }

  distanceTo(p: PlayerController): number {
    if (!this.current) return Infinity;
    return Math.hypot(this.current.x - p.pos.x, this.current.y - p.pos.y, this.current.z - p.pos.z);
  }

  update(dt: number, p: PlayerController): boolean {
    this.time += dt;
    let changed = false;
    if (!this.current) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.spawn(p);
        changed = true;
      }
      return changed;
    }
    const e = this.current;
    this.ring.rotation.y += dt * 0.8;
    const s = 1 + Math.sin(this.time * 3) * 0.08;
    this.ring.scaling.set(s, 1, s);
    if (this.distanceTo(p) < e.radius) {
      this.completed++;
      this.bus.emit("alert", { text: `${e.title} resolved · ${this.completed} assist${this.completed === 1 ? "" : "s"} today`, level: "success" });
      this.current = null;
      this.beam.setEnabled(false);
      this.ring.setEnabled(false);
      this.cooldown = this.rng.range(8, 16);
      changed = true;
    }
    return changed;
  }

  private spawn(p: PlayerController): void {
    const t = this.rng.pick(TEMPLATES);
    for (let tries = 0; tries < 40; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(140, 380);
      const x = Math.max(DISTRICT_MIN + 10, Math.min(DISTRICT_MAX - 10, p.pos.x + Math.sin(a) * d));
      const z = Math.max(DISTRICT_MIN + 10, Math.min(DISTRICT_MAX - 10, p.pos.z + Math.cos(a) * d));
      const y = this.world.surfaceBelow(x, 1000, z, 0.5, 0);
      const onRoof = y > 5;
      if (t.roof !== onRoof) continue;
      this.current = { title: t.title, detail: t.detail, x, y, z, radius: 10 };
      this.beam.position.set(x, y + 200, z);
      this.ring.position.set(x, y + 1.2, z);
      this.beam.setEnabled(true);
      this.ring.setEnabled(true);
      this.bus.emit("alert", { text: `New incident: ${t.title}`, level: "warn", ttl: 5 });
      return;
    }
    this.cooldown = 2; // try again shortly
  }
}
