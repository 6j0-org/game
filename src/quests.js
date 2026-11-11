// Quests: jobs the Fantasy Town's people (npcs.js) give you. Shopkeepers want the makings of their trades:
// the blacksmith coal and ore, the healer mushrooms and herbs, the innkeeper ingredients, the fletcher sticks
// and feathers, the wizard rare reagents. Villagers lose things about the town, want a patch of garden
// tilled, or are just hungry. You have at most `maxQuests` on the go, one per person; finishing one pays
// Zcash (its dollar reward at the rate of the moment), gives Questing skill points, and that person has
// nothing more for you for `questCooldown` minutes.
//
// A player's quests: `player.quests` = { active: [quest], count: { npcKey: done }, cool: { npcKey: epoch ms }, next }.
// A quest: { id, giver (the npc's key), name, role, kind ('fetch' | 'lost' | 'till'), item, n, usd, text,
// spot? ({ x, y, z }: where a lost thing lies, or the middle of the ground to till), found? (lost), progress? (till) }.
// What someone offers is decided by their key, your character and how many jobs you've done for them
// (`offerSeed`), so asking twice gets the same answer. The game (game.js `_talk`, `_quest`) does the rest.
// Logic only: no Three.js, no DOM.

import { T, tune, bindTunable } from './tuning.js';
import { mulberry32 } from './noise.js';
import { itemCount, buildyHas, itemName } from './items.js';
import { FOUND_WHERE } from './forage.js';

tune('Quests', {
  maxQuests: [5, 'Quests at once', 'How many quests one player can have on the go', { min: 1, max: 20, step: 1 }],
  questCooldown: [5, 'Quest cooldown', 'Minutes after you finish a job for someone before they have another', { unit: ' min', min: 0, max: 120, step: 0.5 }],
  questReward: [150, 'Quest reward', 'What a fetching quest pays, compared with what the goods are worth', { unit: '%', min: 0, max: 1000, step: 10 }],
  questSize: [100, 'Quest size', 'How many things a fetching quest asks for, compared with normal', { unit: '%', min: 10, max: 500, step: 10 }],
  questLostUsd: [15, 'Lost item reward', 'Dollars for finding something a villager lost (paid in ZEC)', { unit: '$', min: 0, max: 500, step: 1 }],
  questLostRange: [28, 'Lost item distance', 'How far from the middle of the market square lost things turn up', { min: 8, max: 80, step: 1 }],
  questTillBlocks: [8, 'Blocks to till', 'How many blocks of ground a garden quest asks you to till', { min: 1, max: 64, step: 1 }],
  questTillUsd: [1.5, 'Tilling reward', 'Dollars per block of a garden quest (paid in ZEC)', { unit: '$', min: 0, max: 50, step: 0.5 }],
  questTillRadius: [5, 'Garden size', 'Tilling counts for a garden quest within this many blocks of its marker', { min: 2, max: 16, step: 1 }],
  questSkill: [10, 'Questing points', 'Questing skill points for each quest you finish', { min: 0, max: 200, step: 1 }],
});

/** Things villagers lose: 'lost:<key>' (a quest's item; you never carry it, you just find it). */
export const LOST_ITEMS = {
  ring: "Grandmother's Ring", locket: 'Silver Locket', spectacles: 'Reading Spectacles', key: 'Cellar Key',
  doll: 'Rag Doll', pipe: 'Carved Pipe', purse: 'Coin Purse', letter: 'Sealed Letter',
};
export const lostKind = (k) => `lost:${k}`;
export const lostName = (kind) => LOST_ITEMS[String(kind).slice(5)] ?? 'something';

/**
 * What each role asks for: [item kind, fewest, most, one, many]. What each is worth (`WORTH`, dollars, a
 * setting) sets the reward.
 */
