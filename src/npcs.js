// Townsfolk: the people of the Fantasy Town. Every market square has its five shopkeepers (the blacksmith,
// the healer, the innkeeper, the fletcher and the wizard), each behind their counter, and a handful of
// villagers wandering about the plaza. They come out when a player is near a market and go when everyone
// has left. Who they are (names, looks, the `key` quests remember them by) comes from the seed and the
// market's position, so the same people are there every time you come back. They can't be hurt, and mobs
// ignore them. Talking to them (game.js `_talk`) is how you get quests (quests.js). Logic only: no Three.js,
// no DOM.

import { T, tune } from './tuning.js';
import { Body } from './body.js';
import { hash2 } from './noise.js';
import { MARKET, MARKET_ARRIVAL, MARKET_SHOPKEEPERS, marketOpenSpot } from './townplan.js';
import { SKINS, HAIRSTYLES, HAIR_COLORS, SHIRT_COLORS, PANTS_COLORS } from './characters.js';

tune('Quests', {
  npcWanderers: [6, 'Villagers per market', 'Townsfolk wandering about each market square', { step: 1, min: 0, max: 20 }],
  npcRange: [140, 'Townsfolk range', 'Townsfolk come out when someone is this close to the middle of a market square', { min: 30, max: 400, step: 10 }],
  npcWalk: [1.3, 'Villager walking speed', 'Blocks per second', { min: 0, max: 6, step: 0.1 }],
});

/**
 * What each kind of townsperson is called and looks like. `hands` and `worn` are what avatars.js draws them
 * holding and wearing; `look` fixes parts of their look (the rest comes from their name's hash).
 */
export const ROLES = {
  blacksmith: { title: 'the Blacksmith', hands: { left: 'empty', right: 'pick' }, worn: 'leather', look: { shirt: 0x3a3a3a, pants: 0x1a1a1a, hair: 'bald' } },
  healer: { title: 'the Healer', hands: { left: 'empty', right: 'potion' }, look: { shirt: 0xecf0f1, pants: 0x3a5a3a } },
  tavern: { title: 'the Innkeeper', hands: { left: 'empty', right: 'ale' }, look: { shirt: 0x8a5a2a, pants: 0x5a4a3a } },
  fletcher: { title: 'the Fletcher', hands: { left: 'shortbow', right: 'empty' }, look: { shirt: 0x3a6a3a, pants: 0x5a4a3a } },
  wizard: { title: 'the Wizard', hands: { left: 'staff', right: 'staff' }, look: { shirt: 0x5a3aa8, pants: 0x4a4a6a, hair: 'long', hairColor: 0xd8d8d8 } },
  villager: { title: '', hands: { left: 'empty', right: 'empty' }, look: {} },
};
/** Things villagers carry about (one each, or nothing). */
const VILLAGER_HANDS = ['empty', 'empty', 'bread', 'bucket', 'tiller', 'stick', 'cabbage', 'empty'];

const FIRST = ['Alder', 'Bramble', 'Corwin', 'Dorrit', 'Elspeth', 'Fennick', 'Gisla', 'Hobb', 'Ivo', 'Jessamy', 'Kettle', 'Lowell',
  'Maudie', 'Nettle', 'Oswin', 'Perrin', 'Quenby', 'Rook', 'Saffi', 'Tobin', 'Ulla', 'Wystan', 'Yarra', 'Bertolt', 'Clemency',
  'Dagny', 'Emrys', 'Florian', 'Greer', 'Haddie', 'Isembard', 'Juno', 'Linnea', 'Mabyn', 'Noll', 'Odile', 'Piety', 'Ravel', 'Sorrel', 'Tamsin'];
const LAST = ['Applewhite', 'Brackenridge', 'Cobbleford', 'Dunmore', 'Elmsworth', 'Fernsby', 'Goodbarrow', 'Hollins', 'Inchcape',
  'Kettlewell', 'Longacre', 'Millbrook', 'Nethercott', 'Oakhurst', 'Puddifoot', 'Quarrender', 'Rushby', 'Stillwater', 'Thistlewood', 'Underhill'];

const SPAWN_CHECK = 2; // seconds between looks for markets near players (plumbing)

/** A townsperson: a body that walks (villagers) or stands at its counter (shopkeepers). */
export class Npc extends Body {
  constructor(world, o) {
    super(world, 0.3, 1.8);
    Object.assign(this, o);
    this.goal = null; // where a villager is walking to
    this.waitT = 0; // seconds a villager stands about before walking somewhere else
    this.stuckT = 0;
    this.talkT = 0; // seconds it stays still, facing whoever talked to it
    this.talkTo = null;
  }
}

