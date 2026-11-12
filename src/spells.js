// Magic: everyone knows every spell. Pick one with the scroll wheel, then click with an empty hand,
// a Wand or a Staff to cast it; that costs mana, which refills over time. Mana and its refill rate
// come from your Big Brain. The game owns mana and does the casting (game.js `_cast`). No Three.js, no DOM.
//
// Every number here is a default: Server settings (settings.js, group "Magic") can change any of them,
// so read them through the helpers below with the current settings, never directly.
import { T } from './tuning.js';

/** offensive: aimed at something else (blocked for Buildy Bois, and it ends your invisibility). */
export const SPELLS = {
  fireball: { name: 'Fireball', icon: '🔥', cost: 10, cooldown: 0.45, offensive: true, desc: 'A ball of fire that blows up blocks and anything near them.' },
  missile: { name: 'Magic Missile', icon: '✴️', cost: 12, cooldown: 0.6, offensive: true, desc: 'A homing bolt that finds the nearest target. Never misses (much).' },
  icebolt: { name: 'Icebolt', icon: '🧊', cost: 15, cooldown: 0.6, offensive: true, desc: 'A shard of ice: it hurts, chills (slows) what it hits, and freezes water it lands in.' },
  blizzard: { name: 'Blizzard', icon: '🌨️', cost: 45, cooldown: 6, offensive: true, desc: 'Throw a ball of ice: where it lands, a freezing storm hurts and chills everything inside but you, and freezes water.' },
  lightning: { name: 'Chain Lightning', icon: '⚡', cost: 30, cooldown: 1.5, offensive: true, desc: 'Strikes what you aim at, then jumps to more targets nearby.' },
  shrink: { name: 'Shrink', icon: '🔻', cost: 30, cooldown: 2, offensive: true, desc: 'Your target shrinks: its attacks and speed shrink too.' },
  enlarge: { name: 'Enlarge', icon: '🔺', cost: 30, cooldown: 2, offensive: true, desc: 'Your target grows six times bigger, and hits six times harder.' },
  polymorph: { name: 'Polymorph', icon: '👶', cost: 35, cooldown: 2, offensive: true, desc: 'Turns your target into an immobile, coughing infant for a while.' },
  hallucinate: { name: 'Hallucinate', icon: '🌀', cost: 25, cooldown: 2, offensive: true, desc: 'Your target sees monsters that aren\'t there: monsters fight thin air, players get chased by phantoms.' },
  stoneskin: { name: 'Stoneskin', icon: '🪨', cost: 25, cooldown: 3, offensive: false, desc: 'Your skin turns to stone: you take much less damage for a while.' },
  invisibility: { name: 'Invisibility', icon: '👻', cost: 30, cooldown: 3, offensive: false, desc: 'Nobody can see you, monsters included, until you attack.' },
  flight: { name: 'Flying', icon: '🕊️', cost: 35, cooldown: 4, offensive: false, desc: 'You can fly for a while: F to take off (Space up, C down). Mind the landing when it wears off.' },
  teleport: { name: 'Teleportation', icon: '✨', cost: 25, cooldown: 2, offensive: false, desc: 'Blink to the spot you\'re looking at.' },
  dragon: { name: 'Dragon\'s Breath', icon: '🐉', cost: 20, cooldown: 0.5, offensive: true, stream: true, desc: 'Hold the button to breathe a stream of fire that burns everything in front of you, for as long as your mana lasts. (Its cost is mana a second.)' },
  blind: { name: 'Blind', icon: '🙈', cost: 25, cooldown: 2, offensive: true, desc: 'Your target can\'t see: a player sees only a blur, a monster loses track of everyone.' },
};
/** The scroll wheel cycles through these; 'none' means an empty hand punches and mines as usual. */
export const SPELL_ORDER = ['none', ...Object.keys(SPELLS)];

/** What you cast with. Its potency (a setting) multiplies damage and durations. */
export const FOCUS_KEYS = { empty: null, wand: 'wandPotency', staff: 'staffPotency', runewand: 'runewandPotency', archstaff: 'archstaffPotency' };
export const isFocus = (kind) => kind in FOCUS_KEYS;

