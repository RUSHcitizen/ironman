import type { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * Set a thin-instance count, disabling the mesh at zero. A mesh with a
 * per-instance colour buffer but no instances would otherwise be compiled
 * with instance colours but without instancing - an invalid shader.
 */
export function setInstanceCount(mesh: Mesh, n: number): void {
  mesh.thinInstanceCount = n;
  const on = n > 0;
  if (mesh.isEnabled(false) !== on) mesh.setEnabled(on);
}