export class Npcs {
  constructor(world, rand = Math.random) {
    this.world = world;
    this.rand = rand;
    this.list = [];
    this.markets = new Map(); // "ox,oz" (the market square's north-west corner) -> its townsfolk
    this.nextId = 1;
    this.checkT = 0;
  }

  get(id) {
    return this.list.find((n) => n.id === id) || null;
  }

  /** Brings townsfolk out near players (and sends them home when nobody's about), then moves them. `players` are Player bodies. */
  update(dt, players) {
    if ((this.checkT -= dt) <= 0) {
      this.checkT = SPAWN_CHECK;
      this._populate(players);
    }
    for (const n of this.list) this._think(n, dt, players);
  }

  /** Which market squares should have their people out: any with a player within range of its middle. */
  _populate(players) {
    const want = new Set();
    for (const p of players) {
      const m = this.world.findMarket(p.pos.x, p.pos.z, T.npcRange + MARKET);
      if (!m) continue;
      const ox = Math.round(m.x - MARKET_ARRIVAL.x);
      const oz = Math.round(m.z - MARKET_ARRIVAL.z);
      if (Math.hypot(p.pos.x - (ox + MARKET / 2), p.pos.z - (oz + MARKET / 2)) <= T.npcRange) want.add(`${ox},${oz}`);
    }
    for (const key of [...this.markets.keys()]) if (!want.has(key)) this._clear(key);
    for (const key of want) {
      if (!this.markets.has(key)) this._fill(key);
      else this._recount(key); // (the villagers setting may have changed)
    }
  }

  _clear(key) {
    const gone = new Set(this.markets.get(key));
    this.list = this.list.filter((n) => !gone.has(n));
    this.markets.delete(key);
  }

  /** A market square's people: its shopkeepers, then the villagers. */
  _fill(key) {
    const [ox, oz] = key.split(',').map(Number);
    const folk = [];
    this.markets.set(key, folk);
    const used = new Set(); // (no two people in one market share a first name)
    MARKET_SHOPKEEPERS.forEach((s, i) => {
      const x = ox + s.x;
      const z = oz + s.z;
      const counter = { x: ox + s.counter.x, y: this.world.heightAt(ox + s.counter.x, oz + s.counter.z) + 1, z: oz + s.counter.z };
      folk.push(this._spawn({ key: `${s.role}@${key}`, role: s.role, x, z, yaw: s.yaw, home: { x, z, yaw: s.yaw }, counter, ...this._identity(ox, oz, i, s.role, used) }));
    });
    this._recount(key);
  }

  /** Adds or sends home villagers so the market has the number the setting asks for. */
  _recount(key) {
    const [ox, oz] = key.split(',').map(Number);
    const folk = this.markets.get(key);
    const villagers = folk.filter((n) => n.role === 'villager');
    const want = Math.max(0, Math.round(T.npcWanderers));
    if (villagers.length > want) {
      const gone = new Set(villagers.slice(want));
      this.list = this.list.filter((n) => !gone.has(n));
      this.markets.set(key, folk.filter((n) => !gone.has(n)));
      return;
    }
    const used = new Set(folk.map((n) => n.first));
    for (let i = villagers.length; i < want; i++) {
      const spot = this._openSpot(ox, oz);
      if (!spot) break;
      folk.push(this._spawn({ key: `villager${i}@${key}`, role: 'villager', x: spot.x, z: spot.z, yaw: this.rand() * Math.PI * 2, home: null, counter: null,
        market: { x: ox, z: oz }, ...this._identity(ox, oz, 100 + i, 'villager', used) }));
    }
  }

  _spawn(o) {
    const n = new Npc(this.world, { id: this.nextId++, ...o });
    n.pos = { x: o.x, y: this.world.heightAt(Math.floor(o.x), Math.floor(o.z)) + 1, z: o.z };
    delete n.x;
    delete n.z;
    this.list.push(n);
    return n;
  }

  /** A random open spot on a market square's plaza (world coordinates, the middle of a block), or null. */
  _openSpot(ox, oz) {
    for (let i = 0; i < 30; i++) {
      const px = Math.floor(this.rand() * MARKET);
      const pz = Math.floor(this.rand() * MARKET);
      if (marketOpenSpot(px, pz)) return { x: ox + px + 0.5, z: oz + pz + 0.5 };
    }
    return null;
  }

