// Hostile mobs: AI, spawning, arrows and blast damage. No Three.js dependency.
//
//   zombie      walks at you and punches; burns in daylight
//   skeleton    keeps its distance and shoots arrows; burns in daylight
//   seedoil     golden oil blob that hops at you and splits in two when killed (size 3 -> 2 -> 1)
//   cow         passive; wanders in daytime herds, runs when hit, drops steak or liver
//   cat, dog    friendly pets that tag along after you; their allergy aura makes you cough and sneeze
//   pomodorino, lavatricio, ventilone   brainrot: absurd hybrids with sing-song pseudo-Italian names (night, anywhere)
//   amalgam     the Amalgamation: three creatures glued together into one
//   sahur       Tung Tung Tung Sahur: a wooden log with a bat; only comes out before dawn (from T.sahurStart)

import { T, tune, bindTunable } from './tuning.js';
import { Body } from './body.js';
import { CH } from './world.js';
import { AIR, GRASS, LEAFY, WATER, SOLID, FLUID, LAVA, LAVA_LAMP, SNOW_GRASS, ICE } from './blocks.js';
import { rollCowLoot, rollSeedOilLoot, rollCoinLoot } from './items.js';
import { sizeScale, sizeSpeed, magic } from './spells.js';

// Server settings (tuning.js): read the live values as T.key.
tune('Monsters & animals', {
  seagullReach: [1.6, 'Seagull reach', 'How close a seagull gets before snatching food'],
  maxBirds: [10, 'Max birds', 'Birds around at once (times Animals & birds)', { step: 1 }],
  birdSpook: [5, 'Bird spook distance', 'A perched bird takes off when you come this close'],
  maxCows: [8, 'Max cows', 'Cows around at once (times Animals & birds)', { step: 1 }],
  maxPets: [1, 'Max pets', 'Cats and dogs around at once', { step: 1, max: 10 }],
  petSpawnInterval: [30, 'Pet spawn interval', 'Seconds between pet spawn rolls', { unit: ' s', min: 1 }],
  petSpawnChance: [0.2, 'Pet spawn chance', 'Chance a pet turns up each roll', { max: 1, step: 0.05 }],
  petNotice: [20, 'Pet notice distance', 'Pets come to you from this far'],
  seedOilMaxSize: [3, 'Seed Oil max size', 'Size of a new Seed Oil (it splits into smaller ones)', { step: 1, min: 1, max: 6 }],
  maxMonsters: [14, 'Max monsters', 'Monsters around at once (times Monster spawns)', { step: 1 }],
  lampSafe: [8, 'Lava lamp safe zone', 'No monsters spawn within this many blocks of a lava lamp'],
  darkness: [0.4, 'Spawn darkness', 'Monsters only spawn when daylight is below this (0 to 1)', { max: 1, step: 0.05 }],
  mobSight: [24, 'Monster sight', 'How far monsters notice you, in blocks'],
  despawnDistance: [72, 'Despawn distance', 'Mobs farther than this from everyone vanish'],
  mobJump: [8.2, 'Mob jump strength', "Upward speed of a mob's jump"],
  arrowSpeed: [22, 'Arrow speed', 'Skeleton arrows, blocks per second'],
  arrowGravity: [14, 'Arrow drop', 'How fast arrows fall'],
  floatDepth: [0.7, 'Mob float depth', 'How much of a swimming mob is under water', { max: 1, step: 0.05 }],
  mobSwimSpeed: [0.5, 'Mob swim speed', 'Swimming speed compared with walking', { unit: '×' }],
  arrowDamage: [3, 'Arrow damage', 'Damage per skeleton arrow'],
  sahurStart: [3, 'Sahur hour', 'Tung Tung Tung Sahur only comes out from this hour of the night until dawn', { unit: ':00', min: 0, max: 6, step: 0.5 }],
});

