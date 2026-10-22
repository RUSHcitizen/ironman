import type { EventBus, GameEvents } from "../core/EventBus";
import { Rng } from "../core/math";

/**
 * Contracts: three side objectives running at once (destroy N of a kind,
 * finish a mission type, collect pickups, pull off stunts...). Completing one
 * pays XP and a new one takes its place. Driven purely by game events.
 */
export interface ContractDef {
  id: string;
  text: string;
  /** Event that advances it, and a filter on that event. */
  on: keyof GameEvents;
  match?: (e: never) => boolean;
  goal: number;
  reward: number;
}

const kill = (kind: string) => (e: never) => (e as { kind: string }).kind === kind;
const won = (kind: string) => (e: never) => (e as { kind: string; won: boolean }).kind === kind && (e as { won: boolean }).won;

export const CONTRACTS: ContractDef[] = [
  { id: "drones", text: "Destroy 8 drones", on: "kill", match: kill("drone"), goal: 8, reward: 400 },
  { id: "troopers", text: "Take down 6 jet-pack troopers", on: "kill", match: kill("trooper"), goal: 6, reward: 400 },
  { id: "swarm", text: "Pop 15 swarmers", on: "kill", match: kill("swarmer"), goal: 15, reward: 450 },
  { id: "jets", text: "Shoot down 3 jets", on: "kill", match: kill("jet"), goal: 3, reward: 600 },
  { id: "mines", text: "Clear 8 air mines", on: "kill", match: kill("mine"), goal: 8, reward: 450 },
  { id: "heavies", text: "Destroy 2 gunships", on: "kill", match: kill("gunship"), goal: 2, reward: 700 },
  { id: "turrets", text: "Silence 3 flak turrets", on: "kill", match: kill("turret"), goal: 3, reward: 600 },
  { id: "arcs", text: "Destroy 4 arc drones", on: "kill", match: kill("arc"), goal: 4, reward: 600 },
  { id: "any", text: "Destroy 25 hostiles", on: "kill", goal: 25, reward: 800 },
  { id: "streak", text: "Chain a triple kill", on: "streak", match: (e: never) => (e as { chain: number }).chain >= 3, goal: 1, reward: 500 },
  { id: "landing", text: "Superhero-land on 2 hostiles at once", on: "superLanding", match: (e: never) => (e as { hits: number }).hits >= 2, goal: 1, reward: 600 },
  { id: "pickups", text: "Collect 6 salvage pickups", on: "pickup", goal: 6, reward: 400 },
  { id: "bombs", text: "Defuse a bomb threat", on: "objective", match: won("bombs"), goal: 1, reward: 700 },
  { id: "cores", text: "Recover the stolen data cores", on: "objective", match: won("cores"), goal: 1, reward: 700 },
  { id: "escort", text: "Escort a medevac home", on: "objective", match: won("escort"), goal: 1, reward: 800 },
  { id: "stunt", text: "Complete a rooftop run", on: "objective", match: won("stunt"), goal: 1, reward: 600 },
  { id: "skydive", text: "Nail a low-pull skydive", on: "objective", match: won("skydive"), goal: 1, reward: 600 },
  { id: "rescue", text: "Catch a falling civilian", on: "rescue", match: (e: never) => (e as { saved: boolean }).saved, goal: 1, reward: 700 },
  { id: "rings", text: "Fly through 15 course rings", on: "ringPassed", goal: 15, reward: 500 },
  { id: "nearMiss", text: "Pull 10 near misses", on: "nearMiss", goal: 10, reward: 450 },
  { id: "rush", text: "Hit MAX RUSH twice", on: "rush", match: (e: never) => (e as { level: number }).level >= 2, goal: 2, reward: 500 },
  { id: "sonic", text: "Break the sound barrier", on: "sonicBoom", goal: 1, reward: 400 },
  { id: "tricks", text: "Land 5 flight tricks", on: "trick", goal: 5, reward: 400 },
];

export interface ActiveContract {
  def: ContractDef;
  progress: number;
}

export class Contracts {
  readonly active: ActiveContract[] = [];
  completed = 0;
  private rng: Rng;

  constructor(
    private bus: EventBus<GameEvents>,
    seed = Date.now() >>> 0,
    count = 3,
  ) {
    this.rng = new Rng(seed);
    for (let k = 0; k < count; k++) this.active.push({ def: this.pick(), progress: 0 });
    const events = new Set(CONTRACTS.map((c) => c.on));
    for (const ev of events) bus.on(ev, (e) => this.advance(ev, e));
  }

  /** A contract not currently active. */
  private pick(): ContractDef {
    const taken = new Set(this.active.map((a) => a.def.id));
    const pool = CONTRACTS.filter((c) => !taken.has(c.id));
    return this.rng.pick(pool);
  }

  private advance(ev: keyof GameEvents, e: unknown): void {
    for (let i = 0; i < this.active.length; i++) {
      const a = this.active[i];
      if (a.def.on !== ev || (a.def.match && !a.def.match(e as never))) continue;
      a.progress++;
      if (a.progress >= a.def.goal) {
        this.completed++;
        this.bus.emit("contract", { text: a.def.text, reward: a.def.reward });
        this.active[i] = { def: this.pick(), progress: 0 };
      }
    }
  }

  /** Lines for the menu / HUD. */
  list(): { text: string; progress: number; goal: number; reward: number }[] {
    return this.active.map((a) => ({ text: a.def.text, progress: a.progress, goal: a.def.goal, reward: a.def.reward }));
  }
}
