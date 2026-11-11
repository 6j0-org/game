// Items: food and dishes, loot rolls, dropped items in the world, pickup.
// No Three.js dependency.

import { T, tune, bindTunable } from './tuning.js';
import { Body } from './body.js';
import { SOLID, LEAFY, PLANT, BLOCKS, HOTBAR, PRINTER, COLD_WALLET, BED, PLANKS, GLASS, BRICK, LAVA_LAMP, DOOR,
  STAIRS_PLANKS, STAIRS_STONE, SLAB_PLANKS, SLAB_STONE, FENCE, TRAPDOOR, LADDER, BLADES, isCrop,
  POTTERY_WHEEL, KILN, GLAZING_TABLE, CLAY_BLOCKS, isPottery, isLuminary } from './blocks.js';
import { GUNS, GRAPPLE, AMMO, grantAmmo } from './weapons.js';
import { SPELLS } from './spells.js';
import { FISH } from './fishing.js';
import { FOUND_WHERE } from './forage.js';

// Server settings (tuning.js): read the live values as T.key.
tune('Food & traits', {
  headacheSeconds: [20, 'Gluten headache', 'Seconds of headache when a gluten-intolerant player eats gluten', { unit: ' s' }],
  upsetSeconds: [24, 'Lactose trouble', 'Seconds of trouble when a lactose-intolerant player has dairy', { unit: ' s' }],
  upsetHit: [3, 'Lactose damage', "Damage right away from dairy, if you're intolerant"],
  upsetEvery: [4, 'Lactose damage interval', 'Then 1 more damage every this many seconds', { unit: ' s', min: 0.1 }],
  poopEvery: [1.6, 'Accident interval', 'Seconds between accidents while lactose trouble lasts', { unit: ' s', min: 0.1 }],
  upsetSpeed: [0.5, 'Lactose slowdown', 'Speed while lactose trouble lasts, compared with normal', { unit: '×' }],
  allergyRadius: [5, 'Pet allergy range', 'How close a pet has to be to set off allergies'],
  coughDamage: [1, 'Cough damage', 'Damage per allergy cough'],
  sneezeDamage: [2, 'Sneeze damage', 'Damage per allergy sneeze'],
  flapSeconds: [30, 'Flapping time', 'Seconds of flapping from a Roast Bird', { unit: ' s' }],
  fallHealMin: [4, 'Fall healing minimum', 'Falls of at least this many blocks heal fall healers'],
});
tune('Items & tools', {
  pickupRange: [1.3, 'Pickup range', 'How close you have to be to pick something up'],
  magnetRange: [3, 'Pickup pull range', 'Drops slide towards you from this far'],
  milkCooldown: [60, 'Milking interval', 'Seconds before a cow you milked has milk again', { unit: ' s', min: 0, max: 600, step: 5 }],
  dropLifetime: [300, 'Drop lifetime', 'Seconds before items on the ground vanish', { unit: ' s' }],
  sackGravity: [20, 'Hackysack drop', 'How fast a thrown hackysack falls'],
  sackSpeed: [16, 'Hackysack throw speed', 'Blocks per second'],
});

// `allergen`: eating it does nothing good if you have that intolerance (see game.js for what it does instead).
// `town`: sold only at that Fantasy Town shop. `cure`: clears ailments. `mana`: restores mana.
// `raw`: 'meat' or 'fish': heals less than cooked (cooking.js), and raw meat can upset your stomach.
// `cookedFrom`: the raw food it's made from. `ingredient`: not for eating on its own (it's for cooking).
export const FOOD = {
  steak: { name: 'Raw Steak', heal: 3, dishes: [], raw: 'meat' },
  liver: { name: 'Raw Liver', heal: 5, dishes: [], raw: 'meat' },
  bread: { name: 'Bread', heal: 5, dishes: [], allergen: 'gluten' },
  milk: { name: 'Glass of Milk', heal: 4, dishes: ['glass'], allergen: 'lactose' },
  cheese: { name: 'Cheese', heal: 7, dishes: [], allergen: 'lactose' },
  bird: { name: 'Raw Bird', heal: 1, dishes: [], raw: 'meat' },
  penguin: { name: 'Raw Penguin', heal: 3, dishes: [], raw: 'meat' },
  // Cooked at a campfire or range (cooking.js)
  cookedsteak: { name: 'Steak', heal: 8, dishes: ['plate', 'cutlery'], cookedFrom: 'steak' },
  friedliver: { name: 'Fried Liver', heal: 11, dishes: ['bowl'], cookedFrom: 'liver' },
  roastbird: { name: 'Roast Bird', heal: 3, dishes: ['plate'], flap: true, cookedFrom: 'bird' }, // and T.flapSeconds of flapping
  roastpenguin: { name: 'Roast Penguin', heal: 7, dishes: ['plate', 'cutlery'], flightless: true, cookedFrom: 'penguin' }, // a bird, technically
  // Ingredients (cooking.js): for recipes, not for eating as they are
  wheat: { name: 'Wheat', heal: 0, dishes: [], ingredient: true },
  yeast: { name: 'Yeast', heal: 0, dishes: [], ingredient: true },
  butter: { name: 'Butter', heal: 0, dishes: [], ingredient: true, allergen: 'lactose' },
  cornmeal: { name: 'Cornmeal', heal: 0, dishes: [], ingredient: true },
  water: { name: 'Bucket of Water', heal: 0, dishes: [], ingredient: true },
  oliveoil: { name: 'Olive Oil', heal: 0, dishes: [], ingredient: true },
  // Recipes (cooking.js)
  bakedpotato: { name: 'Baked Potato', heal: 10, dishes: ['plate'], allergen: 'lactose' },
  chips: { name: 'Tortilla Chips', heal: 3, dishes: [] },
  povertynachos: { name: 'Poverty Nachos', heal: 8, dishes: ['plate'], allergen: 'lactose' },
  timsnachos: { name: 'Tim\'s Nachos', heal: 13, dishes: ['plate'], allergen: 'lactose' },
  hummus: { name: 'Hummus', heal: 9, dishes: ['bowl'] },
  // The healer's
  potion: { name: 'Healing Potion', heal: 10, dishes: [], town: 'healer', drink: true },
  bigpotion: { name: 'Greater Healing Potion', heal: 25, dishes: [], town: 'healer', drink: true },
  antidote: { name: 'Antidote', heal: 0, dishes: [], town: 'healer', drink: true, cure: true },
  // The wizard's
  manapotion: { name: 'Mana Potion', heal: 0, dishes: [], town: 'wizard', drink: true, mana: 40 },
  // The tavern's
  stew: { name: 'Hearty Stew', heal: 9, dishes: ['bowl'], town: 'tavern' },
  pie: { name: 'Meat Pie', heal: 8, dishes: ['plate'], town: 'tavern', allergen: 'gluten' },
  honeycake: { name: 'Honey Cake', heal: 4, dishes: ['plate'], town: 'tavern', allergen: 'gluten' },
  ale: { name: 'Mug of Ale', heal: 2, dishes: ['glass'], town: 'tavern', drink: true, allergen: 'gluten' },
  mead: { name: 'Mug of Mead', heal: 3, dishes: ['glass'], town: 'tavern', drink: true },
  cider: { name: 'Mug of Cider', heal: 2, dishes: ['glass'], town: 'tavern', drink: true },
  // Grown in your garden (garden.js): pick a ripe plant
  garlic: { name: 'Garlic', heal: 2, dishes: [] },
  thyme: { name: 'Thyme', heal: 1, dishes: [] },
  okra: { name: 'Okra', heal: 4, dishes: [] },
  artichoke: { name: 'Artichoke', heal: 6, dishes: [] },
  cabbage: { name: 'Cabbage', heal: 7, dishes: [] },
  carrot: { name: 'Carrot', heal: 4, dishes: [] },
  onion: { name: 'Onion', heal: 3, dishes: [] },
  potato: { name: 'Potato', heal: 6, dishes: [] },
  pinto: { name: 'Pinto Beans', heal: 5, dishes: [] },
  pea: { name: 'Peas', heal: 4, dishes: [] },
  soy: { name: 'Soybeans', heal: 5, dishes: [] },
  chives: { name: 'Chives', heal: 1, dishes: [] },
  corn: { name: 'Corn', heal: 3, dishes: [] },
  jalapeno: { name: 'Jalapeño', heal: 1, dishes: [] },
  garbanzo: { name: 'Garbanzo Beans', heal: 3, dishes: [] },
  olive: { name: 'Olives', heal: 1, dishes: [] },
  // Caught with a Fishing Rod (fishing.js): raw, or grilled at a campfire or range
  ...Object.fromEntries(Object.entries(FISH).flatMap(([k, f]) => [
    [k, { name: `Raw ${f.name}`, heal: Math.max(1, Math.ceil(f.heal / 2)), dishes: [], fish: true, raw: 'fish' }],
    [`grilled${k}`, { name: `Grilled ${f.name}`, heal: f.heal + 1, dishes: ['plate'], fish: true, cookedFrom: k }],
  ])),
};
/** Ailments an Antidote clears. */
export const CURES = ['headache', 'upset', 'chill', 'hallucinate'];