// `melee` mobs walk straight at you and hit for `damage`. `weight` is the natural night-spawn share.
// `moves`: where a creature can go (MOVES; more than one for in-between ones):
//   aquatic      under water            natatorial   on the water's surface (swimming, floating)
//   terrestrial  on land                aerial       in the air
//   fossorial    underground (none yet)
// A walker that isn't natatorial or aquatic stops at the shore; a bird that isn't natatorial keeps above water;
// only aquatic ones go under (Mobs._think, Mobs._fly).
export const MOB_TYPES = {
  zombie: { tag: 'Z', moves: ['terrestrial', 'natatorial'], halfW: 0.3, height: 1.85, hp: 20, speed: 2.4, burns: true, melee: true, damage: 3, weight: 0.3 },
  skeleton: { tag: 'S', moves: ['terrestrial', 'natatorial'], halfW: 0.3, height: 1.9, hp: 16, speed: 2.6, burns: true, weight: 0.2 },
  // Waddles up and stabs. Can't fly; never could.
  penguin: { tag: 'P', moves: ['terrestrial', 'natatorial', 'aquatic'], halfW: 0.3, height: 1.0, hp: 14, speed: 2.2, burns: false, melee: true, damage: 3, weight: 0.08, swim: 1.6, habitat: 'cold' }, // (only where it's cold)
  // The Backrooms: they come out of the dark rooms, day or night (Mobs._trySpawnBackrooms).
  clerk: { tag: 'K', moves: ['terrestrial'], halfW: 0.3, height: 2.2, hp: 26, speed: 1.9, burns: false, melee: true, damage: 5, weight: 0.6, habitat: 'backrooms' },
  mildew: { tag: 'M', moves: ['terrestrial'], halfW: 0.4, height: 0.45, hp: 10, speed: 4.4, burns: false, melee: true, damage: 2, weight: 0.4, habitat: 'backrooms' },
  // Brainrot (original designs): absurd hybrids with sing-song pseudo-Italian names. Night, anywhere.
  // `knock` is how hard a hit shoves you (default 6).
  pomodorino: { tag: 'T', moves: ['terrestrial', 'natatorial'], halfW: 0.32, height: 0.95, hp: 12, speed: 3.6, burns: false, melee: true, damage: 2, weight: 0.06 }, // a boxing tomato
  lavatricio: { tag: 'L', moves: ['terrestrial'], halfW: 0.45, height: 2.6, hp: 40, speed: 1.7, burns: false, melee: true, damage: 6, knock: 11, weight: 0.05 }, // a washing machine on giraffe legs
  ventilone: { tag: 'V', moves: ['terrestrial', 'natatorial'], halfW: 0.3, height: 1.7, hp: 14, speed: 3, burns: false, melee: true, damage: 1, knock: 18, weight: 0.06 }, // a flamingo with a desk fan for a head
  // Tung Tung Tung Sahur: a log with a face and a bat. `sahur`: only spawns from T.sahurStart until dawn; wood burns at sunrise.
  sahur: { tag: 'H', moves: ['terrestrial', 'natatorial'], halfW: 0.3, height: 2, hp: 30, speed: 2.7, burns: true, melee: true, damage: 4, knock: 9, weight: 0.35, sahur: true },
  // The Amalgamation: three creatures glued into one (which three depends on its id: mobModels.js `amalgamParts`).
  amalgam: { tag: 'A', moves: ['terrestrial'], halfW: 0.7, height: 1.9, hp: 45, speed: 1.9, burns: false, melee: true, damage: 5, knock: 8, weight: 0.04 },
  // Sized: box is 0.5*size wide and 0.4*size tall, hp and contact damage scale with size.
  seedoil: { tag: 'O', moves: ['terrestrial', 'natatorial'], sized: true, hp: 6, speed: 3.2, burns: false, weight: 0.12 },
  cow: { tag: 'C', moves: ['terrestrial', 'natatorial'], passive: true, halfW: 0.45, height: 1.4, hp: 65, // (at least ten punches, however strong you rolled)
    speed: 1.6, burns: false, weight: 0 },
  // Pets follow you, stopping at `stay` blocks away once closer than `follow`.
  cat: { tag: 'c', moves: ['terrestrial'], passive: true, pet: true, halfW: 0.22, height: 0.6, hp: 8, speed: 3.6, burns: false, weight: 0, follow: 4, stay: 3 },
  dog: { tag: 'd', moves: ['terrestrial', 'natatorial'], passive: true, pet: true, halfW: 0.3, height: 0.85, hp: 12, speed: 4.2, burns: false, weight: 0, follow: 2.4, stay: 1.8 },
  // Birds fly in small flocks by day, sometimes landing to peck at the ground. Eat one to flap.
  // `flock` is [min, max] birds per flock, `cruise` [min, max] blocks above the ground, `perch` how often they land.
  bird: { tag: 'b', moves: ['aerial', 'terrestrial'], passive: true, flies: true, halfW: 0.18, height: 0.3, hp: 3, speed: 4.5, burns: false, weight: 0, flock: [2, 4], cruise: [3, 7], perch: 0.2 },
  munia: { tag: 'u', moves: ['aerial', 'terrestrial'], passive: true, flies: true, halfW: 0.14, height: 0.24, hp: 2, speed: 4.2, burns: false, weight: 0, flock: [4, 7], cruise: [2, 4], perch: 0.35 },
  finch: { tag: 'f', moves: ['aerial', 'terrestrial'], passive: true, flies: true, halfW: 0.14, height: 0.24, hp: 2, speed: 5.2, burns: false, weight: 0, flock: [2, 5], cruise: [3, 6], perch: 0.2 },
  seagull: { tag: 'g', moves: ['aerial', 'terrestrial', 'natatorial'], passive: true, flies: true, halfW: 0.28, height: 0.4, hp: 6, speed: 5.5, burns: false, weight: 0, flock: [1, 3], cruise: [6, 10], perch: 0.1, thief: true },
  nutmunch: { tag: 'n', moves: ['aerial', 'terrestrial'], passive: true, flies: true, halfW: 0.22, height: 0.34, hp: 5, speed: 3.4, burns: false, weight: 0, flock: [1, 2], cruise: [2, 4], perch: 0.45 },
};
export const MOVES = ['aquatic', 'natatorial', 'terrestrial', 'aerial', 'fossorial'];
/** Can a mob of `type` go there? ('aquatic', 'natatorial', ...) */
export const canMove = (type, where) => !!MOB_TYPES[type]?.moves?.includes(where);
/** Which flying species turn up where: beaches and water get seagulls; elsewhere, the rest. */
const INLAND_BIRDS = [['bird', 0.3], ['munia', 0.3], ['finch', 0.25], ['nutmunch', 0.15]];
// Pets are rare: at most one around, and only a small chance to show up every half minute.

// Swimming: mobs float with this fraction of their height under the surface, and paddle at
// T.mobSwimSpeed of their walking speed (MOB_TYPES[type].swim overrides it: penguins are good at this).

const asList = (players) => (Array.isArray(players) ? players : players ? [players] : []);

/** Players mobs act as if they can't see: the dead, the invisible, and Buildy Bois (hostiles don't chase them, seagulls don't rob them, birds and pets don't notice them). */
const ignored = (p) => p.dead || p.buildy || p.effects?.invisible > 0; // (and the invisible)