  /** Who someone is: their name and look, from the seed and where they live (the same every visit). */
  _identity(ox, oz, i, role, used) {
    const h = (k) => hash2(ox * 31 + i, oz * 17 - i, this.world.seed + 9001 + k);
    let f = Math.floor(h(0) * FIRST.length);
    while (used.has(FIRST[f])) f = (f + 1) % FIRST.length;
    used.add(FIRST[f]);
    const first = FIRST[f];
    const r = ROLES[role];
    const name = role === 'villager' ? `${first} ${LAST[Math.floor(h(1) * LAST.length)]}` : `${first} ${r.title}`;
    const hairs = Object.keys(HAIRSTYLES);
    const look = {
      skin: Math.floor(h(2) * SKINS.length), hair: hairs[Math.floor(h(3) * hairs.length)], hairColor: HAIR_COLORS[Math.floor(h(4) * HAIR_COLORS.length)],
      brows: h(5) < 0.15 ? 'uni' : 'dual', head: 'normal',
      shirt: SHIRT_COLORS[Math.floor(h(6) * SHIRT_COLORS.length)], pants: PANTS_COLORS[Math.floor(h(7) * PANTS_COLORS.length)],
      ...r.look,
    };
    const carry = VILLAGER_HANDS[Math.floor(h(8) * VILLAGER_HANDS.length)];
    const hands = role === 'villager' ? { left: 'empty', right: carry } : { ...r.hands };
    return { first, name, look, hands, worn: r.worn || null };
  }

  _think(n, dt, players) {
    let nearest = null;
    let nd = Infinity;
    for (const p of players) {
      if (p.dead) continue;
      const d = Math.hypot(p.pos.x - n.pos.x, p.pos.z - n.pos.z);
      if (d < nd) { nd = d; nearest = p; }
    }
    const face = (x, z) => { n.yaw = Math.atan2(-(x - n.pos.x), -(z - n.pos.z)); };
    n.talkT = Math.max(0, n.talkT - dt);
    let wx = 0;
    let wz = 0;
    if (n.talkT > 0 && n.talkTo) face(n.talkTo.x, n.talkTo.z); // listening
    else if (n.home) { // a shopkeeper: behind the counter, watching customers come in
      if (Math.hypot(n.pos.x - n.home.x, n.pos.z - n.home.z) > 0.6) {
        const d = Math.hypot(n.home.x - n.pos.x, n.home.z - n.pos.z);
        wx = ((n.home.x - n.pos.x) / d) * 1.5;
        wz = ((n.home.z - n.pos.z) / d) * 1.5;
        face(n.home.x, n.home.z);
      } else if (nearest && nd < 7) face(nearest.pos.x, nearest.pos.z);
      else n.yaw = n.home.yaw;
    } else if (nearest && nd < 2.2) face(nearest.pos.x, nearest.pos.z); // someone's right here: stop and say hello
    else {
      // A villager: stroll to an open spot on the plaza, stand about a while, then somewhere else.
      if (!n.goal) {
        if ((n.waitT -= dt) <= 0) {
          n.goal = this._openSpot(n.market.x, n.market.z);
          n.stuckT = 0;
        }
      }
      if (n.goal) {
        const dx = n.goal.x - n.pos.x;
        const dz = n.goal.z - n.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          n.goal = null;
          n.waitT = 3 + this.rand() * 8;
        } else {
          wx = (dx / d) * T.npcWalk;
          wz = (dz / d) * T.npcWalk;
          face(n.goal.x, n.goal.z);
          // Walked into something (the fountain's rim, a wall, a lamp post): give up and go somewhere else.
          if (n.hitWall) n.stuckT += dt;
          if (n.stuckT > 0.6) {
            n.goal = null;
            n.waitT = 0.5 + this.rand();
          }
        }
      }
    }
    // Someone who wandered off (or fell somewhere odd) is put back on the plaza.
    if (n.pos.y < 1 || (n.market && Math.hypot(n.pos.x - (n.market.x + MARKET / 2), n.pos.z - (n.market.z + MARKET / 2)) > MARKET)) {
      const spot = n.home || this._openSpot(n.market.x, n.market.z) || { x: n.market.x + MARKET_ARRIVAL.x, z: n.market.z + MARKET_ARRIVAL.z };
      n.pos = { x: spot.x, y: this.world.heightAt(Math.floor(spot.x), Math.floor(spot.z)) + 1, z: spot.z };
      n.vel = { x: 0, y: 0, z: 0 };
    }
    n.step(dt, wx, wz, false, 0);
  }
}
