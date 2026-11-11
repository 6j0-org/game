// Cooking: recipes made at a Range, a Campfire or an Olive Press (blocks you place, then right-click), and
// the recipe book (K) that lists them all. Ingredients come from the garden (chives, corn, jalapeños,
// garbanzo beans, olives, potatoes, garlic...), the Tavern and CONSUME (yeast, butter), cows (cheese), a
// Bucket dipped in water (Bucket of Water), wheat you cut, and other recipes (cornmeal, chips, olive oil).
// Raw meat and fish heal less than cooked, and raw meat can upset your stomach (the Raw meat upset setting).
// game.js `_cook` runs the `cook` message; one dish at a time, ready after the recipe's cooking time.
// A Sink (blocks.js SINK) counts as water for washing dishes. No Three.js, no DOM.

import { T, tune } from './tuning.js';
import { FOOD } from './items.js';
import { RANGE, CAMPFIRE, OLIVE_PRESS } from './blocks.js';

tune('Cooking', {
  cookSeconds: [6, 'Range cooking time', 'Seconds a recipe takes at the range', { unit: ' s', min: 0, max: 120, step: 1 }],
  roastSeconds: [4, 'Roasting time', 'Seconds to cook raw meat or fish (campfire or range)', { unit: ' s', min: 0, max: 120, step: 1 }],
  pressSeconds: [5, 'Pressing time', 'Seconds the olive press takes for a bottle of oil', { unit: ' s', min: 0, max: 120, step: 1 }],
  rawUpset: [25, 'Raw meat upset', 'Chance eating raw meat upsets your stomach', { unit: '%', min: 0, max: 100, step: 5 }],
  waterReach: [5, 'Bucket reach', 'How far away water can be to fill a bucket, in blocks', { min: 1, max: 10, step: 0.5 }],
});

/** Where you cook: the block you right-click. */
export const STATIONS = {
  range: { name: 'Range', block: RANGE, desc: 'Stovetop and oven: every recipe, and roasting' },
  campfire: { name: 'Campfire', block: CAMPFIRE, desc: 'Roast raw meat and grill fish' },
  press: { name: 'Olive Press', block: OLIVE_PRESS, desc: 'Press olives into oil' },
};
export const stationOf = (blockId) => Object.keys(STATIONS).find((k) => STATIONS[k].block === blockId) ?? null;

/**
 * Every recipe: `out` (a FOOD kind) × `n`, from `needs` (kind -> how many), made `at` these stations, taking
 * `time` (a setting key) seconds.
 */
export const RECIPES = [
  { out: 'bread', n: 1, needs: { wheat: 2, yeast: 1, water: 1 }, at: ['range'], time: 'cookSeconds' },
  { out: 'bakedpotato', n: 1, needs: { potato: 1, butter: 1, chives: 1 }, at: ['range'], time: 'cookSeconds' },
  { out: 'cornmeal', n: 2, needs: { corn: 2 }, at: ['range'], time: 'cookSeconds' },
  { out: 'chips', n: 2, needs: { cornmeal: 1, water: 1 }, at: ['range'], time: 'cookSeconds' },
  { out: 'povertynachos', n: 1, needs: { chips: 1, cheese: 1 }, at: ['range'], time: 'cookSeconds' },
  { out: 'timsnachos', n: 1, needs: { chips: 1, pinto: 1, jalapeno: 1, cheese: 1 }, at: ['range'], time: 'cookSeconds' },
  { out: 'hummus', n: 1, needs: { garbanzo: 2, garlic: 1, oliveoil: 1 }, at: ['range'], time: 'cookSeconds' },
  { out: 'oliveoil', n: 1, needs: { olive: 3 }, at: ['press'], time: 'pressSeconds' },
  // Raw meat and fish: cooked on a campfire or range.
  ...Object.entries(FOOD).filter(([, f]) => f.cookedFrom).map(([k, f]) => ({ out: k, n: 1, needs: { [f.cookedFrom]: 1 }, at: ['campfire', 'range'], time: 'roastSeconds' })),
];
export const recipeFor = (out) => RECIPES.find((r) => r.out === out) ?? null;
export const cookSeconds = (r) => Math.max(0, T[r.time] ?? 5);

/** How many of `kind` the player has (Buildy Bois: plenty). */
const have = (player, kind) => (player.buildy ? Infinity : player.food?.[kind] || 0);
/** Has the player got everything a recipe needs? */
export const canCook = (player, r) => Object.entries(r.needs).every(([k, n]) => have(player, k) >= n);
/** "2 Wheat, 1 Yeast, 1 Bucket of Water" */
export const needsText = (r) => Object.entries(r.needs).map(([k, n]) => `${n} ${FOOD[k]?.name ?? k}`).join(', ');