export const DISHES = {
  plate: { name: 'Plate' },
  bowl: { name: 'Bowl' },
  cutlery: { name: 'Cutlery' },
  glass: { name: 'Glass' },
};

export const TRAITS = {
  gluten: { name: 'Gluten intolerant', icon: '🌾', chance: 0.25 },
  lactose: { name: 'Lactose intolerant', icon: '🥛', chance: 0.3 },
  fallHealing: { name: 'Fall healing', icon: '🪂', chance: 0.2 }, // big drops heal you instead of hurting
  lowGravity: { name: 'Gravity resistant', icon: '🎈', chance: 0.15 }, // half gravity, and no fall damage
};
/** Falls of at least this many blocks heal a fall-healing player 1 health per block beyond the first 3. */
export const fallHealFor = (drop) => (drop >= T.fallHealMin ? Math.floor(drop - T.fallSafe) : 0);
/** Falls of more than the safe height (a setting) hurt: 1 damage per block beyond it, times the fall damage setting. */
export const fallDamageFor = (drop, mult = 1) => (drop > T.fallSafe + 0.5 ? Math.floor((drop - T.fallSafe) * mult) : 0);

/** A fresh set of traits for a new life. */
export function rollTraits(rand = Math.random) {
  return Object.fromEntries(Object.entries(TRAITS).map(([k, t]) => [k, rand() < t.chance]));
}

// Printable tools. `usd` is the price in dollars; you pay the printer in Zcash at the current rate.
export const TOOLS = {
  shovel: { name: 'Shovel', usd: 30, desc: 'Digs dirt, grass and sand 5x faster', damage: 6, knock: 7 },
  pick: { name: 'Pick', usd: 50, desc: 'Breaks stone and brick 5x faster', damage: 7, knock: 7 },
  axe: { name: 'Axe', usd: 40, desc: 'Chops logs and planks 5x faster', damage: 8, knock: 8 },
  sword: { name: 'Sword', usd: 60, desc: '12 damage per hit, and cuts leaves fast', damage: 12, knock: 9 },
  pillow: { name: 'Couch Pillow', usd: 20, desc: 'PvP: only 1 damage, but sends them flying', damage: 1, knock: 22 },
  hackysack: { name: 'Hackysack', usd: 10, desc: 'PvP: throw it, it bounces, pick it back up', damage: 1, knock: 4, throwDamage: 3, throwKnock: 10 },
  flashlight: { name: 'Flashlight', usd: 25, desc: 'Lights up the dark in front of you while you hold it', damage: 2, knock: 3 },
  // Guns (see weapons.js). Clicking at close range still works as a clumsy club.
  ...Object.fromEntries(Object.entries(GUNS).map(([k, g]) => [k, { name: g.name, usd: g.usd, desc: g.twoHanded ? `${g.desc} Two-handed.` : g.desc, damage: 3, knock: 4, gun: true, twoHanded: !!g.twoHanded, ...(g.town ? { town: g.town } : {}) }])),
  grapple: { name: GRAPPLE.name, usd: GRAPPLE.usd, desc: GRAPPLE.desc, damage: 2, knock: 3, grapple: true },
  wand: { name: 'Wand', usd: 150, desc: 'Cast spells with it: magic is 25% stronger (scroll to pick a spell)', damage: 2, knock: 3, magic: true },
  staff: { name: 'Staff', usd: 300, desc: 'Cast spells with it: magic is 50% stronger. Two-handed.', damage: 4, knock: 6, magic: true, twoHanded: true },
  // Fantasy Town wares (`town`: the shop that sells them; you can't print them or order them).
  dagger: { name: 'Dagger', usd: 25, desc: 'Light and cheap: 8 damage per hit, and cuts leaves fast', damage: 8, knock: 5, blade: true, town: 'blacksmith' },
  longsword: { name: 'Longsword', usd: 140, desc: '16 damage per hit, and cuts leaves fast', damage: 16, knock: 10, blade: true, town: 'blacksmith' },
  greatsword: { name: 'Greatsword', usd: 260, desc: 'Left button: a wide horizontal slash through everything in front of you. Right button: an overhead chop, slow but brutal. Two-handed.', damage: 24, knock: 16, blade: true, twoHanded: true, town: 'blacksmith', attacks: { left: 'sweep', right: 'chop' } },
  leather: { name: 'Leather Armor', usd: 50, desc: 'Click to put it on: every hit hurts 15% less', damage: 1, knock: 2, armor: 15, speed: 100, town: 'blacksmith' },
  chainmail: { name: 'Chainmail', usd: 140, desc: 'Click to put it on: every hit hurts 30% less', damage: 1, knock: 2, armor: 30, speed: 100, town: 'blacksmith' },
  platearmor: { name: 'Plate Armor', usd: 320, desc: 'Click to put it on: every hit hurts 50% less, but you walk 10% slower', damage: 1, knock: 2, armor: 50, speed: 90, town: 'blacksmith' },
  runewand: { name: 'Rune Wand', usd: 260, desc: 'Cast spells with it: magic is 60% stronger', damage: 2, knock: 3, magic: true, town: 'wizard' },
  // Gardening (garden.js)
  tiller: { name: 'Tiller', usd: 35, desc: 'Click dirt or grass to till a row of it, ready for seeds', damage: 4, knock: 5, garden: true },
  sprayer: { name: 'Sprayer', usd: 30, desc: 'Click your garden to water it: watered crops grow overnight', damage: 1, knock: 2, garden: true },
  bucket: { name: 'Bucket', usd: 15, desc: 'Hold it in your left hand and right-click a cow to milk it', damage: 2, knock: 4 },
  // Crafted (crafting.js): not printed or sold. Stone tools mine like the tools they're named after, more slowly.
  stoneaxe: { name: 'Stone Axe', usd: 0, desc: 'Crafted: chops logs and planks faster (not as fast as a real axe)', damage: 6, knock: 6, crafted: true },
  stonepick: { name: 'Stone Pick', usd: 0, desc: 'Crafted: breaks stone and brick faster (not as fast as a real pick)', damage: 5, knock: 6, crafted: true },
  stoneshovel: { name: 'Stone Shovel', usd: 0, desc: 'Crafted: digs dirt, grass and sand faster (not as fast as a real shovel)', damage: 4, knock: 6, crafted: true },
  stoneknife: { name: 'Stone Knife', usd: 0, desc: 'Crafted: 7 damage per hit, and cuts leaves fast', damage: 7, knock: 4, blade: true, crafted: true },
  stonespear: { name: 'Stone Spear', usd: 0, desc: 'Crafted: 10 damage per hit and a good shove', damage: 10, knock: 10, crafted: true },
  rod: { name: 'Fishing Rod', usd: 25, desc: 'Click water to cast; click again the moment the bobber dips to reel in a fish', damage: 2, knock: 3, fishing: true },
  weedtorch: { name: 'Weed Torch', usd: 45, desc: 'Click your garden to burn off the weeds (left to grow, they halve your harvest)', damage: 3, knock: 3, garden: true },
  archstaff: { name: 'Archmage Staff', usd: 600, desc: 'Cast spells with it: magic is 120% stronger. Two-handed.', damage: 5, knock: 7, magic: true, twoHanded: true, town: 'wizard' },
};
for (const [k, t] of Object.entries(TOOLS)) if (t.blade) BLADES.add(k);
export const HAND = { name: 'Hand', damage: 5, knock: 7 };

