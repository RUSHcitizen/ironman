import type { EventBus, GameEvents } from "../core/EventBus";

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
}

/** Every achievement, in the order the menu lists them. */
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "firstBlood", name: "First Blood", desc: "Destroy a hostile" },
  { id: "centurion", name: "Centurion", desc: "Destroy 100 hostiles" },
  { id: "doubleKill", name: "Two for One", desc: "Get a double kill" },
  { id: "rampage", name: "Rampage", desc: "Chain a 7-kill streak" },
  { id: "godlike", name: "Godlike", desc: "Chain a 15-kill streak" },
  { id: "giantSlayer", name: "Giant Slayer", desc: "Bring down a Titan" },
  { id: "carrierDown", name: "Sky Breaker", desc: "Destroy the Dreadnought carrier" },
  { id: "duelist", name: "Duelist", desc: "Defeat the Rogue Armour" },
  { id: "bomberAce", name: "Bomber Ace", desc: "Shoot down a heavy bomber" },
  { id: "sweeper", name: "Minesweeper", desc: "Destroy 10 air mines" },
  { id: "heroLanding", name: "Superhero Landing", desc: "Hit 3 hostiles with one landing" },
  { id: "soundBarrier", name: "Sound Barrier", desc: "Break Mach 1" },
  { id: "hypersonic", name: "Hypersonic", desc: "Go hypersonic" },
  { id: "maxRush", name: "Daredevil", desc: "Fill the RUSH meter" },
  { id: "ringMaster", name: "Ring Master", desc: "Complete a flight challenge" },
  { id: "lifeguard", name: "Lifeguard", desc: "Catch a falling civilian" },
  { id: "bombSquad", name: "Bomb Squad", desc: "Defuse every bomb in a bomb threat" },
  { id: "dataThief", name: "Data Recovery", desc: "Recover all the stolen data cores" },
  { id: "courierCatcher", name: "Special Delivery", desc: "Catch the courier" },
  { id: "guardian", name: "Guardian", desc: "Protect the arc reactor" },
  { id: "medic", name: "Air Ambulance", desc: "Escort the medevac to the hospital" },
  { id: "deckRunner", name: "Deck Runner", desc: "Complete a rooftop run" },
  { id: "lowPull", name: "Low Pull", desc: "Win the skydive challenge" },
  { id: "firefighter", name: "Firefighter", desc: "Put out every rooftop fire" },
  { id: "scavenger", name: "Scavenger", desc: "Collect 20 pickups" },
  { id: "avenger", name: "Avenger", desc: "Reach the AVENGER rank" },
];

const KEY = "ironman.achievements.v1";

/**
 * Achievements unlocked from game events and saved between sessions (fails
 * soft without storage). Unlocks raise an "achievement" event for the HUD.
 */
export class Achievements {
  readonly unlocked = new Set<string>();
  kills = 0;
  mines = 0;
  pickups = 0;

  constructor(private bus: EventBus<GameEvents>) {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { ids?: string[]; kills?: number; mines?: number; pickups?: number };
      for (const id of d.ids ?? []) this.unlocked.add(id);
      this.kills = d.kills ?? 0;
      this.mines = d.mines ?? 0;
      this.pickups = d.pickups ?? 0;
    } catch {
      /* no storage: this session only */
    }
    bus.on("kill", (e) => {
      this.kills++;
      this.unlock("firstBlood");
      if (this.kills >= 100) this.unlock("centurion");
      if (e.kind === "titan") this.unlock("giantSlayer");
      if (e.kind === "carrier") this.unlock("carrierDown");
      if (e.kind === "rival") this.unlock("duelist");
      if (e.kind === "bomber") this.unlock("bomberAce");
      if (e.kind === "courier") this.unlock("courierCatcher");
      if (e.kind === "mine" && ++this.mines >= 10) this.unlock("sweeper");
      this.save();
    });
    bus.on("streak", (e) => {
      if (e.chain >= 2) this.unlock("doubleKill");
      if (e.chain >= 7) this.unlock("rampage");
      if (e.chain >= 15) this.unlock("godlike");
    });
    bus.on("superLanding", (e) => {
      if (e.hits >= 3) this.unlock("heroLanding");
    });
    bus.on("sonicBoom", () => this.unlock("soundBarrier"));
    bus.on("hypersonic", () => this.unlock("hypersonic"));
    bus.on("rush", (e) => {
      if (e.level >= 2) this.unlock("maxRush");
    });
    bus.on("ringPassed", (e) => {
      if (e.index >= e.total) this.unlock("ringMaster");
    });
    bus.on("rescue", (e) => {
      if (e.saved) this.unlock("lifeguard");
    });
    bus.on("objective", (e) => {
      if (!e.won) return;
      const id = ({ bombs: "bombSquad", cores: "dataThief", courier: "courierCatcher", defend: "guardian", escort: "medic", stunt: "deckRunner", skydive: "lowPull", fires: "firefighter" } as Record<string, string>)[e.kind];
      if (id) this.unlock(id);
    });
    bus.on("pickup", () => {
      if (++this.pickups >= 20) this.unlock("scavenger");
      this.save();
    });
    bus.on("rankUp", (e) => {
      if (["AVENGER", "GUARDIAN", "LEGEND", "INVINCIBLE"].includes(e.name)) this.unlock("avenger");
    });
  }

  unlock(id: string): boolean {
    if (this.unlocked.has(id)) return false;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return false;
    this.unlocked.add(id);
    this.save();
    this.bus.emit("achievement", { id, name: def.name });
    return true;
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ids: [...this.unlocked], kills: this.kills, mines: this.mines, pickups: this.pickups }));
    } catch {
      /* ignore */
    }
  }

  /** Menu rows: every achievement with its unlocked state. */
  list(): (AchievementDef & { done: boolean })[] {
    return ACHIEVEMENTS.map((a) => ({ ...a, done: this.unlocked.has(a.id) }));
  }
}
