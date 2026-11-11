// Characters: a Player (accounts.js) can have several, each with its own name, look, stats, traits, inventory,
// skills and saves. You make one on the title screen (account.js): every stat starts at `startStat` and you
// place `startPoints` more; traits are rolled once, when it's made, and stay with it for good. Logic only:
// no Three.js, no DOM (the game checks what the browser sends with `cleanCharacter`).

import { T, tune } from './tuning.js';
import { STATS } from './stats.js';
import { TRAITS, rollTraits } from './items.js';

tune('Stats', {
  startStat: [5, 'Starting stat', 'Every stat of a new character starts here', { min: 1, max: 18, step: 1 }],
  startPoints: [15, 'Starting stat points', 'Points a new character places among its stats', { min: 0, max: 60, step: 1 }],
  maxCharacters: [5, 'Characters per Player', 'How many characters one Player can have', { min: 1, max: 20, step: 1 }],
  bonkChance: [2, 'Head bonk chance', 'Chance per step under a low ceiling, per point of Tallness over 10, of bonking your head (1 damage)', { unit: '%', min: 0, max: 20, step: 0.5 }],
});

/** Fitzpatrick skin types I to VI. */
export const SKINS = [0xf6d7c3, 0xeac0a0, 0xd6a07a, 0xb07a52, 0x7d4f32, 0x4a2c1c];
export const SKIN_NAMES = ['I', 'II', 'III', 'IV', 'V', 'VI'];
export const HAIRSTYLES = { short: 'Short', long: 'Long', curly: 'Curly', ponytail: 'Ponytail', mohawk: 'Mohawk', bald: 'Bald' };
export const HAIR_COLORS = [0x1a1a1a, 0x3b2414, 0x6a4424, 0xb07a3a, 0xe0c070, 0xa83a1e, 0xd8d8d8, 0x6a3ac8, 0x2ab0a0];
export const BROWS = { dual: 'Two brows', uni: 'Unibrow' };
/** Head models: a normal head (with your hair and brows), or one of the novelty heads (original designs). */
export const HEADS = { normal: 'Normal', shiba: 'Smug Shiba', hunk: 'Chiseled Hunk', stone: 'Stone Head', frog: 'Frog' };
export const SHIRT_COLORS = [0xc0392b, 0xe67e22, 0xf1c40f, 0x27ae60, 0x2980b9, 0x8e44ad, 0x2c3e50, 0xecf0f1, 0x7f8c8d, 0xe84393];
export const PANTS_COLORS = [0x2f3f5c, 0x1a1a1a, 0x5a4a3a, 0x3a5a3a, 0x7a6a5a, 0x4a4a6a, 0x8a2a2a, 0xd8d0c0];

/** The look a character gets if you don't choose: from a number (an old save, or a fresh form). */
export function defaultLook(n = 0) {
  return {
    skin: n % SKINS.length, hair: 'short', hairColor: HAIR_COLORS[(n * 7) % HAIR_COLORS.length], brows: 'dual', head: 'normal',
    shirt: SHIRT_COLORS[n % SHIRT_COLORS.length], pants: PANTS_COLORS[0],
  };
}
const color = (v, fallback) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : fallback);
/** A look the browser sent, made safe. */
export function cleanLook(l, n = 0) {
  const d = defaultLook(n);
  if (!l || typeof l !== 'object') return d;
  return {
    skin: Number.isInteger(l.skin) && l.skin >= 0 && l.skin < SKINS.length ? l.skin : d.skin,
    hair: l.hair in HAIRSTYLES ? l.hair : d.hair,
    hairColor: color(l.hairColor, d.hairColor),
    brows: l.brows in BROWS ? l.brows : d.brows,
    head: l.head in HEADS ? l.head : d.head,
    shirt: color(l.shirt, d.shirt),
    pants: color(l.pants, d.pants),
  };
}

/**
 * Stats the browser sent for a new character: each from startStat up, using no more than startPoints in all.
 * Returns { stats, spare } (spare points become attribute points to spend later) or { error }.
 */
export function cleanStats(s) {
  const stats = {};
  let used = 0;
  for (const k of Object.keys(STATS)) {
    const v = Number.isInteger(s?.[k]) ? s[k] : T.startStat;
    if (v < T.startStat) return { error: `${STATS[k].name} can't go below ${T.startStat}` };
    stats[k] = v;
    used += v - T.startStat;
  }
  if (used > T.startPoints) return { error: `That's ${used} points; you have ${T.startPoints}` };
  return { stats, spare: T.startPoints - used };
}

/** A new character from what the browser sent: { name, look, stats, spare, traits } or { error }. */
export function newCharacter({ name, look, stats }, n, rand = Math.random) {
  const st = cleanStats(stats);
  if (st.error) return st;
  return { name, look: cleanLook(look, n), stats: st.stats, spare: st.spare, traits: rollTraits(rand), created: Date.now() };
}

/** How much bigger (or smaller) Tallness makes a character look: 2.5% a point from 10 (looks only). */
export const tallScale = (stats) => Math.max(0.8, Math.min(1.3, 1 + ((stats?.tallness ?? 10) - 10) * 0.025));
export { TRAITS };
