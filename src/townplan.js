// The Fantasy Town zone's layout: cobbled streets on a grid, timber-and-plaster houses, gardens and
// wells, and every MARKET_EVERY cells a market square with a fountain and the five shops (blacksmith,
// healer, tavern, fletcher, wizard). Like the rest of terrain generation it's a pure function of the
// seed and the column, so it stays deterministic. No Three.js, no DOM.
//
// Buildings are designed in their own local frame (lx across, lz deep, the door on the far +lz wall)
// and rotated into place: `rot` 0 puts the door on the south side, 1 west, 2 north, 3 east. Blocks
// with a facing (doors, beds, ladders) turn with them: local facing f becomes world facing (f + rot) % 4.

import { AIR, STONE, PLANKS, GLASS, BRICK, LOG, SPRUCE_LOG, WATER, LAVA, LAVA_LAMP, FENCE, SLAB_PLANKS, WHEAT, GRASS, COBBLE, PLASTER,
  SHINGLES, SHOP_COUNTER, SHOP_ORDER, BED, BED_FOOT, LADDER, doorId } from './blocks.js';

export const TOWN_CELL = 20; // one plot plus the street along its north and west edges
const STREET = 3;
export const MARKET_EVERY = 6; // a market square every this many cells each way
const MARKET_CELLS = 3; // the square covers 3×3 cells (60×60 blocks)
export const MARKET = MARKET_CELLS * TOWN_CELL;
/** Where to stand in a market square (from its north-west corner): on the plaza between the tavern and the fountain. */
export const MARKET_ARRIVAL = { x: 24.5, z: 21.5 };

const mod = (a, n) => ((a % n) + n) % n;
const counter = (shop) => SHOP_COUNTER + SHOP_ORDER.indexOf(shop);

// ---------- buildings in their local frame ----------
// Each builder gets (lx, lz, b) and returns [[dy, id], ...] for that column (dy 0 is the ground block).
// `f(localFacing)` turns a local facing into the world one.

/** Walls of a box: corner posts, a stone footing, plaster with windows, a beam on top of each storey. */
function wallBlock(lx, lz, W, D, dy, { storey = 4, stone = false, door }) {
  const corner = (lx === 0 || lx === W - 1) && (lz === 0 || lz === D - 1);
  const along = lz === 0 || lz === D - 1 ? lx : lz;
  if (corner) return SPRUCE_LOG;
  if (dy % storey === 0) return SPRUCE_LOG; // the beam between storeys
  if (dy === 1) return COBBLE;
  if (door && lx === door[0] && lz === door[1] && dy <= 2) return null; // the builder puts the door in
  const windowRow = dy % storey === 2 || dy % storey === 3;
  if (windowRow && along % 3 === 1 && !(door && lx === door[0] && lz === door[1])) return GLASS;
  return stone ? STONE : PLASTER;
}

/** A gable roof two blocks thick, ridge along local x, from `top` up; gable ends filled with plaster. */
function gable(out, lx, lz, W, D, top, inside) {
  const ry = top + 1 + Math.min(lz, D - 1 - lz);
  out.push([ry, SHINGLES], [ry - 1, SHINGLES]);
  if (lx === 0 || lx === W - 1) for (let y = top + 1; y < ry - 1; y++) out.push([y, PLASTER]);
  else if (inside) for (let y = top + 1; y < ry - 1; y++) out.push([y, AIR]);
}

function door(out, dy, facing) {
  out.push([dy, doorId(facing, false, false)], [dy + 1, doorId(facing, false, true)]);
}