/** Defaults for every magic setting (see settings.js for names, ranges and units). */
export const MAGIC_DEFAULTS = {
  manaBase: 50, manaPerPoint: 5, // max mana: base ± per Big Brain point away from 10
  regenBase: 2, regenPerPoint: 0.3, // mana per second, likewise
  wandPotency: 1.25, staffPotency: 1.5, runewandPotency: 1.6, archstaffPotency: 2.2, // the last two: the town wizard's
  scrollPotency: 1, // a spell read from a scroll (free: no mana, and the scroll is used up)
  spellRange: 32, // how far targeted spells reach
  fireballDamage: 1, // blast strength
  missileDamage: 8, missileSpeed: 13, missileTurn: 5, missileSeek: 28, missileLifetime: 6,
  iceboltDamage: 6, iceboltSpeed: 24, iceboltFreeze: 1.5, // iceboltFreeze: radius of water it freezes
  blizzardSpeed: 22, blizzardDrop: 6, // the ball you throw: blocks per second, and how fast it falls
  blizzardSeconds: 8, blizzardRadius: 5, blizzardDamage: 2, blizzardEvery: 0.5, // damage every blizzardEvery seconds
  iceboltSnow: 1.5, blizzardSnow: 6, snowMelt: 180, // snow: radius an icebolt dusts, columns a blizzard covers per bite, seconds before it melts
  chillSeconds: 4, chillSpeed: 50, // chilled: % of normal speed, for chillSeconds (times potency)
  freezeWater: true, // ice spells turn water into ice
  lightningDamage: 12, lightningJumps: 4, lightningJump: 7, lightningFalloff: 75, // falloff: % of damage each jump keeps
  shrinkScale: 20, shrinkSeconds: 20, // shrinkScale: % of normal size
  enlargeScale: 600, enlargeSeconds: 20, enlargeSpeed: 100, // enlargeSpeed: % of normal speed while enlarged
  polymorphSeconds: 10,
  hallucinateSeconds: 20, hallucinateMobs: 5, hallucinateSpeed: 3.5, // a hallucinating player sees up to hallucinateMobs phantoms at a time
  stoneskinSeconds: 30, stoneskinArmor: 40, stoneskinMaxArmor: 75, // % of damage stopped (armor × potency, capped)
  invisibilitySeconds: 20,
  flightSeconds: 20, teleportRange: 40,
  breathRange: 7, breathArc: 50, breathDamage: 14, // Dragon's Breath: a cone breathRange long and breathArc degrees wide, breathDamage a second while you hold it
  blindSeconds: 10, blindBlur: 14, // blindBlur: how blurred a blinded player's view is (pixels)
  ...Object.fromEntries(Object.entries(SPELLS).flatMap(([k, s]) => [[`cost_${k}`, s.cost], [`cooldown_${k}`, s.cooldown]])),
};

/** A magic number with the server settings applied. */
export const magic = (settings, key) => settings?.[key] ?? MAGIC_DEFAULTS[key];
export const spellCost = (spell, settings) => magic(settings, `cost_${spell}`);
export const spellCooldown = (spell, settings) => magic(settings, `cooldown_${spell}`);
/** How much stronger casting with this hand makes your magic (1 for an empty hand). */
export const potency = (kind, settings) => (FOCUS_KEYS[kind] ? magic(settings, FOCUS_KEYS[kind]) : 1);
/**
 * Spells that resize their target (Shrink, Enlarge), with the settings for how big it becomes (% of
 * normal size) and how long it lasts. A target has at most one: a new one replaces the old. Its attacks
 * scale with its size; so does its speed when shrunk, while enlarged it's the Enlarge speed setting.
 */
export const SIZE_SPELLS = { shrink: { scale: 'shrinkScale', seconds: 'shrinkSeconds' }, enlarge: { scale: 'enlargeScale', seconds: 'enlargeSeconds' } };
/** How big something under size spell `spell` (or none) is, as a fraction of its normal size. */
export const sizeScale = (spell, settings = T) => (SIZE_SPELLS[spell] ? magic(settings, SIZE_SPELLS[spell].scale) / 100 : 1);
/** Its speed multiplier. */
export const sizeSpeed = (spell, settings = T) => (spell === 'enlarge' ? magic(settings, 'enlargeSpeed') / 100 : sizeScale(spell, settings));

const smart = (stats) => (Number.isFinite(stats?.bigBrain) ? stats.bigBrain : 10) - 10; // Big Brain
/** Most mana you can hold. */
export const maxMana = (stats, settings) => Math.max(1, Math.round(magic(settings, 'manaBase') + smart(stats) * magic(settings, 'manaPerPoint')));
/** Mana per second. */
export const manaRegen = (stats, settings) => Math.max(0, magic(settings, 'regenBase') + smart(stats) * magic(settings, 'regenPerPoint'));
