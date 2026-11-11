// Block gravity: every block falls unless it's grounded, i.e. joined to the world's floor (y = 0)
// through a chain of touching blocks (any block but air and fluids). Only blocks near a change are
// checked: generated terrain stays put until someone edits next to it. An unsupported structure falls
// as one rigid piece (a tree whose trunk you cut, a bridge whose pillar you blew up), speeding up as it
// goes, and stops when it lands on something. Players and monsters in the way hold it up and get
// crushed. Fluids don't hold anything up, but falling blocks sink through them (the fluid closes in
// behind), and ice floats on water. Logic only: no Three.js, no DOM (the server runs it).

import { T, tune } from './tuning.js';
import { AIR, WATER, ICE, FLUID } from './blocks.js';
import { CH } from './world.js';

tune('Blocks', {
  blockGravity: [true, 'Block gravity', 'Blocks that aren\'t joined to the ground by other blocks fall'],
  blockFallAccel: [30, 'Falling block acceleration', 'How fast falling blocks speed up', { unit: ' blocks/s²', min: 1, max: 100, step: 1 }],
  blockFallSpeed: [40, 'Falling block top speed', 'The fastest a falling block goes', { unit: ' blocks/s', min: 1, max: 100, step: 1 }],
  blockFallLimit: [5000, 'Biggest falling structure', 'Unsupported structures bigger than this stay up (checking huge ones would slow the game)', { unit: ' blocks', min: 10, max: 50000, step: 10 }],
  crushDamage: [4, 'Crush damage', 'Damage a falling block does to a player or creature it lands on (each hit; players get their usual moment of invulnerability after)', { min: 0, max: 40, step: 1 }],
});

const key = (x, y, z) => `${x},${y},${z}`;
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
// Searched last-in-first-out: down goes last so it's tried first (solid ground is usually straight down).
const SEARCH = [[0, 1, 0], ...SIDES, [0, -1, 0]];

/** True for anything that holds blocks up and joins them together. */
const holds = (id) => id !== AIR && !FLUID[id];

