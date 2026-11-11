// Pottery, the way potters do it: throw a pot on the Pottery Wheel, trim it on the wheel, bisque-fire it in
// the Kiln, glaze it at the Glazing Table, then glaze-fire it in the Kiln.
//
//   Clay        White, Brown and Red Clay are blocks. Digging sand sometimes turns up white clay, dirt, grass
//               and mud brown, sandstone and brimstone red (chances are settings); CONSUME sells all three.
//   Throw       (wheel) clay -> a thrown pot, still wet and rough: 'thrown:<object>:<clay>'
//   Trim        (wheel) thrown -> trimmed: 'trimmed:<object>:<clay>'
//   Bisque      (kiln) trimmed -> a bisque piece: a block you can place (blocks.js POTTERY, glaze 0)
//   Glaze       (table) a bisque piece -> glazed but unfired: 'glazed:<object>:<clay>:<glaze>' (1-3:
//               Cobalt Stripes, Jade Speckle, Amber Zigzag)
//   Glaze fire  (kiln) glazed -> the finished glazed piece (a block)
//   Luminaries  right-click a placed one to light it or put it out.
// Unfired pieces live in player.unfired (keys above) and can't be placed or held. Every step earns a point in
// the Pottery skill (firing: a point a piece). game.js `_pottery` runs the `pottery` message. No Three.js, no DOM.

import { T, tune } from './tuning.js';
import { POT_OBJECTS, POT_NAMES, CLAYS, CLAY_NAMES, CLAY_BLOCKS, GLAZES, GLAZE_NAMES, SAND, DIRT, GRASS, MUD, SANDSTONE, BRIMSTONE, WHITE_CLAY, BROWN_CLAY, RED_CLAY,
  potteryId, potteryInfo } from './blocks.js';

tune('Pottery', {
  bisqueSeconds: [20, 'Bisque firing time', 'Seconds the kiln takes to bisque-fire a batch of trimmed pots', { unit: ' s', min: 0, max: 300, step: 5 }],
  glazeFireSeconds: [25, 'Glaze firing time', 'Seconds the kiln takes to glaze-fire a batch of glazed pieces', { unit: ' s', min: 0, max: 300, step: 5 }],
  kilnLoad: [8, 'Kiln load', 'Most pieces the kiln fires at once', { min: 1, max: 64, step: 1 }],
  ...Object.fromEntries(POT_OBJECTS.map((o, i) => [`clay_${o}`, [[1, 2, 1, 1, 2][i], `${POT_NAMES[i]} clay`, `Clay blocks a ${POT_NAMES[i].toLowerCase()} takes on the wheel`, { min: 0, max: 10, step: 1 }]])),
  whiteClayChance: [0.12, 'White clay chance', 'Chance digging sand also turns up a White Clay block', { max: 1, step: 0.01 }],
  brownClayChance: [0.08, 'Brown clay chance', 'Chance digging dirt or grass also turns up a Brown Clay block (three times that in mud)', { max: 1, step: 0.01 }],
  redClayChance: [0.15, 'Red clay chance', 'Chance digging sandstone or brimstone also turns up a Red Clay block', { max: 1, step: 0.01 }],
});

export const STAGES = ['thrown', 'trimmed', 'glazed'];
/** Every unfired piece's key: 'thrown:mug:red', 'trimmed:mug:red', 'glazed:mug:red:1'... */
export const UNFIRED = [
  ...['thrown', 'trimmed'].flatMap((st) => POT_OBJECTS.flatMap((o) => CLAYS.map((c) => `${st}:${o}:${c}`))),
  ...POT_OBJECTS.flatMap((o) => CLAYS.flatMap((c) => [1, 2, 3].map((g) => `glazed:${o}:${c}:${g}`))),
];
const UNFIRED_SET = new Set(UNFIRED);
export const unfiredKey = (stage, obj, clay, glaze = 0) => `${stage}:${POT_OBJECTS[obj]}:${CLAYS[clay]}${stage === 'glazed' ? `:${glaze}` : ''}`;
/** { stage, obj, clay, glaze } (indices; glaze 0 unless glazed) from an unfired key, or null. */
export function unfiredInfo(key) {
  if (!UNFIRED_SET.has(key)) return null;
  const [stage, o, c, g] = key.split(':');
  return { stage, obj: POT_OBJECTS.indexOf(o), clay: CLAYS.indexOf(c), glaze: g ? Number(g) : 0 };
}
/** "Thrown Red Clay Mug", "Trimmed White Clay Vase", "Glazed Brown Clay Bowl (Jade Speckle)". */
export function unfiredName(key) {
  const u = unfiredInfo(key);
  if (!u) return key;
  const what = `${CLAY_NAMES[u.clay]} ${POT_NAMES[u.obj]}`;
  return u.stage === 'glazed' ? `Glazed ${what} (${GLAZE_NAMES[u.glaze]})` : `${u.stage === 'thrown' ? 'Thrown' : 'Trimmed'} ${what}`;
}
/** What firing an unfired piece makes (a block id), or null if it isn't ready for the kiln (thrown pots need trimming). */
export function firedId(key) {
  const u = unfiredInfo(key);
  if (!u || u.stage === 'thrown') return null;
  return potteryId(u.obj, u.clay, u.stage === 'glazed' ? u.glaze : 0);
}
/** The kiln time for a piece: bisque or glaze firing (settings). */
export const fireSeconds = (key) => (unfiredInfo(key)?.stage === 'glazed' ? T.glazeFireSeconds : T.bisqueSeconds);
/** Old saves (before trimming) kept unfired pots as '<object>:<clay>': those are trimmed pots now. */
export const upgradeUnfiredKey = (key) => (UNFIRED_SET.has(key) ? key : UNFIRED_SET.has(`trimmed:${key}`) ? `trimmed:${key}` : null);
/** Clay blocks one object takes on the wheel (a setting). */
export const clayFor = (obj) => T[`clay_${POT_OBJECTS[obj]}`];
export const clayBlock = (clay) => CLAY_BLOCKS[clay];

/** Digging a block sometimes turns up clay as well: the clay block's id, or null. */
export function clayFind(id, rand = Math.random) {
  if (id === SAND) return rand() < T.whiteClayChance ? WHITE_CLAY : null;
  if (id === DIRT || id === GRASS) return rand() < T.brownClayChance ? BROWN_CLAY : null;
  if (id === MUD) return rand() < Math.min(1, T.brownClayChance * 3) ? BROWN_CLAY : null;
  if (id === SANDSTONE || id === BRIMSTONE) return rand() < T.redClayChance ? RED_CLAY : null;
  return null;
}

/** Glazing a bisque piece (block id) with glaze `g` (1-3): the unfired glazed key, or null if it can't take one. */
export function glazedKey(id, g) {
  const p = potteryInfo(id);
  if (!p || p.glaze || p.lit || !(g >= 1 && g < GLAZES.length)) return null;
  return unfiredKey('glazed', p.obj, p.clay, g);
}

/** The lit or dark twin of a luminary. */
export function toggledLuminary(id) {
  const p = potteryInfo(id);
  return p && p.obj === 4 ? potteryId(4, p.clay, p.glaze, !p.lit) : null;
}

/** "3 mugs, 1 vase" for a list of [unfired key, n]. */
export function piecesText(pieces) {
  return pieces.map(([k, n]) => { const u = unfiredInfo(k); const name = POT_NAMES[u.obj].toLowerCase(); return `${n} ${name}${n === 1 ? '' : 's'}`; }).join(', ');
}