/** A small shop: 11 wide, 9 deep, a counter across the room, the shop's sign over the door. */
const SHOP_W = 11;
const SHOP_D = 9;
function buildShop(lx, lz, b, f) {
  const W = SHOP_W;
  const D = SHOP_D;
  const wizard = b.shop === 'wizard';
  const top = wizard ? 6 : 4;
  const dr = [5, D - 1];
  const out = [];
  const wall = lx === 0 || lx === W - 1 || lz === 0 || lz === D - 1;
  for (let dy = 1; dy <= top; dy++) out.push([dy, AIR]);
  if (wall) {
    for (let dy = 1; dy <= top; dy++) {
      const id = wallBlock(lx, lz, W, D, dy, { storey: top, stone: wizard, door: dr });
      if (id !== null) out.push([dy, id]);
    }
    if (lx === dr[0] && lz === dr[1]) {
      door(out, 1, f(0));
      out.push([3, counter(b.shop)]); // the sign over the door
    }
  } else {
    out.push([0, PLANKS]);
    if (lz === 3 && lx <= 7) out.push([1, counter(b.shop)]); // the counter
    if (lx === W - 2 && lz === D - 2) out.push([1, LAVA_LAMP]);
    if (lz === 1 || lz === 2) { // behind the counter
      if (b.shop === 'blacksmith') {
        if (lz === 1 && lx >= 1 && lx <= 3) out.push([1, lx === 2 ? LAVA : BRICK]); // the forge
        if (lz === 2 && lx === 2) out.push([1, BRICK]);
        if (lz === 1 && lx >= 1 && lx <= 3 && lx !== 2) out.push([2, BRICK]);
        if (lz === 1 && lx === 6) out.push([1, STONE]); // the anvil
      } else if (b.shop === 'healer' && lz === 1) {
        out.push([1, PLANKS], [2, GLASS], [3, PLANKS]); // shelves of bottles
      } else if (b.shop === 'fletcher' && lz === 1) {
        if (lx <= 3) out.push([1, LOG]); // a pile of staves
        if (lx === 5 || lx === 7) out.push([1, FENCE], [2, FENCE]); // racks
      } else if (wizard && lz === 1) {
        out.push([1, lx % 4 === 2 ? LAVA_LAMP : PLANKS], [2, lx % 4 === 2 ? AIR : GLASS], [3, PLANKS]);
      }
    }
  }
  if (wizard) {
    // A pointed roof with a spire.
    const ry = top + 1 + Math.min(lx, W - 1 - lx, lz, D - 1 - lz);
    out.push([ry, SHINGLES], [ry - 1, SHINGLES]);
    if (lx === 5 && lz === 4) for (let y = ry + 1; y <= ry + 3; y++) out.push([y, SHINGLES]);
  } else gable(out, lx, lz, W, D, top, !wall);
  return out;
}

/**
 * The tavern: 16 wide, 12 deep, two storeys. Downstairs a bar (the tavern's counter) and tables;
 * a ladder up to a corridor with six rooms, each with a bed you can make your spawn point.
 */
