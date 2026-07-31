import * as THREE from 'three';
import { isSolid } from './blocks.js';
import { atlasTexture, uvRectFor } from '../render/TextureAtlas.js';

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 40;
// Underground faces never go fully black — dark enough that you genuinely
// need a torch to see, but not a literal void that reads as a rendering bug.
const MIN_UNDERGROUND_LIGHT = 0.04;

// Greedy mesher: merges adjacent exposed faces that share the same block
// id + light level into one quad instead of one quad per block face — a
// 16-block grass strip becomes 1 quad instead of 16, cutting triangle/
// draw count sharply on flat/solid runs. Results are pixel-identical to
// the old per-face mesher for shading, since light levels were already
// integer-quantized (World.recomputeLight works in 0-15 steps), so
// "same light" merging never loses detail there. One accepted trade-off:
// a merged quad's texture tile stretches across its full size instead of
// repeating — true per-tile repeat within a shared atlas needs a custom
// shader to wrap UVs inside a sub-rect, which isn't worth it for this
// low-fi pixel-art game; stretching reads as fine on big flat runs.
const FACES = [
  { dir: [1, 0, 0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], tint: 0.75 },
  { dir: [-1, 0, 0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], tint: 0.75 },
  { dir: [0, 1, 0], corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], tint: 1.0 },
  { dir: [0, -1, 0], corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]], tint: 0.5 },
  { dir: [0, 0, 1], corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], tint: 0.85 },
  { dir: [0, 0, -1], corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], tint: 0.65 },
];
const FACE_UVS = [[0, 1], [1, 1], [1, 0], [0, 0]];
const AXIS_SIZE = [CHUNK_X, CHUNK_Y, CHUNK_Z];

export class Chunk {
  constructor(cx, cz, world) {
    this.cx = cx;
    this.cz = cz;
    this.world = world;
    this.data = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
    this.mesh = null;
  }

  index(x, y, z) {
    return (y * CHUNK_Z + z) * CHUNK_X + x;
  }

  inBounds(x, y, z) {
    return x >= 0 && x < CHUNK_X && y >= 0 && y < CHUNK_Y && z >= 0 && z < CHUNK_Z;
  }

  getLocal(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.data[this.index(x, y, z)];
  }

