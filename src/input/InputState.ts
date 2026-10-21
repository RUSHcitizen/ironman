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
  /** Toggle sentry mode for the empty suit. */
  sentry: boolean;
  /** -1 roll left, +1 roll right, 0 none. */
  roll: number;
  menu: boolean;
}

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
    roll: 0,
    menu: false,
  };
}
