import * as THREE from 'three';
import { isSolid } from './blocks.js';
import { atlasTexture, uvRectFor } from '../render/TextureAtlas.js';

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 40;
// Underground faces never go fully black — dark enough that you genuinely
// need a torch to see, but not a literal void that reads as a rendering bug.
const MIN_UNDERGROUND_LIGHT = 0.04;

// Culled-face mesher: for a small island this is plenty fast and much
// simpler than true greedy meshing — only exposed faces get triangles,
// merged into one BufferGeometry per chunk. Textured via a shared atlas
// (render/TextureAtlas.js) rather than per-block vertex colors; the vertex
// color attribute is repurposed as a cheap per-face-direction brightness
// tint (top brightest, bottom darkest) — texture * tint, no per-face
// normals-based lighting needed.
const FACES = [
  { dir: [1, 0, 0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], tint: 0.75 },
  { dir: [-1, 0, 0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], tint: 0.75 },
  { dir: [0, 1, 0], corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], tint: 1.0 },
  { dir: [0, -1, 0], corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]], tint: 0.5 },
  { dir: [0, 0, 1], corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], tint: 0.85 },
  { dir: [0, 0, -1], corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], tint: 0.65 },
];
const FACE_UVS = [[0, 1], [1, 1], [1, 0], [0, 0]];

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

    for (let y = 0; y < CHUNK_Y; y++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        for (let x = 0; x < CHUNK_X; x++) {
          const id = this.getLocal(x, y, z);
          if (!isSolid(id)) continue;
          const { u0, v0, u1, v1 } = uvRectFor(id);
          const underground = this.world.isUnderground(wx + x, y, wz + z);

          for (const face of FACES) {
            const [dx, dy, dz] = face.dir;
            const nx = x + dx, ny = y + dy, nz = z + dz;
            const neighbor = this.inBounds(nx, ny, nz)
              ? this.getLocal(nx, ny, nz)
              : this.world.getBlock(wx + nx, ny, wz + nz);
            if (isSolid(neighbor)) continue; // hidden face, skip

            // Underground faces are lit by the propagated torch/lava
            // lightmap instead of the normal day/night scene lighting —
            // sampled from the exposed (air) side of the face, same as
            // Minecraft's own block-light model. Surface faces are
            // untouched (light === 1) so nothing changes above ground.
            const light = underground
              ? Math.max(MIN_UNDERGROUND_LIGHT, this.world.getLightLevel(wx + nx, ny, wz + nz) / 15)
              : 1;
            const shade = face.tint * light;

            const start = positions.length / 3;
            face.corners.forEach(([cxo, cyo, czo], i) => {
              positions.push(x + cxo, y + cyo, z + czo);
              normals.push(dx, dy, dz);
              colors.push(shade, shade, shade);
              const [fu, fv] = FACE_UVS[i];
              uvs.push(fu === 0 ? u0 : u1, fv === 0 ? v0 : v1);
            });
            indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
          }
        }
      }
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
}
