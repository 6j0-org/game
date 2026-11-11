// Fishing: cast a Fishing Rod into water, wait for a bite, click again while the bobber dips to reel
// the fish in. Fish are food (items.js FOOD, `fish: true`). game.js runs it (`fish` message, `_fish`,
// `_tickFishing`) and sends the bobber in snapshots. Every number is a setting (group Fishing). No Three.js, no DOM.

import { T, tune } from './tuning.js';
import { WATER } from './blocks.js';
import { CH } from './world.js';

/** The fish you can catch: names, healing and how often each bites (`weight`, a setting). */
export const FISH = {
  minnow: { name: 'Minnow', heal: 1, weight: 30 },
  trout: { name: 'Trout', heal: 4, weight: 25 },
  salmon: { name: 'Salmon', heal: 6, weight: 15 },
  catfish: { name: 'Catfish', heal: 5, weight: 10, night: true }, // bites more at night
  perch: { name: 'Perch', heal: 3, weight: 18 },
  koi: { name: 'Golden Koi', heal: 12, weight: 2 }, // rare
};

tune('Fishing', {
  fishRange: [14, 'Casting range', 'How far you can cast a fishing line, in blocks', { min: 2, max: 40, step: 1 }],
  fishWaitMin: [3, 'Shortest wait for a bite', 'Seconds, at least, before a fish bites', { unit: ' s', min: 0, max: 60, step: 0.5 }],
  fishWaitMax: [12, 'Longest wait for a bite', 'Seconds, at most, before a fish bites', { unit: ' s', min: 0, max: 120, step: 0.5 }],
  fishBiteWindow: [1.2, 'Bite time', 'Seconds you have to click while the bobber dips', { unit: ' s', min: 0.2, max: 5, step: 0.1 }],
  fishJunkChance: [0.08, 'Junk chance', 'Chance a catch is a dirty dish someone threw in', { max: 1, step: 0.01 }],
  fishNight: [3, 'Catfish at night', 'How much more often catfish bite at night', { unit: '×', min: 1, max: 10, step: 0.5 }],
  ...Object.fromEntries(Object.entries(FISH).map(([k, f]) => [`fishWeight_${k}`, [f.weight, `${f.name} odds`, 'How often it bites, compared with the other fish', { min: 0, max: 100, step: 1 }]])),
});

const STEP = 0.1;
/**
 * Where a line cast from `o` along unit vector `d` lands in water: the first water block the ray reaches
 * through open air (within the casting range), as { x, y, z } for the bobber on its surface, or null if the
 * line hits something solid first or never reaches water. (A cast arcs, but this is a fair stand-in.)
 */
export function findWater(world, o, d, range = T.fishRange) {
  for (let t = 0.5; t <= range; t += STEP) {
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    const z = o.z + d.z * t;
    if (y < 0 || y >= CH) return null;
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const id = world.getBlock(bx, by, bz);
    if (id === WATER) {
      let top = by; // float on the surface
      while (top + 1 < CH && world.getBlock(bx, top + 1, bz) === WATER) top++;
      return { x: Math.round(x * 100) / 100, y: top + 0.92, z: Math.round(z * 100) / 100, bx, by: top, bz };
    }
    if (id !== 0) return null; // hit the bank (or a tree)
  }
  return null;
}

/** Seconds until the next bite. */
export const biteWait = (rand = Math.random) => {
  const lo = Math.min(T.fishWaitMin, T.fishWaitMax);
  return lo + rand() * Math.abs(T.fishWaitMax - T.fishWaitMin);
};

/** What's on the hook: a fish kind, or 'junk' (the game hands over a dirty dish). */
export function rollCatch(rand = Math.random, night = false) {
  if (rand() < T.fishJunkChance) return 'junk';
  const weights = Object.entries(FISH).map(([k, f]) => [k, Math.max(0, T[`fishWeight_${k}`]) * (f.night && night ? T.fishNight : 1)]);
  const total = weights.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return 'junk';
  let r = rand() * total;
  for (const [k, w] of weights) if ((r -= w) < 0) return k;
  return weights[weights.length - 1][0];
}
