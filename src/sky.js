// Sky visuals for the day/night cycle: sky colour, a square sun and moon, stars.

import * as THREE from 'three';
import { sunHeight, smoothstep } from './daycycle.js';

const DAY = new THREE.Color(0x9ccdf2);
const NIGHT = new THREE.Color(0x0a1024);
const SUNSET = new THREE.Color(0xf08a4b);
const DIST = 400;

function moonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e4ebf5';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = '#b9c3d3';
  for (const [x, y, w, h] of [[1, 1, 2, 2], [5, 2, 2, 1], [3, 5, 2, 2], [6, 5, 1, 1]]) ctx.fillRect(x, y, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const flat = (opts) => new THREE.MeshBasicMaterial({ fog: false, depthWrite: false, ...opts });

    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), flat({ color: 0xfff4c2 }));
    this.sunGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      flat({ color: 0xffc46b, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending }),
    );
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), flat({ map: moonTexture(), transparent: true }));

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

    for (const o of [this.stars, this.sunGlow, this.sun, this.moon]) {
      o.renderOrder = -1;
      o.frustumCulled = false;
      this.group.add(o);
    }
    this.color = DAY.clone();
    this._sunDir = new THREE.Vector3();
  }

  /** Positions the sky around the camera and returns the sky colour for this time. */
  update(time, cameraPos) {
    const a = time * Math.PI * 2;
    const h = sunHeight(time);
    this.group.position.copy(cameraPos);
    this.group.updateMatrixWorld();
    this._sunDir.set(Math.cos(a), Math.sin(a), 0.25).normalize();

    const place = (mesh, sign) => {
      mesh.position.copy(this._sunDir).multiplyScalar(DIST * sign);
      mesh.lookAt(cameraPos);
    };
    place(this.sun, 1);
    place(this.sunGlow, 1.01);
    place(this.moon, -1);

    const night = 1 - smoothstep(-0.25, 0.05, h);
    this.stars.material.opacity = night;
    this.stars.rotation.z = a;

    this.color.copy(NIGHT).lerp(DAY, smoothstep(-0.12, 0.2, h));
    const dusk = Math.max(0, 1 - Math.abs(h) / 0.25);
    this.color.lerp(SUNSET, dusk * 0.45);
    return this.color;
  }
}
