// Character stats, RPG-style but sillier. A character gets them when it's made (characters.js: each starts at
// 5 and you place 15 more points) plus attribute points from levelling up; they stay with it for good. Each
// one nudges something real; Touch Grass does nothing yet. No Three.js, no DOM.
import { T, tune } from './tuning.js';
import { maxMana } from './spells.js';

// Server settings: what each stat point above (or below) 10 does.
const PER = (what) => `${what} per point above 10 (and less per point below)`;
const ABOVE = (what) => `${what} per point above 10 (none at 10 or below)`;
tune('Stats', {
  statMog: [0.04, 'Mog effect', PER('Extra damage with melee weapons and bows'), { unit: '×' }],
  statCracked: [0.015, 'Cracked effect', PER('Extra movement speed'), { unit: '×' }],
  statDodge: [1, 'Cracked dodge', ABOVE('Chance to dodge an attack (mobs, weapons, spells; never falls, lava or blasts)'), { unit: '%', min: 0, max: 10, step: 0.1 }],
  statDodgeMax: [40, 'Most dodge', "Cracked can't take the dodge chance beyond this", { unit: '%', min: 0, max: 100, step: 1 }],
  statRizz: [0.03, 'Rizz price effect', PER('Discount at Fantasy Town shopkeepers'), { unit: '×' }],
  statRizzReward: [0.03, 'Rizz reward effect', PER('Extra quest reward'), { unit: '×' }],
  statBuiltHp: [1, 'Built Different health', PER('Extra max health'), { step: 0.5 }],
  statResist: [2, 'Built Different resistance', ABOVE('Chance to shrug off a debuff (hostile spells, food reactions)'), { unit: '%', min: 0, max: 10, step: 0.1 }],
  statResistMax: [40, 'Most debuff resistance', "Built Different can't take the chance to shrug off a debuff beyond this", { unit: '%', min: 0, max: 100, step: 1 }],
  statDebuffTime: [0.03, 'Built Different debuff time', PER('Shorter debuffs'), { unit: '×' }],
  statTallness: [0.03, 'Tallness effect', PER('Extra reach'), { unit: '×' }],
});

export const STATS = {
  mog: { name: 'Mog', abbr: 'MOG', desc: 'Out-muscles everyone in the room, and makes sure they know it.', effect: 'damage with melee weapons and bows' },
  cracked: { name: 'Cracked', abbr: 'CRK', desc: 'Impossibly quick. Probably up to something.', effect: 'movement speed and dodging attacks' },
  bigBrain: { name: 'Big Brain', abbr: 'BRN', desc: 'Book learning. Dish learning. Spell learning.', effect: 'max mana and mana regeneration' },
  rizz: { name: 'Rizz', abbr: 'RZZ', desc: 'The shopkeepers like you. Or they don\'t.', effect: 'shopkeeper prices and quest rewards' },
  builtDifferent: { name: 'Built Different', abbr: 'BLT', desc: 'Shrugs off what would floor anyone else.', effect: 'max health, and resisting debuffs (and how long they last)' },
  tallness: { name: 'Tallness', abbr: 'TAL', desc: 'Up there. Reaches the top shelf; over 10, ducks under doorways, mostly.', effect: 'reach (and how tall you look)' },
  touchGrass: { name: 'Touch Grass', abbr: 'TGR', desc: 'Time spent outside, spiritually.', effect: null },
};

/** Stats saved before the renames: strongth -> mog, rascaliness -> cracked, smartness -> bigBrain (snackitude and vibes are gone). */
const RENAMED = { strongth: 'mog', rascaliness: 'cracked', smartness: 'bigBrain' };
export function migrateStats(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) if (RENAMED[k] ? !(RENAMED[k] in s) : k in STATS) out[RENAMED[k] || k] = v;
  return out;
}

tune('Health & XP', {
  statPointsPerLevel: [3, 'Attribute points per level', 'Points you get to add to your stats (Mog, Rizz...) each time you level up', { min: 0, max: 20, step: 1 }],
});

export const AVERAGE = { mog: 10, cracked: 10, bigBrain: 10, rizz: 10, builtDifferent: 10, tallness: 10, touchGrass: 10 };

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

/** Multipliers (1 = average) and chances (0-1) used by the game. */
export const statEffects = (stats) => ({
  damage: 1 + mod(stats, 'mog') * T.statMog, // melee and bows
  speed: 1 + mod(stats, 'cracked') * T.statCracked,
  dodge: Math.min(T.statDodgeMax, Math.max(0, mod(stats, 'cracked')) * T.statDodge) / 100,
  price: 1 - mod(stats, 'rizz') * T.statRizz, // shopkeepers only (not the printer or CONSUME)
  reward: Math.max(0, 1 + mod(stats, 'rizz') * T.statRizzReward), // quest rewards
  hp: Math.round(mod(stats, 'builtDifferent') * T.statBuiltHp), // added to max health
  resist: Math.min(T.statResistMax, Math.max(0, mod(stats, 'builtDifferent')) * T.statResist) / 100,
  debuffTime: Math.max(0.25, 1 - mod(stats, 'builtDifferent') * T.statDebuffTime),
  reach: Math.max(0.5, 1 + mod(stats, 'tallness') * T.statTallness),
});

const pctText = (pct) => { const n = Math.round(pct * 100); return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}%`; };
/** What a stat does for you, for the character sheet: "+12% movement speed · 8% dodge". */
export function effectText(key, stats) {
  const e = statEffects(stats);
  switch (key) {
    case 'mog': return `${pctText(e.damage - 1)} damage with melee weapons and bows`;
    case 'cracked': return `${pctText(e.speed - 1)} movement speed · ${Math.round(e.dodge * 100)}% dodge`;
    case 'bigBrain': return `${pctText(maxMana(stats, T) / maxMana(AVERAGE, T) - 1)} max mana and mana regeneration`;
    case 'rizz': return `${pctText(e.price - 1)} shopkeeper prices · ${pctText(e.reward - 1)} quest rewards`;
    case 'builtDifferent': return `${e.hp >= 0 ? '+' : '−'}${Math.abs(e.hp)} max health · ${Math.round(e.resist * 100)}% debuff resistance · ${pctText(e.debuffTime - 1)} debuff time`;
    case 'tallness': return `${pctText(e.reach - 1)} reach`;
    default: return 'No effect yet';
  }
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