/** Crafting materials (crafting.js): `player.materials`. Gathered from trees and grass, or crafted. */
export const MATERIALS = {
  stick: { name: 'Stick', desc: 'From leaves (sometimes) and planks: handles for stone tools' },
  fiber: { name: 'Plant Fiber', desc: 'From grass (sometimes): twist three into cord' },
  cord: { name: 'Cord', desc: 'Lashes a stone head to a stick' },
  axehead: { name: 'Stone Axe Head', desc: 'Knapped from stone: for a Stone Axe' },
  pickhead: { name: 'Stone Pick Head', desc: 'Knapped from stone: for a Stone Pick' },
  shovelhead: { name: 'Stone Shovel Head', desc: 'Knapped from stone: for a Stone Shovel' },
  blade: { name: 'Stone Blade', desc: 'Knapped from stone: for a Stone Knife or Spear' },
  // Found while mining and digging (forage.js): what the Fantasy Town's shopkeepers ask for (quests.js). `found`: not for crafting.
  coal: { name: 'Lump of Coal', desc: 'The blacksmith burns it in the forge', found: true },
  ironore: { name: 'Iron Ore', desc: 'The blacksmith smelts it into iron', found: true },
  copperore: { name: 'Copper Ore', desc: 'The blacksmith smelts it into copper', found: true },
  silverore: { name: 'Silver Ore', desc: 'Precious: the blacksmith and the wizard both want it', found: true },
  sulfur: { name: 'Sulfur', desc: 'Smells of rotten eggs. The wizard wants it', found: true },
  yarrow: { name: 'Yarrow', desc: 'A herb: the healer makes salves from it', found: true },
  mint: { name: 'Wild Mint', desc: 'A herb: the healer brews it into tonics', found: true },
  mushroom: { name: 'Brown Mushroom', desc: 'The healer brews potions from mushrooms', found: true },
  glowcap: { name: 'Glowcap', desc: 'A rare mushroom that glows: the healer and the wizard prize it', found: true },
  feather: { name: 'Feather', desc: 'The fletcher fletches arrows with them', found: true },
};
for (const [k, m] of Object.entries(MATERIALS)) if (m.found) m.desc = `${m.desc} (${FOUND_WHERE[k]})`;

/**
 * Blocks you can print (outside Buildy Boi mode you only have the blocks you've mined or printed).
 * `n` blocks per print for `usd` dollars, paid in ZEC like tools. Natural blocks (dirt, stone, logs...) come from mining.
 */
export const BLOCK_PRINTS = {
  [PLANKS]: { usd: 3, n: 8 }, [GLASS]: { usd: 3, n: 4 }, [BRICK]: { usd: 4, n: 8 },
  [STAIRS_PLANKS]: { usd: 4, n: 4 }, [STAIRS_STONE]: { usd: 4, n: 4 }, [SLAB_PLANKS]: { usd: 3, n: 8 }, [SLAB_STONE]: { usd: 3, n: 8 },
  [FENCE]: { usd: 5, n: 6 }, [LADDER]: { usd: 4, n: 6 }, [TRAPDOOR]: { usd: 5, n: 2 }, [DOOR]: { usd: 8, n: 1 },
  [LAVA_LAMP]: { usd: 15, n: 1 }, [BED]: { usd: 20, n: 1 }, [COLD_WALLET]: { usd: 50, n: 1 }, [PRINTER]: { usd: 100, n: 1 },
  [POTTERY_WHEEL]: { usd: 40, n: 1 }, [KILN]: { usd: 60, n: 1 }, [GLAZING_TABLE]: { usd: 30, n: 1 },
};
/** What a new player starts with: nothing but the phone (which everyone always has). */
export const STARTING_BLOCKS = {};
/** Printable things: tool names, ammo boxes ('ammo:<type>') and 'block:<id>' (not the Fantasy Town's wares). */
export const printable = (kind) => (kind in TOOLS && !TOOLS[kind].town && !TOOLS[kind].crafted) || (!!ammoOf(kind) && !AMMO[ammoOf(kind)].town) || (blockIdOf(kind) !== null && blockIdOf(kind) in BLOCK_PRINTS);
export const printUsd = (kind) => (kind in TOOLS ? TOOLS[kind].usd : ammoOf(kind) ? AMMO_USD[ammoOf(kind)] : BLOCK_PRINTS[blockIdOf(kind)]?.usd);

