// The show for ultimates (ultimates.js): the burst when someone lets one go, the storm that whirls round
// them while it lasts (plates and cutlery, axes, hackysacks, water, fire, feathers), and a shimmer round
// anyone powered up. The Titan Blade's giant glowing weapon is avatars.js. Rendering side: Three.js.

import * as THREE from 'three';
import { T } from './tuning.js';
import { ULTIMATES } from './ultimates.js';
import { buildHeldModel } from './mobModels.js';
import { withFlashlight } from './flashlight.js';

/** A colour for each kind of show. */
const COLORS = { dishes: 0xdfe8f2, axes: 0xc9ced6, sacks: 0xf2c230, water: 0x7fc4ff, fire: 0xff7a2a, feathers: 0xf6f2ea, nova: 0xc77dff,
  rocks: 0x9a9a9a, dirt: 0x8a5a36, vines: 0x4fbf5a, flash: 0xfff6c8, hooks: 0xc9ced6, sparks: 0xffe9a8, rocket: 0xff9a4a, arrow: 0xe8d8b0,
  meteor: 0xff6a1a };
/** What whirls round a storm (item models: mobModels.js TOOL_SHAPES and DROP_SHAPES). Water and fire are particles. */
const ORBIT = { dishes: ['plate', 'bowl', 'cutlery', 'glass'], axes: ['axe'], sacks: ['hackysack'], feathers: [] };

export class UltFx {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.storms = new Map(); // player id -> { group, items, visual }
    this.material = withFlashlight(new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.shimmerT = 0;
  }

  /** Someone let theirs go (the 'ult' fx): a ring, a wave, a flash, sparkles. */
  burst(m) {
    const fx = this.effects;
    const color = COLORS[m.visual] ?? 0xffd257;
    if (m.kind === 'burst') {
      fx.ring(m.x, m.y, m.z, m.r || 8, color, 160);
      if (m.visual === 'nova' || m.visual === 'fire') fx.explosion(m.x, m.y, m.z, 2.5, []);
      if (m.visual === 'flash') fx.surge(m.x, m.y, m.z);
      if (m.visual === 'feathers') for (let i = 0; i < 6; i++) fx.feathers(m.x + (Math.random() - 0.5) * 6, m.y + Math.random() * 2, m.z + (Math.random() - 0.5) * 6);
    } else if (m.kind === 'cone') {
      fx.wave(m.x, m.y, m.z, { x: -Math.sin(m.yaw), z: -Math.cos(m.yaw) }, m.r || 12, 70, 0xb89a6a, 200);
    } else if (m.kind === 'storm') {
      fx.ring(m.x, m.y, m.z, m.r || 4, color, 80);
    } else if (m.kind === 'heal') {
      fx.ring(m.x, m.y, m.z, 4, 0x7fe07a, 80);
      for (let i = 0; i < 5; i++) fx.sparkle(m.x + (Math.random() - 0.5) * 2, m.y + Math.random() * 1.5, m.z + (Math.random() - 0.5) * 2);
    } else {
      fx.surge(m.x, m.y, m.z);
      fx.ring(m.x, m.y, m.z, 3, 0xffd257, 60);
    }
  }

  /** Every frame: `who` is [{ id, pos, ult }] (you and everyone else), `light` the material brightness. */
  update(dt, who, light) {
    this.material.color.setScalar(light);
    const t = performance.now() / 1000;
    const live = new Set();
    this.shimmerT -= dt;
    const shimmer = this.shimmerT <= 0;
    if (shimmer) this.shimmerT = 0.18;
    for (const p of who) {
      const def = ULTIMATES[p.ult];
      if (!def) continue;
      const c = { x: p.pos.x, y: p.pos.y + 1, z: p.pos.z };
      if (def.kind === 'aura') {
        if (shimmer) this.effects.sparkle(c.x + (Math.random() - 0.5) * 1.2, c.y + (Math.random() - 0.5) * 1.4, c.z + (Math.random() - 0.5) * 1.2);
        continue;
      }
      if (def.kind !== 'storm') continue;
      live.add(p.id);
      let s = this.storms.get(p.id);
      if (!s) {
        const group = new THREE.Group();
        const kinds = ORBIT[def.visual] || [];
        const items = [];
        for (let i = 0; i < (kinds.length ? 14 : 0); i++) {
          const m = buildHeldModel(kinds[i % kinds.length], this.material);
          if (!m) continue;
          m.scale.multiplyScalar(1.3);
          group.add(m);
          items.push({ m, phase: (i / 14) * Math.PI * 2, h: (i % 3) * 0.55 - 0.5, r: 0.55 + (i % 4) * 0.13, spin: 3 + Math.random() * 5 });
        }
        this.scene.add(group);
        s = { group, items, visual: def.visual };
        this.storms.set(p.id, s);
      }
      s.group.position.set(c.x, c.y, c.z);
      const R = T.ultStormRadius;
      for (const it of s.items) { // round and round, bobbing, tumbling
        const a = it.phase + t * 3.2;
        it.m.position.set(Math.cos(a) * R * it.r, it.h + Math.sin(t * 2 + it.phase) * 0.3, Math.sin(a) * R * it.r);
        it.m.rotation.set(t * it.spin, a, t * it.spin * 0.7);
      }
      // Water, fire and feathers are particles, flung round the ring.
      const k = Math.random() * Math.PI * 2;
      const rr = R * (0.5 + Math.random() * 0.5);
      if (s.visual === 'fire') this.effects.burn(c.x + Math.cos(k) * rr, c.y - 1, c.z + Math.sin(k) * rr, 0.4, 1.4);
      else if (s.visual === 'water') this.effects.spray(c.x + Math.cos(k) * rr, c.y + Math.random(), c.z + Math.sin(k) * rr);
      else if (s.visual === 'feathers' && shimmer) this.effects.feathers(c.x + Math.cos(k) * rr, c.y, c.z + Math.sin(k) * rr);
    }
    for (const [id, s] of this.storms) {
      if (live.has(id)) continue;
      this.scene.remove(s.group);
      this.storms.delete(id);
    }
  }
}