const TAVERN_W = 16;
const TAVERN_D = 12;
function buildTavern(lx, lz, b, f) {
  const W = TAVERN_W;
  const D = TAVERN_D;
  const top = 10; // two storeys of 5 (beam at 5 and 10)
  const dr = [7, D - 1];
  const out = [];
  const wall = lx === 0 || lx === W - 1 || lz === 0 || lz === D - 1;
  for (let dy = 1; dy <= top; dy++) out.push([dy, AIR]);
  if (wall) {
    for (let dy = 1; dy <= top; dy++) {
      const id = wallBlock(lx, lz, W, D, dy, { storey: 5, door: dr });
      if (id !== null) out.push([dy, id]);
    }
    if (lx === dr[0] && lz === dr[1]) {
      door(out, 1, f(0));
      out.push([3, counter('tavern')]);
    }
    gable(out, lx, lz, W, D, top, false);
    return out;
  }
  // Downstairs.
  out.push([0, PLANKS]);
  if (lz === 3 && lx >= 2 && lx <= 8) out.push([1, counter('tavern')]); // the bar
  if (lz === 1 && lx >= 2 && lx <= 4) out.push([1, LOG], [2, lx === 2 ? LOG : AIR]); // barrels
  for (const [tx, tz] of [[3, 7], [10, 8], [11, 4]]) if (lx === tx && lz === tz) out.push([1, FENCE], [2, SLAB_PLANKS]); // tables
  if ((lx === 1 || lx === W - 2) && lz === D - 2) out.push([1, LAVA_LAMP]);
  // The ladder up, on the east wall of the corridor, through the floor.
  const ladder = lx === W - 2 && lz === 5;
  if (ladder) for (let dy = 1; dy <= 6; dy++) out.push([dy, LADDER + f(1)]);
  else out.push([5, PLANKS]); // the upstairs floor
  // Upstairs (dy 6-9): rooms north (lz 1-3) and south (lz 8-10) of a corridor (lz 5-6).
  const north = lz <= 3;
  const south = lz >= 8;
  const roomWall = lz === 4 || lz === 7 || ((north || south) && (lx === 5 || lx === 10));
  if (roomWall) {
    for (let dy = 6; dy <= 9; dy++) out.push([dy, PLASTER]);
    if ((lz === 4 || lz === 7) && (lx === 3 || lx === 8 || lx === 13)) door(out, 6, f(lz === 4 ? 0 : 2));
  } else if (north || south) {
    const x0 = lx <= 4 ? 1 : lx <= 9 ? 6 : 11; // the room's first column
    const bz = north ? 1 : D - 2; // beds along the outside wall
    if (lz === bz && lx === x0) out.push([6, BED_FOOT + f(1)]);
    if (lz === bz && lx === x0 + 1) out.push([6, BED + f(1)]);
    if (lz === bz && lx === x0 + 3) out.push([6, LAVA_LAMP]);
  } else if (lx === 1 && lz === 5) out.push([6, LAVA_LAMP]);
  gable(out, lx, lz, W, D, top, true);
  return out;
}

/** A house: one or two storeys, a lamp inside, a door to the street. */
function buildHouse(lx, lz, b, f) {
  const { W, D } = b;
  const storey = 4;
  const top = storey * b.storeys;
  const dr = [Math.floor(W / 2), D - 1];
  const out = [];
  const wall = lx === 0 || lx === W - 1 || lz === 0 || lz === D - 1;
  for (let dy = 1; dy <= top; dy++) out.push([dy, AIR]);
  if (wall) {
    for (let dy = 1; dy <= top; dy++) {
      const id = wallBlock(lx, lz, W, D, dy, { storey, stone: b.stone, door: dr });
      if (id !== null) out.push([dy, id]);
    }
    if (lx === dr[0] && lz === dr[1]) door(out, 1, f(0));
  } else {
    out.push([0, PLANKS]);
    if (lx === Math.floor(W / 2) && lz === Math.floor(D / 2)) out.push([1, LAVA_LAMP]);
    if (b.storeys > 1) {
      if (lx === 1 && lz === 1) for (let dy = 1; dy <= storey + 1; dy++) out.push([dy, LADDER + f(0)]);
      else out.push([storey, PLANKS]);
      if (lx === W - 2 && lz === 1) out.push([storey + 1, LAVA_LAMP]);
    }
    if (lx === W - 2 && lz === D - 2 && b.table) out.push([1, FENCE], [2, SLAB_PLANKS]);
  }
  if (W >= D) gable(out, lx, lz, W, D, top, !wall);
  else { // ridge along the other way: swap the axes for the roof
    const ry = top + 1 + Math.min(lx, W - 1 - lx);
    out.push([ry, SHINGLES], [ry - 1, SHINGLES]);
    if (lz === 0 || lz === D - 1) for (let y = top + 1; y < ry - 1; y++) out.push([y, PLASTER]);
    else if (!wall) for (let y = top + 1; y < ry - 1; y++) out.push([y, AIR]);
  }
  return out;
}

