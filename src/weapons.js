// Guns, ammo, the grappling hook and Power Surge. Original takes on the classic shooter arsenal
// (no names, art or sounds from any particular game). No Three.js, no DOM.

import { T, tune, bindTunable } from './tuning.js';

// Server settings (tuning.js): read the live values as T.key.
tune('Weapons', {
  surgeSeconds: [30, 'Power Surge duration', 'Seconds of extra damage', { unit: ' s' }],
  surgeMult: [4, 'Power Surge damage', 'Damage multiplier during Power Surge', { unit: '×' }],
  arrowBreak: [10, 'Arrow break chance', 'Chance an arrow or bolt breaks when it hits, instead of lying there (or staying stuck in a creature) for you to pick up', { unit: '%', min: 0, max: 100, step: 5 }],
  scopeZoom1: [5, 'Scope zoom 1', 'The Sniper Rifle scope\'s first zoom (right-click once)', { unit: '×', min: 1, max: 50, step: 0.5 }],
  scopeZoom2: [10, 'Scope zoom 2', 'Its second zoom (right-click twice)', { unit: '×', min: 1, max: 50, step: 0.5 }],
  scopeZoom3: [20, 'Scope zoom 3', 'Its third zoom (right-click three times; once more puts it away)', { unit: '×', min: 1, max: 50, step: 0.5 }],
  scopeSpread: [2, 'Scoped spread', 'A Sniper Rifle shot\'s spread through the scope, compared with from the hip', { unit: '%', min: 0, max: 100, step: 1 }],
  bowMinDraw: [25, 'Least bow draw', 'How far you have to draw a bow before letting go shoots an arrow (less and nothing happens)', { unit: '%', min: 0, max: 100, step: 5 }],
});

export const AMMO = {
  bullets: { name: 'Bullets', box: 30, weight: 0.36 },
  shells: { name: 'Shells', box: 8, weight: 0.24 },
  rockets: { name: 'Rockets', box: 4, weight: 0.16 },
  slugs: { name: 'Slugs', box: 4, weight: 0.12 },
  cells: { name: 'Cells', box: 60, weight: 0.12 },
  rifle: { name: 'Rifle Rounds', box: 10, weight: 0.08 }, // the Sniper Rifle's
  arrows: { name: 'Arrows', box: 20, weight: 0, town: true }, // sold by the town's fletcher (weight 0: not in monsters' crates)
};

/** Guns with a magazine (`mag` rounds; R to reload, ammo in the other hand: game.js `_reload`). Bows aren't: arrows go one at a time. `loadOne`: a click loads one round (shells, rockets), not a full magazine. */
export const usesMag = (kind) => !!GUNS[kind]?.mag;

/**
 * type: 'hitscan' (instant), 'rail' (instant, pierces), 'rocket' / 'orb' (projectiles), 'arrow' (an arrow that arcs
 * as it flies and hits what it meets; `speed` and `gravity`). `town`: sold only at that shop in the Fantasy Town.
 * damage is per bullet/pellet (projectiles: blast strength). cooldown in seconds; hold to keep firing.
 * twoHanded: held in both hands at once (only the pistol is one-handed).
 */
