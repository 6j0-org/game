// Lava lamps: placed blocks that glow. Each one gets a small model (base, tinted glass, drifting wax
// blobs) and lights its surroundings through the flashlight shader (see setLamps in flashlight.js).

import * as THREE from 'three';
import { withFlashlight } from './flashlight.js';

const baseMat = withFlashlight(new THREE.MeshBasicMaterial({ color: 0x8a8f99 }));
const glassMat = new THREE.MeshBasicMaterial({ color: 0xff5ab4, transparent: true, opacity: 0.45, depthWrite: false });
const waxMat = new THREE.MeshBasicMaterial({ color: 0xffb03a });
const capMat = withFlashlight(new THREE.MeshBasicMaterial({ color: 0x8a8f99 }));

const baseGeo = new THREE.CylinderGeometry(0.1, 0.2, 0.28, 10);
const glassGeo = new THREE.CylinderGeometry(0.09, 0.15, 0.5, 12);
const capGeo = new THREE.CylinderGeometry(0.05, 0.09, 0.1, 10);
const blobGeo = new THREE.SphereGeometry(1, 10, 8);

/** A lava lamp model, 1 block tall, origin at the bottom centre. `scale` for held/icon versions. */
export function lavaLampModel(scale = 1) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.14;
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.y = 0.53;
  glass.renderOrder = 2;
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = 0.83;
  g.add(base, glass, cap);
  g.userData.blobs = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(blobGeo, waxMat);
    b.userData.phase = i * 2.1 + Math.random();
    b.userData.speed = 0.25 + Math.random() * 0.15;
    b.userData.size = 0.045 + i * 0.012;
    g.add(b);
    g.userData.blobs.push(b);
  }
  animate(g, 0);
  g.scale.setScalar(scale);
  return g;
}

/** Drift the wax up and down. */
function animate(g, t) {
  for (const b of g.userData.blobs) {
    const u = 0.5 - 0.5 * Math.cos(t * b.userData.speed + b.userData.phase); // 0..1
    const s = b.userData.size * (1 + 0.25 * Math.sin(t * 1.3 + b.userData.phase));
    b.position.set(Math.sin(b.userData.phase * 3) * 0.03, 0.33 + u * 0.38, Math.cos(b.userData.phase * 5) * 0.03);
    b.scale.set(s, s * (1.2 + 0.3 * Math.sin(t + b.userData.phase)), s);
  }
}

export class Lamps {
  constructor(scene) {
    this.scene = scene;
    this.models = new Map(); // "x,y,z" -> group
    this.t = 0;
  }

  /** Make the set of drawn lamps match `positions` ([[x,y,z], ...] from the chunk meshes). */
  sync(positions) {
    const live = new Set();
    for (const [x, y, z] of positions) {
      const key = `${x},${y},${z}`;
      live.add(key);
      if (this.models.has(key)) continue;
      const m = lavaLampModel();
      m.position.set(x + 0.5, y, z + 0.5);
      this.scene.add(m);
      this.models.set(key, m);
    }
    for (const [key, m] of this.models) {
      if (live.has(key)) continue;
      this.scene.remove(m);
      this.models.delete(key);
    }
  }

  /** Animate, and return light sources nearest `from` first. */
  update(dt, from) {
    this.t += dt;
    const out = [];
    for (const m of this.models.values()) {
      animate(m, this.t);
      const pos = new THREE.Vector3(m.position.x, m.position.y + 0.55, m.position.z);
      out.push({ pos, d: pos.distanceToSquared(from) });
    }
    return out.sort((a, b) => a.d - b.d);
  }
}