const WANTS = {
  blacksmith: [['coal', 4, 8, 'lump of coal', 'lumps of coal'], ['ironore', 3, 6, 'iron ore', 'iron ore'], ['copperore', 3, 6, 'copper ore', 'copper ore'],
    ['silverore', 1, 3, 'silver ore', 'silver ore']],
  healer: [['mushroom', 3, 6, 'brown mushroom', 'brown mushrooms'], ['yarrow', 3, 6, 'sprig of yarrow', 'sprigs of yarrow'], ['mint', 3, 5, 'sprig of wild mint', 'sprigs of wild mint'],
    ['glowcap', 1, 3, 'glowcap', 'glowcaps'], ['garlic', 2, 4, 'bulb of garlic', 'bulbs of garlic'], ['thyme', 2, 4, 'bunch of thyme', 'bunches of thyme']],
  tavern: [['potato', 3, 6, 'potato', 'potatoes'], ['onion', 2, 5, 'onion', 'onions'], ['carrot', 3, 6, 'carrot', 'carrots'], ['cabbage', 1, 3, 'cabbage', 'cabbages'],
    ['wheat', 4, 8, 'sheaf of wheat', 'sheaves of wheat'], ['steak', 2, 4, 'raw steak', 'raw steaks'], ['milk', 1, 3, 'glass of milk', 'glasses of milk'],
    ['trout', 1, 3, 'raw trout', 'raw trout'], ['salmon', 1, 2, 'raw salmon', 'raw salmon']],
  fletcher: [['stick', 6, 12, 'stick', 'sticks'], ['feather', 4, 8, 'feather', 'feathers'], ['cord', 2, 4, 'length of cord', 'lengths of cord'], ['fiber', 6, 10, 'bundle of plant fiber', 'bundles of plant fiber']],
  wizard: [['glowcap', 2, 4, 'glowcap', 'glowcaps'], ['sulfur', 3, 6, 'lump of sulfur', 'lumps of sulfur'], ['silverore', 1, 3, 'silver ore', 'silver ore'], ['mushroom', 4, 6, 'brown mushroom', 'brown mushrooms']],
  villager: [['bread', 1, 2, 'loaf of bread', 'loaves of bread'], ['cookedsteak', 1, 2, 'cooked steak', 'cooked steaks'], ['roastbird', 1, 1, 'roast bird', 'roast birds'],
    ['cheese', 1, 2, 'cheese', 'cheeses'], ['bakedpotato', 1, 1, 'baked potato', 'baked potatoes']],
};
/** Dollars each thing is worth to the people who ask for it (fetching rewards are this × how many × the Quest reward setting). */
export const WORTH = {
  coal: 2, ironore: 4, copperore: 3, silverore: 10, mushroom: 2, yarrow: 1.5, mint: 1.5, glowcap: 8, garlic: 2, thyme: 2,
  potato: 2, onion: 2, carrot: 2, cabbage: 3, wheat: 1, steak: 4, milk: 3, trout: 4, salmon: 6,
  stick: 0.5, feather: 1.5, cord: 2, fiber: 0.5, sulfur: 3, bread: 4, cookedsteak: 9, roastbird: 8, cheese: 5, bakedpotato: 11,
};
/** Where to get things that aren't found by digging (FOUND_WHERE has those). */
const WHERE = {
  garlic: 'grown in a garden (seeds on CONSUME)', thyme: 'grown in a garden (seeds on CONSUME)', potato: 'grown in a garden (seeds on CONSUME)',
  onion: 'grown in a garden (seeds on CONSUME)', carrot: 'grown in a garden (seeds on CONSUME)', cabbage: 'grown in a garden (seeds on CONSUME)',
  wheat: 'cut from wild wheat', steak: 'from cows', milk: 'from a cow: hold a Bucket in your left hand and right-click one',
  trout: 'caught with a Fishing Rod', salmon: 'caught with a Fishing Rod',
  stick: 'dropped by leaves you break', fiber: 'found when you cut grass', cord: 'twisted from plant fiber (crafting, R)',
  bread: 'baked (recipe book, K)', cookedsteak: 'a raw steak cooked at a campfire or range', roastbird: 'a raw bird roasted at a campfire or range',
  cheese: 'sometimes dropped by cows', bakedpotato: 'baked (recipe book, K)',
};
export const whereToGet = (item) => FOUND_WHERE[item] ?? WHERE[item] ?? '';