// ---------- CONSUME: the phone shop ----------
// Everything can be ordered from your phone. It's charged like a print (dollars, paid in ZEC at the
// rate of the moment) plus a delivery fee, and a drone brings it after the delivery time (both are settings).
const FOOD_USD = { steak: 6, liver: 5, bread: 3, milk: 3, cheese: 4, bird: 8, penguin: 7, yeast: 2, butter: 3 };
const AMMO_USD = { bullets: 8, shells: 8, rockets: 20, slugs: 15, cells: 12, arrows: 6, rifle: 15 };
const RAW_BLOCKS = { usd: 2, n: 8 }; // natural blocks you'd otherwise mine
const SEEDS = { usd: 3, n: 4 }; // a packet of seeds on CONSUME
export const ammoKind = (type) => `ammo:${type}`;
const ammoOf = (kind) => (typeof kind === 'string' && kind.startsWith('ammo:') && kind.slice(5) in AMMO ? kind.slice(5) : null);
/** What one order of `kind` costs in dollars (before fees and haggling) and how many you get, or null. */
export function shopOffer(kind) {
  if (kind in TOOLS) return TOOLS[kind].town || TOOLS[kind].crafted ? null : { usd: TOOLS[kind].usd, n: 1 };
  if (kind in FOOD_USD) return { usd: FOOD_USD[kind], n: 1 };
  const ammo = ammoOf(kind);
  if (ammo) return AMMO[ammo].town ? null : { usd: AMMO_USD[ammo], n: AMMO[ammo].box };
  const id = blockIdOf(kind);
  if (id !== null && isCrop(id)) return SEEDS; // a packet of seeds
  if (id !== null && isPottery(id)) return null; // pottery is made, not bought
  if (id !== null && HOTBAR.includes(id)) return BLOCK_PRINTS[id] || RAW_BLOCKS;
  return null;
}
/** The CONSUME catalogue, in display order: { kind, name, category, usd, n }. */
export function shopCatalog() {
  const list = [];
  const add = (kind, category, name = itemName(kind)) => { if (shopOffer(kind)) list.push({ kind, name, category, ...shopOffer(kind) }); }; // (not the Fantasy Town's wares)
  for (const [k, def] of Object.entries(TOOLS)) add(k, def.gun ? 'Weapons' : def.magic ? 'Magic' : 'Tools');
  for (const k of Object.keys(AMMO)) add(ammoKind(k), 'Ammo');
  for (const k of Object.keys(FOOD_USD)) add(k, 'Food');
  for (const id of HOTBAR) add(blockKind(id), isCrop(id) ? 'Seeds' : 'Blocks');
  return list;
}
/** Puts one print, order or purchase of `kind` into the player's inventory. Returns how many items that was. */
export function grantItem(player, kind, offer = shopOffer(kind)) {
  if (!offer) return 0;
  const id = blockIdOf(kind);
  const ammo = ammoOf(kind);
  const spell = scrollOf(kind);
  if (id !== null) player.blocks[id] = (player.blocks[id] || 0) + offer.n;
  else if (ammo) player.ammo[ammo] = (player.ammo[ammo] || 0) + offer.n;
  else if (spell) player.scrolls[spell] = (player.scrolls[spell] || 0) + offer.n;
  else if (kind in TOOLS) player.tools[kind] = (player.tools[kind] || 0) + 1;
  else if (kind in FOOD) player.food[kind] = (player.food[kind] || 0) + 1;
  return offer.n;
}

// ---------- the Fantasy Town's shops ----------
// Right-click a shop's counter (blocks.js SHOP_COUNTER) to buy, paid in ZEC at the moment's rate like a print,
// with no fee and no wait. Their wares (`town` above, scrolls, arrows) are sold nowhere else.
const TOWN_FOOD_USD = { potion: 12, bigpotion: 30, antidote: 10, manapotion: 15, stew: 7, pie: 6, honeycake: 4, ale: 3, mead: 4, cider: 3 };
const SCROLL_USD = { fireball: 10, missile: 12, icebolt: 12, blizzard: 40, lightning: 30, shrink: 25, enlarge: 25, polymorph: 35, hallucinate: 25, stoneskin: 20, invisibility: 25, flight: 35, teleport: 25, dragon: 30, blind: 20 };
/** Spell scrolls: 'scroll:<spell>'. Reading one casts its spell for free (no mana) and uses it up. */
export const scrollKind = (spell) => `scroll:${spell}`;
export const scrollOf = (kind) => (typeof kind === 'string' && kind.startsWith('scroll:') && kind.slice(7) in SPELLS ? kind.slice(7) : null);
export const SHOPS = {
  blacksmith: { name: 'Blacksmith', greeting: 'Steel for the road. Swords and armor, forged here.', wares: ['dagger', 'sword', 'longsword', 'greatsword', 'leather', 'chainmail', 'platearmor'] },
  healer: { name: 'Healer', greeting: 'Potions to mend you, and an antidote for what ails you.', wares: ['potion', 'bigpotion', 'antidote'] },
  tavern: { name: 'Tavern', greeting: 'Food, drink, and a bed upstairs: right-click one to sleep there (it becomes your spawn point). Baking? We sell yeast and butter.', wares: ['stew', 'pie', 'bread', 'cheese', 'honeycake', 'ale', 'mead', 'cider', 'milk', 'yeast', 'butter'] },
  fletcher: { name: 'Fletcher', greeting: 'Bows strung to order, and arrows by the bundle.', wares: ['shortbow', 'longbow', 'crossbow', ammoKind('arrows')] },
  wizard: { name: 'Wizard', greeting: 'Wands, staves, and scrolls. Read a scroll to learn its spell for good; read one of a spell you know to cast it without any mana.', wares: ['wand', 'staff', 'runewand', 'archstaff', 'manapotion', ...Object.keys(SPELLS).map(scrollKind)] },
};
/** What `kind` costs at `shop` in dollars (before haggling) and how many you get, or null if it isn't sold there. */
export function townOffer(shop, kind) {
  if (!SHOPS[shop]?.wares.includes(kind)) return null;
  if (kind in TOOLS) return { usd: TOOLS[kind].usd, n: 1 };
  if (kind in TOWN_FOOD_USD) return { usd: TOWN_FOOD_USD[kind], n: 1 };
  if (kind in FOOD_USD) return { usd: FOOD_USD[kind], n: 1 };
  const ammo = ammoOf(kind);
  if (ammo) return { usd: AMMO_USD[ammo], n: AMMO[ammo].box };
  const spell = scrollOf(kind);
  if (spell) return { usd: SCROLL_USD[spell], n: 1 };
  return null;
}
/** A shop's wares, in display order: { kind, name, category, desc, usd, n }. */
export function townCatalog(shop) {
  return (SHOPS[shop]?.wares || []).map((kind) => {
    const spell = scrollOf(kind);
    const food = FOOD[kind];
    const category = spell ? 'Scrolls' : TOOLS[kind]?.armor ? 'Armor' : TOOLS[kind]?.magic ? 'Magic' : kind in TOOLS || ammoOf(kind) ? 'Weapons' : food?.drink ? 'Drink' : 'Food';
    const desc = spell ? `Read it to cast ${SPELLS[spell].name} without mana: ${SPELLS[spell].desc}`
      : TOOLS[kind]?.desc ?? (ammoOf(kind) ? 'A bundle of arrows for your bow' : foodDesc(kind));
    return { kind, name: itemName(kind), category, desc, ...townOffer(shop, kind) };
  });
}
/** What a food or drink does, in a few words. */
export function foodDesc(kind) {
  const f = FOOD[kind];
  if (!f) return '';
  const bits = [];
  if (f.heal > 0) bits.push(`+${f.heal} health`);
  if (f.cure) bits.push('cures headaches, tummy trouble, chills and hallucinations');
  if (f.mana) bits.push(`+${f.mana} mana`);
  if (f.allergen) bits.push(`contains ${f.allergen}`);
  return bits.join(', ');
}
// ---------- every item, for /give ----------
const compact = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * Every item kind there is, as { kind, name, word }: `word` is a short id to type (a tool or food's key,
 * a block's or ammo's name in one word, 'scroll:<spell>'). Dishes are dirty ones; 'zcash' is ZEC.
 */
