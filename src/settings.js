// Server settings: knobs anyone playing can turn from the main menu (Server settings). Every gameplay
// number in the game is one. Each module registers its own with `tune()` / `bindTunable()` (tuning.js)
// and reads the live value from `T`; this file adds the game-wide ones, gathers them all into
// SETTINGS, and validates, loads and formats them. The game owns the values (`game.settings` is `T`),
// saves them with the world, and sends them in 'welcome' and in 'settings' messages. No Three.js or DOM.

import { T, TUNABLES, tune, setTuning } from './tuning.js';
import { GUNS } from './weapons.js';
import { SPELLS, MAGIC_DEFAULTS as M } from './spells.js';
// These register their settings when they load:
import './blocks.js';
import './body.js';
import './player.js';
import './items.js';
import './mobs.js';
import './fireballs.js';
import './drones.js';
import './market.js';
import './stats.js';
import './commands.js';
import './voiceroom.js';
import './garden.js';
import './gravity.js';
import './pottery.js';
import './fishing.js';
import './cooking.js';
import './crafting.js';
import './skills.js';

export { T, setTuning };

/** Every setting: key -> { group, name, desc, def, min, max, step, unit, type? }. */
export const SETTINGS = TUNABLES;

/** Groups, in the order the panel shows them. */
export const SETTING_GROUPS = ['World', 'Player', 'Health & XP', 'Food & traits', 'Stats', 'Monsters & animals', 'Items & tools', 'Blocks', 'Gardening', 'Pottery', 'Fishing', 'Cooking', 'Crafting', 'Economy', 'Weapons', 'Magic'];

const x = (min, max, step, unit) => ({ min, max, step, unit });
tune('World', {
  monsters: [1, 'Monster spawns', 'How fast monsters spawn at night, and how many can be around at once', x(0, 3, 0.25, '×')],
  wildlife: [1, 'Animals & birds', 'Cows, birds, cats and dogs: how many turn up', x(0, 3, 0.25, '×')],
  loot: [1, 'Monster loot', 'How often monsters drop Zcash and ammo crates', x(0, 3, 0.25, '×')],
  dayMinutes: [10, 'Day length', 'Minutes for a full day and night', x(2, 60, 1, ' min')],
  fallDamage: [1, 'Fall damage', 'Damage per block fallen beyond the safe height (gravity-resistant players take none)', x(0, 3, 0.25, '×')],
  pvp: [true, 'PvP', 'Players can hurt each other (multiplayer)'],
  backpackMinutes: [5, 'Backpack lifetime', 'Minutes the backpack a player drops when they die stays before it\'s gone (only they can pick it up)', x(0.5, 60, 0.5, ' min')],
  respawnDelay: [2.5, 'Respawn delay', 'Seconds you stay dead', x(0, 30, 0.5, ' s')],
  lavaDamage: [3, 'Lava damage', 'Damage per burn while you stand in lava'],
  lavaEvery: [0.5, 'Lava burn interval', 'Seconds between lava burns', { unit: ' s', min: 0.05 }],
  buildySwitch: [10, 'Buildy Boi switch time', 'Seconds to put on or take off the hard hat', { unit: ' s' }],
  messLifetime: [120, 'Mess lifetime', 'Seconds a lactose accident stays on the ground', { unit: ' s' }],
  surgeEvery: [40, 'Power Surge orb interval', 'Seconds between chances of a Power Surge orb appearing', { unit: ' s', min: 1 }],
  surgeChance: [40, 'Power Surge orb chance', 'Chance an orb appears each interval', x(0, 100, 5, '%')],
  meleeCooldown: [0.25, 'Melee cooldown', 'Seconds between punches or tool hits', { unit: ' s' }],
});
tune('Economy', {
  volatility: [1, 'Zcash volatility', 'How wildly the ZEC/USD rate swings (0: no swings, it settles at the base rate)', x(0, 3, 0.25, '×')],
  deliveryMinutes: [5, 'CONSUME delivery time', 'Minutes until a phone order arrives', x(0, 30, 0.5, ' min')],
  deliveryFee: [10, 'CONSUME delivery fee', 'Added to the price of every phone order', x(0, 100, 5, '%')],
  printSeconds: [5, '3D print time', 'Seconds a 3D Printer takes per print', x(0, 60, 1, ' s')],
  maxOrders: [20, 'CONSUME max orders', 'Deliveries one player can have on the way at once', x(1, 100, 1, '')],
});
tune('Weapons', {
  adsSpread: [50, 'Aiming spread', 'Gun spread while aiming down sights, compared with the hip', x(0, 100, 5, '%')],
  adsZoom: [100, 'Aiming zoom', 'How much aiming down sights magnifies (100%: twice as big)', x(0, 300, 10, '%')],
  sweepDamage: [75, 'Sweep damage', 'A horizontal slash (two-handed blades, left button) hits everything in front of you for this much of the weapon\'s damage', x(0, 200, 5, '%')],
  sweepArc: [120, 'Sweep width', 'How wide a horizontal slash reaches, in degrees', x(10, 360, 10, '°')],
  sweepReach: [3.5, 'Sweep reach', 'How far a horizontal slash reaches, in blocks', x(1, 8, 0.5, '')],
  chopDamage: [175, 'Chop damage', 'An overhead chop (two-handed blades, right button) hits one target for this much of the weapon\'s damage', x(0, 400, 5, '%')],
  chopCooldown: [2, 'Chop recovery', 'How much longer you need after a chop before you can swing again', x(1, 5, 0.25, '×')],
  headshotDamage: [2, 'Headshot damage', 'Damage from a gun or bow shot that hits the head, compared with a body shot', x(1, 5, 0.25, '×')],
  headshotZone: [20, 'Head size', 'How much of a player or creature, from the top, counts as the head', x(5, 50, 5, '%')],
});

