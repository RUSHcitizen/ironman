import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { EventBus, GameEvents } from "../core/EventBus";
import type { CollisionWorld } from "../world/Collision";
import type { WorldMaterials } from "../world/Materials";
import type { PlayerController } from "../player/PlayerController";
import { AIR_KINDS, type EnemyKind, type EnemyManager } from "../combat/Enemies";
import type { HudMarker } from "../ui/Hud";
import { Rng } from "../core/math";
import { DISTRICT_MIN, DISTRICT_MAX } from "../world/WorldConfig";

type Placement = "air" | "roof" | "street";

interface Template {
  title: string;
  detail: string;
  place: Placement;
  /** Enemies to spawn; empty = non-combat assist call. */
  squad: EnemyKind[];
  /** Only offered after this many completed incidents. */
  minLevel?: number;
  /** A civilian falls off this rooftop: catch them mid-air. */
  rescue?: boolean;
}

/** Fall speed (m/s) a civilian survives (matches the player's civilian limit). */
const SAFE_LANDING = 26;

interface Faller {
  x: number;
  y: number;
  z: number;
  vy: number;
  /** Street below the fall column. */
  floor: number;
  /** Where they step off to (over the street). */
  dropX: number;
  dropZ: number;
  state: "waiting" | "falling" | "caught";
  t: number;
}

const TEMPLATES: Template[] = [
  { title: "Rogue drone swarm", detail: "Hostile drones over the avenue", place: "air", squad: ["drone", "drone", "drone", "drone"] },
  { title: "Armed gang on a rooftop", detail: "Jet-pack troopers spotted", place: "roof", squad: ["trooper", "trooper", "trooper"] },
  { title: "Street robbery in progress", detail: "Armed suspects at street level", place: "street", squad: ["trooper", "trooper", "trooper", "drone"] },
  { title: "Kamikaze drone wave", detail: "Explosive drones inbound - keep moving", place: "air", squad: ["kamikaze", "kamikaze", "kamikaze", "kamikaze", "drone", "drone"], minLevel: 1 },
  { title: "Rooftop missile nest", detail: "Troopers with homing launchers", place: "roof", squad: ["trooper", "trooper", "trooper", "trooper", "drone"], minLevel: 2 },
  { title: "WARBOT RAMPAGE", detail: "Heavy assault mech - dodge the laser", place: "street", squad: ["warbot", "drone", "drone"], minLevel: 3 },
  { title: "Sniper nest", detail: "Watch for the red laser - keep moving", place: "roof", squad: ["sniper", "sniper", "trooper"] },
  { title: "Shielded strike team", detail: "Take out the shield drone first", place: "air", squad: ["shielder", "drone", "drone", "drone"], minLevel: 1 },
  { title: "Gunship assault", detail: "Heavy VTOL gunship over the district", place: "air", squad: ["gunship", "drone", "drone"], minLevel: 1 },
  { title: "Armoured convoy", detail: "Hover tanks shelling the avenue", place: "street", squad: ["tank", "tank", "trooper", "trooper"], minLevel: 2 },
  { title: "All-out assault", detail: "Gunship, shield drone and a tank", place: "street", squad: ["gunship", "shielder", "tank", "drone", "drone", "sniper"], minLevel: 4 },
  { title: "Interceptor squadron", detail: "Fighter jets making strafing runs", place: "air", squad: ["jet", "jet", "jet"], minLevel: 1 },
  { title: "Hunter swarm", detail: "A cloud of tiny seekers - sweep them up", place: "air", squad: ["swarmer", "swarmer", "swarmer", "swarmer", "swarmer", "swarmer", "swarmer", "swarmer", "swarmer", "swarmer"] },
  { title: "EMP strike", detail: "Jammer drones drain suit power - keep your distance", place: "air", squad: ["jammer", "jammer", "drone", "drone", "drone"], minLevel: 1 },
  { title: "Air superiority", detail: "Jets escorting a gunship", place: "air", squad: ["gunship", "jet", "jet", "shielder", "swarmer", "swarmer", "swarmer"], minLevel: 3 },
  { title: "DREADNOUGHT INBOUND", detail: "Carrier airship launching swarmers - bring rockets", place: "air", squad: ["carrier", "jet", "jet", "jammer"], minLevel: 3 },
  { title: "Ultron sentinels", detail: "Flying robots that ram you - dodge the dash", place: "air", squad: ["sentinel", "sentinel", "sentinel", "sentinel"], minLevel: 1 },
  { title: "Spider walkers", detail: "Six-legged walkers lobbing mortars down the avenue", place: "street", squad: ["spider", "spider", "trooper", "trooper"], minLevel: 2 },
  { title: "Ghost squadron", detail: "Cloaked drones - they only show when they fire", place: "air", squad: ["cloaker", "cloaker", "cloaker", "drone"], minLevel: 2 },
  { title: "TITAN AWAKENS", detail: "Super-heavy mech - dodge the laser and the stomp", place: "street", squad: ["titan", "sentinel", "sentinel", "spider"], minLevel: 4 },
  { title: "Civilian falling!", detail: "Someone's slipping off a rooftop - catch them before they hit the street", place: "roof", squad: [], rescue: true },
  { title: "Stalled cab on the avenue", detail: "Assist at street level", place: "street", squad: [] },
  { title: "Rooftop distress beacon", detail: "Civilian signal from a rooftop", place: "roof", squad: [] },
];

