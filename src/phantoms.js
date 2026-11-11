// Hallucinations: phantom monsters that only a hallucinating player sees (the Hallucinate spell). They
// are harmless and exist only in that player's browser: they turn up around you, creep closer, and vanish
// in a puff when they reach you or when the spell wears off. How many there are and how fast they come
// are Server settings (Magic). No Three.js, no DOM: main.js draws them like any other mob.
import { MOB_TYPES } from './mobs.js';
import { SOLID } from './blocks.js';
import { magic } from './spells.js';
import { T } from './tuning.js';

/** Monsters worth hallucinating: the hostile walkers. */
const KINDS = Object.entries(MOB_TYPES).filter(([, t]) => !t.passive && !t.flies && !t.sized).map(([k]) => k);

export class Phantoms {
  constructor(world, rand = Math.random) {
    this.world = world;
    this.rand = rand;
    this.list = [];
    this.nextId = -1; // negative: never clashes with a real mob's id
    this.spawnT = 0;
  }

  /** Feet height of open ground in column (x, z) near height y, or null. */
  _ground(x, y, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const solid = (by) => SOLID[this.world.getBlock(bx, by, bz)];
    for (let by = Math.floor(y) + 4; by > Math.floor(y) - 8; by--) {
      if (solid(by - 1) && !solid(by) && !solid(by + 1)) return by;
    }
    return null;
  }

  /**
   * Moves the phantoms around `me` (feet position) while `active`. Returns events: { type: 'appear' |
   * 'vanish', mob } so the caller can play sounds and puffs.
   */
  update(dt, active, me) {
    const events = [];
    if (!active) {
      for (const mob of this.list) events.push({ type: 'vanish', mob });
      this.list = [];
      return events;
    }
    if ((this.spawnT -= dt) <= 0 && this.list.length < magic(T, 'hallucinateMobs')) {
      this.spawnT = 0.5 + this.rand() * 1.2;
      const a = this.rand() * Math.PI * 2;
      const r = 9 + this.rand() * 7;
      const x = me.x + Math.cos(a) * r;
      const z = me.z + Math.sin(a) * r;
      const y = this._ground(x, me.y, z);
      if (y !== null) {
        const type = KINDS[Math.floor(this.rand() * KINDS.length)];
        const mob = { id: this.nextId--, type, pos: { x, y, z }, yaw: 0, walkPhase: 0, walkAmount: 1, scale: 1, poly: false, aiming: type === 'skeleton' };
        this.list.push(mob);
        events.push({ type: 'appear', mob });
      }
    }
    const speed = magic(T, 'hallucinateSpeed');
    this.list = this.list.filter((mob) => {
      const dx = me.x - mob.pos.x;
      const dz = me.z - mob.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2 || d > 40) { // it lunges at you... and isn't there
        events.push({ type: 'vanish', mob });
        return false;
      }
      mob.yaw = Math.atan2(-dx, -dz); // models face -Z
      const step = Math.min(d, speed * dt);
      mob.pos.x += (dx / d) * step;
      mob.pos.z += (dz / d) * step;
      const y = this._ground(mob.pos.x, mob.pos.y, mob.pos.z);
      if (y !== null) mob.pos.y += (y - mob.pos.y) * Math.min(1, dt * 10);
      mob.walkPhase += step * 3;
      return true;
    });
    return events;
  }
}
