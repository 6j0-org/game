// Fireball projectiles and explosions. No Three.js dependency.

import { T, tune, bindTunable } from './tuning.js';
import { AIR, WATER, SOLID, FLUID, UNBREAKABLE } from './blocks.js';
import { CH } from './world.js';

// Server settings (tuning.js): read the live values as T.key.
tune('Magic', {
  fireballSpeed: [28, 'Fireball speed', 'Blocks per second'],
  fireballGravity: [5, 'Fireball drop', 'How fast fireballs fall'],
  fireballLifetime: [4, 'Fireball lifetime', 'Seconds before it burns out mid-air', { unit: ' s', min: 0.5 }],
  explosionRadius: [3, 'Fireball blast radius', 'Blocks destroyed around an exploding fireball'],
});

const STEP = 0.2; // max distance per collision check, so fireballs can't tunnel

export class Fireballs {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.nextId = 1;
  }

  /**
   * opts: kind ('fireball' | 'rocket' | 'orb' | 'missile' | 'icebolt' | 'arrow'), speed, gravity, radius (blast), mult (damage), lifetime.
   */
  shoot(origin, dir, owner = null, opts = {}) {
    const speed = opts.speed ?? T.fireballSpeed;
    const fb = {
      id: this.nextId++,
      owner, // who shot it (it flies through them)
      kind: opts.kind ?? 'fireball',
      gravity: opts.gravity ?? T.fireballGravity,
      radius: opts.radius ?? T.explosionRadius,
      mult: opts.mult ?? 1,
      lifetime: opts.lifetime ?? T.fireballLifetime,
      skill: opts.skill ?? null, // the shooter's skill a kill counts for (game.js)
      pos: { x: origin.x, y: origin.y, z: origin.z },
      vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
      age: 0,
    };
    this.list.push(fb);
    return fb;
  }

  /**
   * Advances all fireballs. Returns events:
   *   { type: 'explode', fireball, x, y, z }  hit a solid block (x,y,z = last free point)
   *   { type: 'fizzle',  fireball, x, y, z }  hit water or burned out
   * `hits(pos)` optionally reports a direct hit on something that isn't a block (a mob).
   */
  update(dt, hits = null) {
    const events = [];
    this.list = this.list.filter((fb) => {
      fb.age += dt;
      fb.vel.y -= fb.gravity * dt;
      const dist = Math.hypot(fb.vel.x, fb.vel.y, fb.vel.z) * dt;
      const steps = Math.max(1, Math.ceil(dist / STEP));
      for (let s = 0; s < steps; s++) {
        const prev = { ...fb.pos };
        fb.pos.x += (fb.vel.x * dt) / steps;
        fb.pos.y += (fb.vel.y * dt) / steps;
        fb.pos.z += (fb.vel.z * dt) / steps;
        const id = this.world.getBlock(Math.floor(fb.pos.x), Math.floor(fb.pos.y), Math.floor(fb.pos.z));
        if (SOLID[id]) {
          events.push({ type: 'explode', fireball: fb, ...prev });
          return false;
        }
        if (hits && hits(fb.pos, fb)) {
          events.push({ type: 'explode', fireball: fb, ...fb.pos });
          return false;
        }
        if (id === WATER) {
          events.push({ type: 'fizzle', fireball: fb, ...fb.pos });
          return false;
        }
      }
      if (fb.age > fb.lifetime) {
        events.push({ type: 'fizzle', fireball: fb, ...fb.pos });
        return false;
      }
      return true;
    });
    return events;
  }
}

/**
 * Removes blocks in a slightly ragged sphere around (cx,cy,cz). Water and the
 * y=0 floor are left alone. Returns the removed blocks as [{x,y,z,id}].
 */
export function explode(world, cx, cy, cz, radius = T.explosionRadius, rand = Math.random, canBreak = null) {
  const removed = [];
  const r = Math.ceil(radius + 0.5);
  for (let y = Math.floor(cy) - r; y <= Math.floor(cy) + r; y++) {
    if (y <= 0 || y >= CH) continue;
    for (let z = Math.floor(cz) - r; z <= Math.floor(cz) + r; z++) {
      for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
        if (d > radius - 0.4 + rand() * 0.8) continue;
        const id = world.getBlock(x, y, z);
        if (id === AIR || FLUID[id] || UNBREAKABLE[id] || (canBreak && !canBreak(x, y, z))) continue; // (canBreak: someone's land, leases.js)
        world.setBlock(x, y, z, AIR);
        removed.push({ x, y, z, id });
      }
    }
  }
  return removed;
}
