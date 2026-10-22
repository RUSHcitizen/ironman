import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { CollisionWorld } from "./Collision";

const GHOSTS: { f: number; size: number; color: string }[] = [
  { f: 0.55, size: 46, color: "120,150,255" },
  { f: 0.9, size: 26, color: "255,170,90" },
  { f: 1.25, size: 70, color: "110,220,170" },
  { f: 1.6, size: 20, color: "255,200,120" },
  { f: 2.0, size: 110, color: "150,130,255" },
];

/**
 * Sun lens flare as a screen-space overlay: a soft glare on the sun, an
 * anamorphic streak and a chain of ghosts across the view. The sun is
 * projected as a direction (view + projection only), so it is exact with
 * floating-origin rendering; occlusion is one cheap collision-world ray.
 * Costs a handful of composited elements, no extra render passes.
 */
export class SunFlare {
  private root: HTMLElement;
  private glow: HTMLElement;
  private streak: HTMLElement;
  private ghosts: HTMLElement[] = [];
  private vis = 0;
  private want = 0;
  private checkTimer = 0;
  private v = new Vector3();
  private shown = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "sunflare";
    this.root.setAttribute("aria-hidden", "true");
    this.glow = document.createElement("i");
    this.glow.className = "sf-glow";
    this.streak = document.createElement("i");
    this.streak.className = "sf-streak";
    this.root.append(this.glow, this.streak);
    for (const g of GHOSTS) {
      const el = document.createElement("i");
      el.className = "sf-ghost";
      el.style.width = el.style.height = `${g.size}px`;
      el.style.margin = `${-g.size / 2}px 0 0 ${-g.size / 2}px`;
      // Soft filled glows (no ring outlines).
      el.style.background = `radial-gradient(circle, rgba(${g.color},0.16) 0%, rgba(${g.color},0.08) 45%, rgba(${g.color},0) 100%)`;
      this.ghosts.push(el);
      this.root.append(el);
    }
    parent.prepend(this.root);
  }

  /** Track the sun; fade with occlusion and when off-screen. */
  update(dt: number, camera: Camera, cam: Vector3, sunDir: Vector3, world: CollisionWorld, enabled: boolean, width: number, height: number): void {
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.1;
      const blocked = enabled && world.raycast(cam.x, cam.y, cam.z, sunDir.x, sunDir.y, sunDir.z, 2500) !== Infinity;
      this.want = enabled && sunDir.y > -0.02 && !blocked ? 1 : 0;
    }
    // Direction into view space, then onto the screen.
    Vector3.TransformNormalToRef(sunDir, camera.getViewMatrix(), this.v);
    const inFront = this.v.z > 0.05;
    let sx = 0, sy = 0, edge = 0;
    if (inFront) {
      const p = camera.getProjectionMatrix().m;
      const x = this.v.x * p[0] + this.v.y * p[4] + this.v.z * p[8];
      const y = this.v.x * p[1] + this.v.y * p[5] + this.v.z * p[9];
      const w = this.v.x * p[3] + this.v.y * p[7] + this.v.z * p[11];
      const nx = x / w, ny = y / w;
      sx = (nx * 0.5 + 0.5) * width;
      sy = (0.5 - ny * 0.5) * height;
      // Fade out as the sun leaves the frame.
      edge = Math.max(0, 1 - Math.max(0, Math.abs(nx) - 0.85) / 0.35) * Math.max(0, 1 - Math.max(0, Math.abs(ny) - 0.85) / 0.35);
    }
    const target = this.want * (inFront ? edge : 0);
    this.vis += (target - this.vis) * Math.min(1, dt * 6);
    const on = this.vis > 0.01;
    if (on !== this.shown) {
      this.shown = on;
      this.root.style.display = on ? "block" : "none";
    }
    if (!on) return;
    this.root.style.opacity = this.vis.toFixed(3);
    this.glow.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    this.streak.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    const cx = width / 2, cy = height / 2;
    for (let k = 0; k < GHOSTS.length; k++) {
      const f = GHOSTS[k].f;
      const gx = sx + (cx - sx) * f, gy = sy + (cy - sy) * f;
      this.ghosts[k].style.transform = `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px)`;
    }
  }
}