export function allItems() {
  const list = [];
  const add = (kind, word) => list.push({ kind, name: kind === 'zcash' ? 'Zcash (ZEC)' : itemName(kind), word });
  for (const k of Object.keys(TOOLS)) add(k, k);
  for (const k of Object.keys(FOOD)) add(k, k);
  for (const k of Object.keys(DISHES)) add(k, k);
  for (const k of Object.keys(MATERIALS)) add(k, k);
  for (const k of Object.keys(AMMO)) list.push({ kind: ammoKind(k), name: AMMO[k].name, word: k }); // (/give counts rounds, not boxes)
  for (const k of Object.keys(SPELLS)) add(scrollKind(k), `scroll:${k}`);
  for (const id of HOTBAR) add(blockKind(id), compact(BLOCKS[id].name));
  add('zcash', 'zcash');
  return list;
}
/**
 * Finds an item from what someone typed (any case and spacing): its word, kind or full name exactly, or else
 * the only one whose word or name starts with it. Returns { item } or { matches } (none, or several).
 */
export function findItem(text) {
  const q = compact(text);
  if (!q) return { matches: [] };
  const all = allItems();
  const exact = all.find((i) => compact(i.word) === q || compact(i.kind) === q || compact(i.name) === q);
  if (exact) return { item: exact };
  const starts = all.filter((i) => compact(i.word).startsWith(q) || compact(i.name).startsWith(q));
  return starts.length === 1 ? { item: starts[0] } : { matches: starts };
}
/** How many /give hands out when no count is given: a box of ammo, a stack of blocks, otherwise one. */
export const giveDefault = (kind) => (ammoOf(kind) ? AMMO[ammoOf(kind)].box : blockIdOf(kind) !== null ? 64 : 1);
/** Adds `n` of `kind` to a player's inventory (ammo: rounds; zcash: ZEC). Returns false if it isn't an item. */
export function giveItem(player, kind, n) {
  const id = blockIdOf(kind);
  const ammo = ammoOf(kind);
  const spell = scrollOf(kind);
  const add = (inv, k) => { inv[k] = (inv[k] || 0) + n; };
  if (kind === 'zcash') player.wallet.zcash = Math.round((player.wallet.zcash + n) * 100) / 100;
  else if (id !== null && HOTBAR.includes(id)) add(player.blocks, id);
  else if (ammo) add(player.ammo, ammo);
  else if (spell) add(player.scrolls, spell);
  else if (kind in TOOLS) add(player.tools, kind);
  else if (kind in FOOD) add(player.food, kind);
  else if (kind in DISHES) add(player.dishes, kind);
  else if (kind in MATERIALS) add(player.materials, kind);
  else return false;
  return true;
}

/** Armor: click it to put it on (game.js `_wear`). */
export const isArmor = (kind) => !!TOOLS[kind]?.armor;

/** Which player inventory an item kind goes into. */
export const itemGroup = (kind) =>
  kind === 'zcash' ? 'wallet' : kind in FOOD ? 'food' : kind in TOOLS ? 'tools' : kind in MATERIALS ? 'materials' : 'dishes';

const MAX_LOOSE_COINS = 9;
/** What one coin is worth: 0.01 to 1.00 ZEC, in cents. */
export const coinValue = (rand = Math.random) => Math.round((T.coinMin + rand() * (T.coinMax - T.coinMin)) * 100) / 100;


/** What a cow drops: meat (usually 1-2 steak, sometimes a liver), and usually some dairy. */
export function rollCowLoot(rand = Math.random) {
  const loot = rand() < T.cowLiver ? ['liver'] : rand() < T.cowDoubleSteak ? ['steak', 'steak'] : ['steak'];
  if (rand() < T.cowDairy) loot.push(rand() < T.cowMilk ? 'milk' : 'cheese');
  return loot;
}

/** Greasy Seed Oils sometimes leave a dirty dish behind. */
export function rollSeedOilLoot(rand = Math.random) {
  if (rand() >= T.seedOilDish) return [];
  const kinds = Object.keys(DISHES);
  return [kinds[Math.floor(rand() * kinds.length)]];
}

/** Hostile mobs sometimes drop a coin or two. `mult` scales the chance (the loot setting). */
export function rollCoinLoot(rand = Math.random, mult = 1) {
  if (rand() >= T.lootCoin * mult) return [];
  return rand() < T.lootDoubleCoin ? ['zcash', 'zcash'] : ['zcash'];
}

// ---------- hands & inventory ----------
// Items are identified by a "kind" string: 'empty', 'phone', a tool/food/dish name (the Wand and Staff are the tools 'wand' and 'staff'), or 'block:<id>'.
export const blockKind = (id) => `block:${id}`;
export const blockIdOf = (kind) => (typeof kind === 'string' && kind.startsWith('block:') ? Number(kind.slice(6)) : null);
export const isMiningKind = (kind) =>
  kind === 'empty' || (kind in TOOLS && kind !== 'hackysack' && !TOOLS[kind].gun && !TOOLS[kind].grapple && !TOOLS[kind].magic && !TOOLS[kind].armor && !TOOLS[kind].garden && !TOOLS[kind].fishing);
export const isGun = (kind) => !!TOOLS[kind]?.gun;
/** Two-handed items fill both hands at once. */
export const isTwoHanded = (kind) => !!TOOLS[kind]?.twoHanded;