export class BlockGravity {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    this.queue = new Map(); // "x,y,z" -> [x, y, z]: blocks to check, next update
    this.groups = []; // falling structures: { cells: [{ x, y, z, id }], keys: Set, vel, dist }
    this.falling = new Map(); // "x,y,z" -> group, for every falling block
    this.moving = false; // true while we move blocks ourselves (those changes don't need checks)
  }

  /** Call for every block change (World.onChange). */
  changed(x, y, z, id) {
    if (this.moving) return;
    if (holds(id)) this._queue(x, y, z); // a new block: is it hanging in the air?
    else { // a block gone: whatever it held up may fall
      this._queue(x, y + 1, z);
      this._queue(x, y - 1, z);
      for (const [dx, , dz] of SIDES) this._queue(x + dx, y, z + dz);
    }
  }

  _queue(x, y, z) {
    if (y > 0 && y < CH) this.queue.set(key(x, y, z), [x, y, z]);
  }

  /**
   * Checks queued blocks and moves falling structures.
   * @param {number} dt
   * @param {Array<import('./body.js').Body & { damage: Function, dead?: boolean }>} bodies  players and mobs
   * @returns {Array<{type:'crush', body:object, x:number, y:number, z:number}|{type:'land', x:number, y:number, z:number, size:number}>}
   */
  update(dt, bodies) {
    const events = [];
    if (!T.blockGravity) { // switched off: whatever was falling stops where it is
      this.queue.clear();
      this.groups = [];
      this.falling.clear();
      return events;
    }
    if (this.queue.size) {
      const grounded = new Set(); // shared by this round's searches: once grounded, always grounded
      const queued = [...this.queue.values()];
      this.queue.clear();
      for (const [x, y, z] of queued) {
        const k = key(x, y, z);
        if (grounded.has(k) || this.falling.has(k) || !holds(this.world.getBlock(x, y, z))) continue;
        const cells = this._unsupported(x, y, z, grounded);
        if (cells) this._fall(cells);
      }
    }
    for (const g of [...this.groups]) {
      g.vel = Math.min(T.blockFallSpeed, g.vel + T.blockFallAccel * dt);
      g.dist += g.vel * dt;
      while (g.dist >= 1) {
        g.dist -= 1;
        const r = this._step(g, bodies);
        if (r === 'moved') continue;
        if (r === 'landed') {
          this._land(g);
          const c = g.cells[0];
          events.push({ type: 'land', x: c.x + 0.5, y: c.y, z: c.z + 0.5, size: g.cells.length, speed: g.vel });
        } else { // held up by someone: they get crushed, and it waits
          for (const b of r) events.push({ type: 'crush', body: b, x: b.pos.x, y: b.pos.y, z: b.pos.z });
          g.vel = 0;
          g.dist = 0;
        }
        break;
      }
    }
    return events;
  }

  /**
   * Follows touching blocks from (x,y,z) looking for the floor. Returns null if grounded (and adds
   * everything it saw to `grounded`), otherwise the cells of the unsupported structure.
   */
  _unsupported(x, y, z, grounded) {
    const w = this.world;
    const seen = new Map(); // key -> { x, y, z, id }
    const stack = [[x, y, z]];
    seen.set(key(x, y, z), { x, y, z, id: w.getBlock(x, y, z) });
    let found = false;
    while (stack.length) {
      const [cx, cy, cz] = stack.pop();
      const id = seen.get(key(cx, cy, cz)).id;
      if (cy <= 0 || (id === ICE && w.getBlock(cx, cy - 1, cz) === WATER)) { found = true; break; } // the floor; ice floats
      for (const [dx, dy, dz] of SEARCH) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
        if (ny >= CH) continue;
        const k = key(nx, ny, nz);
        if (seen.has(k) || this.falling.has(k)) continue;
        if (grounded.has(k)) { found = true; break; }
        const nid = w.getBlock(nx, ny, nz);
        if (!holds(nid)) continue;
        seen.set(k, { x: nx, y: ny, z: nz, id: nid });
        stack.push([nx, ny, nz]);
      }
      if (found || seen.size > T.blockFallLimit) { found = true; break; } // too big to check: call it grounded
    }
    if (found) {
      for (const k of seen.keys()) grounded.add(k);
      return null;
    }
    return [...seen.values()];
  }

  _fall(cells) {
    const g = { cells, keys: new Set(cells.map((c) => key(c.x, c.y, c.z))), vel: 0, dist: 0 };
    for (const k of g.keys) this.falling.set(k, g);
    this.groups.push(g);
  }

  _land(g) {
    for (const k of g.keys) this.falling.delete(k);
    this.groups.splice(this.groups.indexOf(g), 1);
    // Check it again: it may have landed on another falling structure, or on nothing but a ledge corner.
    const c = g.cells[0];
    this._queue(c.x, c.y, c.z);
  }

  /** Moves a structure down one block. Returns 'moved', 'landed', or the bodies holding it up. */
  _step(g, bodies) {
    const w = this.world;
    const lows = g.cells.filter((c) => !g.keys.has(key(c.x, c.y - 1, c.z))); // the bottom of every column
    for (const c of lows) {
      if (c.y - 1 < 0 || holds(w.getBlock(c.x, c.y - 1, c.z))) return 'landed';
    }
    const under = bodies.filter((b) => !b.dead && lows.some((c) => b.intersectsBlock(c.x, c.y - 1, c.z)));
    if (under.length) return under;

    this.moving = true;
    for (const k of g.keys) this.falling.delete(k);
    const tops = g.cells.filter((c) => !g.keys.has(key(c.x, c.y + 1, c.z))); // these spots empty out
    for (const c of g.cells) w.setBlock(c.x, c.y - 1, c.z, c.id);
    for (const c of tops) w.setBlock(c.x, c.y, c.z, this._fill(c.x, c.y, c.z));
    for (const c of g.cells) c.y -= 1;
    g.keys = new Set(g.cells.map((c) => key(c.x, c.y, c.z)));
    for (const k of g.keys) this.falling.set(k, g);
    this.moving = false;
    return 'moved';
  }

  /** What flows into a spot a falling block just left: a fluid next to it or above it, otherwise air. */
  _fill(x, y, z) {
    const w = this.world;
    const above = w.getBlock(x, y + 1, z);
    if (FLUID[above]) return above;
    for (const [dx, , dz] of SIDES) {
      const id = w.getBlock(x + dx, y, z + dz);
      if (FLUID[id]) return id;
    }
    return AIR;
  }
}