  setLocal(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.index(x, y, z)] = id;
  }

  worldOrigin() {
    return { wx: this.cx * CHUNK_X, wz: this.cz * CHUNK_Z };
  }

  // Face visibility + shading for one local block position along one face
  // direction. Returns null if hidden (air, or a solid neighbor blocking
  // the face); otherwise {id, shade}. Shared by every slice of the mask
  // sweep in _greedyMeshFace.
  _faceAt(x, y, z, face, wx, wz) {
    const id = this.getLocal(x, y, z);
    if (!isSolid(id)) return null;
    const [dx, dy, dz] = face.dir;
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const neighbor = this.inBounds(nx, ny, nz)
      ? this.getLocal(nx, ny, nz)
      : this.world.getBlock(wx + nx, ny, wz + nz);
    if (isSolid(neighbor)) return null;
    const underground = this.world.isUnderground(wx + x, y, wz + z);
    const light = underground
      ? Math.max(MIN_UNDERGROUND_LIGHT, this.world.getLightLevel(wx + nx, ny, wz + nz) / 15)
      : 1;
    return { id, shade: face.tint * light };
  }

  buildMesh(scene) {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }

    const positions = [];
    const normals = [];
    const colors = [];
    const uvs = [];
    const indices = [];
    const { wx, wz } = this.worldOrigin();

    for (const face of FACES) {
      this._greedyMeshFace(face, wx, wz, positions, normals, colors, uvs, indices);
    }

    // A chunk with zero exposed faces (shouldn't normally happen now that
    // terrain is continuous everywhere — see World.js — but stays a cheap,
    // safe guard) skips adding a mesh/draw call entirely.
    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    const material = new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(wx, 0, wz);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    return this.mesh;
  }

  // One face direction's contribution to the mesh: sweeps every slice
  // along the face's normal axis, builds a 2D (blockId+shade) mask over
  // the other two axes for that slice, greedily merges the mask into
  // rectangles (classic "expand width, then expand height while the
  // whole row matches" scan), then emits one quad per rectangle.
  _greedyMeshFace(face, wx, wz, positions, normals, colors, uvs, indices) {
    const [dx, dy, dz] = face.dir;
    const normalAxis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
    const [axisU, axisV] = [0, 1, 2].filter((a) => a !== normalAxis);
    const sizeNormal = AXIS_SIZE[normalAxis];
    const sizeU = AXIS_SIZE[axisU];
    const sizeV = AXIS_SIZE[axisV];
    const coord = [0, 0, 0];

    for (let slice = 0; slice < sizeNormal; slice++) {
      coord[normalAxis] = slice;
      const mask = new Array(sizeU * sizeV);
      for (let u = 0; u < sizeU; u++) {
        coord[axisU] = u;
        for (let v = 0; v < sizeV; v++) {
          coord[axisV] = v;
          mask[u * sizeV + v] = this._faceAt(coord[0], coord[1], coord[2], face, wx, wz);
        }
      }

      const visited = new Uint8Array(sizeU * sizeV);
      for (let u = 0; u < sizeU; u++) {
        for (let v = 0; v < sizeV; v++) {
          const i = u * sizeV + v;
          if (visited[i] || !mask[i]) continue;
          const { id, shade } = mask[i];

          // Expand along v (width) while the mask keeps matching.
          let extentV = 1;
          while (
            v + extentV < sizeV &&
            !visited[u * sizeV + v + extentV] &&
            mask[u * sizeV + v + extentV] &&
            mask[u * sizeV + v + extentV].id === id &&
            mask[u * sizeV + v + extentV].shade === shade
          ) extentV++;

          // Expand along u (height) while the ENTIRE row [v, v+extentV) matches.
          let extentU = 1;
          growU:
          while (u + extentU < sizeU) {
            for (let vv = v; vv < v + extentV; vv++) {
              const j = (u + extentU) * sizeV + vv;
              if (visited[j] || !mask[j] || mask[j].id !== id || mask[j].shade !== shade) break growU;
            }
            extentU++;
          }

          for (let uu = u; uu < u + extentU; uu++) {
            for (let vv = v; vv < v + extentV; vv++) visited[uu * sizeV + vv] = 1;
          }

          this._emitQuad(face, id, shade, normalAxis, axisU, axisV, slice, u, v, extentU, extentV, positions, normals, colors, uvs, indices);
        }
      }
    }
  }

  // Scales the unit-cube corner template in FACES up to an extentU x
  // extentV rectangle. This is always correct — including winding order —
  // without any per-face-direction special-casing: each template corner's
  // 0/1 offset along the two free axes just gets multiplied by that
  // axis's extent instead of staying a flat 0-or-1, while the offset
  // along the normal axis (which only ever picks the near/far cube face,
  // not a length) is left untouched. Reduces to the exact original
  // per-block quad when extentU = extentV = 1.
  _emitQuad(face, id, shade, normalAxis, axisU, axisV, slice, u0, v0, extentU, extentV, positions, normals, colors, uvs, indices) {
    const { u0: tu0, v0: tv0, u1: tu1, v1: tv1 } = uvRectFor(id);
    const [dx, dy, dz] = face.dir;
    const start = positions.length / 3;
    const base = [0, 0, 0];
    base[normalAxis] = slice;
    base[axisU] = u0;
    base[axisV] = v0;

    face.corners.forEach(([c0, c1, c2], i) => {
      const raw = [c0, c1, c2];
      const scaled = [0, 0, 0];
      scaled[normalAxis] = raw[normalAxis];
      scaled[axisU] = raw[axisU] * extentU;
      scaled[axisV] = raw[axisV] * extentV;
      positions.push(base[0] + scaled[0], base[1] + scaled[1], base[2] + scaled[2]);
      normals.push(dx, dy, dz);
      colors.push(shade, shade, shade);
      const [fu, fv] = FACE_UVS[i];
      uvs.push(fu === 0 ? tu0 : tu1, fv === 0 ? tv0 : tv1);
    });
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
}
