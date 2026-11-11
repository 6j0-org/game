// Character stats, RPG-style but sillier. A character gets them when it's made (characters.js: each starts at
// 5 and you place 15 more points) plus attribute points from levelling up; they stay with it for good. Each
// one nudges something real; Touch Grass is purely for show. No Three.js, no DOM.
import { T, tune } from './tuning.js';
import { maxMana } from './spells.js';

// Server settings: what each stat point above (or below) 10 does.
const PER = (what) => `${what} per point above 10 (and less per point below)`;
tune('Stats', {
  statStrongth: [0.04, 'Strongth effect', PER('Extra melee damage'), { unit: '×' }],
  statRascaliness: [0.015, 'Rascaliness effect', PER('Extra movement speed'), { unit: '×' }],
  statRizz: [0.03, 'Rizz effect', PER('Discount at the printer and CONSUME'), { unit: '×' }],
  statSnackitude: [0.05, 'Snackitude effect', PER('Extra healing from food'), { unit: '×' }],
  statVibes: [0.06, 'Vibes effect', PER('Longer gaps between allergy symptoms'), { unit: '×' }],
  statTallness: [0.03, 'Tallness effect', PER('Extra reach'), { unit: '×' }],
});

export const STATS = {
  strongth: { name: 'Strongth', abbr: 'STR', desc: 'Like strength, but more.', effect: 'melee damage' },
  rascaliness: { name: 'Rascaliness', abbr: 'RSC', desc: 'Nimble, sneaky, probably up to something.', effect: 'movement speed' },
  smartness: { name: 'Smartness', abbr: 'SMT', desc: 'Book learning. Dish learning. Spell learning.', effect: 'max mana (and mana regeneration)' },
  rizz: { name: 'Rizz', abbr: 'RZZ', desc: 'The printer likes you. Or it doesn\'t.', effect: '3D Printer prices' },
  snackitude: { name: 'Snackitude', abbr: 'SNK', desc: 'Knowing which end of a steak to bite.', effect: 'healing from food' },
  vibes: { name: 'Vibes', abbr: 'VIB', desc: 'Immovable chill.', effect: 'how often pet allergies flare up' },
  tallness: { name: 'Tallness', abbr: 'TAL', desc: 'Up there. Reaches the top shelf; over 10, ducks under doorways, mostly.', effect: 'reach (and how tall you look)' },
  touchGrass: { name: 'Touch Grass', abbr: 'TGR', desc: 'Time spent outside, spiritually.', effect: null },
};

tune('Health & XP', {
  statPointsPerLevel: [3, 'Attribute points per level', 'Points you get to add to your stats (Strongth, Rizz...) each time you level up', { min: 0, max: 20, step: 1 }],
});

export const AVERAGE = { strongth: 10, rascaliness: 10, smartness: 10, rizz: 10, snackitude: 10, vibes: 10, tallness: 10, touchGrass: 10 };

/** 3d6 for every stat. */
export function rollStats(rand = Math.random) {
  const d6 = () => 1 + Math.floor(rand() * 6);
  return Object.fromEntries(Object.keys(STATS).map((k) => [k, d6() + d6() + d6()]));
}

/**
 * Your stats this life: what you rolled plus the attribute points you've put in (those stay from life to
 * life; the roll doesn't). Points come from levelling up (statPointsPerLevel).
 */
export function withBonus(base, bonus) {
  return Object.fromEntries(Object.keys(STATS).map((k) => [k, (base?.[k] ?? 10) + (bonus?.[k] > 0 ? bonus[k] : 0)]));
}

const mod = (stats, k) => (Number.isFinite(stats?.[k]) ? stats[k] : 10) - 10;

/** Multipliers used by the game. 1 = average. */
export const statEffects = (stats) => ({
  damage: 1 + mod(stats, 'strongth') * T.statStrongth,
  speed: 1 + mod(stats, 'rascaliness') * T.statRascaliness,
  price: 1 - mod(stats, 'rizz') * T.statRizz,
  heal: 1 + mod(stats, 'snackitude') * T.statSnackitude,
  allergy: 1 + mod(stats, 'vibes') * T.statVibes, // longer gaps between symptoms
  reach: Math.max(0.5, 1 + mod(stats, 'tallness') * T.statTallness),
});

/** "+12%" / "-6%" for showing on the character sheet. */
export function effectText(key, stats) {
  const e = statEffects(stats);
  const pct = { strongth: e.damage - 1, rascaliness: e.speed - 1, smartness: maxMana(stats, T) / maxMana(AVERAGE, T) - 1, rizz: e.price - 1, snackitude: e.heal - 1, vibes: e.allergy - 1, tallness: e.reach - 1 }[key];
  if (pct === undefined) return '';
  const n = Math.round(pct * 100);
  return `${n > 0 ? '+' : ''}${n}%`;
}

/** A one-line verdict for a stat value. */
export function verdict(v) {
  if (v <= 5) return 'Tragic';
  if (v <= 8) return 'Meh';
  if (v <= 12) return 'Fine';
  if (v <= 15) return 'Good';
  if (v <= 17) return 'Great';
  return 'Legendary';
}
