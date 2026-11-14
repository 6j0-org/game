// Grenades and flares in flight (and lying about): frag, sticky, incendiary, flashbang, proximity mines, radio
// charges (set off with the Detonator), and flares from the Flare Gun. They bounce, stick, arm and wait here;
// game.js turns their events into blasts, fires and flashes. Thrown by hand (`throw` with a grenade in hand) or
// fired from the Grenade Launcher (weapons.js). No Three.js, no DOM.

import { T, tune } from './tuning.js';
import { SOLID, WATER } from './blocks.js';

tune('Grenades', {
  throwSpeed: [15, 'Grenade throw speed', 'How hard you throw a grenade, in blocks per second', { min: 2, max: 60 }],
  grenadeGravity: [18, 'Grenade drop', 'How fast grenades fall', { min: 0, max: 60 }],
  grenadeBounce: [0.4, 'Grenade bounciness', 'How much speed a grenade keeps when it bounces', { min: 0, max: 0.95, step: 0.05 }],
  fragFuse: [2.5, 'Frag fuse', 'Seconds from throwing a frag grenade to the bang', { unit: ' s', min: 0.2, max: 10, step: 0.1 }],
  fragRadius: [2.6, 'Frag blast radius', 'Blocks', { min: 0.5, max: 10, step: 0.1 }],
  fragDamage: [1.4, 'Frag blast strength', 'Compared with a rocket', { unit: '×', min: 0, max: 10, step: 0.1 }],
  stickyFuse: [2, 'Sticky fuse', 'Seconds from sticking to the bang', { unit: ' s', min: 0.2, max: 10, step: 0.1 }],
  stickyRadius: [2.3, 'Sticky blast radius', 'Blocks', { min: 0.5, max: 10, step: 0.1 }],
  stickyDamage: [1.4, 'Sticky blast strength', 'Compared with a rocket', { unit: '×', min: 0, max: 10, step: 0.1 }],
  fireFuse: [1.5, 'Incendiary fuse', 'Seconds before a thrown incendiary bursts (a launched one bursts when it hits)', { unit: ' s', min: 0.2, max: 10, step: 0.1 }],
  fireRadius: [3.5, 'Fire radius', 'How wide an incendiary\'s fire spreads, in blocks', { min: 0.5, max: 12, step: 0.5 }],
  fireSeconds: [8, 'Fire duration', 'How long the fire burns', { unit: ' s', min: 1, max: 60 }],
  fireDamage: [3, 'Fire damage', 'Damage a second to anything standing in it', { min: 0, max: 50 }],
  flashFuse: [1.5, 'Flashbang fuse', 'Seconds before a thrown flashbang goes off', { unit: ' s', min: 0.2, max: 10, step: 0.1 }],
  flashRadius: [14, 'Flashbang reach', 'How far away it can blind you (if you can see it), in blocks', { min: 1, max: 40 }],
  flashSeconds: [10, 'Flashbang blindness', 'Seconds of blindness for someone close and looking right at it (less when farther, or facing away)', { unit: ' s', min: 0.5, max: 20, step: 0.5 }],
  flashDizzy: [100, 'Flashbang dizziness', 'How long a flashbang leaves you dizzy (your view sways and you stagger), compared with how long it blinds you', { unit: '%', min: 0, max: 400, step: 10 }],
  dizzySway: [2, 'Dizzy stagger', 'How hard dizziness pushes you sideways as you walk, in blocks per second', { min: 0, max: 10, step: 0.5 }],
  mineArm: [1.5, 'Mine arming time', 'Seconds after a mine settles before it\'s live (time to step away: once it is, it goes off for anyone, you too)', { unit: ' s', min: 0, max: 10, step: 0.1 }],
  mineTrigger: [2.5, 'Mine trigger distance', 'How close something has to come to set a mine off', { min: 0.5, max: 8, step: 0.1 }],
  mineRadius: [2.8, 'Mine blast radius', 'Blocks', { min: 0.5, max: 10, step: 0.1 }],
  mineDamage: [1.6, 'Mine blast strength', 'Compared with a rocket', { unit: '×', min: 0, max: 10, step: 0.1 }],
  chargeRadius: [3.2, 'Radio charge blast radius', 'Blocks', { min: 0.5, max: 12, step: 0.1 }],
  chargeDamage: [1.8, 'Radio charge blast strength', 'Compared with a rocket', { unit: '×', min: 0, max: 10, step: 0.1 }],
  trapLife: [900, 'Mine and charge lifetime', 'Seconds a mine or radio charge waits before it fizzles out', { unit: ' s', min: 10, max: 7200 }],
  flareGravity: [9, 'Flare drop', 'How fast a flare slows on its way up', { min: 0, max: 40 }],
  flareFall: [1.5, 'Flare fall speed', 'How fast a flare drifts down under its parachute, in blocks per second', { min: 0.1, max: 10, step: 0.1 }],
  flareBurn: [25, 'Flare burn time', 'Seconds a flare burns (in the air and then on the ground)', { unit: ' s', min: 1, max: 120 }],
});

