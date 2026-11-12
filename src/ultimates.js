// Ultimates: every class (your title: your best skill, skills.js) has one big move. Hits you land charge the meter
// (hits you take, a little); when it's full, press H to let it go, which empties it. After ultDecayDelay seconds
// without a hit in combat it drains slowly. The game owns all of it (game.js `_ult`, `_ultCharge`, `_tickUlt`);
// the client draws the meter and the show. Logic only: no Three.js, no DOM.
//
// Each ultimate is one of a few kinds, with its own numbers (the kind's settings, times the ultimate's `power`):
//   aura    a power-up for ultSeconds: `buffs` (melee/gun damage, reach, fire rate, free ammo, headshots...)
//   storm   things whirl round you for ultSeconds, hurting (and shoving) whatever's close: `visual` is what
//   burst   a shockwave round you, now: `push` (negative pulls in), `lift`, and an `effect` (root, sleep, blind)
//   rain    projectiles fall from the sky on the enemies round you: `shot` is what (rocket, arrow, meteor)
//   cone    a wave in front of you that tramples and shoves
//   heal    you (and players near you) back to health
//   warp    off to your current quest (or your bed)

import { T, tune, bindTunable } from './tuning.js';

tune('Ultimates', {
  ultChargeHit: [6, 'Charge per hit', 'How much of the ultimate meter each hit you land fills', { unit: '%', min: 0, max: 100, step: 0.5 }],
  ultChargeHurt: [3, 'Charge when hit', 'How much of the meter each hit you take fills', { unit: '%', min: 0, max: 100, step: 0.5 }],
  ultDecayDelay: [5, 'Meter drain delay', 'Seconds without a hit in combat before the meter starts to drain', { unit: ' s', min: 0, max: 120, step: 0.5 }],
  ultDecayRate: [3, 'Meter drain', 'How fast the meter drains after that, a second', { unit: '%', min: 0, max: 100, step: 0.5 }],
  ultSeconds: [10, 'Ultimate length', 'Seconds a power-up or storm ultimate lasts', { unit: ' s', min: 1, max: 60, step: 0.5 }],
  ultStormRadius: [4.5, 'Storm reach', 'How far a storm ultimate (Silverware Cyclone, Timber Tornado...) reaches, in blocks', { min: 1, max: 20, step: 0.5 }],
  ultStormDamage: [10, 'Storm damage', 'Damage a second a storm does to everything in it', { min: 0, max: 200, step: 1 }],
  ultBurstRadius: [8, 'Shockwave reach', 'How far a shockwave ultimate (Seismic Slam, Lullaby...) reaches, in blocks', { min: 1, max: 30, step: 0.5 }],
  ultBurstDamage: [18, 'Shockwave damage', 'Damage a shockwave does to everything it reaches', { min: 0, max: 200, step: 1 }],
  ultEffectSeconds: [6, 'Shockwave effect length', 'Seconds things stay rooted, asleep or blind after a shockwave', { unit: ' s', min: 0, max: 60, step: 0.5 }],
  ultRainCount: [14, 'Rain shots', 'How many rockets, arrows or meteors a rain ultimate drops', { min: 1, max: 60, step: 1 }],
  ultRainRadius: [16, 'Rain reach', 'How far from you a rain ultimate looks for targets, in blocks', { min: 2, max: 48, step: 1 }],
  ultRainDamage: [10, 'Rain damage', 'Damage each falling rocket, arrow or meteor does', { min: 0, max: 200, step: 1 }],
  ultConeRange: [12, 'Stampede reach', 'How far a cone ultimate (Stampede) reaches, in blocks', { min: 2, max: 40, step: 1 }],
  ultConeDamage: [16, 'Stampede damage', 'Damage a cone ultimate does to everything in it', { min: 0, max: 200, step: 1 }],
  ultHealRadius: [10, 'Feast and Rally reach', 'How far from you other players get healed (Feast) or rallied (Rally), in blocks', { min: 0, max: 40, step: 1 }],
  ultGiantDamage: [300, 'Titan Blade damage', 'Melee damage with a Titan Blade, compared with normal', { unit: '%', min: 100, max: 1000, step: 10 }],
  ultGiantReach: [3, 'Titan Blade reach', 'Extra blocks of reach with a Titan Blade', { min: 0, max: 10, step: 0.5 }],
});