// Weapons: every gun's damage and rate of fire, plus the shotgun's pellets and spread.
const nice = (v) => Math.round(v * 10) / 10;
for (const [k, g] of Object.entries(GUNS)) {
  const blast = g.type === 'rocket' || g.type === 'orb';
  const dmg = g.damage;
  const rate = nice(1 / g.cooldown);
  tune('Weapons', {
    [`damage_${k}`]: [dmg, `${g.name} damage`, blast ? 'Blast strength of each shot' : g.pellets > 1 ? 'Damage per pellet' : 'Damage per hit',
      x(0, dmg < 5 ? nice(dmg * 5) : Math.ceil(dmg * 5), dmg < 5 ? 0.1 : 1, '')],
    [`rate_${k}`]: [rate, `${g.name} fire rate`, 'Shots per second while you hold the button', x(0.1, Math.max(1, nice(rate * 4)), 0.1, '/s')],
  });
}
tune('Weapons', {
  shotgunPellets: [GUNS.shotgun.pellets, 'Shotgun pellets', 'Pellets per shell', x(1, 30, 1, '')],
  shotgunSpread: [nice((GUNS.shotgun.spread * 180) / Math.PI), 'Shotgun spread', 'How widely the pellets scatter', x(0, 20, 0.5, '°')],
});

