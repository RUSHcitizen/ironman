import type { Scene } from "@babylonjs/core/scene";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlayerController } from "../player/PlayerController";
import type { CollisionWorld } from "../world/Collision";
import { clamp, damp, lerp } from "../core/math";

/**
 * Smooth third-person follow camera. Aim angles come from the player
 * controller; the camera handles distance, smoothing, FOV, collision and shake.
 */
export class ThirdPersonCamera {
  readonly camera: TargetCamera;
  private pivot = new Vector3();
  private dist = 6;
  private fov = 0.95;
  private shake = 0;
  private roll = 0;
  private initialised = false;

  constructor(scene: Scene) {
    this.camera = new TargetCamera("cam", new Vector3(0, 5, -10), scene);
    this.camera.minZ = 0.15;
    this.camera.maxZ = 4200;
    this.camera.fov = this.fov;
    this.camera.inertia = 0;
    this.camera.rotation.set(0, 0, 0);
    scene.activeCamera = this.camera;
  }

  /** Jump straight to the follow position (after teleports / respawn). */
  snap(): void {
    this.initialised = false;
    this.dist = 6;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  get position(): Vector3 {
    return this.camera.position;
  }

  update(dt: number, p: PlayerController, world: CollisionWorld): void {
    const speed = p.speed;
    const flight = p.mode === "flight";
    const headY = flight ? 0.9 : p.mode === "hover" ? 1.75 : 1.65;
    const tx = p.pos.x, ty = p.pos.y + headY, tz = p.pos.z;
    if (!this.initialised) {
      this.pivot.set(tx, ty, tz);
      this.initialised = true;
    }
    // Flight: lock to the hero (velocity is already smoothed, and pivot lag at
    // 100+ m/s pushes the hero metres ahead of the camera). On foot: soften.
    const pk = flight ? 1 : damp(12, dt);
    this.pivot.x += (tx - this.pivot.x) * pk;
    this.pivot.y += (ty - this.pivot.y) * (flight ? damp(30, dt) : damp(9, dt));
    this.pivot.z += (tz - this.pivot.z) * pk;

    const yaw = p.viewYaw, pitch = p.viewPitch;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;

    let want = p.mode === "ground" ? 5.2 : p.mode === "hover" ? 7 : 6.2 + clamp(speed / 125, 0, 1) * 3;
    // Raise the camera a little in flight so the horizon stays readable.
    const lift = flight ? 1.0 : 0.45;
    // Shoulder offset on foot / hover.
    const shoulder = flight ? 0 : 0.55;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);

    const ox = this.pivot.x + rx * shoulder;
    const oy = this.pivot.y + lift;
    const oz = this.pivot.z + rz * shoulder;
    // Camera collision: pull in if a building is between pivot and camera.
    const hit = world.raycast(ox, oy, oz, -dx, -dy, -dz, want + 0.5, 0.25);
    if (hit < want + 0.5) want = Math.max(1.0, hit - 0.45);
    this.dist = want < this.dist ? want : lerp(this.dist, want, damp(3, dt));

    let px = ox - dx * this.dist, py = oy - dy * this.dist, pz = oz - dz * this.dist;
    // Never dip below the ground surface.
    py = Math.max(py, world.terrainHeight(px, pz) + 0.35);

    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.5;
      px += (Math.random() - 0.5) * s;
      py += (Math.random() - 0.5) * s;
      pz += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
    // Subtle buzz at very high speed.
    if (p.afterburner) py += (Math.random() - 0.5) * 0.03;

    this.camera.position.set(px, py, pz);
    this.camera.rotation.x = -pitch;
    this.camera.rotation.y = yaw;
    this.roll += ((flight ? p.bodyRoll * 0.18 : 0) - this.roll) * damp(4, dt);
    this.camera.rotation.z = this.roll;

    const targetFov = 0.92 + clamp((speed - 15) / 110, 0, 1) * 0.28;
    this.fov += (targetFov - this.fov) * damp(3, dt);
    this.camera.fov = this.fov;
  }
}