/**
 * Two-handed melee weapons attack differently with each button (`attacks` on the tool): 'sweep' is a horizontal
 * slash that hits everything in an arc in front of you, 'chop' an overhead slash at one target. Null for an
 * ordinary swing.
 */
export const meleeStyle = (kind, hand) => TOOLS[kind]?.attacks?.[hand] ?? null;

/** Damage/knockback when hitting with this item. */
export const itemStats = (kind) => TOOLS[kind] || HAND;

/**
 * Buildy Bois have every item, as many as they like: blocks, tools and weapons (the Fantasy Town's too),
 * food, scrolls and ammo, and using one never uses it up (see `spend`). Not dirty dishes (nobody wants those).
 */
export const buildyHas = (player, kind) => !!player.buildy && (blockIdOf(kind) !== null || kind in TOOLS || kind in FOOD || kind in MATERIALS || !!scrollOf(kind) || !!ammoOf(kind));
/** Uses up `n` of something from an inventory (`inv`: 'tools', 'food', 'scrolls', 'ammo', 'blocks'), unless you're a Buildy Boi. */
export function spend(player, inv, key, n = 1) {
  if (player.buildy) return;
  player[inv][key] = Math.max(0, (player[inv][key] || 0) - n);
}
/** Rounds of an ammo type you have (Infinity for Buildy Bois). */
export const ammoCount = (player, type) => (player.buildy ? Infinity : player.ammo?.[type] || 0);

/** How many of an item you have (Infinity for things you never run out of). */
export function itemCount(player, kind) {
  if (kind === 'empty' || kind === 'phone') return Infinity;
  if (buildyHas(player, kind)) return Infinity; // Buildy Bois have everything
  const ammo = ammoOf(kind);
  if (ammo) return player.ammo?.[ammo] || 0;
  const id = blockIdOf(kind);
  if (id !== null) return player.blocks?.[id] || 0;
  if (kind in TOOLS) return player.tools[kind] || 0;
  if (kind in FOOD) return player.food[kind] || 0;
  if (kind in DISHES) return player.dishes[kind] || 0;
  if (kind in MATERIALS) return player.materials?.[kind] || 0;
  const spell = scrollOf(kind);
  if (spell) return player.scrolls?.[spell] || 0;
  return 0;
}

export function itemName(kind) {
  if (kind === 'empty') return 'Empty hand';
  if (kind === 'phone') return 'Phone';
  if (ammoOf(kind)) return `${AMMO[ammoOf(kind)].name} (box of ${AMMO[ammoOf(kind)].box})`;
  const id = blockIdOf(kind);
  if (id !== null) return BLOCKS[id]?.name ?? 'Block';
  if (kind in DISHES) return `Dirty ${DISHES[kind].name.toLowerCase()}`;
  const spell = scrollOf(kind);
  if (spell) return `Scroll of ${SPELLS[spell].name}`;
  return (TOOLS[kind] || FOOD[kind] || MATERIALS[kind])?.name ?? kind;
}

/**
 * Everything you can put in a hand right now, in display order. Pass `hand` ('left'/'right') to mark
 * items whose only copy is in the other hand (`inOtherHand`); picking one moves it across.
 */
export function inventoryList(player, hand = null) {
  const list = [
    { kind: 'empty', category: 'Hand', desc: 'Punch and mine (with no spell picked), or cast the spell you picked with the scroll wheel' },
    { kind: 'phone', category: 'Gadget', desc: 'Click to use it: order anything from CONSUME, delivered by drone' },
  ];
  for (const [k, def] of Object.entries(TOOLS)) {
    if (!(itemCount(player, k) > 0)) continue;
    const gun = GUNS[k];
    const rounds = ammoCount(player, gun?.ammo);
    const desc = gun ? `${def.desc} (${rounds === Infinity ? '∞' : rounds} ${AMMO[gun.ammo].name.toLowerCase()})` : def.desc;
    list.push({ kind: k, category: gun || def.blade ? 'Weapon' : def.magic ? 'Magic' : def.armor ? 'Armor' : def.garden ? 'Garden' : def.fishing ? 'Fishing' : 'Tool', desc });
  }
  for (const [k, def] of Object.entries(FOOD)) {
    if (!(itemCount(player, k) > 0)) continue;
    const bad = def.allergen && player.traits?.[def.allergen];
    const heal = player.healFor ? player.healFor(k) : def.heal;
    const what = [heal > 0 ? `+${heal} health` : '', def.cure ? 'cures ailments' : '', def.mana ? `+${def.mana} mana` : ''].filter(Boolean).join(', ');
    if (def.ingredient) { list.push({ kind: k, category: 'Ingredient', desc: 'For cooking: see the recipe book (K)' }); continue; }
    const rawNote = def.raw === 'meat' ? ' (raw: cook it at a campfire or range; raw meat can upset your stomach)' : def.raw ? ' (raw: grill it at a campfire or range to heal more)' : '';
    list.push({ kind: k, category: def.drink ? 'Drink' : 'Food', desc: bad ? `⚠ You're ${TRAITS[def.allergen].name.toLowerCase()}!` : `Click to ${def.drink ? 'drink' : 'eat'}: ${what}${rawNote}` });
  }
  for (const spell of Object.keys(SPELLS)) {
    if (itemCount(player, scrollKind(spell)) > 0) list.push({ kind: scrollKind(spell), category: 'Scroll', desc: player.spells?.includes(spell) || player.buildy ? `Click to read it: casts ${SPELLS[spell].name} for free (used up)` : `Click to read it: learn ${SPELLS[spell].name} (used up), then cast it with mana` });
  }
  for (const [k, def] of Object.entries(MATERIALS)) {
    if (itemCount(player, k) > 0) list.push({ kind: k, category: 'Material', desc: def.found ? def.desc : `${def.desc} (crafting: R)` });
  }
  for (const [k, def] of Object.entries(DISHES)) {
    if (player.dishes[k] > 0) list.push({ kind: k, category: 'Dish', desc: 'Hold the button near water to wash it: +1 Dishwash' });
  }
  for (const id of HOTBAR) {
    if (!player.buildy && !(player.blocks?.[id] > 0)) continue;
    list.push({ kind: blockKind(id), category: isCrop(id) ? 'Seeds' : isPottery(id) ? 'Pottery' : 'Block', desc: isCrop(id) ? 'Plant it on tilled dirt (Tiller), water it (Sprayer), keep the weeds off (Weed Torch)'
      : isLuminary(id) ? 'Place it, then right-click it to light it or put it out'
      : isPottery(id) ? 'Click to place it'
      : CLAY_BLOCKS.includes(id) ? 'Shape it on a Pottery Wheel (or place it as a block)'
      : id === POTTERY_WHEEL ? 'Place it, then right-click it to throw clay into mugs, vases, plates, bowls and luminaries, and to trim them'
      : id === KILN ? 'Place it, then right-click it to bisque-fire trimmed pots and glaze-fire glazed ones'
      : id === GLAZING_TABLE ? 'Place it, then right-click it to glaze bisque pottery with a coloured pattern'
      : id === PRINTER ? 'Place it, then right-click it to print tools'
      : id === COLD_WALLET ? 'Place it, then right-click it to keep Zcash safe from death'
        : id === BED ? 'Place it (2 blocks long), then right-click it to respawn there' : 'Click to place' });
  }
  const other = hand === 'left' ? 'right' : hand === 'right' ? 'left' : null;
  for (const item of list) {
    item.name = itemName(item.kind);
    item.count = itemCount(player, item.kind);
    item.inOtherHand = !!other && player.hands[other] === item.kind && item.count < 2 && !isTwoHanded(item.kind) ? other : null;
  }
  return list;
}

