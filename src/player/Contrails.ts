import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ProjectileSystem } from "../combat/Projectiles";

/**
 * White vapour contrails streaming from the boots at high speed (and in thin
 * air): soft puffs left behind in the world that swell and fade, so they
 * never sweep across the chase camera like a ribbon would.
 */
export class Contrails {
  private level = 0;
  private timer = 0;
  enabled = true;

  constructor(
    private fx: ProjectileSystem,
    private anchors: TransformNode[],
  ) {}

  reset(): void {
    this.level = 0;
  }

  get intensity(): number {
    return this.level;
  }

  update(dt: number, flying: boolean, speed: number, altitude: number): void {
    const want = this.enabled && flying ? Math.min(1, Math.max(0, (speed - 55) / 50) + Math.max(0, (altitude - 900) / 1500) * 0.5) : 0;
    this.level += (want - this.level) * Math.min(1, dt * 3);
    if (this.level < 0.05) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.03;
    for (const a of this.anchors) {
      const p = a.getAbsolutePosition();
      this.fx.vapour({ x: p.x, y: p.y, z: p.z }, this.level);
    }
  }
}