interface Incident {
  t: Template;
  x: number;
  y: number;
  z: number;
  group: number;
  total: number;
}

/**
 * Free-roam incidents. F.R.I.D.A.Y. dispatches a nearby incident, marks it on the
 * compass and in the world (beam + ring); neutralise every hostile, or reach
 * the beacon for assist calls, to complete it.
 */
export class CityEvents {
  private current: Incident | null = null;
  private cooldown = 5;
  private beam: Mesh;
  private ring: Mesh;
  private rng = new Rng(Date.now() >>> 0);
  private nextGroup = 1;
  completed = 0;
  private time = 0;
  faller: Faller | null = null;
  private person: TransformNode;
  /** Rescues: caught / lost (for the HUD and tests). */
  saved = 0;
  lost = 0;
  /** Called when an incident is resolved (for rewards). */
  onComplete: ((combat: boolean) => void) | null = null;

  constructor(
    scene: Scene,
    mats: WorldMaterials,
    private world: CollisionWorld,
    private bus: EventBus<GameEvents>,
    private enemies: EnemyManager,
  ) {
    this.beam = CreateCylinder("eventBeam", { diameter: 3, height: 400, tessellation: 12, cap: 0 }, scene);
    this.beam.material = mats.additive("eventBeam", new Color3(1.0, 0.65, 0.2), 0.35);
    this.ring = CreateTorus("eventRing", { diameter: 14, thickness: 0.5, tessellation: 32 }, scene);
    this.ring.material = mats.additive("eventRing", new Color3(1, 0.75, 0.3), 0.9);
    for (const m of [this.beam, this.ring]) {
      m.isPickable = false;
      m.setEnabled(false);
    }
    // The person to rescue: simple figure in a bright jacket so you can spot them.
    this.person = new TransformNode("faller", scene);
    const jacket = new StandardMaterial("fallerJacket", scene);
    jacket.diffuseColor = new Color3(0.95, 0.75, 0.1);
    jacket.emissiveColor = new Color3(0.25, 0.18, 0);
    const skin = new StandardMaterial("fallerSkin", scene);
    skin.diffuseColor = new Color3(0.8, 0.6, 0.47);
    const body = CreateCapsule("fallerBody", { height: 1.2, radius: 0.22 }, scene);
    body.material = jacket;
    body.position.y = 0.9;
    const head = CreateSphere("fallerHead", { diameter: 0.28, segments: 8 }, scene);
    head.material = skin;
    head.position.y = 1.65;
    const legs = CreateCapsule("fallerLegs", { height: 0.9, radius: 0.14 }, scene);
    legs.material = jacket;
    legs.position.y = 0.35;
    for (const m of [body, head, legs]) {
      m.parent = this.person;
      m.isPickable = false;
    }
    this.person.setEnabled(false);
  }

