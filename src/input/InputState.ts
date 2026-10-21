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
  /** Edge-triggered actions (true for exactly one frame). */
  takeoff: boolean;
  toggleFlight: boolean;
  menu: boolean;
}

export function emptyInput(): InputState {
  return { moveX: 0, moveY: 0, lookX: 0, lookY: 0, ascend: false, descend: false, takeoff: false, toggleFlight: false, menu: false };
}