export const GUNS = {
  pistol: { name: 'Pistol', usd: 40, ammo: 'bullets', per: 1, mag: 12, type: 'hitscan', damage: 9, pellets: 1, spread: 0.004, range: 64, cooldown: 0.32, knock: 3,
    desc: 'Reliable single shots. Uses bullets.' },
  shotgun: { name: 'Shotgun', usd: 90, ammo: 'shells', per: 1, mag: 6, loadOne: true, type: 'hitscan', damage: 6, pellets: 8, spread: 0.07, range: 28, cooldown: 0.9, knock: 4, twoHanded: true,
    desc: 'Eight pellets at once. Brutal up close. Uses shells.' },
  machinegun: { name: 'Machine Gun', usd: 150, ammo: 'bullets', per: 1, mag: 30, type: 'hitscan', damage: 6, pellets: 1, spread: 0.025, range: 56, cooldown: 0.09, knock: 1.5, twoHanded: true,
    desc: 'Hold to spray. Eats bullets. Uses bullets.' },
  rocket: { name: 'Rocket Launcher', usd: 250, ammo: 'rockets', per: 1, mag: 1, loadOne: true, type: 'rocket', damage: 1.2, radius: 3.3, speed: 26, cooldown: 0.85, knock: 0, twoHanded: true,
    desc: 'Explodes on impact, blocks and all. Mind the splash. Uses rockets.' },
  sniper: { name: 'Sniper Rifle', usd: 350, ammo: 'rifle', per: 1, mag: 5, type: 'hitscan', damage: 45, pellets: 1, spread: 0.06, range: 220, cooldown: 1.4, knock: 6, twoHanded: true, scope: true,
    desc: 'Bolt-action, long range, and wild from the hip. Right-click for the scope: 5×, 10×, 20×, then off. Uses rifle rounds.' },
  railgun: { name: 'Railgun', usd: 400, ammo: 'slugs', per: 1, mag: 4, type: 'rail', damage: 60, range: 96, cooldown: 1.6, knock: 10, twoHanded: true,
    desc: 'An instant beam that goes through everything in a line. Uses slugs.' },
  overcharge: { name: 'Overcharge Cannon', usd: 900, ammo: 'cells', per: 30, mag: 90, type: 'orb', damage: 2, radius: 5.5, speed: 9, cooldown: 2.5, knock: 0, twoHanded: true,
    zapRadius: 7, zapDamage: 7, zapEvery: 0.3, desc: 'A slow orb that zaps everything near its path, then detonates hugely. 30 cells a shot.' },
  // Bows, from the fletcher.
  shortbow: { name: 'Shortbow', usd: 45, ammo: 'arrows', per: 1, type: 'arrow', damage: 7, speed: 30, gravity: 10, cooldown: 0.3, knock: 3, twoHanded: true, town: 'fletcher', draw: 0.6,
    desc: 'Light and quick: hold the button to draw, let go to shoot. Arrows drop as they fly, so aim high for long shots. Uses arrows.' },
  longbow: { name: 'Longbow', usd: 120, ammo: 'arrows', per: 1, type: 'arrow', damage: 14, speed: 44, gravity: 8, cooldown: 0.4, knock: 5, twoHanded: true, town: 'fletcher', draw: 1,
    desc: 'Hits hard and flies far: hold the button to draw it all the way, let go to shoot. Uses arrows.' },
  crossbow: { name: 'Crossbow', usd: 200, ammo: 'arrows', per: 1, type: 'arrow', damage: 22, speed: 56, gravity: 5, cooldown: 1.6, knock: 7, twoHanded: true, town: 'fletcher',
    desc: 'A heavy bolt, fast and flat. Slow to reload. Uses arrows.' },
};

export const GRAPPLE = { name: 'Grappling Hook', usd: 60, range: 40, speed: 20, desc: 'Hook a block and hold the button to be pulled to it.' };


/** A random ammo crate: one ammo type, a box's worth. Adds it to the player and returns { ammo, n }. */
export function grantAmmo(player, rand = Math.random) {
  let pick = rand();
  let type = 'bullets';
  for (const [k, a] of Object.entries(AMMO)) {
    if ((pick -= a.weight) < 0) { type = k; break; }
  }
  player.ammo[type] = (player.ammo[type] || 0) + AMMO[type].box;
  return { ammo: type, n: AMMO[type].box };
}

/** A direction nudged randomly within `spread` (radians, roughly). */
export function spreadDir(d, spread, rand = Math.random) {
  const x = d.x + (rand() - 0.5) * 2 * spread;
  const y = d.y + (rand() - 0.5) * 2 * spread;
  const z = d.z + (rand() - 0.5) * 2 * spread;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}


// ---------- Server settings: ammo boxes and the grappling hook ----------
for (const [k, a] of Object.entries(AMMO)) {
  bindTunable(a, 'box', 'Weapons', `box_${k}`, `${a.name} per box`, 'How many come in a crate or a bought box', { min: 1, step: 1 });
  bindTunable(a, 'weight', 'Weapons', `crate_${k}`, `${a.name} crate weight`, 'How often a monster\'s ammo crate holds this kind', { max: 1, step: 0.01 });
}
for (const [k, g] of Object.entries(GUNS)) {
  if (g.type !== 'arrow') continue;
  bindTunable(g, 'speed', 'Weapons', `arrowSpeed_${k}`, `${g.name} arrow speed`, 'Blocks per second as the arrow leaves the bow');
  bindTunable(g, 'gravity', 'Weapons', `arrowDrop_${k}`, `${g.name} arrow drop`, 'How fast its arrows fall');
  if (g.draw) bindTunable(g, 'draw', 'Weapons', `drawTime_${k}`, `${g.name} draw time`, 'Seconds to draw it all the way (a full draw: full speed and damage)', { unit: ' s', min: 0.05, max: 5, step: 0.05 });
}
bindTunable(GRAPPLE, 'range', 'Weapons', 'grappleRange', 'Grapple range', 'How far the grappling hook reaches, in blocks');
