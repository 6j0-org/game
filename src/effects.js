// Visuals for fireballs and explosions: glowing projectiles, a pooled particle
// system (debris, fire, smoke, steam) and expanding flash spheres.

import * as THREE from 'three';
import { BLOCKS, TILE_COUNT } from './blocks.js';

const MAX_PARTICLES = 4000;
const KIND = { DEBRIS: 0, FIRE: 1, SMOKE: 2, SNOW: 3 };
const GRAVITY = [22, -2, -1.5, 2]; // per kind; negative rises
const DRAG = [0.4, 2.5, 1.5, 2.5];

const FIRE_HOT = new THREE.Color(0xffe27a);
const FIRE_MID = new THREE.Color(0xff6a1a);
const SMOKE = new THREE.Color(0x4a4a4a);
const STEAM = new THREE.Color(0xdde8f0);
const OIL_GOLD = new THREE.Color(0xe8b830);
const FUR = new THREE.Color(0x9c8f7e); // muted, so dander reads as faint fluff
const BUBBLE = new THREE.Color(0xeaf6ff);
const SPRAY = new THREE.Color(0xd8ecf2);
const COIN_GOLD = new THREE.Color(0xffd257);
const FEATHER = new THREE.Color(0xf6f2ea);
const POOP = new THREE.Color(0x6b4423);
const SPARK = new THREE.Color(0xffe9a8);
const ORB = new THREE.Color(0x7dffb0);
const SURGE = new THREE.Color(0xc77dff);
const SMOKE_GREY = new THREE.Color(0x9a9a9a);
const ICE_BLUE = new THREE.Color(0x9fdcff);
const SNOW = new THREE.Color(0xf4faff);
const WATER_DROP = new THREE.Color(0x7fc4ff);
const DIRT_BROWN = new THREE.Color(0x7a5236);
const UP = new THREE.Vector3(0, 1, 0);
const FLARE_RED = new THREE.Color(0xff4a2a);
const FLARE_PINK = new THREE.Color(0xffb0a0);
const WHITE = new THREE.Color(0xffffff);
const TRACER_SPEED = 260; // blocks per second (slow enough to see it fly)

/** Average colour of each atlas tile, used to tint debris. */
function tileColors(atlasCanvas) {
  const S = atlasCanvas.height;
  const data = atlasCanvas.getContext('2d').getImageData(0, 0, atlasCanvas.width, S).data;
  const out = [];
  for (let t = 0; t < TILE_COUNT; t++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * atlasCanvas.width + t * S + x) * 4;
        if (data[i + 3] < 128) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    n = Math.max(n, 1);
    out.push(new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace));
  }
  return out;
}

export class Effects {
  constructor(scene, atlasCanvas) {
    this.scene = scene;
    this.tileColors = tileColors(atlasCanvas);

    // Particle pool
    this.count = 0;
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.base = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.kind = new Uint8Array(MAX_PARTICLES);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, sizeAttenuation: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);

