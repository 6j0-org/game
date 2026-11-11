// Skills: the experience system. Every weapon and tool you use well earns points in its own skill:
//   - a kill (melee, a gun or bow, an explosion, a spell) is a point for the weapon that made it
//   - a block broken with the right tool, or a use of a garden tool (Tiller, Sprayer, Weed Torch) that
//     changed something, is a point for that tool
//   - planting a seed is a point in Plant
//   - milking a cow is a point for the Bucket
//   - every dish cooked is a point in Cooking, every thing crafted a point in Crafting
//   - a fish (or anything else) reeled in is a point for the Fishing Rod
//   - shaping, firing (a point a piece) and glazing pottery are points in Pottery
//   - washing a dish is points in Dishwash (its XP)
//   - finishing a quest for someone in the Fantasy Town is points in Questing (quests.js)
// Your level comes from your total points (first level at levelFirst, each next one levelMore further),
// and your title is your best skill with "er" on the end ("Wander", "Rocket Launcherer"). No Three.js, no DOM.

import { T, tune } from './tuning.js';
import { TOOLS, HAND } from './items.js';

tune('Health & XP', {
  levelFirst: [100, 'Skill points for level 2', 'Total skill points to reach level 2', { min: 10, max: 2000, step: 10 }],
  levelMore: [50, 'Extra points per level', 'Each level after that needs this many more points than the one before', { min: 0, max: 1000, step: 5 }],
});

/** Skills that aren't an item: punching (an empty hand), spells cast with an empty hand, washing dishes, planting seeds. */
const SPECIAL = { empty: 'Punch', magic: 'Magic', dishwash: 'Dishwash', plant: 'Plant', pottery: 'Pottery', cooking: 'Cooking', crafting: 'Crafting', quest: 'Questing' };
/** Titles that don't come out right with "er" on the end. */
const TITLES = { pottery: 'Potter', rod: 'Fisher', bucket: 'Milker', cooking: 'Chef', crafting: 'Crafter', quest: 'Hero' };
/** What a skill (an item kind, or a special one) is called. */
export const skillName = (kind) => SPECIAL[kind] ?? TOOLS[kind]?.name ?? (kind === 'hand' ? HAND.name : kind);
/** Your best skill's name + "er": a Wand user is a Wander. Nobody's anything yet: Adventurer. */
export function title(skills) {
  const best = Object.entries(skills || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
  if (!best) return 'Adventurer';
  if (TITLES[best[0]]) return TITLES[best[0]];
  const name = skillName(best[0]);
  if (name.endsWith('er')) return name; // a Sprayer user is a Sprayer, not a Sprayerer
  return `${name}${name.endsWith('e') ? 'r' : 'er'}`; // ("Axe" makes an Axer, not an Axeer)
}
export const totalPoints = (skills) => Object.values(skills || {}).reduce((a, n) => a + (n > 0 ? n : 0), 0);
/** Total points needed to reach `level` (level 1 needs none). 100, 250, 450, 700... with the default settings. */
export function pointsFor(level) {
  const n = Math.max(0, level - 1); // levels above 1
  return n * T.levelFirst + (T.levelMore * n * (n - 1)) / 2;
}
/** The level `points` total puts you at (1 and up). */
export function levelFor(points) {
  let level = 1;
  while (pointsFor(level + 1) <= points && level < 999) level++;
  return level;
}
/** Max health at a level: the starting max plus a bit per level, capped. */
export const maxHpFor = (level) => Math.min(Math.max(T.startMaxHp, T.maxHpCap), T.startMaxHp + (level - 1) * T.hpPerLevel);
