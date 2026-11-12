// Gardening: till dirt into rows, plant seeds, water, burn off weeds, harvest. No Three.js, no DOM.
//
//   Tiller      turns dirt or grass into tilled dirt, a short row of it along the way you're facing
//   Seeds       (blocks: the crop's stage 0) go on tilled dirt
//   Sprayer     waters tilled dirt around where you aim
//   Weed Torch  burns the weeds off tilled dirt around where you aim
//
// Every morning (game.js calls `newDay` when the clock passes sunrise), for every tilled dirt block:
//   - a crop on watered dirt grows a stage (the Growth chance setting); then the dirt dries out
//   - weeds sprout on clean dirt (the Weed chance setting), and weeds already there grow a level
//   - weeds stop growing at level 3; a ripe crop picked from dirt with level-3 weeds gives fewer
//     vegetables (the Weed harvest cut setting)
// All of it is stored in block ids (blocks.js SOIL and CROP), so it's saved with the world's edits.

import { T, tune } from './tuning.js';
import { AIR, DIRT, GRASS, SNOW_GRASS, MUD, SOLID, PLANT, isSoil, soilInfo, soilId, isCrop, cropInfo, cropId, CROPS } from './blocks.js';
import { CS } from './world.js';

tune('Gardening', {
  tillRow: [3, 'Tiller row length', 'Blocks the Tiller tills in a row along the way you face', { min: 1, max: 9, step: 1 }],
  sprayRadius: [1, 'Sprayer reach', 'Blocks around where you aim the Sprayer waters (1: a 3×3 patch)', { min: 0, max: 4, step: 1 }],
  torchRadius: [1, 'Weed Torch reach', 'Blocks around where you aim the Weed Torch clears (1: a 3×3 patch)', { min: 0, max: 4, step: 1 }],
  growChance: [1, 'Growth chance', 'Chance a watered crop grows a stage each morning', { max: 1, step: 0.05 }],
  weedChance: [0.3, 'Weed chance', 'Chance weeds sprout on clean tilled dirt each morning', { max: 1, step: 0.05 }],
  weedHarvestCut: [50, 'Weed harvest cut', 'How much smaller a ripe plant\'s harvest is when its weeds are fully grown (level 3)', { min: 0, max: 100, step: 5, unit: '%' }],
  yieldMin: [1, 'Harvest (least)', 'Fewest vegetables a ripe plant gives', { min: 0, max: 10, step: 1 }],
  yieldMax: [3, 'Harvest (most)', 'Most vegetables a ripe plant gives', { min: 0, max: 10, step: 1 }],
  seedBack: [0.5, 'Extra seed chance', 'Chance a ripe plant gives a second seed (you always get one back)', { max: 1, step: 0.05 }],
});

export const GARDEN_TOOLS = { tiller: 'till', sprayer: 'water', weedtorch: 'torch' };
export const TILLABLE = new Set([DIRT, GRASS, SNOW_GRASS, MUD]);
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W

/** Tills a row (`row` long: the Tiller's setting) starting at (x, y, z) along `facing` (0 N, 1 E, 2 S, 3 W). Returns how many blocks it tilled. */
export function till(world, x, y, z, facing, row = T.tillRow) {
  const [dx, dz] = SIDES[facing] || SIDES[0];
  let n = 0;
  for (let i = 0; i < row; i++) {
    const bx = x + dx * i;
    const bz = z + dz * i;
    const id = world.getBlock(bx, y, bz);
    const above = world.getBlock(bx, y + 1, bz);
    if (!TILLABLE.has(id) || (above !== AIR && !(PLANT[above] && !isCrop(above)))) continue; // (wheat and the like get cleared)
    if (above !== AIR) world.setBlock(bx, y + 1, bz, AIR);
    world.setBlock(bx, y, bz, soilId(false, 0));
    n++;
  }
  return n;
}

/** The tilled dirt a click on (x, y, z) means: that block, or the one under a crop. */
function soilAt(world, x, y, z) {
  if (isSoil(world.getBlock(x, y, z))) return y;
  if (isCrop(world.getBlock(x, y, z)) && isSoil(world.getBlock(x, y - 1, z))) return y - 1;
  return null;
}