/** What they say. `{n}` and `{item}` are filled in. */
const ASK = {
  blacksmith: ['The forge is hungry. Bring me {n} {item} and I\'ll make it worth your while.', 'I\'m short of {item} for an order of horseshoes. {n} would see me right.', 'Good steel starts with good stuff. Fetch me {n} {item}?'],
  healer: ['My shelves are bare. Could you gather {n} {item} for my remedies?', 'There\'s a fever going round the town. I need {n} {item} for the tonic.', 'A salve won\'t make itself. Bring me {n} {item}, would you?'],
  tavern: ['The cook\'s run out of {item}. Fetch me {n} and I\'ll pay you handsomely.', 'Big crowd tonight. I need {n} {item} for the stew pot.', 'If I don\'t get {n} {item} by supper, there\'ll be a riot in here.'],
  fletcher: ['I\'ve a rush order of arrows. Bring me {n} {item}?', 'You can\'t make a bow out of wishes. {n} {item}, if you can find them.', 'Every arrow needs its makings. I\'m after {n} {item}.'],
  wizard: ['For an experiment of some delicacy, I require {n} {item}. Don\'t ask.', 'My reagents are running low: {n} {item}, please. Quickly, before the stars move.', 'Bring me {n} {item}. The last apprentice who asked why is now a newt.'],
  villager: ['I\'m famished, and I can\'t cook to save my life. Could you bring me {n} {item}?', 'My cupboard is bare and my tummy is rumbling. {n} {item} would be lovely.'],
};
const LOST = ['I\'ve lost my {item} somewhere about the town and I\'ve looked everywhere! Would you have a look for me? Follow the shining beam.',
  'Oh, it\'s dreadful: my {item} went missing on my walk this morning. Would you look for me? Follow the beam.'];
const TILL = ['My back\'s not what it was. Would you till {n} blocks of ground for my garden, by the green marker? You\'ll need a Tiller.',
  'I\'d love a little vegetable patch. Could you till {n} blocks of ground for me, by the green marker? Use a Tiller.'];
const HELLO = {
  blacksmith: ['Mind the sparks.', 'Hot work, this.', 'Need something forged?'],
  healer: ['Are you well? You look a little peaky.', 'Rest, water, and a good tonic: that\'s my advice.', 'Hello, dear.'],
  tavern: ['Welcome, traveller! Pull up a stool.', 'Rooms are upstairs, ale is down here.', 'What\'ll it be?'],
  fletcher: ['Straight shafts, true flights.', 'Mind where you point that.', 'Arrows by the bundle, bows to order.'],
  wizard: ['Hmm? Oh. You.', 'Do not touch the glowing things.', 'The stars are restless tonight.'],
  villager: ['Lovely day for it.', 'Have you tried the stew at the tavern?', 'Mind the fountain, it\'s deeper than it looks.', 'Good day to you!'],
};
const THANKS = ['Wonderful! Here, you\'ve earned this.', 'Thank you kindly. Here\'s your reward.', 'Just what I needed. Much obliged!'];

/** The shape of `player.quests` for someone who's never done one. */
export const emptyQuests = () => ({ active: [], count: {}, cool: {}, next: 1 });

/** A saved `quests` made safe (anything odd is dropped). */
export function cleanQuests(s) {
  const q = emptyQuests();
  if (!s || typeof s !== 'object') return q;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const str = (v, n = 80) => typeof v === 'string' && v.length <= n;
  if (Array.isArray(s.active)) {
    for (const a of s.active.slice(0, 20)) {
      if (!a || !str(a.giver) || !str(a.name) || !(a.role in ASK) || !['fetch', 'lost', 'till'].includes(a.kind) || !str(a.item, 40) || !Number.isInteger(a.n) || !num(a.usd) || !Number.isInteger(a.id)) continue;
      if (a.kind === 'fetch' && !(a.item in WORTH)) continue;
      if (a.kind === 'lost' && !(a.item.slice(5) in LOST_ITEMS)) continue;
      const spot = a.spot && [a.spot.x, a.spot.y, a.spot.z].every(num) ? { x: a.spot.x, y: a.spot.y, z: a.spot.z } : null;
      if (a.kind !== 'fetch' && !spot) continue;
      q.active.push({ id: a.id, giver: a.giver, name: a.name, role: a.role, kind: a.kind, item: a.item, n: Math.max(1, a.n), usd: Math.max(0, a.usd),
        text: str(a.text, 400) ? a.text : '', ...(spot ? { spot } : {}), ...(a.kind === 'lost' ? { found: !!a.found } : {}),
        ...(a.kind === 'till' ? { progress: Number.isInteger(a.progress) ? Math.max(0, a.progress) : 0 } : {}) });
    }
  }
  for (const [k, v] of Object.entries(s.count || {})) if (str(k) && Number.isInteger(v) && v > 0) q.count[k] = v;
  for (const [k, v] of Object.entries(s.cool || {})) if (str(k) && num(v) && v > Date.now()) q.cool[k] = v;
  q.next = Math.max(Number.isInteger(s.next) ? s.next : 1, ...q.active.map((a) => a.id + 1));
  return q;
}

/** A number from a string (a seed for mulberry32). */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** What `npcKey` offers this character after `done` jobs for them: the same until something changes. */
export const offerSeed = (npcKey, token, done) => hashString(`${npcKey}|${token}|${done}`);
const pick = (list, rand) => list[Math.floor(rand() * list.length)];
const fill = (text, n, item) => text.replace('{n}', String(n)).replace('{item}', item);
const roundUsd = (v) => Math.max(0.5, Math.round(v * 2) / 2);