// One table: [kind, name, description, extra]. `classes` lists the skills (skills.js kinds) that get it.
const U = (kind, name, desc, extra = {}) => ({ kind, name, desc, power: 1, ...extra });
export const ULTIMATES = {
  cyclone: U('storm', 'Silverware Cyclone', 'A whirling storm of plates, bowls and cutlery spins round you, shredding anything that comes close.', { visual: 'dishes', classes: ['dishwash'] }),
  titan: U('aura', 'Titan Blade', 'Your weapon grows three times bigger and glows: triple melee damage and longer reach.', { buffs: { giant: true, reach: true }, classes: ['sword', 'longsword', 'greatsword', 'stonespear'] }),
  cuts: U('aura', 'Thousand Cuts', 'Stab after stab after stab: three times as fast, and harder.', { buffs: { melee: 1.5, cooldown: 0.3 }, classes: ['dagger', 'stoneknife'] }),
  flurry: U('aura', 'Flurry of Fists', 'Your fists blur: four times the damage, three times as fast, and a shove like a truck.', { buffs: { melee: 4, cooldown: 0.35, knock: 2.5 }, classes: ['empty'] }),
  deadeye: U('aura', 'Deadeye', 'Every hit is a headshot, and you shoot twice as fast.', { buffs: { headshot: true, rate: 2 }, classes: ['sniper'] }),
  overload: U('aura', 'Overload', 'Double damage and double the fire rate.', { buffs: { gun: 2, rate: 2 }, classes: ['railgun'] }),
  fan: U('aura', 'Fan the Hammer', 'Three times the fire rate, and you don\'t use any ammo.', { buffs: { rate: 3, ammo: true }, classes: ['pistol'] }),
  boomstick: U('aura', 'Boomstick', 'Twice the pellets, three times the kick, and no ammo used.', { buffs: { pellets: 2, knock: 3, ammo: true }, classes: ['shotgun'] }),
  hose: U('aura', 'Bullet Hose', 'Dead-on accurate, faster, and endless ammo.', { buffs: { spread: 0, rate: 1.5, ammo: true }, classes: ['machinegun'] }),
  rockets: U('rain', 'Rocket Rain', 'Rockets rain down on every enemy around you (they don\'t dig up the ground).', { shot: 'rocket', classes: ['rocket'] }),
  arrows: U('rain', 'Arrow Storm', 'The sky goes dark with arrows, all of them finding someone.', { shot: 'arrow', classes: ['shortbow', 'longbow', 'crossbow'] }),
  arcane: U('aura', 'Arcane Overflow', 'Your spells cost no mana and need no cooldown.', { buffs: { spells: true }, classes: ['wand', 'runewand'] }),
  meteors: U('rain', 'Meteor Shower', 'Fire falls from the sky on your enemies.', { shot: 'meteor', classes: ['magic', 'staff', 'archstaff'] }),
  supernova: U('burst', 'Supernova', 'You go off like a star: a huge shockwave of light.', { power: 1.6, push: 14, visual: 'nova', classes: ['overcharge'] }),
  timber: U('storm', 'Timber Tornado', 'A whirlwind of spinning axes.', { visual: 'axes', classes: ['axe', 'stoneaxe'] }),
  seismic: U('burst', 'Seismic Slam', 'You hit the ground so hard everything around you goes flying up.', { lift: 14, push: 4, visual: 'rocks', classes: ['pick', 'stonepick'] }),
  grave: U('burst', 'Grave Digger', 'The ground swallows everything around you up to the knees: stuck, and hurt.', { effect: 'root', visual: 'dirt', classes: ['shovel', 'stoneshovel'] }),
  furrow: U('burst', 'Furrow Quake', 'The ground ripples out from you in furrows, bouncing everything.', { lift: 9, push: 6, visual: 'dirt', classes: ['tiller'] }),
  monsoon: U('storm', 'Monsoon', 'A swirling downpour that blasts everything away from you.', { power: 0.5, shove: 10, visual: 'water', classes: ['sprayer'] }),
  inferno: U('storm', 'Inferno', 'A ring of fire roars round you.', { power: 1.3, visual: 'fire', classes: ['weedtorch'] }),
  lullaby: U('burst', 'Lullaby', 'Feathers fill the air and everything nearby nods off (and forgets you\'re there).', { power: 0, effect: 'sleep', visual: 'feathers', classes: ['pillow'] }),
  footbag: U('storm', 'Footbag Frenzy', 'A swarm of hackysacks bounces round you, beaning everything.', { visual: 'sacks', classes: ['hackysack'] }),
  flare: U('burst', 'Solar Flare', 'A blinding flash: everything nearby can\'t see, and the undead burn.', { power: 0.4, effect: 'blind', visual: 'flash', classes: ['flashlight'] }),
  travel: U('warp', 'Fast Travel', 'Off you go: to your current quest, or home to your bed.', { classes: ['compass'] }),
  overhere: U('burst', 'Get Over Here!', 'Your hook flies out to every enemy round you and yanks them right to your feet.', { push: -14, visual: 'hooks', classes: ['grapple'] }),
  unbreakable: U('aura', 'Unbreakable', 'Nothing gets through: hits barely scratch you.', { buffs: { resist: 0.15 }, classes: ['leather', 'chainmail', 'platearmor'] }),
  vines: U('burst', 'Strangling Vines', 'Vines burst out of the ground and hold everything nearby fast.', { power: 0.3, effect: 'root', visual: 'vines', classes: ['plant'] }),
  kiln: U('burst', 'Kiln Blast', 'You open the kiln door on the world: a blast of heat.', { power: 1.2, push: 8, visual: 'fire', classes: ['pottery'] }),
  feast: U('heal', 'Feast', 'A feast appears: you and everyone near you are back to full health.', { classes: ['cooking'] }),
  caltrops: U('burst', 'Caltrops', 'A ring of spikes springs up round you: everything in it is stuck, and sore.', { power: 0.6, effect: 'root', visual: 'sparks', classes: ['crafting'] }),
  rally: U('aura', 'Rally', 'A hero\'s cry: you and the players near you hit harder and shrug off hits.', { buffs: { melee: 1.5, gun: 1.5, resist: 0.5 }, allies: true, classes: ['quest'] }),
  stampede: U('cone', 'Stampede', 'A herd of phantom cattle thunders out in front of you, trampling everything.', { classes: ['bucket'] }),
  kraken: U('burst', 'Kraken\'s Catch', 'Lines fly out and drag every enemy round you to your feet, tangled.', { push: -12, effect: 'root', visual: 'water', classes: ['rod'] }),
  secondwind: U('heal', 'Second Wind', 'You catch your breath: half your health back.', { self: 0.5, classes: [] }),
};
for (const [k, u] of Object.entries(ULTIMATES)) {
  bindTunable(u, 'power', 'Ultimates', `ultPower_${k}`, `${u.name} strength`, `How strong it is (its damage, and a Feast's healing), compared with normal`, { unit: '×', min: 0, max: 10, step: 0.05 });
}
/** Skill (class) -> ultimate key. */
const BY_CLASS = Object.fromEntries(Object.entries(ULTIMATES).flatMap(([k, u]) => u.classes.map((c) => [c, k])));

/** Your class's ultimate key: your best skill's (the one your title comes from), or Second Wind. */
export function ultFor(skills) {
  const best = Object.entries(skills || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
  return (best && BY_CLASS[best[0]]) || 'secondwind';
}

/** A buff of the ultimate that's on (`key`, or null), with `fallback` if it hasn't got that one. */
export function ultBuff(key, buff, fallback) {
  const b = ULTIMATES[key]?.buffs;
  return b && buff in b ? b[buff] : fallback;
}
/** Melee damage multiplier from an ultimate that's on. */
export const ultMelee = (key) => (ultBuff(key, 'giant', false) ? T.ultGiantDamage / 100 : ultBuff(key, 'melee', 1));
/** Extra melee reach from an ultimate that's on. */
export const ultReach = (key) => (ultBuff(key, 'reach', false) ? T.ultGiantReach : 0);