/** Closest player to a mob (horizontally), optionally only ones mobs notice. */
function nearestPlayer(m, players, noticedOnly) {
  let best = null;
  let bestD = Infinity;
  for (const p of players) {
    if (noticedOnly && ignored(p)) continue;
    const d = Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

export class Mob extends Body {
  constructor(world, type, id, size = 1) {
    const t = MOB_TYPES[type];
    super(world, t.sized ? 0.25 * size : t.halfW, t.sized ? 0.4 * size : t.height);
    this.size = t.sized ? size : 1;
    this.type = type;
    this.id = id;
    this.hp = t.hp * this.size;
    this.hopCd = 0.5; // seedoil: time until the next hop
    this.hopDir = { x: 0, z: 0 };
    this.yaw = Math.random() * Math.PI * 2;
    this.attackCd = 1;
    this.hurtT = 0;
    this.burning = false;
    this.burnCheck = Math.random();
    this.wanderT = 0;
    this.wanderSpeed = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.walkPhase = 0;
    this.walkAmount = 0;
    this.aiming = false;
    this.dead = false;
    this.silentDeath = false; // removed without a death puff (exploded/despawned)
    // Spells: sizeSpell ('shrink'/'enlarge', for sizeT seconds) resizes it, polyT makes it an immobile,
    // coughing infant, halluT makes it see monsters that aren't there (it ignores players and flails about).
    this.baseHalfW = this.halfW;
    this.baseHeight = this.height;
    this.scale = 1;
    this.sizeSpell = null;
    this.sizeT = 0;
    this.halluT = 0;
    this.chillT = 0; // chilled by ice magic: slower (the Chilled speed setting)
    this.polyT = 0;
    this.coughT = 0;
  }

  damage(amount, fromX, fromZ, knock = 6, source = null) {
    if (this.dead || amount <= 0) return;
    this.hp -= amount;
    if (source) this.lastHit = source; // who hit it last: their skill gets the kill (game.js)
    this.mobs?.onHit?.(this, amount, source); // (a hit charges the attacker's ultimate: game.js)
    this.hurtT = 0.3;
    this.panicT = 5; // passive mobs run away for a while
    this.wanderT = 0;
    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.impulse((dx / len) * knock, 4, (dz / len) * knock);
    if (this.hp <= 0) this.dead = true;
  }
}

export class Mobs {
  constructor(world, rand = Math.random) {
    this.world = world;
    this.rand = rand;
    this.list = [];
    this.arrows = [];
    this.nextId = 1;
    this.spawnTimer = 0;
    this.herdTimer = 0;
    this.petTimer = T.petSpawnInterval;
    this.allergyT = new WeakMap(); // per player: time until their next allergy symptom while exposed
  }

  spawn(type, x, y, z, size = 1) {
    const mob = new Mob(this.world, type, this.nextId++, size);
    mob.mobs = this;
    mob.pos = { x, y, z };
    this.list.push(mob);
    return mob;
  }

  /** Nearest mob hit by a ray: { mob, t } or null. */
  raycast(o, d, maxDist) {
    let best = null;
    for (const m of this.list) {
      const t = m.rayHit(o, d, maxDist);
      if (t !== null && (!best || t < best.t)) best = { mob: m, t };
    }
    return best;
  }

  mobAt(p, pad = 0.2) {
    return this.list.find((m) => !m.dead && m.containsPoint(p, pad)) || null;
  }

  hitTest(p, pad = 0.2) {
    return this.list.some((m) => !m.dead && m.containsPoint(p, pad));
  }

  /** Damages mobs and players (one player or a list) near an explosion centre. `mult` scales damage. */
  blast(x, y, z, radius, players, mult = 1, source = null) {
    const reach = radius * 2;
    for (const m of this.list) {
      const c = m.center;
      const d = Math.hypot(c.x - x, c.y - y, c.z - z);
      if (d < reach) m.damage(Math.round((1 - d / reach) * 22 * mult), x, z, 12 * (1 - d / reach));
    }
    for (const player of asList(players)) {
      if (player.dead) continue;
      const c = player.center;
      const d = Math.hypot(c.x - x, c.y - y, c.z - z);
      if (d < reach) player.damage(Math.round((1 - d / reach) * 15 * mult), x, z, 14 * (1 - d / reach), source && { ...source, blast: true }); // (blasts can't be dodged)
    }
  }

  _randomPlayer(players) {
    return players[Math.floor(this.rand() * players.length)];
  }

  /**
   * Runs AI, physics, spawning and arrows. `players` is one player or a list (multiplayer);
   * mobs deal with whichever is nearest. `light` is the daylight level (0.2..1).
   * Returns events: { type: 'death', x, y, z, mobType }
   *               | { type: 'shoot', x, y, z } | { type: 'cough' | 'sneeze', damage, player }
   */
  update(dt, players, light) {
    players = asList(players);
    const events = [];
    if (!players.length) return events;
    const extra = players.length - 1; // more players, more company

    const { monsters = 1, wildlife = 1 } = this.settings || {}; // server settings (multipliers; 0 = none)
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && monsters > 0) {
      this.spawnTimer = T.monsterInterval / monsters;
      const hostiles = this.list.filter((m) => !MOB_TYPES[m.type].passive).length;
      if (hostiles < Math.round((T.maxMonsters + extra * 6) * monsters)) {
        const who = this._randomPlayer(players);
        if (this._underground(who)) this._trySpawnCave(who); // caves are dark all day (world.js caveShade)
        else if (light < T.darkness) this._trySpawn(who); // only in the dark
        else this._trySpawnBackrooms(who); // (the Backrooms' dark rooms are dark all day)
      }
    }
    this.herdTimer -= dt;
    if (this.herdTimer <= 0) {
      this.herdTimer = T.herdInterval;
      const cows = this.list.filter((m) => m.type === 'cow').length;
      const maxCows = Math.round((T.maxCows + extra * 3) * wildlife);
      if (light > 0.6 && cows < maxCows) this._trySpawnHerd(this._randomPlayer(players), maxCows - cows);
      // Birds come with the daytime wildlife, a flock at a time.
      const birds = this.list.filter((m) => MOB_TYPES[m.type].flies).length;
      const maxBirds = Math.round((T.maxBirds + extra * 3) * wildlife);
      if (light > 0.6 && birds < maxBirds && this.rand() < T.flockChance) this._trySpawnFlock(this._randomPlayer(players), maxBirds - birds);
    }
    this.petTimer -= dt;
    if (this.petTimer <= 0) {
      this.petTimer = T.petSpawnInterval;
      const pets = this.list.filter((m) => MOB_TYPES[m.type].pet).length;
      if (pets < Math.round((T.maxPets + extra) * wildlife) && this.rand() < T.petSpawnChance * wildlife) this._trySpawnPet(this._randomPlayer(players));
    }

    for (const m of this.list) {
      if (m.dead) continue;
      const nearest = nearestPlayer(m, players, false);
      const target = nearestPlayer(m, players, true) || nearest;
      this._think(m, dt, target, nearest, light, events);
    }

    const splitting = [];
    this.list = this.list.filter((m) => {
      if (!m.dead) return true;
      if (!m.silentDeath) {
        const loot = m.type === 'cow' ? rollCowLoot(this.rand) : m.type === 'seedoil' ? rollSeedOilLoot(this.rand)
          : MOB_TYPES[m.type].flies ? (this.rand() < T.featherChance ? ['bird', 'feather'] : ['bird']) : m.type === 'penguin' ? ['penguin'] : [];
        if (!MOB_TYPES[m.type].passive) {
          const lootMult = this.settings?.loot ?? 1;
          loot.push(...rollCoinLoot(this.rand, lootMult));
          if (this.rand() < T.lootAmmo * lootMult) loot.push('ammo'); // monsters sometimes carry ammo
        }
        for (let i = 0; i < (m.arrows || 0); i++) loot.push('arrow'); // arrows stuck in it fall out (game.js)
        events.push({ type: 'death', ...m.center, mobType: m.type, size: m.size, loot, by: m.lastHit || null });
        if (m.type === 'seedoil' && m.size > 1) splitting.push(m);
      }
      return false;
    });
    for (const m of splitting) this._split(m);
    for (const player of players) this._allergies(dt, player, events);

    this._updateArrows(dt, players);
    return events;
  }

  /** `player` is who this mob deals with (the nearest player it notices, see `ignored`); `nearest` is anyone, for despawning. */
  _think(m, dt, player, nearest, light, events) {
    const t = MOB_TYPES[m.type];
    m.hurtT -= dt;
    m.attackCd -= dt;

    const dx = player.pos.x - m.pos.x;
    const dz = player.pos.z - m.pos.z;
    const dy = player.pos.y - m.pos.y;
    const dist = Math.hypot(dx, dz) || 1e-6;
    const ux = dx / dist;
    const uz = dz / dist;
    const anyDist = Math.hypot(nearest.pos.x - m.pos.x, nearest.pos.z - m.pos.z);

    if (anyDist > T.despawnDistance || m.pos.y < -20 || (!t.passive && light > 0.6 && anyDist > T.mobSight && this.rand() < dt * 0.05)) {
      m.dead = true;
      m.silentDeath = true;
      return;
    }

    // Lava hurts (and keeps hurting) anything that wanders into it.
    if (this.world.getBlock(Math.floor(m.pos.x), Math.floor(m.pos.y + 0.1), Math.floor(m.pos.z)) === LAVA) {
      m.lavaT = (m.lavaT || 0) - dt;
      if (m.lavaT <= 0) { m.lavaT = 0.5; m.damage(3, m.pos.x, m.pos.z, 0); }
    }
    // Spells. Size spells scale the body (and below, its speed and attacks); a polymorphed mob is an
    // infant that sits there coughing until it wears off.
    m.sizeT = Math.max(0, m.sizeT - dt);
    if (m.sizeT <= 0) m.sizeSpell = null;
    m.polyT = Math.max(0, m.polyT - dt);
    m.halluT = Math.max(0, m.halluT - dt);
    m.blindT = Math.max(0, (m.blindT || 0) - dt); // Blind: it can't see anyone
    m.chillT = Math.max(0, m.chillT - dt);
    this._resize(m, sizeScale(m.sizeSpell, this.settings));
    if (m.polyT > 0) {
      m.aiming = false;
      m.walkAmount = 0;
      if ((m.coughT -= dt) <= 0) {
        m.coughT = 1 + this.rand() * 1.5;
        events.push({ type: 'babyCough', ...m.center });
      }
      m.step(dt, 0, 0, false, 0);
      return;
    }
    if (t.flies) {
      this._fly(m, dt, player, dist, events);
      return;
    }

    const seeing = m.halluT > 0 || m.blindT > 0; // busy with monsters only it can see (or blind)
    const sees = !t.passive && !seeing && !ignored(player) && dist < T.mobSight && Math.abs(dy) < 12;
    let wx = 0;
    let wz = 0;
    m.aiming = false;

    if (sees) {
      m.yaw = Math.atan2(-dx, -dz);
      if (t.melee) {
        wx = ux * t.speed;
        wz = uz * t.speed;
        if (dist < 0.9 + t.halfW && Math.abs(dy) < 1.6 && m.attackCd <= 0) {
          player.damage(Math.max(1, Math.round(t.damage * m.scale)), m.pos.x, m.pos.z, (t.knock ?? 6) * m.scale, { cause: 'mob', mob: m.type });
          m.attackCd = 1;
        }
      } else if (m.type === 'skeleton') {
        m.aiming = true;
        if (dist > 11) { wx = ux * t.speed; wz = uz * t.speed; }
        else if (dist < 6) { wx = -ux * t.speed; wz = -uz * t.speed; }
        else {
          if (this.rand() < dt * 0.4) m.strafe *= -1;
          wx = -uz * m.strafe * t.speed * 0.6;
          wz = ux * m.strafe * t.speed * 0.6;
        }
        if (m.attackCd <= 0 && dist < 16) {
          if (this._shoot(m, player)) events.push({ type: 'shoot', ...m.center });
          m.attackCd = 1.8 + this.rand() * 0.8;
        }
      } else if (m.type === 'seedoil') {
        wx = ux * t.speed;
        wz = uz * t.speed;
        const reach = m.halfW + player.halfW + 0.25;
        if (dist < reach && dy < m.height && dy > -1.8 && m.attackCd <= 0) {
          player.damage(Math.max(1, Math.round(m.size * m.scale)), m.pos.x, m.pos.z, (3 + m.size * 2) * m.scale, { cause: 'mob', mob: m.type });
          m.attackCd = 1;
        }
      }
    } else if (t.passive && m.panicT > 0) {
      // Bolt away from the player, zig-zagging a little.
      m.panicT -= dt;
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        m.wanderT = 0.5 + this.rand() * 0.6;
        m.yaw = Math.atan2(dx, dz) + (this.rand() - 0.5) * 1.6;
      }
      wx = -Math.sin(m.yaw) * t.speed * 2.6;
      wz = -Math.cos(m.yaw) * t.speed * 2.6;
    } else if (t.pet && !ignored(player) && dist < T.petNotice && Math.abs(dy) < 8 && (dist > t.follow || (m.following && dist > t.stay))) {
      // Trot over and keep you company.
      m.following = true;
      m.yaw = Math.atan2(-dx, -dz);
      wx = ux * t.speed;
      wz = uz * t.speed;
    } else if (t.pet && !ignored(player) && dist < T.petNotice) {
      m.following = false;
      m.yaw = Math.atan2(-dx, -dz); // sit and stare at you
    } else {
      m.wanderT -= dt;
      if (m.wanderT <= 0 && seeing) { // dodge and lunge at imaginary attackers
        m.wanderT = 0.3 + this.rand() * 0.8;
        m.yaw = this.rand() * Math.PI * 2;
        m.wanderSpeed = t.speed * (0.5 + this.rand() * 0.5);
      } else if (m.wanderT <= 0) {
        m.wanderT = 2 + this.rand() * 4;
        m.yaw = this.rand() * Math.PI * 2;
        m.wanderSpeed = this.rand() < 0.6 ? t.speed * 0.45 : 0;
      }
      wx = -Math.sin(m.yaw) * m.wanderSpeed;
      wz = -Math.cos(m.yaw) * m.wanderSpeed;
    }

    // Gentle separation so crowds don't merge into one blob.
    for (const o of this.list) {
      if (o === m || o.dead) continue;
      const sx = m.pos.x - o.pos.x;
      const sz = m.pos.z - o.pos.z;
      const d = Math.hypot(sx, sz);
      const minD = m.halfW + o.halfW;
      if (d < minD && Math.abs(m.pos.y - o.pos.y) < 1.5) {
        const push = ((minD - d) / minD) * 4;
        if (d > 1e-4) { wx += (sx / d) * push; wz += (sz / d) * push; }
        else { wx += push; }
      }
    }

    // Rooted (an ultimate: Grave Digger, Strangling Vines, Lullaby...): it can't walk anywhere for a while.
    if (m.rootT > 0) { m.rootT -= dt; wx = 0; wz = 0; }

    // The shore: a walker that can't swim (neither natatorial nor aquatic) won't step into water; it turns back.
    if ((wx || wz) && !canMove(m.type, 'natatorial') && !canMove(m.type, 'aquatic') && this._waterSurface(m) === null) {
      const len = Math.hypot(wx, wz);
      const reach = m.halfW + 0.4;
      if (this._wetAhead(m.pos.x + (wx / len) * reach, m.pos.y, m.pos.z + (wz / len) * reach)) {
        wx = 0;
        wz = 0;
        if (!sees) { m.yaw += Math.PI * (0.7 + this.rand() * 0.6); m.wanderT = 0.4; } // wandering: off another way
      }
    }

    const surface = this._waterSurface(m);
    if (surface !== null) { // swimming: slower, and floating chest-deep instead of walking on the water
      const k = t.swim ?? T.mobSwimSpeed;
      wx *= k;
      wz *= k;
    }
    const moving = wx !== 0 || wz !== 0;
    let jump = moving && m.hitWall && (m.onGround || surface !== null); // in water, a wall is the shore: climb out
    let jumpSpeed = T.mobJump;
    if (surface !== null) {
      // Aquatic ones dive after someone under the water; everyone else bobs at floating depth (natatorial or not:
      // one that got knocked in floats, and climbs out at the shore).
      const dive = canMove(m.type, 'aquatic') && sees && player.pos.y + 0.3 < surface - m.height * T.floatDepth;
      if (!jump) m.vel.y = dive ? Math.max(-3, Math.min(3, (player.pos.y - m.pos.y) * 2))
        : Math.max(-2, Math.min(2, (surface - m.height * T.floatDepth - m.pos.y) * 3));
    } else if (m.type === 'seedoil') {
      // Only moves by hopping: sits still on the ground, then leaps in the wished direction.
      m.hopCd -= dt;
      jump = false;
      if (m.onGround) {
        if (moving && m.hopCd <= 0) {
          jump = true;
          m.hopDir = { x: wx, z: wz };
          m.hopCd = 0.9 + this.rand() * 0.8;
        } else {
          wx = 0;
          wz = 0;
        }
      } else {
        wx = m.hopDir.x;
        wz = m.hopDir.z;
      }
      jumpSpeed = 6.5 + m.size * 0.6;
    }
    const pace = sizeSpeed(m.sizeSpell, this.settings) // shrunk: slower; enlarged: the Enlarged speed setting
      * (m.chillT > 0 ? magic(this.settings, 'chillSpeed') / 100 : 1);
    m.step(dt, wx * pace, wz * pace, jump, jumpSpeed);
    const speed = Math.hypot(wx, wz);
    m.walkPhase += speed * dt * 3;
    m.walkAmount += ((speed > 0 ? 1 : 0) - m.walkAmount) * Math.min(1, dt * 8);

    // Undead burn in direct sunlight.
    m.burnCheck -= dt;
    if (m.burnCheck <= 0) {
      m.burnCheck = 1;
      m.burning = t.burns && light > 0.6 && !m.inWater && this._skyExposed(m);
      if (m.burning) {
        m.hp -= 3;
        m.hurtT = 0.2;
        if (m.hp <= 0) m.dead = true;
      }
    }
  }

  _skyExposed(m) {
    const x = Math.floor(m.pos.x);
    const z = Math.floor(m.pos.z);
    for (let y = Math.floor(m.pos.y + m.height); y < CH; y++) {
      if (this.world.getBlock(x, y, z) !== AIR) return false;
    }
    return true;
  }

  /** Top block of column (x, z) if it's solid ground with 2 blocks of air above. */
  _surface(x, z) {
    let y = CH - 1;
    while (y > 0 && this.world.getBlock(x, y, z) === AIR) y--;
    const ground = this.world.getBlock(x, y, z);
    if (!SOLID[ground] || LEAFY[ground]) return null;
    if (this.world.getBlock(x, y + 1, z) !== AIR || this.world.getBlock(x, y + 2, z) !== AIR) return null;
    return { x, y, z, ground };
  }

  /**
   * A Backrooms creature in a dark room (one without a light panel), on the floor, 24-40 blocks away
   * (or at `at`). Returns the mob, or null if the spot's no good.
   */
  _trySpawnBackrooms(player, at = this._ringPoint(player)) {
    const [x, z] = at;
    const info = this.world.biomeAt(x, z);
    if (info.biome !== 'backrooms' || info.s < 1 || !this.world.backroomsDark(x, z)) return null;
    const y = this.world.heightAt(x, z) + 1; // the floor (under the ceiling)
    if (this.world.getBlock(x, y, z) !== AIR || this.world.getBlock(x, y + 1, z) !== AIR) return null; // a wall
    const choices = Object.entries(MOB_TYPES).filter(([, def]) => def.habitat === 'backrooms');
    let pick = this.rand() * choices.reduce((a, [, d]) => a + d.weight, 0);
    let type = choices[0][0];
    for (const [name, def] of choices) if ((pick -= def.weight) < 0) { type = name; break; }
    const mob = this.spawn(type, x + 0.5, y, z + 0.5);
    if (mob.collides()) { this.list.pop(); return null; }
    return mob;
  }

  /** Is (x, z) a cold place: snow, ice, or the taiga? */
  _cold(x, z, ground) {
    return ground === SNOW_GRASS || ground === ICE || this.world.biomeAt(x, z).biome === 'taiga';
  }

  /** Is there water within `r` blocks of (x, y, z) (around that height)? */
  _nearWater(x, y, z, r) {
    for (let dz = -r; dz <= r; dz += 3) {
      for (let dx = -r; dx <= r; dx += 3) {
        for (let dy = 1; dy >= -3; dy--) if (this.world.getBlock(x + dx, y + dy, z + dz) === WATER) return true;
      }
    }
    return false;
  }

  _ringPoint(player, min = T.spawnMin, span = T.spawnSpan) {
    const a = this.rand() * Math.PI * 2;
    const r = min + this.rand() * span;
    return [Math.floor(player.pos.x + Math.cos(a) * r), Math.floor(player.pos.z + Math.sin(a) * r)];
  }

  /** Cough or sneeze while pets are close; closer company means more frequent symptoms. */
  _allergies(dt, player, events) {
    if (player.dead) return;
    let left = this.allergyT.get(player) ?? 1;
    const c = player.center;
    let exposure = 0;
    for (const m of this.list) {
      if (!MOB_TYPES[m.type].pet || m.dead) continue;
      const mc = m.center;
      if (Math.hypot(mc.x - c.x, mc.y - c.y, mc.z - c.z) < T.allergyRadius) exposure++;
    }
    if (!exposure) {
      this.allergyT.set(player, Math.max(left, 1));
      return;
    }
    left -= dt * exposure;
    if (left > 0) {
      this.allergyT.set(player, left);
      return;
    }
    this.allergyT.set(player, 1.4 + this.rand() * 1.4);
    const sneeze = this.rand() < 0.4;
    const damage = sneeze ? T.sneezeDamage : T.coughDamage;
    player.damage(damage, player.pos.x, player.pos.z, 0, { cause: 'allergy' });
    events.push({ type: sneeze ? 'sneeze' : 'cough', damage, player });
  }

  /** A lone cat or dog on grass 14-24 blocks away. */
  _trySpawnPet(player) {
    const [x, z] = this._ringPoint(player, T.petSpawnMin, T.petSpawnSpan);
    const spot = this._surface(x, z);
    if (!spot || spot.ground !== GRASS) return null;
    const pet = this.spawn(this.rand() < 0.5 ? 'cat' : 'dog', spot.x + 0.5, spot.y + 1, spot.z + 0.5);
    if (pet.collides()) { this.list.pop(); return null; }
    return pet;
  }

  /** 2-4 cows (at most `room`) on grass somewhere 24-40 blocks away. */
  /** A flock of one species, in the air somewhere 24-40 blocks away. Seagulls by the sea, the rest inland. */
  _trySpawnFlock(player, room) {
    const [cx, cz] = this._ringPoint(player);
    let top = CH - 1;
    while (top > 0 && this.world.getBlock(cx, top, cz) === AIR) top--;
    const ground = this.world.getBlock(cx, top, cz);
    if (LEAFY[ground] && this.rand() < 0.5) return 0;
    let type = 'seagull';
    if (!this._nearWater(cx, top, cz, 12)) { // seagulls only where there's water nearby (not just sand: no seagulls in the desert)
      let pick = this.rand();
      type = INLAND_BIRDS.find(([, w]) => (pick -= w) < 0)?.[0] ?? 'bird';
    }
    const t = MOB_TYPES[type];
    const n = Math.min(room, t.flock[0] + Math.floor(this.rand() * (t.flock[1] - t.flock[0] + 1)));
    const yaw = this.rand() * Math.PI * 2;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const b = this.spawn(type, cx + 0.5 + (this.rand() - 0.5) * 3, top + 1 + t.cruise[0] + this.rand() * 2, cz + 0.5 + (this.rand() - 0.5) * 3);
      if (b.collides()) { this.list.pop(); continue; }
      b.yaw = yaw + (this.rand() - 0.5) * 0.4; // a flock heads the same way
      b.cruise = t.cruise[0] + this.rand() * (t.cruise[1] - t.cruise[0]);
      made++;
    }
    return made;
  }

  /** The top of the water (or lava, or ball pit) a walking mob is in, or null if it isn't in any. */
  /** Grows or shrinks a mob towards `scale` (its size spell): as big as there's room for, when growing. */
  _resize(m, scale) {
    if (m.scale === scale) return;
    m.scale = m.fitScale(m.scale, scale, (k) => { m.halfW = m.baseHalfW * k; m.height = m.baseHeight * k; });
  }

  /** Is there water where a walker would step at (x, z): at its feet, or a step or two down? */
  _wetAhead(x, y, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const feet = Math.floor(y + 0.1);
    for (let dy = 0; dy >= -2; dy--) {
      const id = this.world.getBlock(bx, feet + dy, bz);
      if (FLUID[id]) return true;
      if (SOLID[id]) return false; // ground first: dry
    }
    return false;
  }

  /**
   * Birds never go under: none of them is aquatic. Pops one that's ended up in water back to the surface
   * (`floating` if it can sit on water, i.e. it's natatorial). Returns the surface's height, or null if dry.
   */
  _keepAboveWater(m) {
    const bx = Math.floor(m.pos.x);
    const bz = Math.floor(m.pos.z);
    let y = Math.floor(m.pos.y);
    if (!FLUID[this.world.getBlock(bx, y, bz)]) return null;
    while (FLUID[this.world.getBlock(bx, y + 1, bz)] && y < CH) y++;
    m.pos.y = y + 1;
    if (m.vel.y < 0) m.vel.y = 0;
    return y + 1;
  }

  _waterSurface(m) {
    const x = Math.floor(m.pos.x);
    const z = Math.floor(m.pos.z);
    let y = Math.floor(m.pos.y + 0.1);
    if (!FLUID[this.world.getBlock(x, y, z)]) return null;
    while (FLUID[this.world.getBlock(x, y + 1, z)] && y < m.pos.y + m.height + 2) y++;
    return y + 1;
  }

  /**
   * Birds: no gravity. They cruise a few blocks above the ground, wheel about, sometimes land to
   * peck, and take off (fleeing, and climbing) when you get close or hurt them.
   */
  _fly(m, dt, player, dist, events) {
    const t = MOB_TYPES[m.type];
    m.wanderT -= dt;
    // Seagulls: swoop on anyone holding food, snatch it, and make off with it.
    const food = (h) => player.food?.[player.hands?.[h]] > 0 ? h : null;
    const hand = t.thief && !ignored(player) && !(m.panicT > 0) && (food('right') || food('left'));
    if (hand && dist < 14) {
      const d3 = Math.hypot(player.pos.x - m.pos.x, player.pos.y + 1.4 - m.pos.y, player.pos.z - m.pos.z);
      if (d3 < T.seagullReach) {
        const kind = player.hands[hand];
        player.food[kind]--;
        events.push({ type: 'stolen', player, kind });
        m.panicT = 6; // off with the loot
      } else {
        m.perched = false;
        m.yaw = Math.atan2(m.pos.x - player.pos.x, m.pos.z - player.pos.z);
        const sp = t.speed * 1.4;
        const dy = player.pos.y + 1.4 - m.pos.y;
        m.vel = { x: -Math.sin(m.yaw) * sp, y: Math.max(-5, Math.min(5, dy * 2)), z: -Math.cos(m.yaw) * sp };
        m.move(m.vel.x * dt, m.vel.y * dt, m.vel.z * dt);
        this._keepAboveWater(m); // (not even for a sandwich)
        m.walkPhase += dt * 12;
        m.walkAmount = 1;
        return;
      }
    }
    m.panicT = Math.max(0, (m.panicT || 0) - dt);
    if (m.perched && !ignored(player) && dist < T.birdSpook) m.panicT = 3;
    if (m.panicT > 0) m.perched = false;
    if (m.wanderT <= 0) {
      m.wanderT = 2 + this.rand() * 4;
      if (m.perched) m.perched = this.rand() < 0.5; // keep pecking a while, or take off
      else if (this.rand() < t.perch) m.perched = true; // come down and peck
      m.turn = (this.rand() - 0.5) * 1.2; // radians per second
      m.cruise = t.cruise[0] + this.rand() * (t.cruise[1] - t.cruise[0]);
    }
    // Height of the ground below (the water's surface counts: they fly over it, never into it).
    let g = Math.floor(m.pos.y);
    const bx = Math.floor(m.pos.x);
    const bz = Math.floor(m.pos.z);
    while (g > 0 && !SOLID[this.world.getBlock(bx, g - 1, bz)] && !FLUID[this.world.getBlock(bx, g - 1, bz)] && m.pos.y - g < 24) g--;
    const overWater = !!FLUID[this.world.getBlock(bx, g - 1, bz)];
    const swims = canMove(m.type, 'natatorial'); // seagulls settle on the water; the others only land on dry ground
    if (m.perched && overWater && !swims) m.perched = false;
    let speed = t.speed;
    let vy;
    if (m.panicT > 0) {
      m.yaw = Math.atan2(m.pos.x - player.pos.x, m.pos.z - player.pos.z) + Math.PI + Math.sin(m.wanderT * 3) * 0.3; // away from you
      speed *= 1.8;
      vy = 3.5;
    } else if (m.perched) {
      speed = m.onGround ? 0 : speed * 0.6;
      vy = -2.5;
    } else {
      m.yaw += (m.turn || 0) * dt;
      vy = Math.max(-3, Math.min(3, (g + (m.cruise || 4) - m.pos.y) * 1.5)) + Math.sin(m.walkPhase * 0.15) * 0.4;
    }
    m.vel = { x: -Math.sin(m.yaw) * speed, y: vy, z: -Math.cos(m.yaw) * speed };
    m.move(m.vel.x * dt, m.vel.y * dt, m.vel.z * dt);
    const surface = this._keepAboveWater(m);
    // Floating: a seagull that's come down on the water sits on it, bobbing (and drifts off again later).
    const floating = surface !== null && swims && m.perched;
    if (floating) { m.pos.x -= m.vel.x * dt * 0.8; m.pos.z -= m.vel.z * dt * 0.8; m.pos.y = surface - 0.08 + Math.sin(m.walkPhase * 0.5) * 0.03; }
    if (m.hitWall) { m.yaw += Math.PI * (0.6 + this.rand() * 0.8); m.pos.y += 0.05; } // bonk: turn away
    const sitting = (m.onGround || floating) && m.perched;
    m.walkPhase += dt * (sitting ? 2 : 14); // wingbeats (a slow peck when perched)
    m.walkAmount = sitting ? 0 : 1;
  }

  _trySpawnHerd(player, room) {
    const [cx, cz] = this._ringPoint(player);
    const centre = this._surface(cx, cz);
    if (!centre || centre.ground !== GRASS) return 0;
    const n = Math.min(room, 2 + Math.floor(this.rand() * 3));
    let made = 0;
    for (let attempt = 0; attempt < n * 3 && made < n; attempt++) {
      const spot = this._surface(cx + Math.floor((this.rand() - 0.5) * 6), cz + Math.floor((this.rand() - 0.5) * 6));
      if (!spot || spot.ground !== GRASS) continue;
      const cow = this.spawn('cow', spot.x + 0.5, spot.y + 1, spot.z + 0.5);
      if (cow.collides()) { this.list.pop(); continue; }
      made++;
    }
    return made;
  }

  /** A night monster for a spot: penguins only where it's cold (and three times as many there), Tung Tung Tung Sahur only before dawn. */
  _pickNight(cold) {
    const choices = Object.entries(MOB_TYPES).filter(([, def]) => def.weight > 0 && def.habitat !== 'backrooms' && (def.habitat !== 'cold' || cold) && (!def.sahur || this._sahur()))
      .map(([name, def]) => [name, def.weight * (def.habitat === 'cold' ? 3 : 1)]);
    const total = choices.reduce((a, [, w]) => a + w, 0);
    let pick = this.rand() * Math.max(total, 1);
    for (const [name, w] of choices) if ((pick -= w) < 0) return name;
    return 'zombie';
  }

  /** Is this player down in a cave (where it's dark whatever the time)? */
  _underground(player) {
    return !!this.world.caveShadeAt && this.world.caveShadeAt(player.pos.x, player.pos.y + 1, player.pos.z) < 0.5;
  }

  /** A monster somewhere dark in the cave around a player: 10-26 blocks off, on a floor near their height, away from lava lamps. */
  _trySpawnCave(player) {
    for (let tries = 0; tries < 6; tries++) {
      const ang = this.rand() * Math.PI * 2;
      const d = 10 + this.rand() * 16;
      const x = Math.floor(player.pos.x + Math.cos(ang) * d);
      const z = Math.floor(player.pos.z + Math.sin(ang) * d);
      const lowest = Math.max(1, Math.floor(player.pos.y) - 10);
      let y = Math.floor(player.pos.y) + 6;
      const floorAt = (yy) => SOLID[this.world.getBlock(x, yy - 1, z)] && !LEAFY[this.world.getBlock(x, yy - 1, z)] && this.world.getBlock(x, yy, z) === AIR && this.world.getBlock(x, yy + 1, z) === AIR;
      while (y > lowest && !floorAt(y)) y--;
      if (y <= lowest || this.world.caveShadeAt(x, y + 1, z) >= 0.4 || this._nearLamp(x, y, z)) continue;
      const type = this._pickNight(false);
      const mob = this.spawn(type, x + 0.5, y, z + 0.5, type === 'seedoil' ? 1 + Math.floor(this.rand() * T.seedOilMaxSize) : 1);
      if (mob.collides()) { this.list.pop(); continue; }
      return mob;
    }
    return null;
  }

  /** Before dawn: from T.sahurStart (an hour of the night) until sunrise. `time` is the game's (set every tick). */
  _sahur() {
    if (!Number.isFinite(this.time)) return false;
    const hour = (this.time * 24 + 6) % 24; // (time 0 is sunrise, 06:00)
    return hour >= T.sahurStart && hour < 6;
  }

  _trySpawn(player) {
    const [x, z] = this._ringPoint(player);
    const spot = this._surface(x, z);
    if (!spot) return null;
    const y = spot.y;
    if (this._nearLamp(x, y + 1, z)) return null; // lava lamps keep the night away

    // Only creatures that belong here: penguins where it's cold (and three times as many there).
    const cold = this._cold(x, z, spot.ground);
    if (this.world.biomeAt(x, z).biome === 'backrooms') return this._trySpawnBackrooms(player, [x, z]); // (not on the roof: inside, in the dark)
    const type = this._pickNight(cold);
    const size = type === 'seedoil' ? 1 + Math.floor(this.rand() * T.seedOilMaxSize) : 1;
    const mob = this.spawn(type, x + 0.5, y + 1, z + 0.5, size);
    if (mob.collides()) {
      this.list.pop(); // too big for this spot
      return null;
    }
    return mob;
  }

  /** Is there a lava lamp within T.lampSafe blocks (in any direction, up and down included)? */
  _nearLamp(x, y, z) {
    const r2 = T.lampSafe * T.lampSafe;
    for (let dy = -T.lampSafe; dy <= T.lampSafe; dy++) {
      for (let dz = -T.lampSafe; dz <= T.lampSafe; dz++) {
        for (let dx = -T.lampSafe; dx <= T.lampSafe; dx++) {
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          if (this.world.getBlock(x + dx, y + dy, z + dz) === LAVA_LAMP) return true;
        }
      }
    }
    return false;
  }

  /** A dying Seed Oil bursts into two smaller ones. */
  _split(m) {
    for (let i = 0; i < 2; i++) {
      const a = this.rand() * Math.PI * 2;
      const off = 0.3 * m.size;
      const kid = this.spawn('seedoil', m.pos.x + Math.cos(a) * off, m.pos.y, m.pos.z + Math.sin(a) * off, m.size - 1);
      if (kid.collides()) kid.pos = { ...m.pos };
      kid.impulse(Math.cos(a) * 3, 5, Math.sin(a) * 3);
      kid.hopCd = 0.6;
    }
  }

  // ---------- arrows ----------

  _shoot(m, player) {
    const from = { x: m.pos.x, y: m.pos.y + 1.6, z: m.pos.z };
    const to = { x: player.pos.x, y: player.pos.y + 1.2, z: player.pos.z };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    // Need a clear line of sight.
    const hit = this.world.raycast(from, { x: dx / dist, y: dy / dist, z: dz / dist }, dist);
    if (hit && hit.t < dist) return false;

    const horiz = Math.hypot(dx, dz);
    const flight = horiz / T.arrowSpeed;
    const spread = () => (this.rand() - 0.5) * 1.2;
    const vel = {
      x: dx / flight + spread(),
      y: dy / flight + 0.5 * T.arrowGravity * flight + spread(),
      z: dz / flight + spread(),
    };
    const lead = 0.5 / Math.hypot(vel.x, vel.y, vel.z);
    this.arrows.push({
      id: this.nextId++,
      pos: { x: from.x + vel.x * lead, y: from.y + vel.y * lead, z: from.z + vel.z * lead },
      vel,
      age: 0,
      stuck: false,
      damage: Math.max(1, Math.round(T.arrowDamage * m.scale)), // a shrunk skeleton's arrows are tiny
    });
    return true;
  }

  _updateArrows(dt, players) {
    this.arrows = this.arrows.filter((a) => {
      a.age += dt;
      if (a.stuck) return a.age < 6;
      if (a.age > 5) return false;
      a.vel.y -= T.arrowGravity * dt;
      const steps = Math.max(1, Math.ceil((Math.hypot(a.vel.x, a.vel.y, a.vel.z) * dt) / 0.25));
      for (let s = 0; s < steps; s++) {
        const prev = { ...a.pos };
        a.pos.x += (a.vel.x * dt) / steps;
        a.pos.y += (a.vel.y * dt) / steps;
        a.pos.z += (a.vel.z * dt) / steps;
        const hit = players.find((pl) => !ignored(pl) && pl.containsPoint(a.pos, 0.1));
        if (hit) {
          hit.damage(a.damage ?? T.arrowDamage, a.pos.x - a.vel.x, a.pos.z - a.vel.z, 4, { cause: 'mob', mob: 'skeleton' });
          return false;
        }
        const id = this.world.getBlock(Math.floor(a.pos.x), Math.floor(a.pos.y), Math.floor(a.pos.z));
        if (SOLID[id]) {
          a.pos = prev;
          a.stuck = true;
          a.age = 0;
          return true;
        }
        if (FLUID[id]) return false;
      }
      return true;
    });
  }
}


