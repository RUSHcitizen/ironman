export interface V3 {
  x: number;
  y: number;
  z: number;
}

export function len(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export function norm(v: V3): V3 {
  const l = len(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function dist(a: V3, b: V3): number {
  return len(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Distance from point c to segment p0-p1. */
export function segmentPointDistance(p0: V3, p1: V3, c: V3): number {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((c.x - p0.x) * dx + (c.y - p0.y) * dy + (c.z - p0.z) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return len(p0.x + dx * t - c.x, p0.y + dy * t - c.y, p0.z + dz * t - c.z);
}

/** Rotate unit vector `cur` toward `want` by at most `maxAngle` radians. */
export function steer(cur: V3, want: V3, maxAngle: number): V3 {
  const d = Math.max(-1, Math.min(1, cur.x * want.x + cur.y * want.y + cur.z * want.z));
  const ang = Math.acos(d);
  if (ang <= maxAngle || ang < 1e-5) return norm(want);
  const t = maxAngle / ang;
  return norm({ x: cur.x + (want.x - cur.x) * t, y: cur.y + (want.y - cur.y) * t, z: cur.z + (want.z - cur.z) * t });
}
