// Chunked voxel storage, terrain generation, edits persistence and raycasting.
// No Three.js dependency, so it can be tested in Node.

import { AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, WHEAT, SNOW_GRASS, SANDSTONE, CACTUS, SPRUCE_LOG, SPRUCE_LEAVES,
  JUNGLE_LOG, JUNGLE_LEAVES, MUD, ICE, CONCRETE, ASPHALT, WINDOW, RUBBLE, BRIMSTONE, LAVA, CARPET, WALLPAPER, CEILING_TILE,
  FLUORESCENT, BALLS, FOAM, FLUID, SOLID } from './blocks.js';
import { biomeAt, biomeAtV1, biomeAtV2, groundHeight, cityColumn, backroomsWall, backroomsLight, ROOM, ROOM_HEIGHT, HELL_LAVA } from './biomes.js';
import { townColumn, TOWN_CELL, MARKET_EVERY, MARKET, MARKET_ARRIVAL } from './townplan.js';
import { createNoise2D, hash2 } from './noise.js';

export const CS = 16; // chunk size (x and z)
export const CH = 80; // chunk height (y)
export const SEA = 20; // sea level

const index = (x, y, z) => (y * CS + z) * CS + x;
/**
 * Legacy chunks: when biomes grew (biomes.js), every chunk a world had been built in, plus one chunk
 * around each, was frozen on the first generation (`biomeAtV1`) so builds keep the land they stand on.
 * Around them the new terrain's height eases into the old over this many blocks.
 */
export const BLEND = 32;
const smoothstep = (t) => t * t * (3 - 2 * t);

export class World {
  /**
   * @param {number} seed
   * @param {{get(k:string):string|null,set(k:string,v:string):void}|null} storage
   */
  constructor(seed, storage = null) {
    this.seed = seed | 0;
    this.noise = createNoise2D(this.seed);
    this.chunks = new Map(); // "cx,cz" -> chunk
    this.edits = new Map(); // "cx,cz" -> Map(localIndex -> blockId)
    this.storage = storage;
    this.storageKey = `game:edits:${this.seed}`;
    this._saveTimer = null;
    this.onChange = null; // (x, y, z, id) => void, called for every block change
    this.legacy = new Set(); // "cx,cz" of chunks generated the first-generation way (see BLEND)
    this.gen2 = new Set(); // chunks frozen on the second generation (the one with the Ball Pit; see _loadGen)
    this._near = new Map(); // chunk key -> legacy chunks within BLEND of it, as [cx, cz]
    this._core = new Map(); // town corner checks, "x,z" -> bool
    this.genKey = `game:gen:${this.seed}`;
    this._loadEdits();
    this._loadGen();
  }

