// Gathering: things you find while mining and digging. Mining stone sometimes turns up coal or ore, brimstone
// sulfur; cutting grass turns up herbs; digging dirt, grass and swamp mud turns up mushrooms (and, rarely, a
// glowing Glowcap). They go into `player.materials` (items.js MATERIALS) and are what the Fantasy Town's
// shopkeepers ask for in their quests (quests.js). Like clay (pottery.js), they come from breaking blocks, so
// terrain generation doesn't change. Logic only: no Three.js, no DOM.

import { T, tune } from './tuning.js';
import { STONE, SANDSTONE, BRIMSTONE, GRASS, SNOW_GRASS, DIRT, MUD } from './blocks.js';

const P = { max: 1, step: 0.005 };
tune('Gathering', {
  coalChance: [0.07, 'Coal chance', 'Chance mining stone turns up a lump of coal', P],
  ironChance: [0.04, 'Iron ore chance', 'Chance mining stone turns up iron ore', P],
  copperChance: [0.04, 'Copper ore chance', 'Chance mining stone turns up copper ore', P],
  silverChance: [0.012, 'Silver ore chance', 'Chance mining stone turns up silver ore', { max: 1, step: 0.001 }], // (a finer step: 0.012 isn't on P's grid)
  sulfurChance: [0.2, 'Sulfur chance', 'Chance mining brimstone (in Hell) turns up sulfur', P],
  yarrowChance: [0.05, 'Yarrow chance', 'Chance cutting grass turns up some yarrow', P],
  mintChance: [0.035, 'Wild mint chance', 'Chance cutting grass turns up some wild mint', P],
  mushroomChance: [0.03, 'Mushroom chance', 'Chance digging dirt or grass turns up a mushroom (three times as often in swamp mud)', P],
  glowcapChance: [0.03, 'Glowcap chance', 'Chance digging swamp mud turns up a Glowcap', P],
  featherChance: [0.6, 'Feather chance', 'Chance a bird leaves a feather when it dies', P],
});

/** Where each found thing comes from, in a few words (quest hints, item descriptions). */
export const FOUND_WHERE = {
  coal: 'found now and then when you mine stone',
  ironore: 'found now and then when you mine stone',
  copperore: 'found now and then when you mine stone',
  silverore: 'found, rarely, when you mine stone',
  sulfur: 'found when you mine brimstone, down in Hell',
  yarrow: 'found when you cut grass',
  mint: 'found when you cut grass',
  mushroom: 'found when you dig dirt or grass, and more often in swamp mud',
  glowcap: 'found, rarely, when you dig swamp mud',
  feather: 'dropped by birds',
};

/**
 * What breaking block `id` turned up, as a list of material kinds (usually empty). Each find is rolled
 * on its own, so one block can (rarely) give two things.
 */
export function forageFind(id, rand = Math.random) {
  const out = [];
  const roll = (chance, kind) => { if (rand() < chance) out.push(kind); };
  if (id === STONE || id === SANDSTONE) {
    roll(T.coalChance, 'coal');
    roll(T.ironChance, 'ironore');
    roll(T.copperChance, 'copperore');
    roll(T.silverChance, 'silverore');
  } else if (id === BRIMSTONE) roll(T.sulfurChance, 'sulfur');
  if (id === GRASS || id === SNOW_GRASS) {
    roll(T.yarrowChance, 'yarrow');
    roll(T.mintChance, 'mint');
  }
  if (id === GRASS || id === DIRT) roll(T.mushroomChance, 'mushroom');
  if (id === MUD) {
    roll(Math.min(1, T.mushroomChance * 3), 'mushroom');
    roll(T.glowcapChance, 'glowcap');
  }
  return out;
}