// Magic: mana, potency, and every spell's numbers (spells.js holds the defaults).
const magic = (key, name, desc, min, max, step, unit = '') => tune('Magic', { [key]: [M[key], name, desc, x(min, max, step, unit)] });
magic('manaBase', 'Max mana', 'Mana you can hold at average Smartness', 1, 500, 1);
magic('manaPerPoint', 'Max mana per Smartness point', 'Added (or taken away) for each Smartness point above (or below) 10', 0, 50, 1);
magic('regenBase', 'Mana regeneration', 'Mana per second at average Smartness', 0, 50, 0.1, '/s');
magic('regenPerPoint', 'Mana regeneration per Smartness point', 'Added (or taken away) for each Smartness point above (or below) 10', 0, 5, 0.05, '/s');
magic('wandPotency', 'Wand potency', 'Spell damage and durations when cast with a Wand', 0, 5, 0.05, '×');
magic('staffPotency', 'Staff potency', 'Spell damage and durations when cast with a Staff', 0, 5, 0.05, '×');
magic('runewandPotency', 'Rune Wand potency', 'Spell damage and durations when cast with a Rune Wand (from the town wizard)', 0, 5, 0.05, '×');
magic('archstaffPotency', 'Archmage Staff potency', 'Spell damage and durations when cast with an Archmage Staff (from the town wizard)', 0, 5, 0.05, '×');
magic('scrollPotency', 'Scroll potency', 'Spell damage and durations when read from a scroll (scrolls cost no mana)', 0, 5, 0.05, '×');
magic('spellRange', 'Spell range', 'How far targeted spells (lightning, shrink, enlarge, polymorph, hallucinate) reach, in blocks', 4, 128, 1);
for (const [k, s] of Object.entries(SPELLS)) {
  magic(`cost_${k}`, `${s.name} mana cost`, 'Mana it takes to cast', 0, 200, 1);
  magic(`cooldown_${k}`, `${s.name} cooldown`, 'Seconds before you can cast it again', 0, 30, 0.05, ' s');
}
magic('fireballDamage', 'Fireball damage', 'Blast strength of a fireball', 0, 10, 0.1);
magic('missileDamage', 'Magic Missile damage', 'Damage per missile', 0, 100, 1);
magic('missileSpeed', 'Magic Missile speed', 'Blocks per second', 1, 60, 1);
magic('missileTurn', 'Magic Missile homing', 'How sharply it turns towards its target', 0, 20, 0.5);
magic('missileSeek', 'Magic Missile seeking range', 'How far away it notices targets, in blocks', 0, 100, 1);
magic('missileLifetime', 'Magic Missile lifetime', 'Seconds before it fizzles out', 1, 30, 0.5, ' s');
magic('iceboltDamage', 'Icebolt damage', 'Damage per icebolt', 0, 100, 1);
magic('iceboltSpeed', 'Icebolt speed', 'Blocks per second', 1, 80, 1);
magic('iceboltFreeze', 'Icebolt freeze radius', 'How much water an icebolt freezes where it lands, in blocks', 0, 6, 0.5);
magic('blizzardSpeed', 'Blizzard throw speed', 'Blocks per second as the ball of ice leaves your hand', 1, 80, 1);
magic('blizzardDrop', 'Blizzard ball drop', 'How fast the ball of ice falls (0: straight line)', 0, 40, 0.5);
magic('blizzardSeconds', 'Blizzard duration', 'Seconds the storm lasts (times potency)', 1, 60, 1, ' s');
magic('blizzardRadius', 'Blizzard radius', 'How far the storm reaches from its centre, in blocks', 1, 20, 0.5);
magic('blizzardDamage', 'Blizzard damage', 'Damage to everything inside, each time it bites', 0, 50, 1);
magic('blizzardEvery', 'Blizzard bite interval', 'Seconds between bites', 0.1, 5, 0.1, ' s');
magic('flightSeconds', 'Flying duration', 'Seconds you can fly (times potency)', 1, 120, 1, ' s');
magic('teleportRange', 'Teleport range', 'How far Teleportation reaches, in blocks', 2, 100, 1);
magic('breathRange', 'Dragon\'s Breath reach', 'How far the fire reaches, in blocks', 1, 20, 0.5);
magic('breathArc', 'Dragon\'s Breath width', 'How wide the cone of fire is, in degrees', 5, 180, 5, '°');
magic('breathDamage', 'Dragon\'s Breath damage', 'Damage to everything in the cone (times potency)', 0, 100, 1);
magic('blindSeconds', 'Blind duration', 'Seconds a target stays blind (times potency)', 1, 60, 1, ' s');
magic('blindBlur', 'Blindness blur', 'How blurred a blinded player\'s view is', 0, 40, 1, ' px');
magic('iceboltSnow', 'Icebolt snow', 'How far around where an icebolt lands gets a layer of snow, in blocks (0: none)', 0, 6, 0.5);
magic('blizzardSnow', 'Blizzard snowfall', 'Spots a blizzard covers in snow each time it bites (0: none)', 0, 40, 1);
magic('snowMelt', 'Snow melt time', 'Seconds, roughly, before snow from spells melts (0: never)', 0, 3600, 10, ' s');
magic('chillSeconds', 'Chill duration', 'Seconds an icebolt or blizzard slows you (times potency)', 0, 30, 0.5, ' s');
magic('chillSpeed', 'Chilled speed', 'How fast a chilled target moves, compared with normal', 0, 100, 5, '%');
tune('Magic', { snowCover: [true, 'Ice spells leave snow', 'Icebolts and blizzards leave a layer of snow on the blocks they hit'] });
tune('Magic', { freezeWater: [M.freezeWater, 'Ice freezes water', 'Icebolts and blizzards turn water into ice'] });
magic('lightningDamage', 'Chain Lightning damage', 'Damage to the first target', 0, 200, 1);
magic('lightningJumps', 'Chain Lightning jumps', 'How many more targets it jumps to', 0, 20, 1);
magic('lightningJump', 'Chain Lightning jump distance', 'How far it can jump between targets, in blocks', 1, 30, 0.5);
magic('lightningFalloff', 'Chain Lightning falloff', 'Damage each jump keeps from the last', 0, 200, 5, '%');
magic('shrinkScale', 'Shrink size', 'How big a shrunk target is (its speed and attacks scale with it)', 5, 100, 5, '%');
magic('shrinkSeconds', 'Shrink duration', 'Seconds it lasts (times potency)', 1, 120, 1, ' s');
magic('enlargeScale', 'Enlarge size', 'How big an enlarged target is (its attacks scale with it)', 100, 1000, 25, '%');
magic('enlargeSeconds', 'Enlarge duration', 'Seconds it lasts (times potency)', 1, 120, 1, ' s');
magic('enlargeSpeed', 'Enlarged speed', 'How fast an enlarged target moves, compared with normal', 0, 600, 10, '%');
magic('polymorphSeconds', 'Polymorph duration', 'Seconds as an infant (times potency)', 1, 120, 1, ' s');
magic('hallucinateSeconds', 'Hallucinate duration', 'Seconds it lasts (times potency)', 1, 120, 1, ' s');
magic('hallucinateMobs', 'Hallucinate phantoms', 'How many phantom monsters a hallucinating player sees at once', 1, 30, 1);
magic('hallucinateSpeed', 'Hallucinate phantom speed', 'How fast phantoms come at a hallucinating player, in blocks per second', 0.5, 15, 0.5, '/s');
magic('stoneskinSeconds', 'Stoneskin duration', 'Seconds it lasts (times potency)', 1, 300, 1, ' s');
magic('stoneskinArmor', 'Stoneskin armor', 'Damage stopped (times potency)', 0, 100, 5, '%');
magic('stoneskinMaxArmor', 'Stoneskin max armor', 'The most damage stoneskin can ever stop', 0, 100, 5, '%');
magic('invisibilitySeconds', 'Invisibility duration', 'Seconds it lasts (times potency)', 1, 300, 1, ' s');