/** Search: items whose name (or any word in it) starts with the query come first, then other matches. */
export function filterItems(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const starts = [];
  const contains = [];
  for (const item of list) {
    const name = item.name.toLowerCase();
    if (name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))) starts.push(item);
    else if (name.includes(q) || item.category.toLowerCase().startsWith(q)) contains.push(item);
  }
  return [...starts, ...contains];
}

/** Shell-style completion: the full name if one item matches, else the longest shared prefix. */
export function tabComplete(list, query) {
  const q = query.toLowerCase();
  const names = list.map((i) => i.name).filter((n) => n.toLowerCase().startsWith(q));
  if (!names.length) return null;
  let len = names[0].length;
  for (const n of names) {
    let i = 0;
    while (i < len && i < n.length && n[i].toLowerCase() === names[0][i].toLowerCase()) i++;
    len = i;
  }
  return names[0].slice(0, len);
}


/** Thrown hackysacks: they arc, bounce off blocks, and land as a pick-up-able drop. */
export class Throwables {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.nextId = 1;
  }

  throw(origin, dir, owner = null) {
    const s = {
      id: this.nextId++,
      owner, // who threw it (can't hit themselves)
      pos: { ...origin },
      vel: { x: dir.x * T.sackSpeed, y: dir.y * T.sackSpeed + 2, z: dir.z * T.sackSpeed },
      age: 0,
      bounces: 0,
    };
    this.list.push(s);
    return s;
  }

  _solidAt(p) {
    return SOLID[this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))];
  }

  /**
   * `mobAt(pos)` returns a mob at that point or null.
   * Returns events: { type: 'hit', mob, x, y, z, vel } and { type: 'land', x, y, z }.
   */
  update(dt, mobAt) {
    const events = [];
    this.list = this.list.filter((s) => {
      s.age += dt;
      s.vel.y -= T.sackGravity * dt;
      const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
      const steps = Math.max(1, Math.ceil((speed * dt) / 0.2));
      for (let i = 0; i < steps; i++) {
        for (const axis of ['x', 'y', 'z']) {
          const prev = s.pos[axis];
          s.pos[axis] += (s.vel[axis] * dt) / steps;
          if (this._solidAt(s.pos)) {
            s.pos[axis] = prev;
            s.vel[axis] *= -0.45;
            s.bounces++;
            if (axis === 'y') { s.vel.x *= 0.7; s.vel.z *= 0.7; }
          }
        }
        const mob = s.age > 0.05 ? mobAt(s.pos, s) : null;
        if (mob) {
          events.push({ type: 'hit', mob, owner: s.owner, ...s.pos, vel: { ...s.vel } });
          events.push({ type: 'land', ...s.pos });
          return false;
        }
      }
      const slow = Math.hypot(s.vel.x, s.vel.y, s.vel.z) < 1.5;
      if (s.bounces > 6 || (slow && s.bounces > 0) || s.age > 8) {
        events.push({ type: 'land', ...s.pos });
        return false;
      }
      return true;
    });
    return events;
  }
}

export class Drops {
  constructor(world, rand = Math.random) {
    this.world = world;
    this.rand = rand;
    this.list = [];
    this.nextId = 1;
  }

  spawn(kind, x, y, z, toss = true) {
    const body = new Body(this.world, 0.15, 0.25);
    body.pos = { x, y, z };
    const a = this.rand() * Math.PI * 2;
    if (toss) body.impulse(Math.cos(a) * 2, 4, Math.sin(a) * 2);
    const drop = { id: this.nextId++, kind, body, age: 0, loose: false };
    this.list.push(drop);
    return drop;
  }



  /** Places an item (coin, ammo crate, Power Surge...) on open ground 8-30 blocks away, up to `cap` of that kind. */
  scatter(kind, player, maxHeight = 80, cap = MAX_LOOSE_COINS) {
    if (this.list.filter((d) => d.loose && d.kind === kind).length >= cap) return null;
    const a = this.rand() * Math.PI * 2;
    const r = 8 + this.rand() * 22;
    const x = Math.floor(player.pos.x + Math.cos(a) * r);
    const z = Math.floor(player.pos.z + Math.sin(a) * r);
    let y = maxHeight - 1;
    const passable = (b) => b === 0 || PLANT[b]; // look through air and wheat down to the ground
    while (y > 0 && passable(this.world.getBlock(x, y, z))) y--;
    const ground = this.world.getBlock(x, y, z);
    if (y <= 0 || !SOLID[ground] || LEAFY[ground]) return null; // water, treetops
    if (!passable(this.world.getBlock(x, y + 1, z))) return null;
    const item = this.spawn(kind, x + 0.5, y + 1, z + 0.5, false);
    item.loose = true;
    return item;
  }

  /**
   * Physics, magnet toward the nearest player, pickup into their inventory. `players` is one player
   * or a list. Returns picked-up drops, each with `.player` set to who got it.
   */
  update(dt, players) {
    players = Array.isArray(players) ? players : [players];
    const picked = [];
    this.list = this.list.filter((d) => {
      d.age += dt;
      if (d.age > T.dropLifetime || d.body.pos.y < -20) return false;
      const near = (p) => Math.hypot(d.body.pos.x - p.pos.x, d.body.pos.z - p.pos.z);
      if (d.loose && players.every((p) => near(p) > 64)) return false;
      let player = null;
      for (const p of players) if (!p.dead && (!player || near(p) < near(player))) player = p;
      let wx = 0;
      let wz = 0;
      if (player && d.age > 0.5) {
        const c = player.center;
        const dx = c.x - d.body.pos.x;
        const dy = c.y - d.body.pos.y;
        const dz = c.z - d.body.pos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < T.pickupRange) {
          if (d.kind === 'ammo') d.bundle = grantAmmo(player, this.rand); // a random kind of ammo
          else if (d.kind === 'arrow') player.ammo.arrows = (player.ammo.arrows || 0) + 1; // a spent arrow, picked back up
          else if (d.kind === 'surge') player.effects.surge = T.surgeSeconds;
          else if (d.kind === 'zcash') { // a coin is worth anything from 0.01 to 1.00 ZEC
            d.value = coinValue(this.rand);
            player.wallet.zcash = Math.round((player.wallet.zcash + d.value) * 100) / 100;
          } else {
            const inv = player[itemGroup(d.kind)];
            inv[d.kind] = (inv[d.kind] || 0) + 1;
          }
          d.player = player;
          picked.push(d);
          return false;
        }
        if (dist < T.magnetRange) {
          d.dir = null; // (a stuck arrow comes loose when you come for it)
          const h = Math.hypot(dx, dz) || 1;
          wx = (dx / h) * 5;
          wz = (dz / h) * 5;
        }
      }
      if (!d.dir) d.body.step(dt, wx, wz, false, 0); // (an arrow stuck in a block, `dir` the way it flew, stays put)
      return true;
    });
    return picked;
  }
}


