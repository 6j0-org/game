// Turns a chunk into vertex arrays: face culling, per-vertex ambient occlusion,
// and atlas UVs. Returns plain typed arrays; main.js wraps them in Three.js geometry.

import { AIR, WATER, BLOCKS, SEE_THROUGH, PLANT, SHAPES, LAVA_LAMP, FLUORESCENT, TILE_COUNT, FLUID, LEAFY, GLOWS, shapeBoxes, isLitLuminary, CAMPFIRE } from './blocks.js';
import { CS, CH, caveShade } from './world.js';

// Corner order per face forms a strip: triangles (0,1,2) and (2,1,3).
const FACES = [
  { dir: [-1, 0, 0], side: 'side', shade: 0.8, corners: [
    { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { dir: [1, 0, 0], side: 'side', shade: 0.8, corners: [
    { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
    { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { dir: [0, -1, 0], side: 'bottom', shade: 0.55, corners: [
    { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
    { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] },
  { dir: [0, 1, 0], side: 'top', shade: 1.0, corners: [
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] },
  { dir: [0, 0, -1], side: 'side', shade: 0.7, corners: [
    { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
    { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
  { dir: [0, 0, 1], side: 'side', shade: 0.7, corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
    { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
];

// Precompute AO neighbour offsets per face corner: [side1, side2, corner].
for (const f of FACES) {
  const axis = f.dir.findIndex((v) => v !== 0);
  const t1 = (axis + 1) % 3;
  const t2 = (axis + 2) % 3;
  for (const c of f.corners) {
    const o1 = [0, 0, 0];
    const o2 = [0, 0, 0];
    o1[t1] = c.pos[t1] ? 1 : -1;
    o2[t2] = c.pos[t2] ? 1 : -1;
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    c.ao = [add(f.dir, o1), add(f.dir, o2), add(add(f.dir, o1), o2)];
  }
}

const AO_LEVELS = [0.45, 0.65, 0.82, 1.0];
const UV_EPS = 0.001;
const WATER_SURFACE = 0.875;

const newBuf = () => ({ pos: [], uv: [], col: [], idx: [] });
const finish = (b) => ({
  positions: new Float32Array(b.pos),
  uvs: new Float32Array(b.uv),
  colors: new Float32Array(b.col),
  indices: new Uint32Array(b.idx),
  vertexCount: b.pos.length / 3,
});

// Two crossed, double-sided quads (like a bunch of stalks), inset a little from the block's edges.
const PLANT_QUADS = [
  [[0.12, 0.12], [0.88, 0.88]],
  [[0.12, 0.88], [0.88, 0.12]],
];
function addPlant(buf, x, y, z, tile) {
  for (const [[ax, az], [bx, bz]] of PLANT_QUADS) {
    const base = buf.pos.length / 3;
    const corners = [[ax, 0, az, 0, 0], [bx, 0, bz, 1, 0], [bx, 1, bz, 1, 1], [ax, 1, az, 0, 1]];
    for (const [cx, cy, cz, u, v] of corners) {
      buf.pos.push(x + cx, y + cy, z + cz);
      buf.uv.push((tile + UV_EPS + u * (1 - 2 * UV_EPS)) / TILE_COUNT, UV_EPS + v * (1 - 2 * UV_EPS));
      const shade = cy ? 0.95 : 0.7; // a touch darker at the roots
      buf.col.push(shade, shade, shade);
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); // front
    buf.idx.push(base, base + 2, base + 1, base, base + 3, base + 2); // back
  }
}

/** Stairs, slabs and doors: each of their boxes, faces textured with the matching part of the tile. */
function addShape(buf, x, y, z, id, get) {
  const def = BLOCKS[id];
  for (const b of shapeBoxes(id, get, x, y, z)) {
    for (const f of FACES) {
      const axis = f.dir.findIndex((v) => v !== 0);
      const positive = f.dir[axis] > 0;
      const onEdge = positive ? b[axis + 3] === 1 : b[axis] === 0;
      if (onEdge) {
        const n = get(x + f.dir[0], y + f.dir[1], z + f.dir[2]);
        if (n !== AIR && !SEE_THROUGH[n]) continue; // hidden against a full block
      }
      const tile = b[6] ?? def[f.side]; // a box can bring its own tile (a bed's pillow)
      const base = buf.pos.length / 3;
      for (const c of f.corners) {
        const p = [0, 1, 2].map((k) => (c.pos[k] ? b[k + 3] : b[k]));
        buf.pos.push(x + p[0], y + p[1], z + p[2]);
        // u, v from the corner's position on the face, so a half slab shows half a texture.
        const [u, v] = axis === 0 ? [p[2], p[1]] : axis === 2 ? [p[0], p[1]] : [p[0], p[2]];
        buf.uv.push((tile + UV_EPS + u * (1 - 2 * UV_EPS)) / TILE_COUNT, UV_EPS + v * (1 - 2 * UV_EPS));
        buf.col.push(f.shade, f.shade, f.shade);
      }
      buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
}

export function buildChunkMesh(world, chunk) {
  const solid = newBuf();
  const water = newBuf();
  const glow = newBuf(); // lava and lights: drawn at full brightness
  const lamps = [];
  const lights = []; // fluorescent panels: they light their surroundings too
  const data = chunk.data;
  const ox = chunk.cx * CS;
  const oz = chunk.cz * CS;

  const get = (x, y, z) =>
    x >= 0 && x < CS && z >= 0 && z < CS && y >= 0 && y < CH
      ? data[(y * CS + z) * CS + x]
      : world.getBlock(ox + x, y, oz + z);
  const occludes = (x, y, z) => {
    const b = get(x, y, z);
    return b !== AIR && !SEE_THROUGH[b] ? 1 : 0;
  };
  // Caves are dark (world.js caveShade): for each column (and one round the chunk), its natural ground height
  // and its highest block. A face is lit by the air in front of it.
  const W = CS + 2;
  const ground = new Int16Array(W * W);
  const top = new Int16Array(W * W);
  for (let z = -1; z <= CS; z++) {
    for (let x = -1; x <= CS; x++) {
      const i = (z + 1) * W + x + 1;
      ground[i] = world.heightAt(ox + x, oz + z);
      let y = CH - 1;
      while (y >= 0 && get(x, y, z) === AIR) y--;
      top[i] = y;
    }
  }
  const shadeAt = (x, y, z) => {
    const i = (Math.max(-1, Math.min(CS, z)) + 1) * W + Math.max(-1, Math.min(CS, x)) + 1;
    return caveShade(y, ground[i], top[i]);
  };
  /** Dims the colours added to `buf` since `from` (a plant or shaped block in a cave). */
  const dim = (buf, from, k) => { if (k < 1) for (let i = from; i < buf.col.length; i++) buf.col[i] *= k; };

  for (let y = 0; y < CH; y++) {
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const id = data[(y * CS + z) * CS + x];
        if (id === AIR) continue;
        if (PLANT[id]) {
          const from = solid.col.length;
          addPlant(solid, x, y, z, BLOCKS[id].side);
          dim(solid, from, shadeAt(x, y, z));
          continue;
        }
        if (id === LAVA_LAMP) {
          lamps.push([ox + x, y, oz + z]); // drawn (and lit) by main.js, not meshed
          continue;
        }
        if (SHAPES[id]) {
          const from = solid.col.length;
          addShape(GLOWS[id] ? glow : solid, x, y, z, id, get); // (a lit luminary glows)
          if (!GLOWS[id]) dim(solid, from, shadeAt(x, y, z));
          if (isLitLuminary(id) || id === CAMPFIRE) lights.push([ox + x, y, oz + z, 'luminary']); // and lights the room (a campfire too)
          continue;
        }
        const fluid = FLUID[id];
        const isWater = id === WATER;
        const buf = isWater ? water : GLOWS[id] ? glow : solid;
        if (id === FLUORESCENT) lights.push([ox + x, y, oz + z]);
        const def = BLOCKS[id];
        const lowerTop = fluid && get(x, y + 1, z) !== id;

        for (const f of FACES) {
          const n = get(x + f.dir[0], y + f.dir[1], z + f.dir[2]);
          if (fluid) {
            // Fluids show only where they meet air or see-through blocks (not themselves, not solid ground).
            if (n === id || (n !== AIR && !SEE_THROUGH[n]) || (isWater && n !== AIR)) continue;
          } else if (!SEE_THROUGH[n] || (n === id && !LEAFY[id])) {
            continue;
          }

          const tile = def[f.side];
          const base = buf.pos.length / 3;
          const cave = GLOWS[id] ? 1 : shadeAt(x + f.dir[0], y + f.dir[1], z + f.dir[2]); // (the air it faces)
          const ao = [3, 3, 3, 3];
          for (let i = 0; i < 4; i++) {
            const c = f.corners[i];
            const py = lowerTop && c.pos[1] === 1 ? WATER_SURFACE : c.pos[1];
            buf.pos.push(x + c.pos[0], y + py, z + c.pos[2]);
            buf.uv.push(
              (tile + UV_EPS + c.uv[0] * (1 - 2 * UV_EPS)) / TILE_COUNT,
              UV_EPS + c.uv[1] * (1 - 2 * UV_EPS),
            );
            if (!fluid && !GLOWS[id]) {
              const [a, b, k] = c.ao;
              const s1 = occludes(x + a[0], y + a[1], z + a[2]);
              const s2 = occludes(x + b[0], y + b[1], z + b[2]);
              const cr = occludes(x + k[0], y + k[1], z + k[2]);
              ao[i] = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
            }
            const s = f.shade * AO_LEVELS[ao[i]] * cave;
            buf.col.push(s, s, s);
          }
          // Split the quad along the diagonal that avoids AO anisotropy.
          if (ao[0] + ao[3] > ao[1] + ao[2]) {
            buf.idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
          } else {
            buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
        }
      }
    }
  }
  return { solid: finish(solid), water: finish(water), glow: finish(glow), lamps, lights };
}