  /** Sets the second generation's frozen chunks (the client gets them in 'welcome'). Call before generating anything. */
  setGen2(keys) {
    this.gen2 = new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []);
    this._core.clear();
  }

  /**
   * The Backrooms' dark rooms (the third generation): clusters of rooms with no light panel, where its
   * creatures come out. Frozen chunks (first and second generation) keep every light.
   */
  backroomsDark(x, z) {
    const key = World.key(x >> 4, z >> 4);
    if (this.legacy.has(key) || this.gen2.has(key)) return false;
    const cx = Math.floor(x / ROOM);
    const cz = Math.floor(z / ROOM);
    return this.noise(cx / 4 + 7300, cz / 4 + 7300) < -0.05;
  }

  /** The biome map for a column outside the first generation's chunks: the second one in its frozen chunks, else the third. */
  _biomeNew(x, z) {
    return this.gen2.size && this.gen2.has(World.key(x >> 4, z >> 4)) ? biomeAtV2(this.noise, x, z) : biomeAt(this.noise, x, z);
  }

  /** Sets the legacy chunk list (the client gets it from the game in 'welcome'). Call before generating anything. */
  setLegacy(keys) {
    this.legacy = new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []);
    this._near.clear();
    this._core.clear();
  }

  /** 0 inside a legacy chunk, rising to 1 at BLEND blocks from the nearest one (1 everywhere if there are none). */
  blendAt(x, z) {
    if (!this.legacy.size) return 1;
    const cx = x >> 4;
    const cz = z >> 4;
    const key = World.key(cx, cz);
    let near = this._near.get(key);
    if (!near) {
      near = [];
      const R = Math.ceil(BLEND / CS) + 1;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (this.legacy.has(World.key(cx + dx, cz + dz))) near.push([cx + dx, cz + dz]);
      if (this._near.size > 20000) this._near.clear();
      this._near.set(key, near);
    }
    let d = BLEND;
    for (const [lx, lz] of near) {
      const ddx = Math.max(lx * CS - x, 0, x - (lx * CS + CS - 1));
      const ddz = Math.max(lz * CS - z, 0, z - (lz * CS + CS - 1));
      d = Math.min(d, Math.hypot(ddx, ddz));
    }
    return d / BLEND;
  }

  static key(cx, cz) {
    return `${cx},${cz}`;
  }

  getChunk(cx, cz) {
    const key = World.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = { cx, cz, key, data: this._generate(cx, cz), meshes: null, dirty: true };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  getBlock(x, y, z) {
    if (y < 0) return STONE;
    if (y >= CH) return AIR;
    return this.getChunk(x >> 4, z >> 4).data[index(x & 15, y, z & 15)];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= CH) return false;
    const chunk = this.getChunk(x >> 4, z >> 4);
    const lx = x & 15;
    const lz = z & 15;
    const i = index(lx, y, lz);
    if (chunk.data[i] === id) return false;
    chunk.data[i] = id;
    if (this.onChange) this.onChange(x, y, z, id);

    let m = this.edits.get(chunk.key);
    if (!m) this.edits.set(chunk.key, (m = new Map()));
    m.set(i, id);

    chunk.dirty = true;
    // Faces (and ambient occlusion) of neighbouring chunks may change too.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        if ((dx === -1 && lx !== 0) || (dx === 1 && lx !== 15)) continue;
        if ((dz === -1 && lz !== 0) || (dz === 1 && lz !== 15)) continue;
        const n = this.chunks.get(World.key(chunk.cx + dx, chunk.cz + dz));
        if (n) n.dirty = true;
      }
    }
    this._scheduleSave();
    return true;
  }

  // ---------- terrain ----------

  /** The biome at a column (see biomes.js): the first generation's in legacy chunks. */
  biomeAt(x, z) {
    return this.blendAt(x, z) === 0 ? biomeAtV1(this.noise, x, z) : this._biomeNew(x, z);
  }

  /** Ground height. `v1` forces the first generation (while generating a legacy chunk). */
  heightAt(x, z, v1 = false) {
    const t = v1 ? 0 : this.blendAt(x, z);
    const old = () => groundHeight(this.noise, x, z, biomeAtV1(this.noise, x, z), SEA, CH - 14);
    if (t === 0) return old();
    const h = groundHeight(this.noise, x, z, this._biomeNew(x, z), SEA, CH - 14);
    return t >= 1 ? h : Math.round(old() + (h - old()) * smoothstep(t));
  }

  /** Deep enough inside the town for buildings (town plots and markets check their corners). */
  _townCore(x, z) {
    const key = `${x},${z}`;
    let ok = this._core.get(key);
    if (ok === undefined) {
      const info = this._biomeNew(x, z);
      ok = info.special === 'town' && info.s >= 1 && this.blendAt(x, z) >= 1;
      if (this._core.size > 20000) this._core.clear();
      this._core.set(key, ok);
    }
    return ok;
  }

  /**
   * A tree rooted at (x, z): { kind, height } or null. Kinds: 'oak', 'spruce', 'jungle', 'bush', 'cactus'.
   * How often, and which, depends on the biome.
   */
  plantAt(x, z, info = null, v1 = false) {
    info ??= v1 ? biomeAtV1(this.noise, x, z) : this.biomeAt(x, z);
    if (info.special && info.s > 0.05) return null;
    const roll = hash2(x, z, this.seed);
    const pick = hash2(x, z, this.seed + 1);
    const h = this.heightAt(x, z, v1);
    if (h <= SEA + 1 || h > 46) return null;
    switch (info.natural) {
      case 'forest': return roll < 0.045 ? { kind: 'oak', height: 4 + Math.floor(pick * 3) } : null;
      case 'jungle':
        if (roll < 0.03) return { kind: 'jungle', height: 8 + Math.floor(pick * 6) };
        return roll < 0.07 ? { kind: 'bush', height: 1 } : null;
      case 'taiga': return roll < 0.035 ? { kind: 'spruce', height: 6 + Math.floor(pick * 4) } : null;
      case 'desert': return roll < 0.008 ? { kind: 'cactus', height: 2 + Math.floor(pick * 2) } : null;
      case 'swamp': return roll < 0.02 ? { kind: 'oak', height: 4 + Math.floor(pick * 2), droopy: true } : null;
      default: return roll < 0.012 ? { kind: 'oak', height: 4 + Math.floor(pick * 2) } : null;
    }
  }

  /** Trunk height if a tree is rooted at (x, z), else 0 (cactus and bushes count as no tree). */
  treeAt(x, z) {
    const p = this.plantAt(x, z);
    return p && p.kind !== 'cactus' && p.kind !== 'bush' ? p.height : 0;
  }

  findSpawn() {
    // Close in, every 8 blocks; then (biomes are big now) further and further out.
    for (let r = 0; r < 20000; r += r < 1024 ? 8 : 64) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos((a / 8) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 8) * Math.PI * 2) * r);
        const info = this.biomeAt(x, z);
        if (info.special) continue; // start somewhere ordinary
        const h = this.heightAt(x, z);
        if (h > SEA + 1 && !this.plantAt(x, z, info)) return { x: x + 0.5, y: h + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: CH - 1, z: 0.5 };
  }

  /** The y to stand at on top of column (x, z): one above the highest solid or fluid block. */
  surfaceAt(x, z) {
    for (let y = CH - 1; y > 0; y--) {
      const id = this.getBlock(x, y, z);
      if (SOLID[id] || FLUID[id]) return y + 1;
    }
    return 1;
  }

  /**
   * The nearest Fantasy Town market square to (x, z), searching outwards up to `maxBlocks` away: the spot
   * to arrive at, as { x, z }, or null. Markets sit on a grid (townplan.js), so this checks grid squares.
   */
  findMarket(x, z, maxBlocks = 30000) {
    const step = MARKET_EVERY * TOWN_CELL;
    const gx = Math.floor((x - TOWN_CELL) / step);
    const gz = Math.floor((z - TOWN_CELL) / step);
    const corners = [[0, 0], [MARKET - 1, 0], [0, MARKET - 1], [MARKET - 1, MARKET - 1]];
    let best = null;
    for (let r = 0; r * step <= maxBlocks; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // just this ring
          const ox = (gx + dx) * step + TOWN_CELL;
          const oz = (gz + dz) * step + TOWN_CELL;
          if (!corners.every(([a, b]) => this._townCore(ox + a, oz + b))) continue;
          const spot = { x: ox + MARKET_ARRIVAL.x, z: oz + MARKET_ARRIVAL.z };
          const d = Math.hypot(spot.x - x, spot.z - z);
          if (!best || d < best.d) best = { ...spot, d };
        }
      }
      if (best && best.d < r * step) break; // nothing in a further ring can be closer
    }
    return best && { x: best.x, z: best.z };
  }

  _generate(cx, cz) {
    const data = new Uint16Array(CS * CS * CH); // (block ids go past 255)
    const ox = cx * CS;
    const oz = cz * CS;
    const set = (lx, y, lz, id) => { if (y >= 0 && y < CH) data[index(lx, y, lz)] = id; };
    const r = (x, z, k) => hash2(x, z, this.seed + k);
    const v1 = this.legacy.has(World.key(cx, cz)); // a legacy chunk: exactly the first generation, trees and all

    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const x = ox + lx;
        const z = oz + lz;
        // Near a legacy chunk the height blends, and the ground's look follows whichever side is closer.
        const t = v1 ? 0 : this.blendAt(x, z);
        const info = t < 0.5 ? biomeAtV1(this.noise, x, z) : this._biomeNew(x, z);
        const h = this.heightAt(x, z, v1);
        const zone = info.special && info.s >= 0.5 ? info.special : null;
        const nat = info.natural;
        const beach = h <= SEA + 1 && !zone;
        // Ground layers: top, the few blocks under it, then stone.
        let top = GRASS;
        let sub = DIRT;
        let deep = STONE;
        let fluid = WATER;
        if (zone === 'hell') { top = BRIMSTONE; sub = BRIMSTONE; deep = BRIMSTONE; fluid = LAVA; }
        else if (zone === 'city' || zone === 'cyber') { top = ASPHALT; sub = CONCRETE; } // (the cyberpunk city: a city for now)
        else if (zone === 'ruins') { top = r(x, z, 11) < 0.3 ? GRASS : r(x, z, 12) < 0.4 ? RUBBLE : ASPHALT; sub = CONCRETE; }
        else if (zone === 'backrooms') { top = CARPET; sub = CONCRETE; }
        else if (zone === 'ballpit') { top = FOAM; sub = FOAM; }
        else if (beach) { top = SAND; sub = SAND; }
        else if (h > 46) { top = nat === 'taiga' ? SNOW_GRASS : STONE; }
        else if (nat === 'desert') { top = SAND; sub = SAND; deep = SANDSTONE; }
        else if (nat === 'taiga') top = SNOW_GRASS;
        else if (nat === 'swamp') { top = r(x, z, 13) < 0.35 ? MUD : GRASS; sub = MUD; }
        const level = zone === 'hell' ? HELL_LAVA : SEA;
        const maxY = Math.max(h, level);
        for (let y = 0; y <= maxY; y++) {
          let id;
          if (y > h) id = fluid === WATER && nat === 'taiga' && y === SEA && !zone ? ICE : fluid; // frozen lakes up north
          else if (y === h) id = top;
          else if (y >= h - 3) id = sub;
          else id = deep;
          set(lx, y, lz, id);
        }
        if (info.special && info.s >= 1 && (t === 0 || t >= 1)) this._zoneColumn(info.special, x, z, h, (y, id) => set(lx, y, lz, id));
      }
    }

    // Trees and other plants can overhang chunk borders, so scan a margin around the chunk.
    const put = (x, y, z, id, onlyAir) => {
      const lx = x - ox;
      const lz = z - oz;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= CH) return;
      const i = index(lx, y, lz);
      if (onlyAir && data[i] !== AIR) return;
      data[i] = id;
    };
    const M = 4;
    for (let z = oz - M; z < oz + CS + M; z++) {
      for (let x = ox - M; x < ox + CS + M; x++) {
        const plant = this.plantAt(x, z, null, v1);
        if (plant) this._plant(plant, x, this.heightAt(x, z, v1) + 1, z, put);
      }
    }

    // Wheat fields: patches of wheat on plains and forest grass where a slow noise is high.
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const x = ox + lx;
        const z = oz + lz;
        if (this.noise(x / 48 + 900, z / 48 + 900) < 0.35 || hash2(x, z, this.seed + 7) > 0.6) continue;
        const h = this.heightAt(x, z, v1);
        if (h + 1 >= CH || data[index(lx, h, lz)] !== GRASS || data[index(lx, h + 1, lz)] !== AIR) continue;
        const nat = (v1 ? biomeAtV1(this.noise, x, z) : this.biomeAt(x, z)).natural;
        if (nat !== 'plains' && nat !== 'forest') continue;
        data[index(lx, h + 1, lz)] = WHEAT;
      }
    }

    const edits = this.edits.get(World.key(cx, cz));
    if (edits) for (const [i, id] of edits) data[i] = id;
    return data;
  }

  /** Builds a tree, bush or cactus rooted at (x, base, z). */
  _plant(plant, x, base, z, put) {
    const th = plant.height;
    const leafBall = (cy, r, leaves, cut = 0.5) => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy * 1.6 + dz * dz > r * r + 0.5) continue;
            if (hash2(x + dx * 7 + dy, z + dz * 13 + cy, this.seed + 2) < cut * 0.25) continue;
            put(x + dx, cy + dy, z + dz, leaves, true);
          }
        }
      }
    };
    switch (plant.kind) {
      case 'cactus':
        for (let dy = 0; dy < th; dy++) put(x, base + dy, z, CACTUS, false);
        return;
      case 'bush':
        leafBall(base, 1, JUNGLE_LEAVES);
        put(x, base, z, JUNGLE_LOG, false);
        return;
      case 'spruce':
        // A cone of needles, widest near the bottom, with a point on top.
        for (let dy = 2; dy <= th; dy++) {
          const r = Math.max(0, Math.round((th - dy) * 0.45)) + (dy % 2 ? 0 : 1);
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.abs(dx) + Math.abs(dz) > r + 0.5) continue;
              put(x + dx, base + dy, z + dz, SPRUCE_LEAVES, true);
            }
          }
        }
        put(x, base + th + 1, z, SPRUCE_LEAVES, true);
        for (let dy = 0; dy < th; dy++) put(x, base + dy, z, SPRUCE_LOG, false);
        return;
      case 'jungle':
        // Tall trunk, a big canopy, and a lower ring of branches.
        leafBall(base + th, 3, JUNGLE_LEAVES);
        leafBall(base + th - 3, 2, JUNGLE_LEAVES, 1.2);
        for (let dy = 0; dy < th; dy++) put(x, base + dy, z, JUNGLE_LOG, false);
        return;
      default: {
        // Oak (the classic): a blob of leaves on a short trunk. Swamp oaks droop.
        for (let dy = th - 2; dy <= th + 1; dy++) {
          const r = dy >= th ? 1 : 2;
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              const corner = Math.abs(dx) === r && Math.abs(dz) === r;
              if (corner && (dy >= th || hash2(x + dx * 7 + dy, z + dz * 13, this.seed + 2) < 0.5)) continue;
              put(x + dx, base + dy, z + dz, LEAVES, true);
              if (plant.droopy && r === 2 && dy === th - 2 && hash2(x + dx, z + dz, this.seed + 3) < 0.4) {
                put(x + dx, base + dy - 1, z + dz, LEAVES, true); // hanging moss
                put(x + dx, base + dy - 2, z + dz, LEAVES, true);
              }
            }
          }
        }
        for (let dy = 0; dy < th; dy++) put(x, base + dy, z, LOG, false);
      }
    }
  }

  /** The buildings and features of a special zone's core, for one column (ground at h). */
  _zoneColumn(zone, x, z, h, set) {
    const r = (k) => hash2(x, z, this.seed + k);
    if (zone === 'town') {
      townColumn(hash2, this.seed, x, z, h, (cx, cz) => this._townCore(cx, cz), set);
      return;
    }
    if (zone === 'hell') {
      if (h > HELL_LAVA && r(20) < 0.006) { // jagged brimstone spires
        const n = 3 + Math.floor(r(21) * 6);
        for (let y = 1; y <= n; y++) set(h + y, BRIMSTONE);
      }
      return;
    }
    if (zone === 'ballpit') {
      if (this.noise(x / 18 + 1200, z / 18 + 1200) > 0.05) { // the pits: three balls deep
        set(h, BALLS);
        set(h - 1, BALLS);
        set(h - 2, BALLS);
      } else if (r(22) < 0.02) { // soft-play towers
        const n = 1 + Math.floor(r(23) * 4);
        for (let y = 1; y <= n; y++) set(h + y, FOAM);
      }
      return;
    }
    if (zone === 'backrooms') {
      // A maze of yellow rooms under a low ceiling with buzzing lights, going on and on.
      const wall = backroomsWall(hash2, this.seed, x, z);
      for (let y = h + 1; y <= h + ROOM_HEIGHT; y++) set(y, wall ? WALLPAPER : AIR);
      set(h + ROOM_HEIGHT + 1, backroomsLight(x, z) && !this.backroomsDark(x, z) ? FLUORESCENT : CEILING_TILE); // (dark rooms have no light)
      return;
    }
    // Cities: roads, pavements and buildings. Ruins are the same city, much later.
    const ruined = zone === 'ruins';
    const col = cityColumn(hash2, this.seed, x, z, ruined);
    if (col.pavement && !ruined) set(h, CONCRETE);
    if (ruined && !col.building && r(24) < 0.05) set(h + 1, r(25) < 0.7 ? RUBBLE : CONCRETE); // debris
    const b = col.building;
    if (!b) return;
    const edgeX = x === b.x0 || x === b.x1;
    const edgeZ = z === b.z0 || z === b.z1;
    const corner = edgeX && edgeZ;
    const along = edgeX ? z - b.z0 : x - b.x0; // position along the wall, for windows
    const door = (z === b.z0 || z === b.z1) && Math.abs(x - Math.floor((b.x0 + b.x1) / 2)) <= 0;
    // Ruins: each column has crumbled down to its own height.
    const top = ruined ? Math.max(1, b.height - Math.floor(r(26) * r(27) * b.height * 1.4)) : b.height;
    for (let dy = 1; dy <= top; dy++) {
      const y = h + dy;
      const floor = dy % 4 === 0 || dy === b.height;
      let id = AIR;
      if (edgeX || edgeZ) {
        const windowRow = dy % 4 === 2 || dy % 4 === 3;
        if (corner || floor) id = CONCRETE;
        else if (door && dy <= 2) id = AIR;
        else if (windowRow && along % 3 !== 0) id = ruined ? AIR : WINDOW; // ruins: the glass is long gone
        else id = CONCRETE;
        if (ruined && id === CONCRETE && !corner && r(28 + dy) < 0.18) id = AIR; // holes in the walls
        if (ruined && id === AIR && dy > 1 && r(40 + dy) < 0.06) id = LEAVES; // vines
      } else if (floor) {
        id = ruined && r(60 + dy) < 0.35 ? AIR : CONCRETE; // ruins: floors have fallen through
      }
      set(y, id);
    }
  }

  /** Every block changed from the generated terrain, as [x, y, z, id]. */
  allEdits() {
    const out = [];
    for (const [key, m] of this.edits) {
      const [cx, cz] = key.split(',').map(Number);
      for (const [i, id] of m) {
        out.push([cx * CS + (i % CS), Math.floor(i / (CS * CS)), cz * CS + (Math.floor(i / CS) % CS), id]);
      }
    }
    return out;
  }

  /** Drops chunk data far from every given position (edits are kept, so it regenerates identically). */
  pruneChunks(positions, keepChunks = 12) {
    for (const [key, chunk] of this.chunks) {
      const near = positions.some((p) => Math.max(Math.abs(chunk.cx - (p.x >> 4)), Math.abs(chunk.cz - (p.z >> 4))) <= keepChunks);
      if (!near) this.chunks.delete(key);
    }
  }

  // ---------- persistence ----------

  /** Loads the legacy chunk list, or makes it on the first load since biomes grew: every chunk with edits, plus one around it. */
  _loadGen() {
    if (!this.storage) return; // a client: the game sends the list
    let rec = null;
    try { rec = JSON.parse(this.storage.get(this.genKey)); } catch { /* none yet */ }
    // Every chunk with edits, plus one all round: frozen on the generation it was built on.
    const edited = new Set();
    for (const [key, m] of this.edits) {
      if (!m.size) continue;
      const [cx, cz] = key.split(',').map(Number);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) edited.add(World.key(cx + dx, cz + dz));
    }
    if (rec && Array.isArray(rec.legacy)) {
      this.setLegacy(rec.legacy);
      if (Array.isArray(rec.gen2)) { this.setGen2(rec.gen2); return; }
      // The first load since the third generation (no Ball Pit): what's been built keeps the second.
      this.setGen2([...edited].filter((k) => !this.legacy.has(k)));
    } else {
      this.setLegacy([...edited]); // (a world from before the second generation: what's built keeps the first)
    }
    try { this.storage.set(this.genKey, JSON.stringify({ v: 3, legacy: [...this.legacy], gen2: [...this.gen2] })); } catch { /* stays in memory */ }
  }

  _loadEdits() {
    if (!this.storage) return;
    try {
      const raw = this.storage.get(this.storageKey);
      if (!raw) return;
      for (const [key, list] of Object.entries(JSON.parse(raw))) this.edits.set(key, new Map(list));
    } catch {
      // Corrupt or unavailable storage: start without edits.
    }
  }

  _scheduleSave() {
    if (!this.storage) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 500);
  }

  saveNow() {
    if (!this.storage) return;
    const obj = {};
    for (const [key, m] of this.edits) obj[key] = [...m];
    try {
      this.storage.set(this.storageKey, JSON.stringify(obj));
    } catch {
      // Quota or privacy mode: edits stay in memory for this session.
    }
  }

  // ---------- raycast ----------

  /** Voxel DDA. Returns {x,y,z,id,t,normal:[nx,ny,nz]} for the first non-air, non-water block. */
  raycast(o, d, maxDist) {
    let x = Math.floor(o.x);
    let y = Math.floor(o.y);
    let z = Math.floor(o.z);
    const stepX = Math.sign(d.x);
    const stepY = Math.sign(d.y);
    const stepZ = Math.sign(d.z);
    const tdx = d.x ? Math.abs(1 / d.x) : Infinity;
    const tdy = d.y ? Math.abs(1 / d.y) : Infinity;
    const tdz = d.z ? Math.abs(1 / d.z) : Infinity;
    let tmx = d.x > 0 ? (x + 1 - o.x) * tdx : d.x < 0 ? (o.x - x) * tdx : Infinity;
    let tmy = d.y > 0 ? (y + 1 - o.y) * tdy : d.y < 0 ? (o.y - y) * tdy : Infinity;
    let tmz = d.z > 0 ? (z + 1 - o.z) * tdz : d.z < 0 ? (o.z - z) * tdz : Infinity;
    const normal = [0, 0, 0];
    let t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== AIR && !FLUID[id]) return { x, y, z, id, t, normal: [...normal] };
      normal[0] = normal[1] = normal[2] = 0;
      if (tmx < tmy && tmx < tmz) {
        x += stepX; t = tmx; tmx += tdx; normal[0] = -stepX;
      } else if (tmy < tmz) {
        y += stepY; t = tmy; tmy += tdy; normal[1] = -stepY;
      } else {
        z += stepZ; t = tmz; tmz += tdz; normal[2] = -stepZ;
      }
    }
    return null;
  }
}
