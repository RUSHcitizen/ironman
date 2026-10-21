import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { RGB } from "./CityGenerator";

/** Tiny helpers to compose low-poly props from primitives with baked vertex colours. */
export class ProcGeo {
  constructor(private scene: Scene) {}

  private finish(m: Mesh, c: RGB, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Mesh {
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.bakeCurrentTransformIntoVertices();
    const n = m.getTotalVertices();
    const col = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) col.set([c[0], c[1], c[2], 1], k * 4);
    m.setVerticesData(VertexBuffer.ColorKind, col);
    return m;
  }

  box(w: number, h: number, d: number, c: RGB, x = 0, y = 0, z = 0, ry = 0): Mesh {
    return this.finish(CreateBox("b", { width: w, height: h, depth: d }, this.scene), c, x, y, z, 0, ry);
  }

  cyl(rTop: number, rBottom: number, h: number, c: RGB, x = 0, y = 0, z = 0, tess = 10, rx = 0, rz = 0): Mesh {
    return this.finish(CreateCylinder("c", { diameterTop: rTop * 2, diameterBottom: rBottom * 2, height: h, tessellation: tess }, this.scene), c, x, y, z, rx, 0, rz);
  }

  sphere(r: number, c: RGB, x = 0, y = 0, z = 0, seg = 8, sx = 1, sy = 1, sz = 1): Mesh {
    const m = CreateSphere("s", { diameter: r * 2, segments: seg }, this.scene);
    m.scaling.set(sx, sy, sz);
    return this.finish(m, c, x, y, z);
  }

  ico(r: number, c: RGB, x = 0, y = 0, z = 0, sy = 1): Mesh {
    const m = CreateIcoSphere("i", { radius: r, subdivisions: 1, flat: true }, this.scene);
    m.scaling.y = sy;
    return this.finish(m, c, x, y, z);
  }

  merge(name: string, parts: Mesh[]): Mesh {
    const m = Mesh.MergeMeshes(parts, true, true);
    if (!m) throw new Error("merge failed: " + name);
    m.name = name;
    m.isPickable = false;
    return m;
  }
}
