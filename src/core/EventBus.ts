type Handler<T> = (payload: T) => void;

/** Minimal typed pub/sub used to decouple gameplay systems from the HUD/audio. */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as Handler<Events[K]>)(payload);
  }
}

export type AlertLevel = "info" | "warn" | "critical" | "success";

export interface GameEvents extends Record<string, unknown> {
  alert: { text: string; level: AlertLevel; ttl?: number };
  modeChanged: { mode: string };
  impact: { speed: number };
  landed: { hard: boolean };
  areaChanged: { name: string };
  qualityChanged: { quality: string };
  /** Suit transformation started (toSuited) / finished (suited). */
  suitTransform: { toSuited: boolean; airborne: boolean };
  suitChanged: { suited: boolean };
  boost: Record<string, never>;
  sonicBoom: { x: number; y: number; z: number };
  roll: { dir: number };
  trick: { name: string; combo: number };
  suitLatch: { x: number; y: number; z: number; part: number };
  nearMiss: { streak: number };
  playerHit: { damage: number };
  evaded: Record<string, never>;
  suitFailure: Record<string, never>;
  unibeam: { x: number; y: number; z: number; charging: boolean };
  flares: { count: number };
  rankUp: { name: string };
  hypersonic: { x: number; y: number; z: number };
  ringPassed: { index: number; total: number };
  rescue: { saved: boolean };
  playerDied: { cause: "fall" | "water"; speed: number };
  weapon: { kind: "repulsor" | "rocket" | "enemyBolt" | "missile" | "laser"; x: number; y: number; z: number };
  explosion: { x: number; y: number; z: number; size: number };
  kill: { kind: string; total: number };
}