  /** Rescue state for the HUD / tests. */
  get rescue(): { state: string; y: number; vy: number } | null {
    return this.faller ? { state: this.faller.state, y: this.faller.y, vy: this.faller.vy } : null;
  }

  get markers(): HudMarker[] {
    return this.current ? [{ id: "event", label: "◆", x: this.current.x, z: this.current.z, kind: "event" }] : [];
  }

  get objective(): [string, string] {
    const c = this.current;
    if (!c) return ["", ""];
    if (c.total === 0) return [c.t.title.toUpperCase(), c.t.detail];
    const left = this.enemies.aliveInGroup(c.group);
    return [c.t.title.toUpperCase(), `Hostiles ${c.total - left}/${c.total} · ${c.t.detail}`];
  }

  distanceTo(p: PlayerController): number {
    if (!this.current) return Infinity;
    return Math.hypot(this.current.x - p.pos.x, this.current.y - p.pos.y, this.current.z - p.pos.z);
  }

  /** Force an incident now (debug / tests). */
  spawnNow(p: PlayerController, title?: string): void {
    this.clear();
    const t = title ? TEMPLATES.find((x) => x.title === title) : undefined;
    this.spawn(p, t);
  }

  clear(): void {
    this.current = null;
    this.faller = null;
    this.person.setEnabled(false);
    this.beam.setEnabled(false);
    this.ring.setEnabled(false);
  }