/**
 * How each kind behaves. `fuse`: seconds to the bang (from the throw, or from sticking: `stick`). `stick`: stops
 * at the first thing it touches (and rides along on a creature or player). `impact`: fired from the launcher,
 * it goes off when it hits. `trap`: waits (mines arm and watch, charges wait for the Detonator).
 */
export const GRENADES = {
  frag: { name: 'Frag Grenade', fuse: () => T.fragFuse, impact: true },
  sticky: { name: 'Sticky Grenade', fuse: () => T.stickyFuse, stick: true },
  incendiary: { name: 'Incendiary Grenade', fuse: () => T.fireFuse, impact: true },
  flashbang: { name: 'Flashbang', fuse: () => T.flashFuse, impact: true },
  mine: { name: 'Proximity Mine', stick: true, trap: true },
  charge: { name: 'Radio Charge', stick: true, trap: true },
  flare: { name: 'Flare' },
};
/** A blast's radius and strength (× the shooter's damage) for the kinds that explode. */
export function blastOf(kind) {
  if (kind === 'frag') return { radius: T.fragRadius, mult: T.fragDamage };
  if (kind === 'sticky') return { radius: T.stickyRadius, mult: T.stickyDamage };
  if (kind === 'mine') return { radius: T.mineRadius, mult: T.mineDamage };
  if (kind === 'charge') return { radius: T.chargeRadius, mult: T.chargeDamage };
  return null;
}

const STEP = 0.15; // max distance per collision check