/**
 * A quest someone in `role` offers: { kind, item, n, usd, text, rand }. Lost things and gardens need a spot,
 * which the game picks with `rand` (the same seeded stream, so it's the same spot every time you ask). `seed`
 * is from `offerSeed`. `fetchOnly`: a villager asks for food (when there's nowhere to lose things or dig).
 */
export function questOffer(role, seed, fetchOnly = false) {
  const rand = mulberry32(seed);
  if (role === 'villager' && !fetchOnly) {
    const roll = rand();
    if (roll < 0.4) {
      const k = pick(Object.keys(LOST_ITEMS), rand);
      return { kind: 'lost', item: lostKind(k), n: 1, usd: roundUsd(T.questLostUsd), text: fill(pick(LOST, rand), 1, LOST_ITEMS[k].toLowerCase()), rand };
    }
    if (roll < 0.75) {
      const n = Math.max(1, Math.round(T.questTillBlocks));
      return { kind: 'till', item: 'tiller', n, usd: roundUsd(T.questTillUsd * n), text: fill(pick(TILL, rand), n, ''), rand };
    }
  }
  const [item, lo, hi, one, many] = pick(WANTS[role] || WANTS.villager, rand);
  const n = Math.max(1, Math.round((lo + Math.floor(rand() * (hi - lo + 1))) * T.questSize / 100));
  const where = whereToGet(item);
  const text = fill(pick(ASK[role] || ASK.villager, rand), n, n === 1 ? one : many) + (where ? ` (${cap(n === 1 ? one : many)}: ${where}.)` : '');
  return { kind: 'fetch', item, n, usd: roundUsd(WORTH[item] * n * T.questReward / 100), text, rand };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A few words on what a quest wants, for the quest log: "Bring 6 lumps of coal to Rook the Blacksmith". */
export function questGoal(q) {
  if (q.kind === 'lost') return q.found ? `Take the ${lostName(q.item)} back to ${q.name}` : `Find ${q.name.split(' ')[0]}'s ${lostName(q.item).toLowerCase()}`;
  if (q.kind === 'till') return `Till ${q.n} blocks of ground for ${q.name}'s garden`;
  const w = (WANTS[q.role] || []).find((x) => x[0] === q.item) || Object.values(WANTS).flat().find((x) => x[0] === q.item);
  return `Bring ${q.n} ${w ? (q.n === 1 ? w[3] : w[4]) : q.item} to ${q.name}`;
}

/** What whoever gave you a quest asks when you come back without it done. */
export function questAsk(q) {
  if (q.kind === 'lost') return `Any sign of my ${lostName(q.item).toLowerCase()}? Follow the beam.`;
  if (q.kind === 'till') return `How's my garden coming along? That's ${Math.min(q.n, q.progress || 0)} of ${q.n} blocks tilled. The green ring shows where.`;
  const w = Object.values(WANTS).flat().find((x) => x[0] === q.item);
  const what = w ? (q.n === 1 ? w[3] : w[4]) : q.item;
  return `Any luck? I still need ${q.n} ${what}.${whereToGet(q.item) ? ` (${cap(what)}: ${whereToGet(q.item)}.)` : ''}`;
}

/** How far along a quest is: { have, need } (fetching counts what you're carrying). */
export function questProgress(q, player) {
  if (q.kind === 'lost') return { have: q.found ? 1 : 0, need: 1 };
  if (q.kind === 'till') return { have: Math.min(q.n, q.progress || 0), need: q.n };
  const have = buildyHas(player, q.item) ? 0 : itemCount(player, q.item); // (a Buildy Boi's endless supply doesn't count)
  return { have: Math.min(q.n, have), need: q.n };
}
export const questReady = (q, player) => { const { have, need } = questProgress(q, player); return have >= need; };

/** Small talk: a hello for when there's no job to talk about, and thanks for one done. */
export const hello = (role, rand = Math.random) => pick(HELLO[role] || HELLO.villager, rand);
export const thanks = (rand = Math.random) => pick(THANKS, rand);

for (const k of Object.keys(WORTH)) bindTunable(WORTH, k, 'Quests', `questWorth_${k}`, `Quest worth: ${itemName(k)}`, 'Dollars one is worth to whoever asks for it in a quest', { unit: '$', min: 0, max: 200, step: 0.5 });
