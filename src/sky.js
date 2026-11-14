// Sky visuals for the day/night cycle: sky colour, stars, and this world's square suns, moons and ring
// (celestial.js: `set` takes the world's sky, from `welcome` and `sky` messages).

import * as THREE from 'three';
import { sunHeight, smoothstep } from './daycycle.js';

const DAY = new THREE.Color(0x9ccdf2);
const NIGHT = new THREE.Color(0x0a1024);
const SUNSET = new THREE.Color(0xf08a4b);
const DIST = 400;
const SUN_SIZE = 34;
const MOON_SIZE = 24;
const RING_FAR = 850; // how far away the ring's outer edge is (inside the camera's far plane; it's drawn behind everything anyway)

/** A moon's face: white with grey craters (the material's colour tints it), a different pattern for each moon. */
function moonTexture(i) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = '#c4ccd8';
  const CRATERS = [
    [[1, 1, 2, 2], [5, 2, 2, 1], [3, 5, 2, 2], [6, 5, 1, 1]],
    [[2, 1, 1, 1], [4, 3, 3, 2], [1, 5, 2, 2]],
    [[1, 2, 3, 2], [5, 1, 1, 1], [5, 5, 2, 2], [2, 6, 1, 1]],
    [[3, 1, 2, 1], [1, 4, 2, 1], [5, 4, 2, 3], [3, 6, 1, 1]],
  ];
  for (const [x, y, w, h] of CRATERS[i % CRATERS.length]) ctx.fillRect(x, y, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The ring's annulus, with bands and a dark gap across it (vertex colours: brightness by distance across). */
function ringGeometry(inner, outer) {
  const g = new THREE.RingGeometry(inner, outer, 256, 24);
  const pos = g.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const u = (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner); // 0 inside .. 1 outside
    let k = 0.7 + 0.18 * Math.sin(u * 31) + 0.12 * Math.sin(u * 83 + 1);
    if (u > 0.6 && u < 0.67) k *= 0.15; // the gap
    k *= Math.min(1, u * 8, (1 - u) * 8); // soft edges
    colors.push(k, k, k);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.flat = (opts) => new THREE.MeshBasicMaterial({ fog: false, depthWrite: false, ...opts });

    const starPos = [];
    for (let i = 0; i < 900; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * DIST * 1.1;
      starPos.push(Math.cos(a) * r, u * DIST * 1.1, Math.sin(a) * r);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false,
    }));
    this._add(this.stars, -3);
    this.bodies = new THREE.Group(); // suns, moons and the ring: rebuilt by `set`
    this.group.add(this.bodies);
    this.suns = [];
    this.moons = [];
    this.ring = null;
    this.color = DAY.clone();
    this._sunDir = new THREE.Vector3();
    this._along = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.set({ suns: [{ color: 0xfff4c2, size: 1, at: [0, 0] }], moons: [{ color: 0xe4ebf5, size: 1, phase: 0, tilt: 0 }], ring: null });
  }

  _add(o, order = -1, parent = this.group) {
    o.renderOrder = order;
    o.frustumCulled = false;
    parent.add(o);
    return o;
  }

  /** This world's suns, moons and ring (celestial.js). */
  set(sky) {
    if (!sky) return;
    for (const o of [...this.bodies.children]) {
      this.bodies.remove(o);
      o.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); } });
    }
    this.suns = (sky.suns || []).map((s) => {
      const glowColor = new THREE.Color(s.color).lerp(new THREE.Color(0xffa040), 0.4);
      const glow = this._add(new THREE.Mesh(new THREE.PlaneGeometry(80 * s.size, 80 * s.size),
        this.flat({ color: glowColor, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending })), -1, this.bodies);
      const sun = this._add(new THREE.Mesh(new THREE.PlaneGeometry(SUN_SIZE * s.size, SUN_SIZE * s.size), this.flat({ color: s.color })), -1, this.bodies);
      return { def: s, sun, glow };
    });
    this.moons = (sky.moons || []).map((m, i) => ({
      def: m,
      mesh: this._add(new THREE.Mesh(new THREE.PlaneGeometry(MOON_SIZE * m.size, MOON_SIZE * m.size),
        this.flat({ map: moonTexture(i), color: m.color, transparent: true })), -1, this.bodies),
    }));
    this.ring = null;
    if (sky.ring) {
      // A ring round the world, seen from its surface: a flat band whose plane passes below you, tipped
      // towards the north, so it shows as an arch across that side of the sky. Bigger rings rise higher; more tilt
      // brings the arch up further.
      const r = sky.ring;
      const angle = THREE.MathUtils.degToRad(50 + r.size * 8); // its angular radius, from the point it circles
      const edge = Math.min(THREE.MathUtils.degToRad(89.5), angle + THREE.MathUtils.degToRad(3 + r.width * 12));
      const drop = RING_FAR * Math.cos(edge); // (so the outer edge is RING_FAR away)
      const inner = drop * Math.tan(angle);
      const outer = drop * Math.tan(edge);
      const pivot = new THREE.Group();
      pivot.rotation.x = 0.7 + r.tilt * 0.45;
      const mesh = this._add(new THREE.Mesh(ringGeometry(inner, outer),
        this.flat({ color: r.color, vertexColors: true, transparent: true, opacity: 0.8, side: THREE.DoubleSide })), -2, pivot);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -drop;
      this.bodies.add(pivot);
      this.ring = { def: r, mesh, base: new THREE.Color(r.color) };
    }
  }

  /** Positions the sky around the camera and returns the sky colour for this time. */
  update(time, cameraPos) {
    const a = time * Math.PI * 2;
    const h = sunHeight(time);
    this.group.position.copy(cameraPos);
    this.group.updateMatrixWorld();
    this._sunDir.set(Math.cos(a), Math.sin(a), 0.25).normalize();
    this._along.set(-Math.sin(a), Math.cos(a), 0); // (along the sun's path)

    const place = (mesh, dir, dist) => {
      mesh.position.copy(dir).multiplyScalar(dist);
      mesh.lookAt(cameraPos);
    };
    for (const s of this.suns) { // a cluster travelling together along the one path
      const d = this._v.copy(this._sunDir).addScaledVector(this._along, s.def.at[0]);
      d.z += s.def.at[1];
      d.normalize();
      place(s.sun, d, DIST);
      place(s.glow, d, DIST * 1.01);
    }
    this.moons.forEach((m, i) => { // each on its own part of the orbit, a little north or south of the sun's path
      const b = a + Math.PI + m.def.phase * Math.PI * 2;
      const d = this._v.set(Math.cos(b), Math.sin(b), 0.25 + m.def.tilt).normalize();
      place(m.mesh, d, DIST * (0.98 - i * 0.004)); // (nearer ones drawn in front)
    });

    const night = 1 - smoothstep(-0.25, 0.05, h);
    this.stars.material.opacity = night;
    this.stars.rotation.z = a;
    if (this.ring) { // lit by the sun: bright by day, dimmer at night
      this.ring.mesh.material.color.copy(this.ring.base).multiplyScalar(1 - night * 0.4);
      this.ring.mesh.material.opacity = 0.55 + night * 0.25;
    }

    this.color.copy(NIGHT).lerp(DAY, smoothstep(-0.12, 0.2, h));
    const dusk = Math.max(0, 1 - Math.abs(h) / 0.25);
    this.color.lerp(SUNSET, dusk * 0.45);
    return this.color;
  }
}