    // Fireballs
    this.fireballMeshes = new Map();
    this.coreGeo = new THREE.SphereGeometry(0.2, 12, 8);
    this.glowGeo = new THREE.SphereGeometry(0.38, 12, 8);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xfff1a0 });
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0xff6a1a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    });

    // Flashes
    this.flashes = [];
    this.beams = []; // tracers, railgun beams and zaps: { obj, age, life }
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.rocketBody = new THREE.MeshBasicMaterial({ color: 0x8c939c });
    this.rocketNose = new THREE.MeshBasicMaterial({ color: 0xd94a3a });
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    this.orbCore = new THREE.MeshBasicMaterial({ color: 0xeafff2 });
    this.missileMat = new THREE.MeshBasicMaterial({ color: 0xd98cff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }); // magic missile
    this.missileCore = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.iceMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }); // icebolt
    this.iceCore = new THREE.MeshBasicMaterial({ color: 0xe8f8ff });
    this.flashGeo = new THREE.SphereGeometry(1, 16, 12);
    this.homingBody = new THREE.MeshBasicMaterial({ color: 0xe8ecf0 });
    this.nukeBody = new THREE.MeshBasicMaterial({ color: 0x3a3e46 });
    this.nukeBand = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tracerGeo = new THREE.BoxGeometry(0.07, 0.07, 1.8);
    this.tracers = []; // { mesh, from, dir, len, t, light }
    this.clouds = []; // the nuke's mushroom clouds and shockwaves: { obj, age, life, grow }
    // Brief lights (main.js puts them with the lamps): { pos, color, base, range, life, max }
    this.lights = [];
  }

  /** A light for a moment: it fades out over `life` seconds. `color` is a THREE.Vector3 (can go above 1). */
  light(x, y, z, color, range, life) {
    const base = color.clone();
    const l = { pos: new THREE.Vector3(x, y, z), color: base.clone(), base, range, life, max: life };
    this.lights.push(l);
    return l;
  }

  /** A machine-gun tracer: a glowing streak racing from `o` to `e`, lighting things as it passes. */
  tracer(o, e) {
    const from = new THREE.Vector3(o.x, o.y, o.z);
    const to = new THREE.Vector3(e.x, e.y, e.z);
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const dir = to.clone().sub(from).normalize();
    if (len < 4) return; // (too close to see fly)
    from.addScaledVector(dir, 2.5); // (it shows from a little way out: right at the muzzle it would fill your view)
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    mesh.position.copy(from);
    mesh.lookAt(to);
    this.scene.add(mesh);
    const light = this.light(o.x, o.y, o.z, new THREE.Vector3(1.4, 0.5, 0.2), 5, len / TRACER_SPEED + 0.05);
    this.tracers.push({ mesh, from, dir, len: len - 2.5, t: 0, light });
    this.beam(from, e, 0xff9a5a, 0.015, 0.18, 0.35); // (a faint line left behind, from where it shows)
  }

  /** A burning flare: red sparks and smoke (under its parachute, they drift). */
  flare(x, y, z, chute) {
    if (Math.random() < 0.7) this._emit(KIND.FIRE, x, y, z, (Math.random() - 0.5) * 2, chute ? -0.5 - Math.random() : (Math.random() - 0.5), (Math.random() - 0.5) * 2, Math.random() < 0.5 ? FLARE_RED : FLARE_PINK, 0.45);
    if (Math.random() < 0.15) this._emit(KIND.SMOKE, x, y, z, (Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4, SMOKE_GREY, 2.5);
  }

  /** An incendiary's fire on the ground: flames over a disc of radius `r`. */
  fire(x, y, z, r, dt) {
    const n = Math.min(12, r * r * 8 * dt * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      this._emit(KIND.FIRE, x + Math.cos(a) * d, y + Math.random() * 0.3, z + Math.sin(a) * d, (Math.random() - 0.5) * 0.4, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.4, Math.random() < 0.5 ? FIRE_HOT : FIRE_MID, 0.6);
    }
    if (Math.random() < dt * 6) this._emit(KIND.SMOKE, x + (Math.random() - 0.5) * r, y + 1, z + (Math.random() - 0.5) * r, 0, 1.2, 0, SMOKE, 3);
  }

  /** An incendiary bursting: a ring of flame thrown out over the ground. */
  fireBurst(x, y, z, r) {
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = r * (1.5 + Math.random() * 1.5);
      this._emit(KIND.FIRE, x, y + 0.3, z, Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp, Math.random() < 0.5 ? FIRE_HOT : FIRE_MID, 0.7);
    }
    this.light(x, y + 1, z, new THREE.Vector3(2, 1, 0.3), r * 4, 0.8);
  }

  /** A flashbang: a blinding white pop and a puff of smoke. */
  flashbang(x, y, z) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(this.flashGeo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.flashes.push({ mesh, age: 0, duration: 0.25, radius: 3 });
    this._burst(KIND.SMOKE, x, y, z, 40, 2.5, SMOKE_GREY, 2.5, 0.5);
    this._burst(KIND.FIRE, x, y, z, 30, 6, WHITE, 0.15, 0.3);
    this.light(x, y + 0.5, z, new THREE.Vector3(3, 3, 3), 16, 0.35);
  }

  /** The nuke: a huge flash, a fireball, a mushroom cloud that rises and spreads, and a shockwave ring. */
  nuke(x, y, z, r) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const flash = new THREE.Mesh(this.flashGeo, mat);
    flash.position.set(x, y, z);
    this.scene.add(flash);
    this.flashes.push({ mesh: flash, age: 0, duration: 1.4, radius: r * 3 });
    this._burst(KIND.FIRE, x, y, z, 700, r * 4, FIRE_HOT, 1.4, r);
    this._burst(KIND.SMOKE, x, y, z, 300, r * 1.5, SMOKE, 4, r);
    // The cloud: a stem and a cap of soft spheres that rise and swell while they fade.
    const cloud = new THREE.Group();
    cloud.position.set(x, y, z);
    const puffMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false });
    const stemMat = puffMat(0x8a7a6a);
    const capMat = puffMat(0xc89a6a);
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(this.flashGeo, stemMat); m.scale.setScalar(r * (0.45 - i * 0.03)); m.position.y = i * r * 0.55; cloud.add(m); }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const m = new THREE.Mesh(this.flashGeo, capMat);
      m.scale.set(r * 0.8, r * 0.55, r * 0.8);
      m.position.set(Math.cos(a) * r * 0.9, r * 3.4, Math.sin(a) * r * 0.9);
      cloud.add(m);
    }
    const top = new THREE.Mesh(this.flashGeo, capMat);
    top.scale.set(r * 1.3, r * 0.8, r * 1.3);
    top.position.y = r * 3.7;
    cloud.add(top);
    cloud.scale.setScalar(0.2);
    this.scene.add(cloud);
    this.clouds.push({ obj: cloud, age: 0, life: 14, grow: 1, mats: [stemMat, capMat] });
    // The shockwave: a flat ring racing outwards along the ground.
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.5, z);
    this.scene.add(ring);
    this.clouds.push({ obj: ring, age: 0, life: 2.2, ring: r * 12, mats: [ringMat] });
    this.light(x, y + r, z, new THREE.Vector3(4, 2.6, 1.2), 90, 4);
  }

  // ---------- particles ----------

  _emit(kind, x, y, z, vx, vy, vz, color, life) {
    if (this.count >= MAX_PARTICLES) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.base[i3] = color.r; this.base[i3 + 1] = color.g; this.base[i3 + 2] = color.b;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.life[i] = this.maxLife[i] = life;
    this.kind[i] = kind;
  }

  _copy(from, to) {
    const f = from * 3;
    const t = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t + k] = this.pos[f + k];
      this.vel[t + k] = this.vel[f + k];
      this.base[t + k] = this.base[f + k];
      this.col[t + k] = this.col[f + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.kind[to] = this.kind[from];
  }

  _burst(kind, x, y, z, n, speed, color, life, spread = 0.3) {
    for (let i = 0; i < n; i++) {
      // Random direction on a sphere, random speed
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u) * speed * (0.3 + Math.random() * 0.7);
      this._emit(
        kind,
        x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread,
        Math.cos(a) * s, u * speed * (0.3 + Math.random() * 0.7), Math.sin(a) * s,
        color, life * (0.6 + Math.random() * 0.8),
      );
    }
  }

  // ---------- fireballs ----------

  addFireball(fb) {
    const group = new THREE.Group();
    if (fb.kind === 'rocket') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), this.rocketBody);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.12), this.rocketNose);
      nose.position.z = 0.3; // lookAt points +z along the flight
      group.add(body, nose);
    } else if (fb.kind === 'homing' || fb.kind === 'drunk' || fb.kind === 'nuke') { // missiles: a body and a nose, pointing +z
      const big = fb.kind === 'nuke' ? 2.2 : fb.kind === 'drunk' ? 0.6 : 1;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.13 * big, 0.13 * big, 0.55 * big), fb.kind === 'nuke' ? this.nukeBody : this.homingBody);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1 * big, 0.1 * big, 0.14 * big), fb.kind === 'nuke' ? this.nukeBand : this.rocketNose);
      nose.position.z = 0.33 * big;
      group.add(body, nose);
      if (fb.kind === 'nuke') { const band = new THREE.Mesh(new THREE.BoxGeometry(0.14 * big, 0.14 * big, 0.08 * big), this.nukeBand); band.position.z = -0.1 * big; group.add(band); }
    } else if (fb.kind === 'missile') {
      const core = new THREE.Mesh(this.coreGeo, this.missileCore);
      core.scale.setScalar(0.6);
      const glow = new THREE.Mesh(this.glowGeo, this.missileMat);
      glow.scale.setScalar(1.1);
      group.add(core, glow);
    } else if (fb.kind === 'snowball') { // a Blizzard: a ball of packed ice in a cold glow
      const core = new THREE.Mesh(this.coreGeo, this.iceCore);
      core.scale.setScalar(1.3);
      const glow = new THREE.Mesh(this.glowGeo, this.iceMat);
      glow.scale.setScalar(1.8);
      group.add(core, glow);
    } else if (fb.kind === 'icebolt') {
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), this.iceCore);
      core.scale.set(0.7, 0.7, 1.8); // a shard, pointing along its flight
      group.add(core, new THREE.Mesh(this.glowGeo, this.iceMat));
    } else if (fb.kind === 'arrow') { // a wooden shaft, a steel head and red fletching, pointing along its flight
      if (!this.arrowMats) this.arrowMats = [0x8a6a44, 0xb0b4ba, 0xd94a3a].map((color) => new THREE.MeshBasicMaterial({ color }));
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.7), this.arrowMats[0]);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), this.arrowMats[1]);
      head.position.z = 0.38;
      const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.14), this.arrowMats[2]);
      fletch.position.z = -0.3;
      group.add(shaft, head, fletch);
    } else if (fb.kind === 'orb') {
      group.add(new THREE.Mesh(this.coreGeo, this.orbCore));
      const glow = new THREE.Mesh(this.glowGeo, this.orbMat);
      glow.scale.setScalar(2);
      group.add(glow);
    } else {
      group.add(new THREE.Mesh(this.coreGeo, this.coreMat));
      group.add(new THREE.Mesh(this.glowGeo, this.glowMat));
    }
    group.userData.kind = fb.kind;
    group.userData.last = { ...fb.pos };
    group.userData.start = { ...fb.pos }; // (no smoke trail for its first few blocks: it would be right in the shooter's face)
    group.position.set(fb.pos.x, fb.pos.y, fb.pos.z);
    this.scene.add(group);
    this.fireballMeshes.set(fb.id, group);
  }

  removeFireball(fb) {
    const g = this.fireballMeshes.get(fb.id);
    if (g) this.scene.remove(g);
    this.fireballMeshes.delete(fb.id);
  }

  // ---------- events ----------

  explosion(x, y, z, radius, removed) {
    // Debris: a few chunks per destroyed block, tinted by the block's texture.
    for (const b of removed) {
      const color = this.tileColors[BLOCKS[b.id].side];
      const bx = b.x + 0.5;
      const by = b.y + 0.5;
      const bz = b.z + 0.5;
      for (let i = 0; i < 2; i++) {
        const dx = bx - x + (Math.random() - 0.5);
        const dy = by - y + Math.random() * 1.5;
        const dz = bz - z + (Math.random() - 0.5);
        const len = Math.hypot(dx, dy, dz) || 1;
        const sp = 6 + Math.random() * 6;
        this._emit(KIND.DEBRIS, bx, by, bz, (dx / len) * sp, (dy / len) * sp + 4, (dz / len) * sp, color,
          0.9 + Math.random() * 0.8);
      }
    }
    this._burst(KIND.FIRE, x, y, z, 160, radius * 3.5, FIRE_HOT, 0.7, radius);
    this._burst(KIND.SMOKE, x, y, z, 70, radius * 1.5, SMOKE, 2.0, radius);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffc061, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.flashGeo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.flashes.push({ mesh, age: 0, duration: 0.3, radius: radius * 1.5 });
    this.light(x, y, z, new THREE.Vector3(2, 1.1, 0.4), radius * 5, 0.5);
  }

  fizzle(x, y, z) {
    this._burst(KIND.SMOKE, x, y + 0.2, z, 30, 2, STEAM, 1.0, 0.4);
  }

  /** A Seed Oil bursting: golden droplets. */
  splat(x, y, z, size) {
    this._burst(KIND.DEBRIS, x, y, z, 25 * size, 5, OIL_GOLD, 0.8, 0.4 * size);
  }

  /** Pet dander drifting off a cat or dog. Call every frame. */
  dander(x, y, z) {
    if (Math.random() < 0.08) {
      this._emit(KIND.SMOKE, x + (Math.random() - 0.5) * 0.8, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5, FUR, 0.7);
    }
  }

  /** Soap bubbles at the given point while washing. */
  bubbles(x, y, z) {
    for (let i = 0; i < 2; i++) {
      this._emit(KIND.SMOKE, x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6, BUBBLE, 0.9);
    }
  }

  /** A sneeze: a spray of droplets out in front of the face. */
  sneeze(x, y, z, dx, dy, dz) {
    for (let i = 0; i < 40; i++) {
      const s = 3 + Math.random() * 4;
      this._emit(KIND.DEBRIS, x + dx * 0.4, y + dy * 0.4 - 0.15, z + dz * 0.4,
        dx * s + (Math.random() - 0.5) * 2, dy * s + (Math.random() - 0.5) * 2 + 1, dz * s + (Math.random() - 0.5) * 2, SPRAY, 0.6);
    }
  }

  /** Bits flying off a block as it breaks. */
  breakBlock(x, y, z, id) {
    const color = this.tileColors[BLOCKS[id].side];
    for (let i = 0; i < 14; i++) {
      this._emit(KIND.DEBRIS, x + Math.random(), y + Math.random(), z + Math.random(),
        (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, color, 0.5 + Math.random() * 0.4);
    }
  }

  /** A few chips while you're still mining a block. */
  chip(x, y, z, id) {
    if (Math.random() > 0.25) return;
    const color = this.tileColors[BLOCKS[id].side];
    this._emit(KIND.DEBRIS, x + Math.random(), y + 1.02, z + Math.random(),
      (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, color, 0.4);
  }

  /** Lactose trouble. */
  poop(x, y, z) {
    for (let i = 0; i < 18; i++) {
      this._emit(KIND.DEBRIS, x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 2.5, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 2.5, POOP, 0.6 + Math.random() * 0.4);
    }
  }

  /** A straight glowing cylinder from a to b (tracers, railgun beams). */
  beam(a, b, color, radius, life, opacity = 0.9) {
    const va = new THREE.Vector3(a.x, a.y, a.z);
    const vb = new THREE.Vector3(b.x, b.y, b.z);
    const len = va.distanceTo(vb);
    if (len < 0.01) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(this.beamGeo, mat);
    m.scale.set(radius, len, radius);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, vb.clone().sub(va).normalize());
    this.scene.add(m);
    this.beams.push({ obj: m, age: 0, life, opacity });
  }

  /** Crackling lightning from a to b (the Overcharge orb's zaps). */
  zap(a, b) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const j = i === 0 || i === 8 ? 0 : 0.35;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j, a.y + (b.y - a.y) * t + (Math.random() - 0.5) * j, a.z + (b.z - a.z) * t + (Math.random() - 0.5) * j));
    }
    const mat = new THREE.LineBasicMaterial({ color: 0xbaffd6, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    this.scene.add(line);
    this.beams.push({ obj: line, age: 0, life: 0.18, opacity: 1 });
  }

  muzzle(o, d) {
    for (let i = 0; i < 6; i++) {
      this._emit(KIND.FIRE, o.x + d.x * 0.3, o.y + d.y * 0.3, o.z + d.z * 0.3,
        d.x * 4 + (Math.random() - 0.5) * 2, d.y * 4 + (Math.random() - 0.5) * 2, d.z * 4 + (Math.random() - 0.5) * 2, FIRE_HOT, 0.09);
    }
  }

  /** Sparks where a bullet lands: a few tiny streaks (particles would look huge up close). */
  impact(p) {
    for (let i = 0; i < 4; i++) {
      const d = { x: (Math.random() - 0.5) * 0.5, y: Math.random() * 0.4, z: (Math.random() - 0.5) * 0.5 };
      this.beam(p, { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z }, 0xffe9a8, 0.008, 0.12, 0.9);
    }
  }

  surge(x, y, z) {
    this._burst(KIND.FIRE, x, y, z, 50, 5, SURGE, 0.6, 0.6);
  }

  /** Pillow fight! */
  feathers(x, y, z) {
    this._burst(KIND.SMOKE, x, y, z, 30, 3, FEATHER, 1.4, 0.6);
  }

  /** Sparkle when a coin is collected. */
  sparkle(x, y, z) {
    this._burst(KIND.FIRE, x, y, z, 20, 2.5, COIN_GOLD, 0.35, 0.2);
  }

  /** The Sprayer: a fan of water droplets. */
  spray(x, y, z) {
    this._burst(KIND.SNOW, x, y + 0.3, z, 40, 2.4, WATER_DROP, 0.6, 0.6);
  }

  /** The Weed Torch: a burst of flame and a little smoke over the soil. */
  torch(x, y, z) {
    this._burst(KIND.FIRE, x, y, z, 30, 1.8, FIRE_HOT, 0.4, 0.5);
    this._burst(KIND.FIRE, x, y, z, 20, 1.4, FIRE_MID, 0.5, 0.5);
    this._burst(KIND.SMOKE, x, y + 0.3, z, 10, 0.8, SMOKE_GREY, 1, 0.4);
  }

  /** The Tiller: clods of dirt kicked up. */
  dust(x, y, z) {
    this._burst(KIND.DEBRIS, x, y, z, 24, 2.2, DIRT_BROWN, 0.6, 0.6);
  }

  /** A mob dying: a puff of smoke. */
  puff(x, y, z) {
    this._burst(KIND.SMOKE, x, y, z, 40, 2.5, STEAM, 0.9, 0.8);
  }

  /** An icebolt shattering. */
  frost(x, y, z) {
    this._burst(KIND.SNOW, x, y, z, 35, 3, ICE_BLUE, 0.7, 0.3);
    this._burst(KIND.SNOW, x, y, z, 20, 2, SNOW, 0.9, 0.5);
  }

  /** A blizzard of radius r centred on (x, y, z): call every frame. Snow whirls down inside it. */
  blizzard(x, y, z, r, dt) {
    const n = Math.min(40, Math.ceil(r * r * 40 * dt));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      this._emit(KIND.SNOW, x + Math.cos(a) * d, y + 1 + Math.random() * r, z + Math.sin(a) * d,
        -Math.sin(a) * 4, -2 - Math.random() * 2, Math.cos(a) * 4, Math.random() < 0.25 ? ICE_BLUE : SNOW, 1.2);
    }
  }

  /** Something chilled: a few frosty flakes. Call every frame. */
  chill(x, y, z, width, height) {
    if (Math.random() > 0.5) return;
    this._emit(KIND.SNOW, x + (Math.random() - 0.5) * width * 2, y + Math.random() * height, z + (Math.random() - 0.5) * width * 2,
      0, 0.3, 0, ICE_BLUE, 0.6);
  }

  /** A burning body: call every frame. */
  /** Dragon's Breath: a gout of fire from (x, y, z) along d, `range` long and `arc` degrees wide. */
  breath(x, y, z, d, range, arc, n = 70) {
    const spread = Math.tan((Math.min(170, arc) / 2) * (Math.PI / 180));
    const drag = DRAG[KIND.FIRE];
    for (let i = 0; i < n; i++) {
      // Fast enough that, slowed by the drag, it really gets to the end of the cone (and a little past) in its life.
      const life = 0.35 + Math.random() * 0.2;
      const reach = range * (0.9 + Math.random() * 0.35);
      const speed = (reach * drag) / (1 - Math.exp(-drag * life));
      const jx = (Math.random() - 0.5) * 2 * spread;
      const jy = (Math.random() - 0.5) * 2 * spread * 0.6;
      const jz = (Math.random() - 0.5) * 2 * spread;
      this._emit(KIND.FIRE, x + d.x * 0.6, y + d.y * 0.6 - 0.15, z + d.z * 0.6,
        (d.x + jx) * speed, (d.y + jy) * speed, (d.z + jz) * speed, Math.random() < 0.6 ? FIRE_HOT : FIRE_MID, life);
    }
  }

  /** A shockwave: particles flying out flat in a ring to radius `r` (ultimates). `color` is a hex number. */
  ring(x, y, z, r, color, n = 120) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
      const speed = r * (2.2 + Math.random() * 0.8);
      this._emit(KIND.SMOKE, x + Math.cos(a) * 0.5, y + (Math.random() - 0.3) * 0.6, z + Math.sin(a) * 0.5, Math.cos(a) * speed, Math.random() * 1.5, Math.sin(a) * speed, c, 0.45 + Math.random() * 0.2);
    }
  }

  /** A wave rolling out along the ground in a cone (Stampede): dust thrown up as it goes. */
  wave(x, y, z, d, range, arc, color, n = 160) {
    const c = new THREE.Color(color);
    const spread = (arc / 2) * (Math.PI / 180);
    const base = Math.atan2(d.x, d.z);
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() * 2 - 1) * spread;
      const speed = range * (1.4 + Math.random() * 0.8);
      this._emit(KIND.SMOKE, x, y - 0.6 + Math.random() * 0.5, z, Math.sin(a) * speed, 1 + Math.random() * 2.5, Math.cos(a) * speed, c, 0.6 + Math.random() * 0.3);
    }
  }

  burn(x, y, z, width, height) {
    for (let i = 0; i < 2; i++) {
      this._emit(KIND.FIRE,
        x + (Math.random() - 0.5) * width * 2, y + Math.random() * height, z + (Math.random() - 0.5) * width * 2,
        0, 1 + Math.random(), 0, Math.random() < 0.5 ? FIRE_HOT : FIRE_MID, 0.5);
    }
  }

  // ---------- per frame ----------

  update(dt, fireballs) {
    // Fireballs: follow the simulation, flicker, leave a trail.
    for (const fb of fireballs) {
      const g = this.fireballMeshes.get(fb.id);
      if (!g) continue;
      const kind = g.userData.kind;
      const last = g.userData.last;
      g.position.set(fb.pos.x, fb.pos.y, fb.pos.z);
      const moved = Math.hypot(fb.pos.x - last.x, fb.pos.y - last.y, fb.pos.z - last.z);
      if (kind === 'snowball') {
        for (let i = 0; i < 3; i++) this._emit(KIND.SNOW, fb.pos.x, fb.pos.y, fb.pos.z, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, Math.random() < 0.3 ? ICE_BLUE : SNOW, 0.7);
      } else if (kind === 'icebolt') {
        if (moved > 1e-3) g.lookAt(fb.pos.x * 2 - last.x, fb.pos.y * 2 - last.y, fb.pos.z * 2 - last.z);
        for (let i = 0; i < 2; i++) {
          this._emit(KIND.SNOW, fb.pos.x, fb.pos.y, fb.pos.z, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, Math.random() < 0.5 ? ICE_BLUE : SNOW, 0.5);
        }
      } else if (kind === 'arrow') {
        if (moved > 1e-3) g.lookAt(fb.pos.x * 2 - last.x, fb.pos.y * 2 - last.y, fb.pos.z * 2 - last.z);
      } else if (kind === 'rocket' || kind === 'homing' || kind === 'drunk' || kind === 'nuke') {
        if (moved > 1e-3) g.lookAt(fb.pos.x * 2 - last.x, fb.pos.y * 2 - last.y, fb.pos.z * 2 - last.z);
        const st = g.userData.start;
        const away = Math.hypot(fb.pos.x - st.x, fb.pos.y - st.y, fb.pos.z - st.z);
        if (away < 3 || (kind === 'drunk' && Math.random() < 0.5)) { g.userData.last = { ...fb.pos }; continue; } // (eight drunk rockets: half the smoke each)
        this._emit(KIND.SMOKE, fb.pos.x, fb.pos.y, fb.pos.z, (Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5, SMOKE_GREY, 1.2);
        this._emit(KIND.FIRE, fb.pos.x, fb.pos.y, fb.pos.z, (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5), FIRE_HOT, 0.2);
      } else if (kind === 'orb') {
        g.children[1].scale.setScalar(1.8 + Math.random() * 0.5);
        for (let i = 0; i < 3; i++) {
          this._emit(KIND.FIRE, fb.pos.x, fb.pos.y, fb.pos.z, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, ORB, 0.4);
        }
      } else {
        g.children[1].scale.setScalar(0.85 + Math.random() * 0.35);
        for (let i = 0; i < 3; i++) {
          this._emit(KIND.FIRE, fb.pos.x, fb.pos.y, fb.pos.z,
            (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5,
            Math.random() < 0.5 ? FIRE_HOT : FIRE_MID, 0.35);
        }
      }
      g.userData.last = { ...fb.pos };
    }

    // Tracers race along their paths.
    this.tracers = this.tracers.filter((tr) => {
      tr.t += dt * TRACER_SPEED;
      const at = Math.min(tr.t, tr.len);
      tr.mesh.position.copy(tr.from).addScaledVector(tr.dir, at);
      tr.light.pos.copy(tr.mesh.position);
      if (tr.t < tr.len + 1) return true;
      this.scene.remove(tr.mesh);
      return false;
    });
    // Brief lights fade.
    this.lights = this.lights.filter((l) => {
      l.life -= dt;
      l.color.copy(l.base).multiplyScalar(Math.max(0, l.life / l.max));
      return l.life > 0;
    });
    // The nuke's cloud rises, swells and fades; its shockwave races out.
    this.clouds = this.clouds.filter((c) => {
      c.age += dt;
      const t = c.age / c.life;
      if (t >= 1) {
        this.scene.remove(c.obj);
        for (const m of c.mats) m.dispose();
        if (c.ring) c.obj.geometry.dispose();
        return false;
      }
      if (c.ring) c.obj.scale.setScalar(1 + c.ring * Math.sqrt(t));
      else { c.obj.scale.setScalar(0.2 + 0.9 * Math.min(1, t * 3)); c.obj.position.y += dt * 1.5; }
      for (const m of c.mats) m.opacity = (c.ring ? 0.7 : 0.85) * (1 - t) * (c.ring ? 1 : Math.min(1, (1 - t) * 3));
      return true;
    });

    // Beams fade out.
    this.beams = this.beams.filter((b) => {
      b.age += dt;
      if (b.age >= b.life) {
        this.scene.remove(b.obj);
        b.obj.geometry !== this.beamGeo && b.obj.geometry.dispose();
        b.obj.material.dispose();
        return false;
      }
      b.obj.material.opacity = b.opacity * (1 - b.age / b.life);
      return true;
    });

    // Particles: integrate, recolour, compact dead ones out of the pool.
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._copy(--this.count, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const k = this.kind[i];
      const drag = Math.exp(-DRAG[k] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag - GRAVITY[k] * dt;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const t = this.life[i] / this.maxLife[i]; // 1 -> 0 over lifetime
      if (k === KIND.FIRE) {
        // hot yellow -> orange -> dark smoke
        const c = t > 0.5 ? FIRE_MID.clone().lerp(FIRE_HOT, (t - 0.5) * 2) : SMOKE.clone().lerp(FIRE_MID, t * 2);
        this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
      } else if (k === KIND.SMOKE) {
        const f = 0.4 + 0.6 * t;
        this.col[i3] = this.base[i3] * f; this.col[i3 + 1] = this.base[i3 + 1] * f; this.col[i3 + 2] = this.base[i3 + 2] * f;
      }
    }
    this.points.geometry.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;

    // Flashes: grow and fade.
    this.flashes = this.flashes.filter((f) => {
      f.age += dt;
      const t = f.age / f.duration;
      if (t >= 1) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
        return false;
      }
      f.mesh.scale.setScalar(0.4 + f.radius * Math.sqrt(t));
      f.mesh.material.opacity = 0.9 * (1 - t);
      return true;
    });
  }
}