// ---------- Server settings for everything above ----------
// bindTunable makes each table field a live setting (code reading FOOD.steak.heal etc. sees the current value).
const P = { max: 1, step: 0.05 }; // chances (0 to 1)
tune('Monsters & animals', {
  lootCoin: [0.4, 'Monster coin chance', 'Chance a monster drops Zcash (times Monster loot)', P],
  lootDoubleCoin: [0.25, 'Double coin chance', 'Chance a coin drop is two coins', P],
  lootAmmo: [0.2, 'Monster ammo chance', 'Chance a monster drops an ammo crate (times Monster loot)', P],
  cowLiver: [0.3, 'Cow liver chance', 'Chance a cow drops a liver instead of steak', P],
  cowDoubleSteak: [0.4, 'Cow double steak chance', 'Otherwise, chance of two steaks', P],
  cowDairy: [0.65, 'Cow dairy chance', 'Chance a cow also drops milk or cheese', P],
  cowMilk: [0.6, 'Cow milk chance', 'When it drops dairy, chance it is milk (otherwise cheese)', P],
  seedOilDish: [0.35, 'Seed Oil dish chance', 'Chance a Seed Oil leaves a greasy dish', P],
});
tune('Economy', {
  coinMin: [0.01, 'Coin value (lowest)', 'Least ZEC a coin can be worth', { unit: ' ZEC', step: 0.01 }],
  coinMax: [1, 'Coin value (highest)', 'Most ZEC a coin can be worth', { unit: ' ZEC', step: 0.01 }],
});
for (const [k, f] of Object.entries(FOOD)) bindTunable(f, 'heal', 'Food & traits', `heal_${k}`, `${f.name} healing`, 'Health it restores');
for (const [k, t] of Object.entries(TRAITS)) bindTunable(t, 'chance', 'Food & traits', `chance_${k}`, `${t.name} chance`, 'Chance of getting it at each spawn', P);
for (const [k, t] of Object.entries(TOOLS)) {
  if (!t.crafted) bindTunable(t, 'usd', 'Items & tools', `usd_${k}`, `${t.name} price`, t.town ? `Dollars at the town ${t.town} (paid in ZEC)` : 'Dollars to print it (paid in ZEC); CONSUME adds its fee', { unit: '$', step: 1 });
  bindTunable(t, 'damage', 'Items & tools', `melee_${k}`, `${t.name} hit damage`, 'Damage when you hit something with it');
  bindTunable(t, 'knock', 'Items & tools', `knock_${k}`, `${t.name} knockback`, 'How far a hit with it shoves');
}
bindTunable(TOOLS.hackysack, 'throwDamage', 'Items & tools', 'sackDamage', 'Hackysack throw damage', 'Damage when a thrown hackysack hits');
bindTunable(TOOLS.hackysack, 'throwKnock', 'Items & tools', 'sackKnock', 'Hackysack throw knockback', 'How far a thrown hackysack shoves');
bindTunable(HAND, 'damage', 'Items & tools', 'handDamage', 'Punch damage', 'Damage of an empty-handed punch');
bindTunable(HAND, 'knock', 'Items & tools', 'handKnock', 'Punch knockback', 'How far a punch shoves');
for (const [id, p] of Object.entries(BLOCK_PRINTS)) {
  bindTunable(p, 'usd', 'Blocks', `printUsd_${id}`, `${BLOCKS[id].name} price`, 'Dollars per batch (printer or CONSUME)', { unit: '$', step: 0.5 });
  bindTunable(p, 'n', 'Blocks', `printCount_${id}`, `${BLOCKS[id].name} per batch`, 'Blocks in one print or order', { min: 1, step: 1 });
}
bindTunable(RAW_BLOCKS, 'usd', 'Blocks', 'rawUsd', 'Natural block price', 'Dollars per batch of natural blocks (dirt, stone...) on CONSUME', { unit: '$', step: 0.5 });
bindTunable(SEEDS, 'usd', 'Gardening', 'seedUsd', 'Seed packet price', 'Dollars per packet of seeds on CONSUME', { unit: '$', step: 0.5 });
bindTunable(SEEDS, 'n', 'Gardening', 'seedCount', 'Seeds per packet', 'Seeds in one CONSUME order', { min: 1, step: 1 });
bindTunable(RAW_BLOCKS, 'n', 'Blocks', 'rawCount', 'Natural blocks per batch', 'Blocks in one CONSUME order', { min: 1, step: 1 });
for (const k of Object.keys(FOOD_USD)) bindTunable(FOOD_USD, k, 'Economy', `usd_food_${k}`, `${FOOD[k].name} price`, 'Dollars to order it on CONSUME', { unit: '$', step: 0.5 });
for (const k of Object.keys(AMMO_USD)) bindTunable(AMMO_USD, k, 'Economy', `usd_ammo_${k}`, `${AMMO[k].name} box price`, AMMO[k].town ? 'Dollars per bundle at the fletcher' : 'Dollars per box (printer or CONSUME)', { unit: '$', step: 0.5 });
for (const k of Object.keys(TOWN_FOOD_USD)) bindTunable(TOWN_FOOD_USD, k, 'Economy', `usd_town_${k}`, `${FOOD[k].name} price`, 'Dollars at the Fantasy Town shop that sells it', { unit: '$', step: 0.5 });
for (const k of Object.keys(SCROLL_USD)) bindTunable(SCROLL_USD, k, 'Economy', `usd_scroll_${k}`, `Scroll of ${SPELLS[k].name} price`, 'Dollars at the town wizard', { unit: '$', step: 0.5 });
for (const [k, t] of Object.entries(TOOLS)) {
  if (!t.armor) continue;
  bindTunable(t, 'armor', 'Items & tools', `armor_${k}`, `${t.name} protection`, 'How much less every hit hurts while you wear it', { max: 100, step: 5, unit: '%' });
  bindTunable(t, 'speed', 'Items & tools', `armorSpeed_${k}`, `${t.name} speed`, 'How fast you walk in it, compared with normal', { max: 100, step: 5, unit: '%' });
}
for (const k of ['manapotion']) bindTunable(FOOD[k], 'mana', 'Magic', `mana_${k}`, `${FOOD[k].name} mana`, 'Mana it restores');
