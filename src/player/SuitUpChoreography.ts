/**
 * Choreographed suit-up on the ground, one section at a time:
 * chest and back, right arm, left arm, right leg, left leg, helmet, faceplate.
 * The wearer presents each limb (arm raised out, knee lifted) and that
 * section's plates fly in and clamp on, glove / boot first. Pure data and
 * maths so it can be tested without a renderer.
 */

export type JointName = "spine" | "neck" | "shL" | "shR" | "elL" | "elR" | "hipL" | "hipR" | "knL" | "knR";
export type Pose = Partial<Record<JointName, [number, number]>>;

export const SuitStage = { Core: 0, RightArm: 1, LeftArm: 2, RightLeg: 3, LeftLeg: 4, Helmet: 5, Faceplate: 6 } as const;

/** Start and length (seconds) of each stage, in order. */
export const SUIT_UP_STAGES: readonly { start: number; dur: number }[] = [
  { start: 0, dur: 0.5 },
  { start: 0.5, dur: 0.65 },
  { start: 1.15, dur: 0.65 },
  { start: 1.8, dur: 0.65 },
  { start: 2.45, dur: 0.65 },
  { start: 3.1, dur: 0.5 },
  { start: 3.6, dur: 0.5 },
];
export const SUIT_UP_TIME = 4.1;

/**
 * When a plate launches and how long it flies. `order` 0..1 is its place in
 * the stage (0 = first: the glove or the boot).
 */
export function pieceTiming(stage: number, order: number): { t0: number; flight: number } {
  const s = SUIT_UP_STAGES[stage];
  // The limb is presented first; then the plates stream in.
  return { t0: s.start + s.dur * (0.28 + 0.3 * order), flight: s.dur * 0.38 };
}

/** Stage playing at time t (the last one once finished). */
export function stageAt(t: number): number {
  for (let k = SUIT_UP_STAGES.length - 1; k >= 0; k--) if (t >= SUIT_UP_STAGES[k].start) return k;
  return 0;
}

/** Arm raised straight out to the side (side: -1 left, +1 right). */
const armOut = (side: number): [number, number] => [-0.25, side * 1.4];
/** Relaxed A-pose arm. */
const armDown = (side: number): [number, number] => [0.05, side * 0.32];

/**
 * Body pose for the suit-up at time t, plus a head turn (radians, + = right)
 * toward the limb being armoured.
 */
export function suitUpPose(t: number): { pose: Pose; look: number } {
  const st = stageAt(t);
  const s = SUIT_UP_STAGES[st];
  const k = Math.min(1, Math.max(0, (t - s.start) / s.dur));
  const pose: Pose = {
    spine: [-0.04, 0],
    neck: [0.08, 0],
    shL: armDown(-1),
    shR: armDown(1),
    elL: [-0.15, 0],
    elR: [-0.15, 0],
    hipL: [0, -0.05],
    hipR: [0, 0.05],
    knL: [0.04, 0],
    knR: [0.04, 0],
  };
  let look = 0;
  switch (st) {
    case SuitStage.Core:
      // Chest out, arms held away from the body, watching the plates arrive.
      pose.spine = [-0.14, 0];
      pose.neck = [0.3, 0];
      pose.shL = [0.1, -0.55];
      pose.shR = [0.1, 0.55];
      break;
    case SuitStage.RightArm:
    case SuitStage.LeftArm: {
      const side = st === SuitStage.RightArm ? 1 : -1;
      const sh = side > 0 ? "shR" : "shL", el = side > 0 ? "elR" : "elL";
      pose[sh] = armOut(side);
      // Fingers flex as the glove clamps: a little elbow pulse late in the stage.
      pose[el] = [-0.08 - Math.max(0, Math.sin((k - 0.55) * Math.PI * 2.5)) * 0.25, 0];
      pose.spine = [-0.04, -side * 0.06];
      pose.neck = [0.12, 0];
      look = side * 0.7;
      break;
    }
    case SuitStage.RightLeg:
    case SuitStage.LeftLeg: {
      const side = st === SuitStage.RightLeg ? 1 : -1;
      const hip = side > 0 ? "hipR" : "hipL", kn = side > 0 ? "knR" : "knL";
      // Knee up, arms out for balance, eyes on the boot.
      const lift = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (k > 0.88 ? 1 - (k - 0.88) / 0.12 : 1);
      pose[hip] = [-1.05 * lift, side * 0.05];
      pose[kn] = [1.25 * lift, 0];
      pose.shL = [0.0, -0.75];
      pose.shR = [0.0, 0.75];
      pose.spine = [0.08 * lift, side * 0.05];
      pose.neck = [0.5 * lift, 0];
      look = side * 0.15;
      break;
    }
    case SuitStage.Helmet:
      // Stand tall, chin up, as the helmet closes around the head.
      pose.spine = [-0.08, 0];
      pose.neck = [-0.2, 0];
      break;
    case SuitStage.Faceplate:
      // Faceplate slams down: a small nod as it clamps, then fists clench at the sides.
      pose.spine = [-0.06, 0];
      pose.neck = [k < 0.6 ? -0.2 : -0.2 + Math.sin((k - 0.6) / 0.4 * Math.PI) * 0.18, 0];
      pose.elL = [-0.35 * k, 0];
      pose.elR = [-0.35 * k, 0];
      break;
  }
  return { pose, look };
}