  update(dt: number, p: PlayerController): boolean {
    this.time += dt;
    if (!this.current) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.spawn(p);
        return true;
      }
      return false;
    }
    const c = this.current;
    this.ring.rotation.y += dt * 0.8;
    const s = 1 + Math.sin(this.time * 3) * 0.08;
    this.ring.scaling.set(s, 1, s);
    // Follow the remaining hostiles so the marker stays useful.
    if (c.total > 0) {
      let n = 0, sx = 0, sy = 0, sz = 0;
      for (const e of this.enemies.enemies) {
        if (!e.alive || e.group !== c.group) continue;
        n++;
        sx += e.x;
        sy += e.y;
        sz += e.z;
      }
      if (n > 0) {
        c.x = sx / n;
        c.z = sz / n;
        c.y = sy / n;
        this.beam.position.set(c.x, this.world.surfaceBelow(c.x, c.y + 1, c.z) + 200, c.z);
        this.ring.position.set(c.x, c.y + 1.2, c.z);
      }
    }
    if (c.t.rescue) return this.updateRescue(dt, p, c);
    const done = c.total > 0 ? this.enemies.aliveInGroup(c.group) === 0 : this.distanceTo(p) < 10 && p.suited;
    if (done) {
      this.completed++;
      this.bus.emit("alert", { text: `${c.t.title} resolved · suit repaired · ${this.completed} incident${this.completed === 1 ? "" : "s"} today`, level: "success" });
      this.onComplete?.(c.total > 0);
      this.clear();
      this.cooldown = this.rng.range(6, 12);
      return true;
    }
    return false;
  }

  private spawn(p: PlayerController, forced?: Template): void {
    const pool = TEMPLATES.filter((t) => (t.minLevel ?? 0) <= this.completed);
    // Mostly combat; assist calls now and then.
    const combat = pool.filter((t) => t.squad.length > 0);
    const t = forced ?? (this.rng.chance(0.8) ? this.rng.pick(combat) : this.rng.pick(pool));
    for (let tries = 0; tries < 60; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = forced ? this.rng.range(110, 180) : this.rng.range(200, 480);
      const x = Math.max(DISTRICT_MIN + 20, Math.min(DISTRICT_MAX - 20, p.pos.x + Math.sin(a) * d));
      const z = Math.max(DISTRICT_MIN + 20, Math.min(DISTRICT_MAX - 20, p.pos.z + Math.cos(a) * d));
      const top = this.world.surfaceBelow(x, 1000, z, 0.5, 0);
      if (t.place === "roof" && top < 12) continue;
      if (t.place === "street" && top > 0.5) continue;
      let drop: { x: number; z: number; dropX: number; dropZ: number; floor: number } | null = null;
      if (t.rescue) {
        if (top < 45) continue;
        drop = this.placeFaller(x, top, z);
        if (!drop) continue;
      }
      const group = this.nextGroup++;
      const y = t.place === "air" ? top + this.rng.range(30, 55) : top;
      this.current = { t, x, y, z, group, total: t.squad.length };
      this.placeSquad(t, x, y, z, top, group);
      if (drop) {
        this.faller = { x: drop.x, y: top, z: drop.z, vy: 0, floor: drop.floor, dropX: drop.dropX, dropZ: drop.dropZ, state: "waiting", t: 0 };
        this.person.position.set(drop.x, top, drop.z);
        this.person.rotation.set(0, 0, 0);
        this.person.setEnabled(true);
        this.current!.x = drop.x;
        this.current!.z = drop.z;
        this.current!.y = top;
      }
      this.beam.position.set(x, top + 200, z);
      this.ring.position.set(x, y + 1.2, z);
      this.beam.setEnabled(true);
      this.ring.setEnabled(true);
      this.bus.emit("alert", { text: `${t.squad.length ? "Threat" : "Incident"}: ${t.title}`, level: t.squad.length ? "critical" : "warn", ttl: 5 });
      return;
    }
    this.cooldown = 2; // try again shortly
  }

  /**
   * Falling civilian: they wait at the roof edge until you get close (or time
   * runs out), then fall. Fly through them in the suit to catch them; if they
   * hit the street too fast, they're lost.
   */
  private updateRescue(dt: number, p: PlayerController, c: Incident): boolean {
    const f = this.faller;
    if (!f) return false;
    f.t += dt;
    const near = Math.hypot(f.x - p.pos.x, f.z - p.pos.z) < 220;
    if (f.state === "waiting") {
      // Teetering on the edge.
      this.person.rotation.z = Math.sin(this.time * 6) * 0.25;
      if (near || f.t > 40) {
        f.state = "falling";
        f.t = 0;
        this.bus.emit("alert", { text: "They're falling! Catch them!", level: "critical", ttl: 3 });
      }
    } else if (f.state === "falling") {
      // Step off the edge, out over the street, then drop.
      const k = Math.min(1, dt * 5);
      f.x += (f.dropX - f.x) * k;
      f.z += (f.dropZ - f.z) * k;
      f.vy -= 22 * dt;
      f.vy -= f.vy * Math.min(1, 0.0075 * Math.abs(f.vy) * dt);
      f.y += f.vy * dt;
      // Flailing tumble.
      this.person.rotation.set(Math.sin(this.time * 7) * 0.9, this.time * 2, Math.cos(this.time * 5) * 0.7);
      const pc = p.center;
      if (p.suited && Math.hypot(pc.x - f.x, pc.y - (f.y + 0.9), pc.z - f.z) < 4.5) {
        f.state = "caught";
        f.t = 0;
        this.saved++;
        this.completed++;
        this.bus.emit("alert", { text: "Gotcha! Civilian safe - nice catch, boss", level: "success" });
        this.bus.emit("rescue", { saved: true });
        this.onComplete?.(false);
      } else if (f.y <= f.floor) {
        f.y = f.floor;
        const survived = -f.vy <= SAFE_LANDING;
        if (!survived) this.lost++;
        this.bus.emit("alert", { text: survived ? "They landed safely" : "We lost them... we'll do better next time", level: survived ? "info" : "warn" });
        this.bus.emit("rescue", { saved: survived });
        this.clear();
        this.cooldown = this.rng.range(6, 12);
        return true;
      }
    } else {
      // Caught: carried along for a moment, then set down safely.
      f.x = p.pos.x + Math.sin(p.bodyYaw) * 0.6;
      f.y = p.pos.y + 0.2;
      f.z = p.pos.z + Math.cos(p.bodyYaw) * 0.6;
      this.person.rotation.set(0.6, p.bodyYaw, 0);
      if (f.t > 3) {
        this.clear();
        this.cooldown = this.rng.range(6, 12);
        return true;
      }
    }
    this.person.position.set(f.x, f.y, f.z);
    c.x = f.x;
    c.y = f.y;
    c.z = f.z;
    this.ring.position.set(f.x, f.y + 1.2, f.z);
    return false;
  }

  /** Find a roof edge with a clear drop of 25 m+ to the street beside it. */
  private placeFaller(x: number, top: number, z: number): { x: number; z: number; dropX: number; dropZ: number; floor: number } | null {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let r = 2; r < 40; r += 1) {
        const floor = this.world.surfaceBelow(x + ca * r, top + 1, z + sa * r, 0.3, 0);
        if (floor > top - 1.5) continue;
        if (floor < top - 25 && Math.abs(this.world.surfaceBelow(x + ca * (r - 1.2), top + 1, z + sa * (r - 1.2), 0.2, 0) - top) < 1.5) {
          const dropFloor = this.world.surfaceBelow(x + ca * (r + 1.5), top + 1, z + sa * (r + 1.5), 0.5, 0);
          if (dropFloor > top - 25) break;
          return { x: x + ca * (r - 1.2), z: z + sa * (r - 1.2), dropX: x + ca * (r + 1.5), dropZ: z + sa * (r + 1.5), floor: dropFloor };
        }
        break;
      }
    }
    return null;
  }

  private placeSquad(t: Template, x: number, y: number, z: number, top: number, group: number): void {
    for (const kind of t.squad) {
      if (AIR_KINDS.has(kind)) {
        const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(4, 16);
        const lift = kind === "carrier" ? 75 : kind === "gunship" || kind === "jet" ? 35 : 18;
        this.enemies.spawn(kind, x + Math.cos(a) * r, Math.max(y, top + lift) + this.rng.range(-4, 6), z + Math.sin(a) * r, group);
        continue;
      }
      // Ground units: find a nearby spot at the same surface height that is not inside a building.
      for (let k = 0; k < 20; k++) {
        const r = kind === "warbot" || kind === "titan" ? 0 : kind === "tank" || kind === "spider" ? this.rng.range(0, 25) : this.rng.range(2, t.place === "roof" ? 9 : 14);
        const a = this.rng.range(0, Math.PI * 2);
        const gx = x + Math.cos(a) * r, gz = z + Math.sin(a) * r;
        const s = this.world.surfaceBelow(gx, top + 1, gz, 0.4);
        const half = kind === "titan" ? 4.2 : kind === "tank" || kind === "warbot" || kind === "spider" ? 2.4 : 0.5;
        const blocked = this.world.overlaps(gx - half, s + 0.4, gz - half, gx + half, s + 1.8, gz + half);
        if (Math.abs(s - top) < 0.6 && !blocked) {
          this.enemies.spawn(kind, gx, s, gz, group);
          break;
        }
      }
    }
    // Squad count may be smaller if placement failed.
    if (this.current) this.current.total = this.enemies.aliveInGroup(group) || 0;
    if (this.current && this.current.total === 0 && t.squad.length > 0) {
      // Fallback: everything spawns as drones overhead.
      for (let k = 0; k < t.squad.length; k++) this.enemies.spawn("drone", x + k * 3, top + 25, z, group);
      this.current.total = t.squad.length;
    }
  }
}