/** A gun's numbers with the server settings applied (damage, cooldown, pellets, spread). */
export function gunStats(kind, settings = T) {
  const g = GUNS[kind];
  if (!g || !settings) return g;
  const out = { ...g, damage: settings[`damage_${kind}`] ?? g.damage };
  const rate = settings[`rate_${kind}`];
  if (rate > 0) out.cooldown = 1 / rate;
  if (kind === 'shotgun') {
    out.pellets = settings.shotgunPellets ?? g.pellets;
    out.spread = ((settings.shotgunSpread ?? (g.spread * 180) / Math.PI) * Math.PI) / 180;
  }
  return out;
}

export function defaultSettings() {
  return Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, s.def]));
}

/** A valid value for setting `key` (clamped and snapped to its step), or undefined if it can't be one. */
export function cleanSetting(key, value) {
  const s = SETTINGS[key];
  if (!s) return undefined;
  if (s.type === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const snapped = Math.round((Math.min(s.max, Math.max(s.min, value)) - s.min) / s.step) * s.step + s.min;
  return Math.round(snapped * 10000) / 10000;
}

/** Settings from saved data: every key present and valid, defaults for the rest. */
/**
 * Defaults that changed: [settings version that changed them, setting key, the old default]. A world saved before
 * that version that still has the old default gets the new one (game.js runs this once per world; saves keep
 * every value, so without this a new default would never reach an existing world).
 */
export const SETTINGS_VERSION = 3;
const CHANGED_DEFAULTS = [
  [2, 'hp_cow', 10], // cows take ten punches now
  [2, 'rate_shortbow', 1.8], [2, 'rate_longbow', 1], // bows: drawing them takes the time now
  // Raw meat and fish heal less now (cook them for more).
  [3, 'heal_steak', 6], [3, 'heal_liver', 10], [3, 'heal_bird', 2], [3, 'heal_penguin', 6],
  [3, 'heal_trout', 4], [3, 'heal_salmon', 6], [3, 'heal_catfish', 5], [3, 'heal_perch', 3], [3, 'heal_koi', 12],
];
/** Upgrades saved settings from `version` to SETTINGS_VERSION (see CHANGED_DEFAULTS). */
export function migrateSettings(saved, version) {
  if (!saved) return saved;
  for (const [v, key, old] of CHANGED_DEFAULTS) if (version < v && saved[key] === old) delete saved[key];
  return saved;
}

export function loadSettings(saved) {
  const out = defaultSettings();
  for (const k of Object.keys(SETTINGS)) {
    const v = cleanSetting(k, saved?.[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** How a setting's value reads: '1.5×', '10 min', 'On'. */
export function settingText(key, value) {
  const s = SETTINGS[key];
  if (s.type === 'bool') return value ? 'On' : 'Off';
  if (s.unit === '×' && value === 0) return 'Off';
  if (s.unit === '$') return '$' + value;
  return `${value}${s.unit}`;
}
