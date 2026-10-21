/** Device-agnostic per-frame input snapshot consumed by gameplay. */
export interface InputState {
  /** Planar movement, -1..1. moveY > 0 is forward. */
  moveX: number;
  moveY: number;
  /** Look delta this frame, in radians (sensitivity already applied). */
  lookX: number;
  lookY: number;
  ascend: boolean;
  descend: boolean;
  /** Held: repulsor fire. */
  fire: boolean;
  /** Held: sprint (civilian). */
  sprint: boolean;
  /** Edge-triggered actions (true for exactly one frame). */
  takeoff: boolean;
  toggleFlight: boolean;
  rockets: boolean;
  toggleSuit: boolean;
  /** Cut all thrust and free-fall (again to re-engage). */
  cutThrust: boolean;
  /** Toggle sentry mode for the empty suit. */
  sentry: boolean;
  /** Mid-air trick requested this frame. */
  trick: TrickRequest | null;
  /** Charge-free chest Unibeam (edge). */
  beam: boolean;
  /** Toggle the HUD (cinematic mode) (edge). */
  cinematic: boolean;
  /** Pop countermeasure flares (edge). */
  flares: boolean;
  /** Shift+A / Shift+D: -1 sharp left, +1 sharp right, 0 none. */
  sharpTurn: number;
  /** -1 roll left, +1 roll right, 0 none. */
  roll: number;
  menu: boolean;
}

/** "auto" picks a loop in flight / front flip in hover (touch TRICK button). */
export type TrickRequest = "auto" | "flip" | "backflip" | "spin";

export function emptyInput(): InputState {
  return {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    ascend: false,
    descend: false,
    fire: false,
    sprint: false,
    takeoff: false,
    toggleFlight: false,
    rockets: false,
    toggleSuit: false,
    sentry: false,
    cutThrust: false,
    trick: null,
    roll: 0,
    sharpTurn: 0,
    beam: false,
    flares: false,
    cinematic: false,
    menu: false,
  };
}
