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
  private fovKick = 0;
  private initialised = false;

  constructor(scene: Scene) {
    this.camera = new TargetCamera("cam", new Vector3(0, 5, -10), scene);
    this.camera.minZ = 0.2;
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

  /** Momentary FOV punch (boosts, sonic boom). */
  addKick(amount: number): void {
    this.fovKick = Math.min(0.3, this.fovKick + amount);
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
    const headY = !p.suited ? 1.55 : flight ? 0.9 : p.mode === "hover" ? 1.75 : 1.65;
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

    let want = !p.suited ? 3.6 : p.mode === "ground" ? 5.2 : p.mode === "hover" ? 7 : 5.4 + clamp(speed / 165, 0, 1) * 2.4;
    // Raise the camera a little in flight so the horizon stays readable.
    const lift = flight ? 1.0 : 0.45;
    // Shoulder offset on foot / hover.
    // Over-the-shoulder offset keeps the crosshair clear of the hero for aiming.
    const shoulder = flight ? 0 : !p.suited ? 0.35 : p.mode === "hover" ? 1.25 : 0.9;
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

    this.fovKick = Math.max(0, this.fovKick - dt * 0.5);
    const targetFov = 0.92 + clamp((speed - 15) / 150, 0, 1) * 0.26 + this.fovKick;
    this.fov += (targetFov - this.fov) * damp(3, dt);
    this.camera.fov = this.fov;
  }
}
