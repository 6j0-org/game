// Jobs: you hire a Fantasy Town villager to do something for you, the other way round from quests.js.
//   errand   they go out and gather `n` of something (ores, herbs, sticks...) and bring it back
//   garden   they borrow your Tiller and till `n` blocks around the last spot you tilled
// You pay up front (dollars, charged in ZEC at the moment's rate). The villager leaves the market while they're
// out (npcs.js `busy`) and the job finishes `due` (epoch ms) later: game.js `_tickJobs` hands over the goods,
// or tills the ground and gives the Tiller back. Logic only: no Three.js, no DOM.

import { T, tune } from './tuning.js';
import { WORTH } from './quests.js';
import { till } from './garden.js';

tune('Jobs', {
  jobErrandPrice: [150, 'Errand price', 'What hiring a villager to fetch something costs, compared with what it\'s worth to quest givers', { unit: '%', min: 0, max: 1000, step: 5 }],
  jobTillUsd: [0.5, 'Gardening price', 'Dollars per block a villager tills for you', { unit: '$', min: 0, max: 20, step: 0.1 }],
  jobMinutes: [2, 'Job base time', 'Minutes any job takes, before the per-item or per-block time', { unit: ' min', min: 0, max: 120, step: 0.5 }],
  jobPerItem: [10, 'Errand time per item', 'Extra seconds an errand takes for each thing fetched', { unit: ' s', min: 0, max: 600, step: 1 }],
  jobPerBlock: [4, 'Gardening time per block', 'Extra seconds gardening takes for each block tilled', { unit: ' s', min: 0, max: 600, step: 1 }],
  maxJobs: [2, 'Jobs at once', 'How many villagers you can have out working for you at a time', { min: 1, max: 10, step: 1 }],
  jobMaxItems: [20, 'Most things per errand', 'The most a villager will fetch in one errand', { min: 1, max: 100, step: 1 }],
  jobMaxTill: [32, 'Most blocks per garden job', 'The most blocks a villager will till in one job', { min: 1, max: 200, step: 1 }],
});

/** What villagers will go and fetch (gathered things: none of it is made or bought). */
export const ERRAND_ITEMS = ['coal', 'ironore', 'copperore', 'silverore', 'sulfur', 'mushroom', 'glowcap', 'yarrow', 'mint', 'stick', 'fiber', 'feather', 'wheat'];
export const JOB_KINDS = ['errand', 'garden'];

const n2 = (v) => Math.round(v * 100) / 100;
/** A job's dollar price. */
export function jobUsd(kind, item, n) {
  if (kind === 'errand') return n2((WORTH[item] || 0) * n * T.jobErrandPrice / 100);
  return n2(T.jobTillUsd * n);
}
/** How long a job takes, in seconds. */
export const jobSeconds = (kind, n) => Math.round(T.jobMinutes * 60 + n * (kind === 'errand' ? T.jobPerItem : T.jobPerBlock));
/** The most `n` for a kind of job. */
export const jobMax = (kind) => Math.max(1, Math.round(kind === 'errand' ? T.jobMaxItems : T.jobMaxTill));

/** A job request from the browser, checked: { kind, item, n } or { error }. */
export function cleanJob({ kind, item, n }) {
  if (!JOB_KINDS.includes(kind)) return { error: 'What job?' };
  if (!Number.isInteger(n) || n < 1 || n > jobMax(kind)) return { error: `Between 1 and ${jobMax(kind)}, please` };
  if (kind === 'errand' && !ERRAND_ITEMS.includes(item)) return { error: 'They don\'t know where to find that' };
  return { kind, item: kind === 'errand' ? item : 'tiller', n };
}

/** Jobs from a save, made safe. */
export function cleanJobs(saved) {
  if (!Array.isArray(saved)) return [];
  const str = (v, max = 80) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const out = [];
  for (const j of saved) {
    if (!j || !str(j.npc) || !str(j.name) || !JOB_KINDS.includes(j.kind) || !Number.isInteger(j.n) || j.n < 1 || !Number.isFinite(j.due)) continue;
    if (j.kind === 'errand' && !ERRAND_ITEMS.includes(j.item)) continue;
    const spot = j.spot && [j.spot.x, j.spot.y, j.spot.z].every(Number.isInteger) ? { x: j.spot.x, y: j.spot.y, z: j.spot.z } : null;
    if (j.kind === 'garden' && !spot) continue;
    out.push({ id: Number.isInteger(j.id) ? j.id : out.length + 1, npc: j.npc, name: j.name, kind: j.kind, item: j.kind === 'errand' ? j.item : 'tiller', n: j.n, due: j.due, spot });
  }
  return out;
}

/**
 * Tills up to `n` blocks around `spot` (the nearest first, within a few blocks, a block up or down from it).
 * Returns how many it tilled.
 */
export function tillAround(world, spot, n) {
  const R = Math.ceil(Math.sqrt(n)) + 2;
  const cells = [];
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) cells.push([dx, dz]);
  cells.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  let done = 0;
  for (const [dx, dz] of cells) {
    if (done >= n) break;
    for (const dy of [0, 1, -1]) {
      // till() does a row starting here; one block's worth is enough, so ask for a row of one.
      const tilled = till(world, spot.x + dx, spot.y + dy, spot.z + dz, 0, 1);
      if (tilled) { done += tilled; break; }
    }
  }
  return done;
}