/** A covered well: a cobble rim round deep water, four posts and a little roof. 5×5. */
function buildWell(lx, lz) {
  const out = [];
  const rim = lx === 0 || lx === 4 || lz === 0 || lz === 4;
  if (rim) out.push([0, COBBLE], [1, COBBLE]);
  else out.push([0, WATER], [-1, WATER], [-2, WATER], [-3, COBBLE]);
  if ((lx === 0 || lx === 4) && (lz === 0 || lz === 4)) out.push([2, FENCE], [3, FENCE]);
  out.push([4, SHINGLES]);
  return out;
}

/** The market fountain: 8×8, a stone rim, water, and a pillar with a lamp on top. */
function buildFountain(lx, lz) {
  const out = [];
  const rim = lx === 0 || lx === 7 || lz === 0 || lz === 7;
  const pillar = (lx === 3 || lx === 4) && (lz === 3 || lz === 4);
  if (rim) out.push([0, STONE], [1, STONE]);
  else if (pillar) {
    out.push([0, STONE], [1, STONE], [2, STONE]);
    if (lx === 3 && lz === 3) out.push([3, LAVA_LAMP]);
  } else out.push([0, WATER], [-1, WATER], [-2, STONE]);
  return out;
}

const BUILDERS = { shop: buildShop, tavern: buildTavern, house: buildHouse };

// ---------- placing buildings ----------

/** A building record with its world footprint: { kind, x0, z0, x1, z1, rot, W, D, ... }. */
function place(kind, x0, z0, W, D, rot, extra = {}) {
  const odd = rot % 2 === 1;
  return { kind, x0, z0, x1: x0 + (odd ? D : W) - 1, z1: z0 + (odd ? W : D) - 1, rot, W, D, ...extra };
}
const inside = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
/** World column -> the building's local (lx, lz). */
function toLocal(b, x, z) {
  switch (b.rot) {
    case 1: return [z - b.z0, b.x1 - x];
    case 2: return [b.x1 - x, b.z1 - z];
    case 3: return [b.z1 - z, x - b.x0];
    default: return [x - b.x0, z - b.z0];
  }
}

// The market square, in its own coordinates (0..59 each way, from its north-west corner).
const MARKET_PLAN = [
  place('tavern', 22, 4, TAVERN_W, TAVERN_D, 0),
  place('shop', 5, 24, SHOP_W, SHOP_D, 3, { shop: 'blacksmith' }), // west side, door east
  place('shop', 46, 24, SHOP_W, SHOP_D, 1, { shop: 'healer' }), // east side, door west
  place('shop', 12, 45, SHOP_W, SHOP_D, 2, { shop: 'fletcher' }), // south side, doors north
  place('shop', 37, 45, SHOP_W, SHOP_D, 2, { shop: 'wizard' }),
];
const FOUNTAIN = { x0: 26, z0: 26, x1: 33, z1: 33 };
const MARKET_LAMPS = [[3, 3], [56, 3], [3, 56], [56, 56], [3, 29], [56, 29], [29, 20], [29, 41], [16, 16], [43, 16], [29, 57]];

/** Is (cx, cz) one of the cells a market square covers? Returns the square's origin or null. */
function marketAt(cx, cz) {
  const mx = mod(cx, MARKET_EVERY);
  const mz = mod(cz, MARKET_EVERY);
  if (mx < 1 || mx > MARKET_CELLS || mz < 1 || mz > MARKET_CELLS) return null;
  return { x: (cx - mx + 1) * TOWN_CELL, z: (cz - mz + 1) * TOWN_CELL };
}