export class Grenades {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.nextId = 1;
  }

  /**
   * A grenade (or flare) on its way: `kind` from GRENADES, `speed` in blocks a second, `launched` from the
   * Grenade Launcher (impact grenades go off when they hit). `mult` scales its damage; `skill` and `weapon`
   * credit the kill.
   */
  throw(origin, dir, owner, kind, { speed = T.throwSpeed, launched = false, mult = 1, skill = null, weapon = null } = {}) {
    const lob = launched || kind === 'flare' ? 0 : 3; // (a throw goes up a little)
    const g = {
      id: this.nextId++, kind, owner, launched, mult, skill, weapon: weapon || GRENADES[kind].name,
      pos: { ...origin }, vel: { x: dir.x * speed, y: dir.y * speed + lob, z: dir.z * speed },
      age: 0, fuse: null, stuck: null, armed: false, settled: 0, boom: false, chute: false, hits: new Set(),
    };
    if (GRENADES[kind].fuse && !GRENADES[kind].stick) g.fuse = GRENADES[kind].fuse();
    this.list.push(g);
    return g;
  }

  /** Sets off every radio charge `owner` has out. Returns how many. */
  detonate(owner) {
    let n = 0;
    for (const g of this.list) if (g.kind === 'charge' && g.owner === owner && !g.boom) { g.boom = true; n++; }
    return n;
  }

  _solid(x, y, z) {
    return SOLID[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))];
  }

  /**
   * Advances everything. `targetAt(pos, g)` is a creature or player at that point (not the thrower), or null;
   * `near(pos, r, g)` is whether anything (the thrower too) is within `r`. Returns events:
   *   { type: 'boom', g, x, y, z }      it goes off (game.js: blast, fire or flash by kind)
   *   { type: 'bounce', g, x, y, z }    a clink off a block (fast enough to hear)
   *   { type: 'stick', g, x, y, z, target? }
   *   { type: 'armed', g, x, y, z }     a mine is live
   *   { type: 'flareHit', g, target, x, y, z }
   *   { type: 'gone', g }               a flare burned out, a trap fizzled, or it sank
   */
  update(dt, targetAt, near) {
    const events = [];
    const at = (g) => ({ x: g.pos.x, y: g.pos.y, z: g.pos.z });
    this.list = this.list.filter((g) => {
      g.age += dt;
      const def = GRENADES[g.kind];
      if (g.boom) { events.push({ type: 'boom', g, ...at(g) }); return false; }

      if (g.kind === 'flare') { // up, then a slow drift down under its parachute; it burns the whole time
        if (g.age > T.flareBurn) { events.push({ type: 'gone', g }); return false; }
        if (!g.stuck) {
          if (!g.chute && g.vel.y <= 0) { g.chute = true; g.vel.x *= 0.15; g.vel.z *= 0.15; }
          if (g.chute) g.vel.y = -T.flareFall;
          else g.vel.y -= T.flareGravity * dt;
          this._fly(g, dt, events, targetAt, true);
        }
        return !g.dead;
      }

      if (g.stuck?.target) { // riding on whatever it stuck to
        const t = g.stuck.target;
        if (t.dead) g.stuck = { block: true };
        else g.pos = { x: t.pos.x + g.stuck.off.x, y: t.pos.y + g.stuck.off.y, z: t.pos.z + g.stuck.off.z };
      }
      if (!g.stuck) this._fly(g, dt, events, targetAt, false);
      if (g.dead) return false;

      if (g.fuse !== null && (g.fuse -= dt) <= 0) { events.push({ type: 'boom', g, ...at(g) }); return false; }
      if (def.trap) {
        if (g.age > T.trapLife) { events.push({ type: 'gone', g }); return false; }
        if (g.kind === 'mine' && g.stuck) {
          g.settled += dt;
          if (!g.armed && g.settled >= T.mineArm) { g.armed = true; events.push({ type: 'armed', g, ...at(g) }); }
          if (g.armed && near(g.pos, T.mineTrigger, g)) { events.push({ type: 'boom', g, ...at(g) }); return false; }
        }
      }
      return true;
    });
    return events;
  }

  /** One step of flight: bounces off blocks (or sticks, or goes off on impact), hits creatures and players. */
  _fly(g, dt, events, targetAt, flare) {
    const def = GRENADES[g.kind];
    if (!flare) g.vel.y -= T.grenadeGravity * dt;
    const speed = Math.hypot(g.vel.x, g.vel.y, g.vel.z);
    const steps = Math.max(1, Math.ceil((speed * dt) / STEP));
    for (let i = 0; i < steps; i++) {
      if (this.world.getBlock(Math.floor(g.pos.x), Math.floor(g.pos.y), Math.floor(g.pos.z)) === WATER && !def.trap && g.kind !== 'flare') {
        // (in water: frags, stickies and flashbangs still go off, just quietly sinking; fire goes out)
        if (g.kind === 'incendiary') { events.push({ type: 'gone', g }); g.dead = true; return; }
      }
      const t = targetAt(g.pos, g);
      if (t && !g.hits.has(t)) {
        g.hits.add(t);
        if (flare) { events.push({ type: 'flareHit', g, target: t, x: g.pos.x, y: g.pos.y, z: g.pos.z }); g.vel = { x: 0, y: 0, z: 0 }; g.stuck = { block: true }; return; }
        if (def.stick) { g.stuck = { target: t, off: { x: g.pos.x - t.pos.x, y: g.pos.y - t.pos.y, z: g.pos.z - t.pos.z } }; this._stuck(g, events, t); return; }
        if (g.launched && def.impact) { events.push({ type: 'boom', g, x: g.pos.x, y: g.pos.y, z: g.pos.z }); g.dead = true; return; }
        g.vel.x *= -0.3; g.vel.z *= -0.3; // (bounces off them)
      }
      for (const axis of ['x', 'y', 'z']) {
        const prev = g.pos[axis];
        g.pos[axis] += (g.vel[axis] * dt) / steps;
        if (!this._solid(g.pos.x, g.pos.y, g.pos.z)) continue;
        g.pos[axis] = prev;
        if (flare || def.stick) { g.vel = { x: 0, y: 0, z: 0 }; g.stuck = { block: true }; if (!flare) this._stuck(g, events, null); return; }
        if (g.launched && def.impact) { events.push({ type: 'boom', g, x: g.pos.x, y: g.pos.y, z: g.pos.z }); g.dead = true; return; }
        const hit = Math.abs(g.vel[axis]);
        g.vel[axis] *= -T.grenadeBounce;
        if (axis === 'y') { g.vel.x *= 0.7; g.vel.z *= 0.7; }
        if (hit > 3) events.push({ type: 'bounce', g, x: g.pos.x, y: g.pos.y, z: g.pos.z });
      }
    }
    if (Math.hypot(g.vel.x, g.vel.z) < 0.3 && Math.abs(g.vel.y) < 0.5 && this._solid(g.pos.x, g.pos.y - 0.15, g.pos.z)) { g.vel.x = 0; g.vel.z = 0; } // (at rest)
  }

  _stuck(g, events, target) {
    const def = GRENADES[g.kind];
    if (def.fuse) g.fuse = def.fuse();
    events.push({ type: 'stick', g, target, x: g.pos.x, y: g.pos.y, z: g.pos.z });
  }
}