/** Changes every tilled dirt block within `r` (a square) at the height you clicked. Returns how many changed. */
function around(world, x, y, z, r, change) {
  const sy = soilAt(world, x, y, z) ?? y;
  let n = 0;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      for (const yy of [sy, sy - 1, sy + 1]) { // (a little give for uneven beds)
        const id = world.getBlock(x + dx, yy, z + dz);
        if (!isSoil(id)) continue;
        const next = change(soilInfo(id));
        if (next !== id) { world.setBlock(x + dx, yy, z + dz, next); n++; }
        break;
      }
    }
  }
  return n;
}

/** Sprayer: waters tilled dirt around (x, y, z). */
export const water = (world, x, y, z) => around(world, x, y, z, T.sprayRadius, ({ weeds }) => soilId(true, weeds));
/** Weed Torch: burns the weeds off tilled dirt around (x, y, z) (crops are fine). */
export const torch = (world, x, y, z) => around(world, x, y, z, T.torchRadius, ({ wet }) => soilId(wet, 0));

/**
 * A morning in the garden: every tilled dirt block in the world's edits (tilling is an edit, so that's all
 * of them). Returns { grew }: how many crops grew.
 */
export function newDay(world, rand = Math.random) {
  const spots = [];
  for (const [key, m] of world.edits) {
    const [cx, cz] = key.split(',').map(Number);
    for (const [i, id] of m) {
      if (!isSoil(id)) continue;
      spots.push([cx * CS + (i % CS), Math.floor(i / (CS * CS)), cz * CS + (Math.floor(i / CS) % CS)]);
    }
  }
  let grew = 0;
  for (const [x, y, z] of spots) {
    const id = world.getBlock(x, y, z);
    if (!isSoil(id)) continue;
    const { wet } = soilInfo(id);
    let { weeds } = soilInfo(id);
    const above = world.getBlock(x, y + 1, z);
    const crop = isCrop(above) ? cropInfo(above) : null;
    // Growth: a watered crop grows a stage.
    if (crop && wet && crop.stage < 3 && rand() < T.growChance) {
      world.setBlock(x, y + 1, z, cropId(crop.crop, crop.stage + 1));
      grew++;
    }
    // Weeds: sprout, or grow, up to level 3 (they cut the harvest then: see harvest()).
    if (weeds === 0) { if (rand() < T.weedChance) weeds = 1; } else weeds = Math.min(4, weeds + 1);
    const next = soilId(false, weeds); // (and the dirt dries out overnight)
    if (next !== id) world.setBlock(x, y, z, next);
  }
  return { grew };
}

/**
 * What picking a crop gives: the vegetables (only when ripe) and whether there's a bonus seed. `soil` is
 * the tilled dirt it grew in: fully grown weeds (level 3) cut the harvest by the Weed harvest cut setting.
 */
export function harvest(id, rand = Math.random, soil = null) {
  const { crop, stage } = cropInfo(id);
  if (stage < 3) return { food: CROPS[crop], n: 0, extraSeed: false, weedy: false };
  const lo = Math.min(T.yieldMin, T.yieldMax);
  let n = lo + Math.floor(rand() * (Math.max(T.yieldMin, T.yieldMax) - lo + 1));
  const weedy = soil !== null && isSoil(soil) && soilInfo(soil).weeds >= 4;
  if (weedy) { // (rounded up or down at random, so it averages out right: half of 1 is 0 or 1)
    const kept = n * (1 - Math.min(100, Math.max(0, T.weedHarvestCut)) / 100);
    n = Math.floor(kept) + (rand() < kept % 1 ? 1 : 0);
  }
  return { food: CROPS[crop], n, extraSeed: rand() < T.seedBack, weedy };
}

/** Can a seed go at (x, y, z)? Only on top of tilled dirt. */
export const canPlant = (world, x, y, z) => isSoil(world.getBlock(x, y - 1, z)) && !SOLID[world.getBlock(x, y, z)];