/** What a plot holds: a house (most), a garden, a well, or nothing. */
function plotOf(hash2, seed, cx, cz) {
  const r = (k) => hash2(cx * 7 + k, cz * 13 - k, seed + 177);
  const ox = cx * TOWN_CELL + STREET;
  const oz = cz * TOWN_CELL + STREET;
  const span = TOWN_CELL - STREET; // 17
  const roll = r(0);
  if (roll < 0.12) return { kind: 'garden', x0: ox + 1, z0: oz + 1, x1: ox + span - 2, z1: oz + span - 2 };
  if (roll < 0.2) return { kind: 'well', ...place('well', ox + 6, oz + 6, 5, 5, 0) };
  const W = 7 + Math.floor(r(1) * 6);
  const D = 7 + Math.floor(r(2) * 4);
  const rot = r(3) < 0.5 ? 2 : 1; // the door faces the north or the west street
  const odd = rot === 1;
  const wx = odd ? D : W;
  const wz = odd ? W : D;
  const x0 = ox + 1 + Math.floor(r(4) * (span - wx - 1));
  const z0 = oz + 1 + Math.floor(r(5) * (span - wz - 1));
  return place('house', x0, z0, W, D, rot, { storeys: r(6) < 0.45 ? 2 : 1, stone: r(7) < 0.2, table: r(8) < 0.6 });
}

/**
 * Builds one column of the town (ground at h). `core(x, z)` says whether a spot is deep enough in the
 * town for buildings: a plot or market is only built if all its corners are, so nothing is cut in half.
 * `set(y, id)` writes a block.
 */
export function townColumn(hash2, seed, x, z, h, core, set) {
  const cx = Math.floor(x / TOWN_CELL);
  const cz = Math.floor(z / TOWN_CELL);
  const lx = mod(x, TOWN_CELL);
  const lz = mod(z, TOWN_CELL);
  const lamp = () => { set(h + 1, FENCE); set(h + 2, FENCE); set(h + 3, LAVA_LAMP); };
  const run = (b, kind = b.kind) => {
    const [bx, bz] = toLocal(b, x, z);
    const f = (lf) => (lf + b.rot) % 4;
    const col = kind === 'well' ? buildWell(bx, bz) : kind === 'fountain' ? buildFountain(bx, bz) : BUILDERS[kind](bx, bz, b, f);
    for (const [dy, id] of col) set(h + dy, id);
  };

  const m = marketAt(cx, cz);
  if (m && core(m.x, m.z) && core(m.x + MARKET - 1, m.z) && core(m.x, m.z + MARKET - 1) && core(m.x + MARKET - 1, m.z + MARKET - 1)) {
    const px = x - m.x;
    const pz = z - m.z;
    set(h, COBBLE);
    for (const b of MARKET_PLAN) if (inside(b, px, pz)) return run({ ...b, x0: b.x0 + m.x, z0: b.z0 + m.z, x1: b.x1 + m.x, z1: b.z1 + m.z });
    if (inside(FOUNTAIN, px, pz)) return run({ ...FOUNTAIN, x0: FOUNTAIN.x0 + m.x, z0: FOUNTAIN.z0 + m.z, x1: FOUNTAIN.x1 + m.x, z1: FOUNTAIN.z1 + m.z, rot: 0 }, 'fountain');
    if (MARKET_LAMPS.some(([ax, az]) => ax === px && az === pz)) lamp();
    return;
  }

  if (lx < STREET || lz < STREET) { // streets, with lamp posts along their edges
    set(h, COBBLE);
    if ((lx === STREET - 1 && (lz === STREET - 1 || lz === 11)) || (lz === STREET - 1 && lx === 11)) lamp();
    return;
  }
  const c0x = cx * TOWN_CELL;
  const c0z = cz * TOWN_CELL;
  if (!(core(c0x, c0z) && core(c0x + TOWN_CELL - 1, c0z) && core(c0x, c0z + TOWN_CELL - 1) && core(c0x + TOWN_CELL - 1, c0z + TOWN_CELL - 1))) return;
  const plot = plotOf(hash2, seed, cx, cz);
  if (!inside(plot, x, z)) return;
  if (plot.kind === 'garden') {
    const edge = x === plot.x0 || x === plot.x1 || z === plot.z0 || z === plot.z1;
    const gate = z === plot.z0 && x === plot.x0 + 3;
    if (edge) { if (!gate) set(h + 1, FENCE); } else { set(h, GRASS); set(h + 1, WHEAT); }
    return;
  }
  run(plot);
}
