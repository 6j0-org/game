// Fish swimming in the water: just for looking at, so they live only in the browser (like phantoms.js), never
// in the game. Little schools turn up in water near you, cruise about, keep to the water, turn tail and dart
// off when you come close, and go when you leave. They come in the colours of what you can catch (fishing.js
// FISH). Rendering side: Three.js.

import * as THREE from 'three';
import { part } from './mobModels.js';
import { WATER } from './blocks.js';
import { withFlashlight } from './flashlight.js';

const MAX_FISH = 18;
const RANGE = 24; // they turn up within this many blocks of you, and go beyond RANGE + 8
const SPOOK = 3; // and dart away when you're this close
// Colours (body, belly/stripe, fins) and size, per species. Minnows are common; the golden koi is rare.
const LOOKS = {
  minnow: { colors: [0x8a9aa0, 0xd0d8d8, 0x6a7a80], size: 0.5, weight: 30, school: [4, 7] },
  trout: { colors: [0x6a7a4a, 0xd88a8a, 0x4a5a3a], size: 0.9, weight: 25, school: [2, 4] },
  salmon: { colors: [0x8a9aaa, 0xf08a6a, 0x5a6a7a], size: 1, weight: 15, school: [2, 4] },
  catfish: { colors: [0x4a4038, 0x8a7a68, 0x2a2420], size: 1.1, weight: 10, school: [1, 2] },
  perch: { colors: [0x9aa040, 0xe0a040, 0x3a4a20], size: 0.8, weight: 18, school: [3, 5] },
  koi: { colors: [0xf2a020, 0xf2f2ee, 0xd84a2a], size: 1, weight: 2, school: [1, 1] },
};
const pickSpecies = () => {
  let r = Math.random() * Object.values(LOOKS).reduce((a, l) => a + l.weight, 0);
  for (const [k, l] of Object.entries(LOOKS)) if ((r -= l.weight) < 0) return k;
  return 'minnow';
};

function buildFish(material, species) {
  const [body, belly, fin] = LOOKS[species].colors;
  const root = new THREE.Group();
  root.add(part(material, [
    [0.12, 0.12, 0.34, body, 0, 0, 0],
    [0.1, 0.05, 0.3, belly, 0, -0.04, 0], // belly (or the koi's white)
    [0.02, 0.07, 0.14, fin, 0, 0.09, 0.02], // dorsal fin
    [0.03, 0.03, 0.02, 0x111111, 0.055, 0.02, -0.12], [0.03, 0.03, 0.02, 0x111111, -0.055, 0.02, -0.12], // eyes
  ]));
  const tail = part(material, [[0.02, 0.14, 0.12, fin, 0, 0, 0.06]], 0, 0, 0.17);
  root.add(tail);
  root.scale.setScalar(LOOKS[species].size);
  return { root, tail };
}

export class Fishes {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.material = withFlashlight(new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.spawnT = 0;
  }

  /** Swimmable: water, with water above it too (not the surface layer, so they stay under). */
  _swim(x, y, z) {
    const g = (a, b, c) => this.world.getBlock(Math.floor(a), Math.floor(b), Math.floor(c));
    return g(x, y, z) === WATER && g(x, y + 0.6, z) === WATER;
  }

  /** Every frame: `eye` is the camera's position, `light` the material brightness. */
  update(dt, eye, light) {
    this.material.color.setScalar(light);
    if ((this.spawnT -= dt) <= 0) {
      this.spawnT = 1.5;
      if (this.list.length < MAX_FISH) this._trySchool(eye);
    }
    const t = performance.now() / 1000;
    for (const f of this.list) {
      const dx = f.pos.x - eye.x;
      const dz = f.pos.z - eye.z;
      const near = Math.hypot(dx, f.pos.y - eye.y, dz);
      if (near > RANGE + 8) { f.gone = true; continue; }
      // Spooked: straight away from you, fast. Otherwise drift towards the school's wandering heading.
      if (near < SPOOK) { f.heading = Math.atan2(dx, dz); f.dash = 1.2; }
      f.dash = Math.max(0, f.dash - dt);
      f.school.turnT -= dt;
      if (f.school.turnT <= 0) { f.school.turnT = 2 + Math.random() * 4; f.school.heading += (Math.random() - 0.5) * 2.2; }
      if (!f.dash) f.heading += angleTo(f.heading, f.school.heading + f.offset) * Math.min(1, dt * 1.5);
      const speed = f.dash ? 3.2 : 0.6 + 0.25 * Math.sin(t * 1.3 + f.phase);
      const nx = f.pos.x + Math.sin(f.heading) * speed * dt;
      const nz = f.pos.z + Math.cos(f.heading) * speed * dt;
      const ny = f.pos.y + Math.sin(t * 0.7 + f.phase) * 0.08 * dt;
      if (this._swim(nx, ny, nz)) { f.pos.x = nx; f.pos.y = ny; f.pos.z = nz; }
      else { f.heading += Math.PI * (0.6 + Math.random() * 0.8); if (f === f.school.lead) f.school.heading = f.heading; } // the shore: turn round
      f.model.root.position.set(f.pos.x, f.pos.y, f.pos.z);
      f.model.root.rotation.y = f.heading + Math.PI; // (models face -Z; heading 0 swims towards +Z)
      f.model.tail.rotation.y = Math.sin(t * (f.dash ? 22 : 8) + f.phase) * 0.5;
    }
    for (const f of this.list) if (f.gone) this.scene.remove(f.model.root);
    this.list = this.list.filter((f) => !f.gone);
  }

  /** A school of one species somewhere in the water near you (out of sight is fine: they're only fish). */
  _trySchool(eye) {
    for (let tries = 0; tries < 6; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const d = 6 + Math.random() * (RANGE - 6);
      const x = Math.floor(eye.x + Math.cos(ang) * d) + 0.5;
      const z = Math.floor(eye.z + Math.sin(ang) * d) + 0.5;
      let y = Math.min(78, Math.floor(eye.y) + 12);
      while (y > 1 && this.world.getBlock(Math.floor(x), y, Math.floor(z)) !== WATER) y--;
      if (y <= 1) continue; // no water here
      let bottom = y;
      while (bottom > 1 && this.world.getBlock(Math.floor(x), bottom - 1, Math.floor(z)) === WATER) bottom--;
      if (y - bottom < 1) continue; // too shallow to swim in
      const species = pickSpecies();
      const [lo, hi] = LOOKS[species].school;
      const n = Math.min(MAX_FISH - this.list.length, lo + Math.floor(Math.random() * (hi - lo + 1)));
      const school = { heading: Math.random() * Math.PI * 2, turnT: 2, lead: null };
      for (let i = 0; i < n; i++) {
        const pos = { x: x + (Math.random() - 0.5) * 1.5, y: bottom + 0.3 + Math.random() * (y - bottom - 0.2), z: z + (Math.random() - 0.5) * 1.5 };
        if (!this._swim(pos.x, pos.y, pos.z)) continue;
        const model = buildFish(this.material, species);
        this.scene.add(model.root);
        const f = { pos, model, school, heading: school.heading, offset: (Math.random() - 0.5) * 0.6, phase: Math.random() * 10, dash: 0 };
        school.lead ??= f;
        this.list.push(f);
      }
      return;
    }
  }
}

/** The shortest turn from angle a to angle b. */
function angleTo(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
