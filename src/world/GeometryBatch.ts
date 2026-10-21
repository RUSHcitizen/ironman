import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Box, RGB } from "./CityGenerator";

export type UvMode = "facade" | "world";

export interface FaceMask {
  top?: boolean;
  bottom?: boolean;
  sides?: boolean;
}

type V3 = [number, number, number];

/**
 * Accumulates boxes and quads into a single vertex buffer so a whole chunk's
 * buildings render in one draw call per material.
 */
export class GeometryBatch {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  constructor(
    /** Texture tile size in metres for facade/world UV generation. */
    public tileU = 8,
    public tileV = 8,
  ) {}

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** Quad from 4 corners (any consistent winding); faces `normal`. */
  quad(p: [V3, V3, V3, V3], normal: V3, uv: [number, number][], color: RGB, alpha = 1): void {
    const base = this.vertexCount;
    for (let k = 0; k < 4; k++) {
      this.positions.push(p[k][0], p[k][1], p[k][2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.uvs.push(uv[k][0], uv[k][1]);
      this.colors.push(color[0], color[1], color[2], alpha);
    }
    // Babylon front faces: standard cross product points away from the normal.
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const d = cx * normal[0] + cy * normal[1] + cz * normal[2];
    if (d < 0) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  box(b: Box, color: RGB, mode: UvMode, faces: FaceMask = { top: true, sides: true }): void {
    const { minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1 } = b;
    const tu = this.tileU, tv = this.tileV;
    if (faces.sides !== false) {
      const v0 = y0 / tv, v1 = y1 / tv;
      const fu = (a: number, c: number): [number, number][] =>
        mode === "facade"
          ? [[a / tu, v0], [c / tu, v0], [c / tu, v1], [a / tu, v1]]
          : [[a / tu, v0], [c / tu, v0], [c / tu, v1], [a / tu, v1]];
      // -Z face
      this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], fu(x0, x1), color);
      // +Z face
      this.quad([[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], [0, 0, 1], fu(-x1, -x0), color);
      // -X face
      this.quad([[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [-1, 0, 0], fu(-z1, -z0), color);
      // +X face
      this.quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], fu(z0, z1), color);
    }
    if (faces.top) {
      this.quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], [[x0 / tu, z0 / tu], [x1 / tu, z0 / tu], [x1 / tu, z1 / tu], [x0 / tu, z1 / tu]], color);
    }
    if (faces.bottom) {
      this.quad([[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], [0, -1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]], color);
    }
  }

  /** Flat horizontal rectangle (e.g. road markings) at height y. */
  rect(x0: number, z0: number, x1: number, z1: number, y: number, color: RGB): void {
    const tu = this.tileU;
    this.quad([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, 1, 0], [[x0 / tu, z0 / tu], [x1 / tu, z0 / tu], [x1 / tu, z1 / tu], [x0 / tu, z1 / tu]], color);
  }

  build(name: string, scene: Scene, material: Material | null): Mesh | null {
    if (this.indices.length === 0) return null;
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.colors = this.colors;
    vd.indices = this.indices;
    vd.applyToMesh(mesh, false);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }
}