// ---------- Server settings: every creature's numbers, and spawning ----------
tune('Monsters & animals', {
  monsterInterval: [1, 'Monster spawn interval', 'Seconds between monster spawn attempts at night (divided by Monster spawns)', { unit: ' s', min: 0.1 }],
  spawnMin: [24, 'Spawn distance', 'Closest a monster, herd or flock spawns to you, in blocks'],
  spawnSpan: [16, 'Spawn distance spread', 'How much farther than that they can spawn'],
  petSpawnMin: [14, 'Pet spawn distance', 'Closest a pet turns up to you'],
  petSpawnSpan: [10, 'Pet spawn distance spread', 'How much farther than that'],
  herdInterval: [4, 'Herd/flock interval', 'Seconds between daytime herd and flock spawn attempts', { unit: ' s', min: 0.5 }],
  flockChance: [0.5, 'Flock chance', 'Chance a flock of birds comes each attempt', { max: 1, step: 0.05 }],
});
const MOB_NAMES = { zombie: 'Zombie', skeleton: 'Skeleton', penguin: 'Knife Penguin', clerk: 'Clerk', mildew: 'Mildew',
  amalgam: 'Amalgamation', sahur: 'Tung Tung Tung Sahur', pomodorino: 'Pomodorino Pugnolino', lavatricio: 'Lavatricio Giraffone', ventilone: 'Ventilone Fenicotterone',
  seedoil: 'Seed Oil', cow: 'Cow', cat: 'Cat', dog: 'Dog', bird: 'Bluebird', munia: 'Munia', finch: 'Finch', seagull: 'Seagull', nutmunch: 'Nutmunch' };
for (const [k, t] of Object.entries(MOB_TYPES)) {
  const name = MOB_NAMES[k] || k;
  bindTunable(t, 'hp', 'Monsters & animals', `hp_${k}`, `${name} health`, t.sized ? 'Health per size step' : 'Health');
  bindTunable(t, 'speed', 'Monsters & animals', `speed_${k}`, `${name} speed`, 'Blocks per second');
  if ('damage' in t) bindTunable(t, 'damage', 'Monsters & animals', `damage_${k}`, `${name} damage`, 'Damage per hit');
  if ('knock' in t) bindTunable(t, 'knock', 'Monsters & animals', `knock_${k}`, `${name} knockback`, 'How hard a hit shoves you');
  if (!t.passive) bindTunable(t, 'weight', 'Monsters & animals', `weight_${k}`, `${name} spawn weight`, 'How often it spawns compared with other monsters (0: never)', { max: 2, step: 0.01 });
}
