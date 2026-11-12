// Box-built models for mobs and arrows, animated from the mob simulation.
// Faces are pre-shaded with vertex colours (like the terrain), and each mob's
// material colour is the daylight level, plus a tint when hurt.

import { T, tune, bindTunable } from './tuning.js';
import * as THREE from 'three';
import { withFlashlight } from './flashlight.js';
import { FOOD } from './items.js';

const FACE_SHADE = [0.8, 0.8, 1.0, 0.55, 0.7, 0.7]; // BoxGeometry order: +x -x +y -y +z -z

function boxGeo(w, h, d, hex, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const c = new THREE.Color(hex);
  const cols = [];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) cols.push(c.r * FACE_SHADE[f], c.g * FACE_SHADE[f], c.b * FACE_SHADE[f]);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.translate(x, y, z);
  return g;
}

// Geometry is cached per (size, colour, offset) so many mobs share buffers.
const geoCache = new Map();
function cachedBox(...args) {
  const key = args.join(',');
  if (!geoCache.has(key)) geoCache.set(key, boxGeo(...args));
  return geoCache.get(key);
}

export function part(material, boxes, px = 0, py = 0, pz = 0) {
  const g = new THREE.Group();
  g.position.set(px, py, pz);
  for (const b of boxes) g.add(new THREE.Mesh(cachedBox(...b), material));
  return g;
}

// Front of every model faces -Z.
const ZOMBIE = { skin: 0x7c9a6a, tunic: 0x6b2f2f, hem: 0x4e2020, trousers: 0x3b3a44, eye: 0x2a0d0d, mouth: 0x3a2020 };
const SKELETON = { bone: 0xe4e0d0, dark: 0x1a1a1a, bow: 0x7a5230, string: 0xdddddd };

function buildZombie(mat) {
  const root = new THREE.Group();
  const legL = part(mat, [[0.24, 0.75, 0.24, ZOMBIE.trousers, 0, -0.375, 0]], -0.13, 0.75, 0);
  const legR = part(mat, [[0.24, 0.75, 0.24, ZOMBIE.trousers, 0, -0.375, 0]], 0.13, 0.75, 0);
  const body = part(mat, [
    [0.5, 0.7, 0.28, ZOMBIE.tunic, 0, 1.1, 0],
    [0.5, 0.08, 0.29, ZOMBIE.hem, 0, 0.78, 0],
  ]);
  const armL = part(mat, [[0.22, 0.7, 0.22, ZOMBIE.skin, 0, -0.3, 0]], -0.36, 1.38, 0);
  const armR = part(mat, [[0.22, 0.7, 0.22, ZOMBIE.skin, 0, -0.3, 0]], 0.36, 1.38, 0);
  const head = part(mat, [
    [0.44, 0.44, 0.44, ZOMBIE.skin, 0, 0.22, 0],
    [0.09, 0.06, 0.02, ZOMBIE.eye, -0.1, 0.27, -0.225],
    [0.09, 0.06, 0.02, ZOMBIE.eye, 0.1, 0.27, -0.225],
    [0.2, 0.05, 0.02, ZOMBIE.mouth, 0, 0.1, -0.225],
  ], 0, 1.45, 0);
  root.add(legL, legR, body, armL, armR, head);
  return { root, legs: [legL, legR], arms: [armL, armR], head };
}

// The Backrooms' creatures (original): a faceless, too-tall Clerk and a skittering patch of Mildew.
const CLERK = { shirt: 0xd8cc98, tie: 0x6a5a2a, trousers: 0x4a4a52, skin: 0xd8d0c0, shoe: 0x2a2620 };
function buildClerk(mat) {
  const root = new THREE.Group();
  const legL = part(mat, [[0.2, 0.95, 0.2, CLERK.trousers, 0, -0.475, 0], [0.22, 0.08, 0.28, CLERK.shoe, 0, -0.93, -0.03]], -0.12, 0.95, 0);
  const legR = part(mat, [[0.2, 0.95, 0.2, CLERK.trousers, 0, -0.475, 0], [0.22, 0.08, 0.28, CLERK.shoe, 0, -0.93, -0.03]], 0.12, 0.95, 0);
  const body = part(mat, [
    [0.44, 0.8, 0.24, CLERK.shirt, 0, 1.35, 0],
    [0.08, 0.5, 0.02, CLERK.tie, 0, 1.45, -0.13], // a loose tie
    [0.14, 0.06, 0.02, CLERK.tie, 0, 1.72, -0.13],
  ]);
  const armL = part(mat, [[0.16, 0.9, 0.16, CLERK.shirt, 0, -0.4, 0], [0.15, 0.14, 0.15, CLERK.skin, 0, -0.9, 0]], -0.31, 1.7, 0);
  const armR = part(mat, [[0.16, 0.9, 0.16, CLERK.shirt, 0, -0.4, 0], [0.15, 0.14, 0.15, CLERK.skin, 0, -0.9, 0]], 0.31, 1.7, 0);
  const head = part(mat, [[0.36, 0.44, 0.36, CLERK.skin, 0, 0.22, 0]], 0, 1.76, 0); // no face. none.
  root.add(legL, legR, body, armL, armR, head);
  return { root, legs: [legL, legR], arms: [armL, armR], head };
}
const MILDEW = { top: 0x8a7a3a, damp: 0x5a5226, under: 0x3a3418, spore: 0xa8b060 };
function buildMildew(mat) {
  const root = new THREE.Group();
  const legs = [];
  for (const [x, z] of [[-0.3, -0.25], [0.3, -0.25], [-0.32, 0.1], [0.32, 0.1], [-0.28, 0.32], [0.28, 0.32]]) {
    const leg = part(mat, [[0.06, 0.2, 0.06, MILDEW.under, 0, -0.1, 0]], x, 0.2, z);
    legs.push(leg);
    root.add(leg);
  }
  const body = part(mat, [
    [0.8, 0.16, 0.7, MILDEW.top, 0, 0.26, 0],
    [0.7, 0.06, 0.6, MILDEW.damp, 0, 0.36, 0.02],
    [0.12, 0.06, 0.12, MILDEW.spore, -0.2, 0.4, -0.1], [0.1, 0.05, 0.1, MILDEW.spore, 0.18, 0.39, 0.15],
    [0.84, 0.06, 0.74, MILDEW.under, 0, 0.16, 0],
  ]);
  root.add(body);
  return { root, legs, arms: [], head: body };
}

function buildSkeleton(mat) {
  const root = new THREE.Group();
  const B = SKELETON.bone;
  const legL = part(mat, [[0.11, 0.78, 0.11, B, 0, -0.39, 0]], -0.1, 0.78, 0);
  const legR = part(mat, [[0.11, 0.78, 0.11, B, 0, -0.39, 0]], 0.1, 0.78, 0);
  const torso = part(mat, [
    [0.32, 0.08, 0.14, B, 0, 0.8, 0],
    [0.08, 0.6, 0.08, B, 0, 1.12, 0],
    [0.36, 0.05, 0.18, B, 0, 1.03, 0],
    [0.38, 0.05, 0.18, B, 0, 1.15, 0],
    [0.38, 0.05, 0.18, B, 0, 1.27, 0],
    [0.46, 0.07, 0.14, B, 0, 1.39, 0],
  ]);
  const armL = part(mat, [
    [0.1, 0.68, 0.1, B, 0, -0.3, 0],
    // Bow: vertical in the world when the arm points forward.
    [0.04, 0.04, 0.8, SKELETON.bow, 0, -0.65, 0],
    [0.04, 0.1, 0.04, SKELETON.bow, 0, -0.6, -0.4],
    [0.04, 0.1, 0.04, SKELETON.bow, 0, -0.6, 0.4],
    [0.015, 0.015, 0.8, SKELETON.string, 0, -0.55, 0],
  ], -0.26, 1.4, 0);
  const armR = part(mat, [[0.1, 0.68, 0.1, B, 0, -0.3, 0]], 0.26, 1.4, 0);
  const head = part(mat, [
    [0.4, 0.4, 0.4, B, 0, 0.2, 0],
    [0.1, 0.09, 0.02, SKELETON.dark, -0.09, 0.24, -0.205],
    [0.1, 0.09, 0.02, SKELETON.dark, 0.09, 0.24, -0.205],
    [0.04, 0.05, 0.02, SKELETON.dark, 0, 0.15, -0.205],
    [0.22, 0.03, 0.02, SKELETON.dark, 0, 0.07, -0.205],
  ], 0, 1.44, 0);
  root.add(legL, legR, torso, armL, armR, head);
  return { root, legs: [legL, legR], arms: [armL, armR], head };
}


const OIL = { gel: 0xe8b830, seed: 0x6b4a1e, eye: 0x2a1a05, glint: 0xfff6c8 };

// Built at size 2 (1.0 wide, 0.8 tall) and scaled by size / 2.
function buildSeedOil(mat) {
  const gel = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false });
  const root = new THREE.Group();
  const body = new THREE.Group();
  const inner = part(mat, [
    [0.36, 0.28, 0.28, OIL.seed, 0.05, 0.32, 0.08], // the seed floating inside
    [0.12, 0.16, 0.02, OIL.eye, -0.2, 0.52, -0.505],
    [0.12, 0.16, 0.02, OIL.eye, 0.2, 0.52, -0.505],
    [0.2, 0.04, 0.02, OIL.eye, 0, 0.32, -0.505],
    [0.16, 0.05, 0.02, OIL.glint, 0.3, 0.68, -0.506],
  ]);
  const outer = part(gel, [[1.0, 0.8, 1.0, OIL.gel, 0, 0.4, 0]]);
  outer.children[0].renderOrder = 1;
  body.add(inner, outer);
  root.add(body);
  return { root, legs: [], arms: [], head: null, body, extra: [gel] };
}

const COW = { hide: 0xf2efe8, patch: 0x3a2e28, muzzle: 0xe8a8a0, horn: 0xe8e0c8, hoof: 0x2e2e2e, eye: 0x111111 };

function buildCow(mat) {
  const root = new THREE.Group();
  const leg = (x, z) => part(mat, [
    [0.2, 0.55, 0.2, COW.hide, 0, -0.275, 0],
    [0.21, 0.12, 0.21, COW.hoof, 0, -0.5, 0],
  ], x, 0.55, z);
  // Diagonal pairs swing together: [front-left, front-right, back-right, back-left].
  const legs = [leg(-0.25, -0.45), leg(0.25, -0.45), leg(0.25, 0.45), leg(-0.25, 0.45)];
  const body = part(mat, [
    [0.8, 0.6, 1.3, COW.hide, 0, 0.85, 0],
    [0.02, 0.3, 0.42, COW.patch, 0.405, 0.9, 0.2],
    [0.02, 0.26, 0.3, COW.patch, -0.405, 0.8, -0.25],
    [0.02, 0.2, 0.25, COW.patch, -0.405, 0.95, 0.35],
    [0.5, 0.02, 0.42, COW.patch, 0.1, 1.155, 0.1],
    [0.3, 0.25, 0.02, COW.patch, -0.1, 0.9, 0.655],
    [0.06, 0.4, 0.06, COW.hide, 0, 0.75, 0.68], // tail
  ]);
  const head = part(mat, [
    [0.5, 0.45, 0.4, COW.hide, 0, 0.05, -0.2],
    [0.18, 0.2, 0.02, COW.patch, 0.12, 0.12, -0.401],
    [0.4, 0.18, 0.1, COW.muzzle, 0, -0.08, -0.42],
    [0.06, 0.06, 0.02, COW.eye, -0.14, 0.12, -0.402],
    [0.06, 0.06, 0.02, COW.eye, 0.14, 0.12, -0.402],
    [0.08, 0.12, 0.08, COW.horn, -0.2, 0.32, -0.15],
    [0.08, 0.12, 0.08, COW.horn, 0.2, 0.32, -0.15],
  ], 0, 1.0, -0.65);
  root.add(...legs, body, head);
  return { root, legs, arms: [], head };
}

const CAT = { fur: 0xe0913a, stripe: 0xa85f22, belly: 0xf3d6b0, eye: 0x3fbf5a, nose: 0xe88a9a };
const DOG = { fur: 0x9a6a3c, ear: 0x5a3a20, snout: 0xd8b48a, nose: 0x1a1a1a, eye: 0x1a1a1a, collar: 0xc0392b };

function petLegs(mat, color, w, h, xs, zs) {
  const leg = (x, z) => part(mat, [[w, h, w, color, 0, -h / 2, 0]], x, h, z);
  return [leg(-xs, -zs), leg(xs, -zs), leg(xs, zs), leg(-xs, zs)];
}

// Birds share one shape (model faces -Z): a body, a head with a beak, a tail, two hinged wings.
// Each species brings its colours, a size, and a few extra marks.
const BIRDS = {
  // Bluebird: blue back, orange breast.
  bird: { scale: 1, back: 0x3f6fc4, breast: 0xf08a3c, wing: 0x2d4f96, beak: 0xf2c230, head: 0x3f6fc4 },
  // Scaly-breasted munia: chocolate brown, white breast with dark scallops, chunky grey beak.
  munia: { scale: 0.8, back: 0x7a5232, breast: 0xf1ead8, wing: 0x5e3d22, beak: 0x6a6e78, head: 0x4f3220,
    marks: [[0.17, 0.02, 0.02, 0x5e3d22, 0, 0.08, -0.165], [0.17, 0.02, 0.02, 0x5e3d22, 0, 0.13, -0.165], [0.17, 0.02, 0.02, 0x5e3d22, 0, 0.18, -0.165]] },
  // Finch: bright yellow with a black cap and black wings barred white.
  finch: { scale: 0.75, back: 0xf2cf2a, breast: 0xf7e06a, wing: 0x1e1e22, beak: 0xe8b88a, head: 0xf2cf2a,
    marks: [[0.19, 0.05, 0.18, 0x1e1e22, 0, 0.395, -0.17], [0.03, 0.04, 0.16, 0xf4f4f4, -0.12, 0.22, 0.02], [0.03, 0.04, 0.16, 0xf4f4f4, 0.12, 0.22, 0.02]] },
  // Seagull: big, white, grey wings with black tips, a yellow beak with a red spot.
  seagull: { scale: 1.6, back: 0xf4f4f2, breast: 0xffffff, wing: 0xa9b0b8, beak: 0xf2c230, head: 0xf4f4f2, wingTip: 0x1e1e22,
    marks: [[0.02, 0.02, 0.02, 0xd8332a, 0, 0.27, -0.31]] },
  // Crusty-titted nutmunch: round, nut-brown, with a crusty speckled chest. Allegedly real.
  nutmunch: { scale: 1.15, back: 0x8a5a2b, breast: 0xc89a5a, wing: 0x6a4320, beak: 0x3a2a1a, head: 0x8a5a2b,
    marks: [[0.04, 0.03, 0.02, 0x5a3a1a, -0.05, 0.1, -0.165], [0.04, 0.03, 0.02, 0xe8d0a0, 0.04, 0.14, -0.165], [0.03, 0.03, 0.02, 0x5a3a1a, 0.05, 0.07, -0.165],
      [0.04, 0.03, 0.02, 0xe8d0a0, -0.03, 0.17, -0.165], [0.03, 0.03, 0.02, 0x5a3a1a, 0.0, 0.12, -0.165]] },
};
function buildBird(mat, type = 'bird') {
  const c = BIRDS[type];
  const root = new THREE.Group();
  const body = part(mat, [
    [0.22, 0.2, 0.32, c.back, 0, 0.17, 0],
    [0.18, 0.12, 0.2, c.breast, 0, 0.11, -0.06],
    [0.18, 0.17, 0.17, c.head, 0, 0.3, -0.16], // head
    [0.05, 0.05, type === 'seagull' ? 0.12 : 0.08, c.beak, 0, 0.29, -0.28],
    [0.03, 0.03, 0.02, 0x111111, -0.07, 0.33, -0.25],
    [0.03, 0.03, 0.02, 0x111111, 0.07, 0.33, -0.25],
    [0.12, 0.04, 0.16, c.wing, 0, 0.22, 0.22], // tail
    [0.03, 0.08, 0.03, 0xe8a060, -0.05, 0.03, 0],
    [0.03, 0.08, 0.03, 0xe8a060, 0.05, 0.03, 0],
    ...(c.marks || []),
  ]);
  // Wings hinge at the shoulders.
  const wing = (side) => part(mat, [
    [0.26, 0.03, 0.18, c.wing, side * 0.13, 0, 0],
    ...(c.wingTip ? [[0.08, 0.032, 0.18, c.wingTip, side * 0.24, 0, 0]] : []),
  ], side * 0.11, 0.24, 0.02);
  const wingL = wing(-1);
  const wingR = wing(1);
  root.add(body, wingL, wingR);
  const scaled = new THREE.Group(); // the root is positioned each frame; scale a child instead
  scaled.add(...root.children);
  scaled.scale.setScalar(c.scale);
  root.add(scaled);
  return { root, legs: [], arms: [], body, wings: [wingL, wingR] };
}

// Penguin: black back, white front, orange beak and feet, and a kitchen knife in its right flipper.
const PENG = { black: 0x1c1f26, white: 0xf2f2ee, orange: 0xf0902a, blade: 0xc9ced6, handle: 0x5a3a1e };
function buildPenguin(mat) {
  const root = new THREE.Group();
  const foot = (x) => part(mat, [[0.16, 0.05, 0.22, PENG.orange, 0, 0.025, -0.04]], x, 0, 0);
  const legs = [foot(-0.1), foot(0.1)];
  const body = part(mat, [
    [0.5, 0.62, 0.42, PENG.black, 0, 0.36, 0.02],
    [0.38, 0.52, 0.04, PENG.white, 0, 0.33, -0.2],
    [0.36, 0.3, 0.34, PENG.black, 0, 0.82, 0], // head
    [0.26, 0.16, 0.04, PENG.white, 0, 0.8, -0.17],
    [0.05, 0.05, 0.02, 0x111111, -0.08, 0.86, -0.19],
    [0.05, 0.05, 0.02, 0x111111, 0.08, 0.86, -0.19],
    [0.1, 0.06, 0.14, PENG.orange, 0, 0.77, -0.24], // beak
  ]);
  const flipper = (side) => part(mat, [[0.06, 0.4, 0.16, PENG.black, 0, -0.18, 0]], side * 0.28, 0.6, 0);
  const flipL = flipper(-1);
  const flipR = flipper(1);
  // The knife, held point-forward at the end of the right flipper.
  const knife = part(mat, [[0.04, 0.04, 0.12, PENG.handle, 0, 0, 0], [0.02, 0.06, 0.26, PENG.blade, 0, 0.01, -0.19]], 0, -0.36, -0.04);
  flipR.add(knife);
  root.add(...legs, body, flipL, flipR);
  return { root, legs, arms: [flipL, flipR], body, waddle: true };
}

// Brainrot (original designs): absurd hybrids. `spin` parts whirl (a washing machine's drum, a fan's blades).
const POMO = { red: 0xd8322a, shine: 0xf06a50, leaf: 0x3a8a2a, stem: 0x2a5a1a, glove: 0x2a5ad8, cuff: 0xf2f2ee, eye: 0xf8f8f0, pupil: 0x111111, brow: 0x5a1010 };
function buildPomodorino(mat) {
  const root = new THREE.Group();
  const leg = (x) => part(mat, [[0.07, 0.24, 0.07, POMO.leaf, 0, -0.12, 0], [0.12, 0.05, 0.16, POMO.stem, 0, -0.23, -0.03]], x, 0.24, 0);
  const legs = [leg(-0.12), leg(0.12)];
  const body = part(mat, [
    [0.62, 0.52, 0.6, POMO.red, 0, 0.52, 0], // the tomato
    [0.68, 0.36, 0.5, POMO.red, 0, 0.52, 0], // (rounder at the middle)
    [0.5, 0.36, 0.66, POMO.red, 0, 0.52, 0],
    [0.12, 0.1, 0.02, POMO.shine, 0.16, 0.66, -0.335], // a glint
    [0.32, 0.04, 0.08, POMO.leaf, 0, 0.8, 0], [0.08, 0.04, 0.32, POMO.leaf, 0, 0.8, 0], // the leafy hat
    [0.05, 0.12, 0.05, POMO.stem, 0, 0.87, 0],
    [0.1, 0.1, 0.02, POMO.eye, -0.12, 0.6, -0.335], [0.1, 0.1, 0.02, POMO.eye, 0.12, 0.6, -0.335],
    [0.05, 0.05, 0.02, POMO.pupil, -0.11, 0.59, -0.345], [0.05, 0.05, 0.02, POMO.pupil, 0.11, 0.59, -0.345],
    [0.12, 0.03, 0.02, POMO.brow, -0.12, 0.68, -0.34], [0.12, 0.03, 0.02, POMO.brow, 0.12, 0.68, -0.34], // cross
    [0.16, 0.04, 0.02, POMO.brow, 0, 0.44, -0.335], // a grimace
  ]);
  const arm = (x) => part(mat, [[0.06, 0.2, 0.06, POMO.leaf, 0, -0.1, 0], [0.07, 0.04, 0.07, POMO.cuff, 0, -0.2, 0], [0.15, 0.15, 0.15, POMO.glove, 0, -0.29, 0]], x, 0.55, 0);
  const arms = [arm(-0.37), arm(0.37)];
  root.add(...legs, body, ...arms);
  return { root, legs, arms, body, punch: true };
}

// Tung Tung Tung Sahur: a standing log with a wide stare, stick limbs and a big wooden bat it drums with.
const SAHUR = { bark: 0x7a4e2a, wood: 0xc8945a, rings: 0xa87440, end: 0xdcb07a, stick: 0x6a4224, eye: 0xf8f8f0, pupil: 0x111111, mouth: 0x4a2a14, bat: 0xd8b070, grip: 0x8a5a2a };
function buildSahur(mat) {
  const root = new THREE.Group();
  const leg = (x) => part(mat, [[0.08, 0.6, 0.08, SAHUR.stick, 0, -0.3, 0], [0.12, 0.05, 0.18, SAHUR.stick, 0, -0.58, -0.04]], x, 0.6, 0);
  const legs = [leg(-0.12), leg(0.12)];
  const body = part(mat, [
    [0.5, 1.3, 0.44, SAHUR.bark, 0, 1.25, 0], // the log
    [0.42, 1.2, 0.02, SAHUR.wood, 0, 1.25, -0.225], // planed smooth at the front
    [0.46, 0.02, 0.4, SAHUR.end, 0, 1.91, 0], [0.3, 0.02, 0.26, SAHUR.rings, 0, 1.915, 0], [0.12, 0.02, 0.1, SAHUR.end, 0, 1.92, 0], // end grain
    [0.14, 0.16, 0.02, SAHUR.eye, -0.1, 1.62, -0.235], [0.14, 0.16, 0.02, SAHUR.eye, 0.1, 1.62, -0.235], // a wide stare
    [0.04, 0.04, 0.02, SAHUR.pupil, -0.1, 1.62, -0.245], [0.04, 0.04, 0.02, SAHUR.pupil, 0.1, 1.62, -0.245],
    [0.16, 0.03, 0.02, SAHUR.mouth, 0, 1.44, -0.235], [0.03, 0.03, 0.02, SAHUR.mouth, -0.09, 1.46, -0.235], [0.03, 0.03, 0.02, SAHUR.mouth, 0.09, 1.46, -0.235], // a thin smile
    [0.1, 0.1, 0.02, SAHUR.rings, 0.16, 1.05, -0.232], [0.06, 0.06, 0.02, SAHUR.bark, 0.16, 1.05, -0.24], // a knot
  ]);
  const arm = (x) => part(mat, [[0.07, 0.55, 0.07, SAHUR.stick, 0, -0.27, 0]], x, 1.5, 0);
  const armL = arm(-0.3);
  const armR = arm(0.3);
  // The bat, gripped at the end of the right arm and pointing on down past the hand.
  armR.add(part(mat, [[0.07, 0.2, 0.07, SAHUR.grip, 0, -0.08, 0], [0.1, 0.04, 0.1, SAHUR.grip, 0, 0.04, 0], [0.11, 0.6, 0.11, SAHUR.bat, 0, -0.45, 0], [0.13, 0.14, 0.13, SAHUR.bat, 0, -0.78, 0]], 0, -0.52, 0));
  root.add(...legs, body, armL, armR);
  return { root, legs, arms: [armL, armR], body, drum: true };
}

const LAVA = { white: 0xeeeee8, panel: 0x9aa0a8, knob: 0x3a3e46, ring: 0x6a6e76, glass: 0x5a8ab8, sock: 0xd83a3a, shirt: 0xf2c230, hide: 0xd8a860, spot: 0x8a5a2a, hoof: 0x3a2a1e, horn: 0x6a4a2a, eye: 0x111111 };
function buildLavatricio(mat) {
  const root = new THREE.Group();
  const leg = (x, z) => part(mat, [
    [0.12, 1, 0.12, LAVA.hide, 0, -0.5, 0],
    [0.13, 0.12, 0.13, LAVA.spot, 0, -0.3, 0], [0.13, 0.1, 0.13, LAVA.spot, 0, -0.68, 0],
    [0.15, 0.08, 0.15, LAVA.hoof, 0, -0.96, 0],
  ], x, 1, z);
  const legs = [leg(-0.3, -0.28), leg(0.3, -0.28), leg(0.3, 0.28), leg(-0.3, 0.28)]; // (diagonal pairs step together)
  const body = part(mat, [
    [0.86, 0.8, 0.8, LAVA.white, 0, 1.4, 0], // the washing machine
    [0.86, 0.12, 0.02, LAVA.panel, 0, 1.74, -0.41], // control panel
    [0.08, 0.08, 0.03, LAVA.knob, 0.28, 1.74, -0.42], [0.05, 0.05, 0.03, LAVA.knob, 0.14, 1.74, -0.42],
    [0.6, 0.6, 0.02, LAVA.ring, 0, 1.34, -0.41], // the door's rim
  ]);
  const spin = part(mat, [
    [0.46, 0.46, 0.02, LAVA.glass, 0, 0, 0],
    [0.14, 0.1, 0.02, LAVA.sock, 0.1, 0.1, -0.012], [0.12, 0.14, 0.02, LAVA.shirt, -0.1, -0.08, -0.012], // laundry, going round
  ], 0, 1.34, -0.42);
  const neck = part(mat, [
    [0.16, 0.7, 0.16, LAVA.hide, 0, 0.35, 0],
    [0.17, 0.1, 0.17, LAVA.spot, 0, 0.2, 0], [0.17, 0.12, 0.17, LAVA.spot, 0, 0.5, 0],
    [0.22, 0.2, 0.42, LAVA.hide, 0, 0.75, -0.1], // the head, on top
    [0.04, 0.1, 0.04, LAVA.horn, -0.06, 0.9, 0], [0.04, 0.1, 0.04, LAVA.horn, 0.06, 0.9, 0],
    [0.04, 0.04, 0.02, LAVA.eye, -0.1, 0.8, -0.2], [0.04, 0.04, 0.02, LAVA.eye, 0.1, 0.8, -0.2],
  ], 0, 1.72, -0.24);
  root.add(...legs, body, spin, neck);
  return { root, legs, arms: [], body, spin, spinRate: 9, neck };
}

const VENT = { pink: 0xf08aa8, deep: 0xd8607e, leg: 0xe07a96, beak: 0x2a2a2a, metal: 0xc8ccd2, motor: 0x8a8e96, blade: 0x9ad0e8, hub: 0x3a3e46 };
function buildVentilone(mat) {
  const root = new THREE.Group();
  const body = part(mat, [
    [0.05, 0.8, 0.05, VENT.leg, 0, 0.4, 0], // the one leg it stands on
    [0.16, 0.03, 0.2, VENT.leg, 0, 0.015, -0.04],
    [0.05, 0.3, 0.05, VENT.leg, 0.1, 0.72, 0.06], [0.05, 0.05, 0.22, VENT.leg, 0.1, 0.6, -0.02], // the other, tucked up
    [0.38, 0.32, 0.6, VENT.pink, 0, 0.98, 0.04], // body
    [0.04, 0.24, 0.44, VENT.deep, -0.2, 1, 0.08], [0.04, 0.24, 0.44, VENT.deep, 0.2, 1, 0.08], // wings
    [0.2, 0.12, 0.2, VENT.deep, 0, 1.04, 0.38], // tail
    [0.08, 0.4, 0.08, VENT.pink, 0, 1.3, -0.2], [0.08, 0.08, 0.16, VENT.pink, 0, 1.46, -0.16], // neck
    [0.06, 0.14, 0.06, VENT.metal, 0, 1.52, -0.2], // ...into the fan's stand
    [0.16, 0.16, 0.2, VENT.motor, 0, 1.62, -0.18], // motor
    [0.5, 0.03, 0.02, VENT.metal, 0, 1.87, -0.3], [0.5, 0.03, 0.02, VENT.metal, 0, 1.37, -0.3], // the cage
    [0.03, 0.5, 0.02, VENT.metal, -0.25, 1.62, -0.3], [0.03, 0.5, 0.02, VENT.metal, 0.25, 1.62, -0.3],
  ]);
  const spin = part(mat, [[0.42, 0.08, 0.02, VENT.blade, 0, 0, 0], [0.08, 0.42, 0.02, VENT.blade, 0, 0, 0], [0.08, 0.08, 0.04, VENT.hub, 0, 0, -0.01]], 0, 1.62, -0.29);
  root.add(body, spin);
  return { root, legs: [], arms: [], body, spin, spinRate: 30, hop: true };
}

function buildCat(mat) {
  const root = new THREE.Group();
  const legs = petLegs(mat, CAT.fur, 0.09, 0.22, 0.09, 0.2);
  const body = part(mat, [
    [0.26, 0.24, 0.56, CAT.fur, 0, 0.34, 0],
    [0.27, 0.05, 0.08, CAT.stripe, 0, 0.44, -0.12],
    [0.27, 0.05, 0.08, CAT.stripe, 0, 0.44, 0.04],
    [0.27, 0.05, 0.08, CAT.stripe, 0, 0.44, 0.2],
    [0.2, 0.02, 0.4, CAT.belly, 0, 0.215, 0],
  ]);
  const head = part(mat, [
    [0.28, 0.24, 0.24, CAT.fur, 0, 0.0, -0.1],
    [0.07, 0.1, 0.04, CAT.fur, -0.09, 0.16, -0.08],
    [0.07, 0.1, 0.04, CAT.fur, 0.09, 0.16, -0.08],
    [0.05, 0.05, 0.02, CAT.eye, -0.07, 0.03, -0.221],
    [0.05, 0.05, 0.02, CAT.eye, 0.07, 0.03, -0.221],
    [0.04, 0.03, 0.02, CAT.nose, 0, -0.04, -0.221],
    [0.12, 0.06, 0.02, CAT.belly, 0, -0.08, -0.221],
  ], 0, 0.48, -0.3);
  const tail = part(mat, [[0.06, 0.06, 0.42, CAT.stripe, 0, 0, 0.21]], 0, 0.4, 0.27);
  tail.rotation.x = -0.9; // held up
  root.add(...legs, body, head, tail);
  return { root, legs, arms: [], head, tail };
}

function buildDog(mat) {
  const root = new THREE.Group();
  const legs = petLegs(mat, DOG.fur, 0.12, 0.32, 0.12, 0.26);
  const body = part(mat, [
    [0.34, 0.34, 0.72, DOG.fur, 0, 0.5, 0],
    [0.36, 0.07, 0.08, DOG.collar, 0, 0.62, -0.33],
  ]);
  const head = part(mat, [
    [0.32, 0.3, 0.32, DOG.fur, 0, 0, -0.1],
    [0.18, 0.14, 0.16, DOG.snout, 0, -0.06, -0.33],
    [0.06, 0.05, 0.02, DOG.nose, 0, -0.01, -0.411],
    [0.05, 0.05, 0.02, DOG.eye, -0.08, 0.06, -0.261],
    [0.05, 0.05, 0.02, DOG.eye, 0.08, 0.06, -0.261],
    [0.06, 0.2, 0.12, DOG.ear, -0.19, -0.02, -0.08],
    [0.06, 0.2, 0.12, DOG.ear, 0.19, -0.02, -0.08],
  ], 0, 0.72, -0.4);
  const tail = part(mat, [[0.07, 0.07, 0.3, DOG.fur, 0, 0, 0.15]], 0, 0.6, 0.36);
  tail.rotation.x = -0.6;
  root.add(...legs, body, head, tail);
  return { root, legs, arms: [], head, tail };
}

// Tools, built standing upright with the grip at the origin.
const WOOD = 0x8a6a44;
const STEEL = 0xb8bec6;
const SACK = [[0.16, 0.16, 0.16, 0xd8433a, 0, 0, 0], [0.175, 0.09, 0.09, 0xf2c230, 0, 0, 0], [0.09, 0.175, 0.09, 0x3fae5a, 0, 0, 0], [0.09, 0.09, 0.175, 0x3a7fd8, 0, 0, 0]];
const TOOL_SHAPES = {
  shovel: [[0.05, 0.62, 0.05, WOOD, 0, 0.31, 0], [0.13, 0.04, 0.06, 0x3a3a3a, 0, 0.02, 0], [0.18, 0.22, 0.03, STEEL, 0, 0.7, 0]],
  pick: [[0.05, 0.66, 0.05, WOOD, 0, 0.33, 0], [0.5, 0.07, 0.07, STEEL, 0, 0.62, 0], [0.06, 0.1, 0.06, STEEL, -0.25, 0.58, 0], [0.06, 0.1, 0.06, STEEL, 0.25, 0.58, 0]],
  // Axe: wooden haft, steel head on one side with a sharp edge.
  axe: [[0.05, 0.66, 0.05, WOOD, 0, 0.33, 0], [0.22, 0.16, 0.05, STEEL, 0.1, 0.58, 0], [0.03, 0.2, 0.055, 0xe2e7ee, 0.22, 0.58, 0],
    [0.06, 0.08, 0.06, 0x6b5233, 0, 0.62, 0]],
  sword: [[0.05, 0.18, 0.05, 0x4a3020, 0, 0.09, 0], [0.24, 0.04, 0.07, 0xd9a93a, 0, 0.2, 0], [0.07, 0.58, 0.025, 0xd4dae2, 0, 0.51, 0], [0.04, 0.06, 0.02, 0xd4dae2, 0, 0.83, 0]],
  pillow: [[0.46, 0.46, 0.12, 0x3aa7a0, 0, 0.23, 0], [0.4, 0.4, 0.15, 0x4cc0b8, 0, 0.23, 0], [0.47, 0.03, 0.13, 0xf2e6c8, 0, 0.46, 0],
    [0.47, 0.03, 0.13, 0xf2e6c8, 0, 0.0, 0], [0.05, 0.08, 0.05, 0xf2e6c8, -0.24, 0.48, 0], [0.05, 0.08, 0.05, 0xf2e6c8, 0.24, 0.48, 0]],
  hackysack: SACK,
  // A mess left by a lactose-intolerant player: a little brown swirl.
  mess: [[0.34, 0.1, 0.3, 0x6b4423, 0, 0.05, 0], [0.24, 0.09, 0.22, 0x7a4f2a, 0.02, 0.13, 0], [0.14, 0.08, 0.12, 0x6b4423, 0, 0.2, 0.01], [0.05, 0.06, 0.05, 0x7a4f2a, 0.01, 0.26, 0]],
  // Guns and the grappling hook: built with the barrel along +Y and "down" along -Z.
  pistol: [[0.07, 0.32, 0.08, 0x2d3036, 0, 0.16, 0.03], [0.06, 0.06, 0.15, 0x4a3324, 0, 0.04, -0.06], [0.03, 0.04, 0.03, 0xbfc5cc, 0, 0.31, 0.08]],
  shotgun: [[0.06, 0.72, 0.06, 0x3a3e46, 0, 0.38, 0.03], [0.09, 0.16, 0.09, 0x6b4a2b, 0, 0.32, 0.0], [0.09, 0.24, 0.13, 0x6b4a2b, 0, -0.02, -0.03], [0.05, 0.05, 0.12, 0x2d3036, 0, 0.1, -0.07]],
  machinegun: [[0.1, 0.42, 0.11, 0x2d3036, 0, 0.2, 0], [0.04, 0.32, 0.04, 0x55595f, 0, 0.56, 0.02], [0.06, 0.07, 0.17, 0x2d3036, 0, 0.22, -0.11], [0.06, 0.06, 0.13, 0x2d3036, 0, 0.05, -0.08], [0.05, 0.05, 0.04, 0xd9a93a, 0, 0.38, 0.07]],
  rocket: [[0.16, 0.8, 0.16, 0x4f5d3a, 0, 0.3, 0.02], [0.2, 0.06, 0.2, 0x2d3036, 0, 0.7, 0.02], [0.09, 0.04, 0.09, 0xd94a3a, 0, 0.73, 0.02], [0.06, 0.06, 0.15, 0x2d3036, 0, 0.2, -0.12], [0.05, 0.12, 0.05, 0x2d3036, 0.1, 0.45, 0.08]],
  sniper: [[0.07, 0.5, 0.08, 0x3d4a2e, 0, 0.12, 0], [0.04, 0.5, 0.04, 0x2d3036, 0, 0.6, 0], [0.06, 0.08, 0.06, 0x1a1a1a, 0, 0.86, 0], // stock and body, a long barrel, the muzzle
    [0.07, 0.26, 0.07, 0x1a1a1a, 0, 0.36, -0.08], [0.08, 0.03, 0.08, 0x7fb8d8, 0, 0.5, -0.08], [0.08, 0.16, 0.06, 0x4a3324, 0, -0.06, 0.04]], // the scope (blue lens), the stock
  railgun: [[0.1, 0.72, 0.1, 0x3a4a6b, 0, 0.3, 0], [0.03, 0.62, 0.03, 0x7fd8ff, 0.065, 0.4, 0], [0.03, 0.62, 0.03, 0x7fd8ff, -0.065, 0.4, 0],
    [0.15, 0.05, 0.15, 0x9adfff, 0, 0.22, 0], [0.15, 0.05, 0.15, 0x9adfff, 0, 0.38, 0], [0.15, 0.05, 0.15, 0x9adfff, 0, 0.54, 0], [0.06, 0.06, 0.15, 0x2d3036, 0, 0.06, -0.09]],
  overcharge: [[0.24, 0.6, 0.24, 0x3d4a3a, 0, 0.25, 0], [0.28, 0.12, 0.28, 0x2d3036, 0, 0.6, 0], [0.16, 0.05, 0.16, 0x7dffb0, 0, 0.675, 0],
    [0.05, 0.42, 0.05, 0x7dffb0, 0.14, 0.25, 0], [0.05, 0.42, 0.05, 0x7dffb0, -0.14, 0.25, 0], [0.07, 0.07, 0.17, 0x2d3036, 0, 0.12, -0.15]],
  grapple: [[0.1, 0.36, 0.1, 0x55595f, 0, 0.18, 0], [0.2, 0.04, 0.04, 0xbfc5cc, 0, 0.4, 0], [0.04, 0.09, 0.04, 0xbfc5cc, 0.1, 0.44, 0], [0.04, 0.09, 0.04, 0xbfc5cc, -0.1, 0.44, 0],
    [0.12, 0.09, 0.12, 0xb8863b, 0, 0.13, 0.07], [0.06, 0.06, 0.13, 0x2d3036, 0, 0.05, -0.08]],
  // Phone: dark slab with a colourful screen facing you.
  phone: [[0.15, 0.28, 0.025, 0x16181d, 0, 0.14, 0], [0.13, 0.24, 0.005, 0xff6ad5, 0, 0.14, 0.014], [0.05, 0.08, 0.006, 0x5fd4ff, 0.03, 0.18, 0.015]],
  // Compass: a flat brass case with a cream face and a red needle.
  compass: [[0.22, 0.05, 0.22, 0xb08a3a, 0, 0, 0], [0.18, 0.052, 0.18, 0xf2e8cc, 0, 0.002, 0], [0.03, 0.054, 0.12, 0xd8322a, 0, 0.004, -0.03], [0.03, 0.054, 0.08, 0x3a3e46, 0, 0.004, 0.04], [0.06, 0.04, 0.04, 0xb08a3a, 0, 0, -0.13]],
  // Flashlight: black body, grippy band, wide head with a warm lens (points up the model's +Y).
  flashlight: [[0.09, 0.42, 0.09, 0x2b2e34, 0, 0.21, 0], [0.1, 0.06, 0.1, 0x4a4f58, 0, 0.12, 0],
    [0.15, 0.1, 0.15, 0x3a3e46, 0, 0.47, 0], [0.12, 0.02, 0.12, 0xfff3c4, 0, 0.525, 0], [0.03, 0.04, 0.03, 0xd94a3a, 0.05, 0.3, -0.04]],
  // Staff: a long gnarled shaft with a crook holding a violet crystal (two-handed).
  staff: [[0.06, 1.3, 0.06, 0x5a4030, 0, 0.45, 0], [0.08, 0.12, 0.08, 0x3b2a1e, 0, 1.0, 0], [0.05, 0.18, 0.05, 0x5a4030, 0.07, 1.16, 0],
    [0.05, 0.18, 0.05, 0x5a4030, -0.07, 1.16, 0], [0.14, 0.16, 0.14, 0x9b4dff, 0, 1.2, 0], [0.07, 0.08, 0.07, 0xe6ccff, 0, 1.22, 0]],
  // Wand: dark twisted wood, gold band, glowing tip.
  wand: [[0.045, 0.5, 0.045, 0x3b2a1e, 0, 0.25, 0], [0.06, 0.05, 0.06, 0xd9a93a, 0, 0.44, 0],
    [0.1, 0.1, 0.1, 0xff6a1a, 0, 0.53, 0], [0.06, 0.06, 0.06, 0xffe27a, 0, 0.53, 0]],
  // Fantasy Town wares.
  dagger: [[0.05, 0.14, 0.05, 0x4a3020, 0, 0.07, 0], [0.16, 0.035, 0.06, 0xd9a93a, 0, 0.15, 0], [0.06, 0.3, 0.02, 0xd4dae2, 0, 0.32, 0]],
  longsword: [[0.05, 0.22, 0.05, 0x4a3020, 0, 0.11, 0], [0.07, 0.05, 0.07, 0x8a6a3a, 0, 0.0, 0], [0.3, 0.04, 0.07, 0xd9a93a, 0, 0.24, 0], [0.07, 0.78, 0.025, 0xd4dae2, 0, 0.65, 0], [0.04, 0.06, 0.02, 0xd4dae2, 0, 1.06, 0]],
  greatsword: [[0.06, 0.34, 0.06, 0x3a2416, 0, 0.12, 0], [0.12, 0.06, 0.08, 0xb03030, 0, 0.3, 0], [0.42, 0.05, 0.08, 0x9aa2ac, 0, 0.34, 0], [0.11, 1.0, 0.03, 0xc8ced6, 0, 0.87, 0], [0.06, 0.08, 0.03, 0xc8ced6, 0, 1.4, 0]],
  leather: [[0.36, 0.42, 0.14, 0x9a6232, 0, 0.21, 0], [0.12, 0.12, 0.16, 0x7a4a24, -0.2, 0.38, 0], [0.12, 0.12, 0.16, 0x7a4a24, 0.2, 0.38, 0], [0.37, 0.04, 0.15, 0x5a3418, 0, 0.12, 0]],
  chainmail: [[0.36, 0.42, 0.14, 0xa8aeb6, 0, 0.21, 0], [0.12, 0.12, 0.16, 0x6f747c, -0.2, 0.38, 0], [0.12, 0.12, 0.16, 0x6f747c, 0.2, 0.38, 0], [0.37, 0.04, 0.15, 0x6f747c, 0, 0.12, 0]],
  platearmor: [[0.36, 0.42, 0.15, 0xd0d6de, 0, 0.21, 0], [0.16, 0.12, 0.18, 0x8a919a, -0.22, 0.4, 0], [0.16, 0.12, 0.18, 0x8a919a, 0.22, 0.4, 0], [0.08, 0.3, 0.16, 0xeef2f6, 0, 0.24, 0], [0.37, 0.04, 0.16, 0xd9a93a, 0, 0.04, 0]],
  // Bows: the stave runs along +Y (up and down in your hand), the string on the -Z side, an arrow nocked.
  shortbow: [[0.04, 0.12, 0.04, 0x5a3a1e, 0, 0, 0], [0.04, 0.24, 0.04, 0x8a5a2a, 0, 0.17, 0.05], [0.04, 0.24, 0.04, 0x8a5a2a, 0, -0.17, 0.05],
    [0.01, 0.62, 0.01, 0xece8dc, 0, 0, -0.08], [0.02, 0.02, 0.5, 0x8a6a44, 0, 0, 0.12], [0.04, 0.04, 0.06, 0xb0b4ba, 0, 0, 0.38]],
  longbow: [[0.045, 0.14, 0.045, 0x3a2412, 0, 0, 0], [0.04, 0.42, 0.04, 0x6a4420, 0, 0.27, 0.06], [0.04, 0.42, 0.04, 0x6a4420, 0, -0.27, 0.06],
    [0.01, 0.98, 0.01, 0xece8dc, 0, 0, -0.06], [0.02, 0.02, 0.6, 0x8a6a44, 0, 0, 0.16], [0.04, 0.04, 0.06, 0xb0b4ba, 0, 0, 0.47]],
  crossbow: [[0.08, 0.6, 0.08, 0x5a3a1e, 0, 0.2, 0], [0.62, 0.05, 0.06, 0x55595f, 0, 0.42, 0], [0.6, 0.012, 0.012, 0xece8dc, 0, 0.36, 0],
    [0.02, 0.4, 0.02, 0xb0b4ba, 0, 0.45, 0.05], [0.06, 0.06, 0.14, 0x2d3036, 0, 0.1, -0.09]],
  runewand: [[0.045, 0.5, 0.045, 0x3a3a52, 0, 0.25, 0], [0.06, 0.05, 0.06, 0x7dd8ff, 0, 0.44, 0],
    [0.1, 0.1, 0.1, 0x3aa0ff, 0, 0.53, 0], [0.06, 0.06, 0.06, 0xc8f0ff, 0, 0.53, 0]],
  archstaff: [[0.06, 1.4, 0.06, 0xe8e0c8, 0, 0.5, 0], [0.09, 0.1, 0.09, 0xd9a93a, 0, 1.1, 0], [0.04, 0.24, 0.04, 0xd9a93a, 0.08, 1.26, 0],
    [0.04, 0.24, 0.04, 0xd9a93a, -0.08, 1.26, 0], [0.16, 0.18, 0.16, 0xffd257, 0, 1.3, 0], [0.08, 0.08, 0.08, 0xfff6c8, 0, 1.32, 0]],
  // Fishing: a long thin rod with a reel, tipped up and forward
  bucket: [[0.26, 0.26, 0.26, 0x9aa0a8, 0, 0.2, 0], [0.22, 0.02, 0.22, 0x4a5058, 0, 0.33, 0], [0.02, 0.18, 0.02, 0x55595f, -0.13, 0.42, 0], [0.02, 0.18, 0.02, 0x55595f, 0.13, 0.42, 0], [0.28, 0.02, 0.02, 0x55595f, 0, 0.51, 0]],
  // Crafted stone tools (crafting.js): a stick, a grey stone head, a wrap of cord
  stoneaxe: [[0.05, 0.6, 0.05, WOOD, 0, 0.3, 0], [0.2, 0.14, 0.06, 0x8a8e94, 0.07, 0.58, 0], [0.06, 0.06, 0.06, 0xc8b078, 0, 0.5, 0]],
  stonepick: [[0.05, 0.6, 0.05, WOOD, 0, 0.3, 0], [0.4, 0.07, 0.06, 0x8a8e94, 0, 0.6, 0], [0.06, 0.06, 0.06, 0xc8b078, 0, 0.54, 0]],
  stoneshovel: [[0.05, 0.6, 0.05, WOOD, 0, 0.3, 0], [0.14, 0.2, 0.04, 0x8a8e94, 0, 0.68, 0], [0.06, 0.06, 0.06, 0xc8b078, 0, 0.56, 0]],
  stoneknife: [[0.05, 0.2, 0.05, WOOD, 0, 0.1, 0], [0.06, 0.26, 0.02, 0x8a8e94, 0, 0.32, 0], [0.06, 0.05, 0.06, 0xc8b078, 0, 0.2, 0]],
  stonespear: [[0.04, 1.3, 0.04, WOOD, 0, 0.55, 0], [0.07, 0.22, 0.03, 0x8a8e94, 0, 1.3, 0], [0.06, 0.06, 0.06, 0xc8b078, 0, 1.17, 0]],
  rod: [[0.04, 1.1, 0.04, WOOD, 0, 0.55, 0], [0.025, 0.4, 0.025, 0x3a2a1a, 0, 1.2, 0], [0.1, 0.1, 0.06, 0x55595f, 0.05, 0.25, 0], [0.03, 0.03, 0.03, 0xd94a3a, 0, 1.4, 0]],
  // Gardening
  tiller: [[0.05, 0.7, 0.05, WOOD, 0, 0.35, 0], [0.34, 0.05, 0.06, 0x55595f, 0, 0.72, 0], [0.04, 0.14, 0.04, 0xbfc5cc, -0.13, 0.66, -0.03],
    [0.04, 0.14, 0.04, 0xbfc5cc, 0, 0.66, -0.03], [0.04, 0.14, 0.04, 0xbfc5cc, 0.13, 0.66, -0.03]],
  sprayer: [[0.2, 0.26, 0.14, 0x3fae5a, 0, 0.13, 0], [0.08, 0.06, 0.08, 0x2d3036, 0, 0.29, 0], [0.03, 0.03, 0.26, 0x55595f, 0, 0.24, -0.18], [0.05, 0.05, 0.04, 0x7fc4ff, 0, 0.24, -0.32]],
  weedtorch: [[0.12, 0.3, 0.12, 0xc43c2c, 0, 0.15, 0], [0.03, 0.03, 0.4, 0x55595f, 0, 0.26, -0.22], [0.06, 0.06, 0.06, 0x2d3036, 0, 0.26, -0.44], [0.05, 0.05, 0.08, 0xff8a1a, 0, 0.26, -0.5]],
  scroll: [[0.06, 0.34, 0.06, 0xc8b07a, 0, 0.17, -0.06], [0.06, 0.34, 0.06, 0xc8b07a, 0, 0.17, 0.06], [0.02, 0.3, 0.12, 0xf2e6c4, 0, 0.17, 0], [0.025, 0.05, 0.05, 0xb03030, 0, 0.17, 0]],
};

// Items lying on the ground (and held food/dishes): food, dishes, coins, hackysacks.
const DROP_SHAPES = {
    steak: [[0.36, 0.1, 0.26, 0xa8402e, 0, 0, 0], [0.3, 0.105, 0.05, 0xf0e0d0, 0, 0, 0.1], [0.06, 0.11, 0.06, 0xf5f0e6, 0.15, 0, -0.06]],
    liver: [[0.34, 0.12, 0.22, 0x6a1f2a, 0, 0, 0], [0.2, 0.1, 0.14, 0x7d2a35, -0.12, 0.01, 0.06]],
    plate: [[0.4, 0.04, 0.4, 0xf4f4f0, 0, 0, 0], [0.16, 0.045, 0.12, 0x8a6a3a, 0.05, 0, 0.04]],
    bowl: [[0.22, 0.05, 0.22, 0x6f9fd0, 0, -0.06, 0], [0.34, 0.12, 0.34, 0x8fbfe8, 0, 0.02, 0], [0.28, 0.125, 0.28, 0x7a5a30, 0, 0.025, 0]],
    cutlery: [[0.04, 0.03, 0.4, 0xc8ccd2, -0.06, 0, 0], [0.1, 0.031, 0.08, 0xc8ccd2, -0.06, 0, -0.18], [0.05, 0.03, 0.4, 0xb0b4ba, 0.07, 0, 0]],
    hackysack: SACK,
    // Crafting materials (crafting.js)
    stick: [[0.05, 0.5, 0.05, 0x8a6a44, 0, 0, 0], [0.04, 0.12, 0.04, 0x8a6a44, 0.05, 0.1, 0]],
    fiber: [[0.02, 0.3, 0.02, 0x7aa050, -0.03, 0, 0], [0.02, 0.32, 0.02, 0x8ab060, 0.02, 0.01, 0.02], [0.02, 0.28, 0.02, 0x6a9040, 0, 0, -0.02]],
    cord: [[0.2, 0.05, 0.2, 0xc8b078, 0, 0, 0], [0.12, 0.06, 0.12, 0xa89058, 0, 0.01, 0]],
    axehead: [[0.22, 0.16, 0.06, 0x8a8e94, 0, 0, 0]],
    pickhead: [[0.42, 0.07, 0.06, 0x8a8e94, 0, 0, 0]],
    shovelhead: [[0.16, 0.22, 0.04, 0x8a8e94, 0, 0, 0]],
    blade: [[0.06, 0.28, 0.02, 0x8a8e94, 0, 0, 0]],
    // Found while mining and digging (forage.js)
    coal: [[0.22, 0.16, 0.18, 0x26262a, 0, 0, 0], [0.12, 0.1, 0.12, 0x3a3a40, 0.06, 0.06, 0.03]],
    ironore: [[0.24, 0.18, 0.2, 0x8d8d8d, 0, 0, 0], [0.07, 0.06, 0.21, 0xc89a78, -0.05, 0.03, 0], [0.06, 0.05, 0.21, 0xb07a58, 0.06, -0.04, 0]],
    copperore: [[0.24, 0.18, 0.2, 0x8d8d8d, 0, 0, 0], [0.07, 0.06, 0.21, 0xd8743a, -0.05, 0.03, 0], [0.06, 0.05, 0.21, 0x3aa88a, 0.06, -0.04, 0]],
    silverore: [[0.24, 0.18, 0.2, 0x8d8d8d, 0, 0, 0], [0.07, 0.06, 0.21, 0xe8eef4, -0.05, 0.03, 0], [0.06, 0.05, 0.21, 0xc8d0d8, 0.06, -0.04, 0]],
    sulfur: [[0.2, 0.14, 0.18, 0xe8d43a, 0, 0, 0], [0.1, 0.1, 0.1, 0xf4e46a, 0.05, 0.06, 0.03]],
    yarrow: [[0.02, 0.36, 0.02, 0x5a8a3a, 0, 0, 0], [0.16, 0.05, 0.16, 0xf0ece0, 0, 0.19, 0], [0.08, 0.03, 0.08, 0xfffcf0, 0, 0.22, 0]],
    mint: [[0.02, 0.3, 0.02, 0x3a7a3a, 0, 0, 0], [0.12, 0.04, 0.08, 0x5ab45a, -0.04, 0.06, 0], [0.12, 0.04, 0.08, 0x5ab45a, 0.04, 0.12, 0], [0.1, 0.04, 0.08, 0x6ac46a, 0, 0.17, 0]],
    mushroom: [[0.07, 0.14, 0.07, 0xece6d2, 0, 0, 0], [0.24, 0.08, 0.24, 0x8a5a34, 0, 0.09, 0], [0.16, 0.04, 0.16, 0xa06a3e, 0, 0.14, 0]],
    glowcap: [[0.06, 0.14, 0.06, 0xd8f0f0, 0, 0, 0], [0.2, 0.08, 0.2, 0x3ae0d0, 0, 0.09, 0], [0.12, 0.04, 0.12, 0xa8fff4, 0, 0.14, 0]],
    feather: [[0.015, 0.4, 0.015, 0xf0ece0, 0, 0, 0], [0.12, 0.3, 0.01, 0xe8e4d8, 0.04, 0.04, 0], [0.06, 0.12, 0.01, 0xc8c4b8, 0.03, 0.18, 0]],
    // Things villagers lose (quests.js): 'lost:<key>', lying where they dropped them
    'lost:ring': [[0.16, 0.03, 0.16, 0xd9a93a, 0, 0, 0], [0.1, 0.035, 0.1, 0x2a2a2a, 0, 0, 0], [0.06, 0.06, 0.06, 0x3ac8e8, 0, 0.04, -0.07]],
    'lost:locket': [[0.16, 0.04, 0.2, 0xc8d0d8, 0, 0, 0], [0.08, 0.045, 0.08, 0xd84a6a, 0, 0, 0], [0.02, 0.02, 0.3, 0xc8d0d8, 0, 0, 0.22]],
    'lost:spectacles': [[0.12, 0.02, 0.12, 0x2a2a2a, -0.09, 0, 0], [0.12, 0.02, 0.12, 0x2a2a2a, 0.09, 0, 0], [0.08, 0.025, 0.02, 0x2a2a2a, 0, 0, -0.03], [0.09, 0.022, 0.09, 0xbfe6ff, -0.09, 0, 0], [0.09, 0.022, 0.09, 0xbfe6ff, 0.09, 0, 0]],
    'lost:key': [[0.12, 0.03, 0.12, 0xb08a3a, 0, 0, -0.1], [0.04, 0.03, 0.24, 0xb08a3a, 0, 0, 0.04], [0.08, 0.03, 0.04, 0xb08a3a, 0.04, 0, 0.13]],
    'lost:doll': [[0.16, 0.2, 0.08, 0xc8644a, 0, 0, 0], [0.14, 0.14, 0.1, 0xe8c8a0, 0, 0.17, 0], [0.16, 0.05, 0.11, 0xe0b040, 0, 0.24, 0], [0.05, 0.14, 0.05, 0xe8c8a0, -0.1, 0.02, 0], [0.05, 0.14, 0.05, 0xe8c8a0, 0.1, 0.02, 0]],
    'lost:pipe': [[0.05, 0.05, 0.26, 0x6a4424, 0, 0, 0], [0.1, 0.14, 0.1, 0x8a5a2a, 0, 0.04, -0.15], [0.06, 0.02, 0.06, 0x2a1a0e, 0, 0.11, -0.15]],
    'lost:purse': [[0.22, 0.14, 0.14, 0x7a4a24, 0, 0, 0], [0.12, 0.06, 0.1, 0x5a3418, 0, 0.1, 0], [0.04, 0.04, 0.04, 0xf4b728, 0, 0.14, 0.03]],
    'lost:letter': [[0.28, 0.02, 0.2, 0xf2e6c4, 0, 0, 0], [0.06, 0.025, 0.06, 0xb03030, 0, 0, 0]],
    // Cooking (cooking.js): ingredients and dishes
    wheat: [[0.08, 0.5, 0.08, 0xd9b45a, -0.05, 0, 0], [0.08, 0.5, 0.08, 0xd9b45a, 0.05, 0, 0.02], [0.12, 0.16, 0.12, 0xe8c870, 0, 0.3, 0], [0.16, 0.04, 0.16, 0x8a6a3a, 0, 0, 0]],
    yeast: [[0.18, 0.08, 0.12, 0xe8d8a0, 0, 0, 0], [0.19, 0.03, 0.13, 0xc84a3a, 0, 0.02, 0]],
    butter: [[0.26, 0.1, 0.14, 0xf4e08a, 0, 0, 0], [0.27, 0.03, 0.15, 0xf8f4ec, 0, -0.04, 0]],
    cornmeal: [[0.26, 0.3, 0.16, 0xd8b878, 0, 0, 0], [0.18, 0.06, 0.12, 0xb89858, 0, 0.17, 0], [0.12, 0.08, 0.01, 0xf0c040, 0, 0, -0.085]],
    water: [[0.26, 0.26, 0.26, 0x9aa0a8, 0, 0.2, 0], [0.22, 0.02, 0.22, 0x4a8ad8, 0, 0.33, 0], [0.28, 0.02, 0.02, 0x55595f, 0, 0.51, 0]],
    oliveoil: [[0.12, 0.3, 0.12, 0x9aaa3a, 0, 0, 0], [0.05, 0.1, 0.05, 0x9aaa3a, 0, 0.2, 0], [0.06, 0.04, 0.06, 0x3a2a1a, 0, 0.27, 0]],
    chives: [[0.03, 0.4, 0.03, 0x46963c, -0.04, 0, 0], [0.03, 0.44, 0.03, 0x46963c, 0.03, 0.02, 0.02], [0.03, 0.38, 0.03, 0x46963c, 0, 0, -0.03], [0.08, 0.06, 0.08, 0xbe82d2, 0, 0.24, 0]],
    corn: [[0.12, 0.36, 0.12, 0xf0ce46, 0, 0, 0], [0.14, 0.3, 0.06, 0x78a046, 0.05, -0.02, 0.04]],
    jalapeno: [[0.08, 0.26, 0.08, 0x347828, 0, 0, 0], [0.03, 0.06, 0.03, 0x5a8a3a, 0, 0.16, 0]],
    garbanzo: [[0.24, 0.1, 0.18, 0xdec482, 0, 0, 0], [0.08, 0.08, 0.08, 0xe8d090, 0.06, 0.08, 0]],
    olive: [[0.08, 0.1, 0.08, 0x46581e, -0.05, 0, 0], [0.08, 0.1, 0.08, 0x3a2848, 0.05, 0, 0.03], [0.08, 0.1, 0.08, 0x46581e, 0, 0, -0.05]],
    bakedpotato: [[0.4, 0.04, 0.4, 0xf4f4f0, 0, -0.06, 0], [0.26, 0.14, 0.18, 0xb48c5a, 0, 0.03, 0], [0.12, 0.04, 0.08, 0xf4e08a, 0, 0.11, 0], [0.04, 0.02, 0.1, 0x46963c, 0.05, 0.12, 0]],
    chips: [[0.22, 0.04, 0.22, 0xe8b850, 0, 0, 0], [0.18, 0.04, 0.18, 0xd8a840, 0.04, 0.04, 0.02], [0.14, 0.04, 0.14, 0xe8b850, -0.03, 0.08, -0.02]],
    povertynachos: [[0.4, 0.04, 0.4, 0xf4f4f0, 0, -0.06, 0], [0.3, 0.08, 0.3, 0xe8b850, 0, 0, 0], [0.24, 0.04, 0.24, 0xf0a020, 0, 0.05, 0]],
    timsnachos: [[0.4, 0.04, 0.4, 0xf4f4f0, 0, -0.06, 0], [0.32, 0.1, 0.32, 0xe8b850, 0, 0, 0], [0.26, 0.05, 0.26, 0xf0a020, 0, 0.06, 0], [0.06, 0.03, 0.06, 0x347828, 0.06, 0.09, 0.05], [0.06, 0.03, 0.06, 0x965a3c, -0.07, 0.09, -0.04]],
    hummus: [[0.22, 0.05, 0.22, 0x6f9fd0, 0, -0.06, 0], [0.34, 0.12, 0.34, 0x8fbfe8, 0, 0.02, 0], [0.28, 0.125, 0.28, 0xe0c890, 0, 0.025, 0], [0.06, 0.13, 0.06, 0x9aaa3a, 0, 0.03, 0]],
    backpack: [[0.44, 0.5, 0.3, 0x6b4a2b, 0, 0.25, 0], [0.46, 0.14, 0.32, 0x5a3a20, 0, 0.47, 0], [0.3, 0.2, 0.06, 0x7d5833, 0, 0.18, -0.17], [0.06, 0.06, 0.02, 0xd9a93a, 0, 0.42, -0.165], [0.06, 0.44, 0.04, 0x3a2716, -0.13, 0.27, 0.17], [0.06, 0.44, 0.04, 0x3a2716, 0.13, 0.27, 0.17]], // a dead player's backpack
    arrow: [[0.03, 0.03, 0.6, 0x8a6a44, 0, 0, 0], [0.05, 0.05, 0.08, 0x9aa0a8, 0, 0, -0.32], [0.08, 0.08, 0.04, 0xd94a3a, 0, 0, 0.26]], // a spent arrow (head towards -Z)
    // Fish (fishing.js): a body, a tail fin, and a darker back
    minnow: [[0.08, 0.06, 0.2, 0x9aa8b0, 0, 0, 0], [0.02, 0.06, 0.06, 0x7a8890, 0, 0, 0.12]],
    trout: [[0.12, 0.1, 0.34, 0x8a9a6a, 0, 0, 0], [0.122, 0.03, 0.3, 0xd88a8a, 0, 0, 0], [0.03, 0.1, 0.08, 0x6a7a4a, 0, 0, 0.21]],
    salmon: [[0.14, 0.12, 0.4, 0xc87a6a, 0, 0, 0], [0.142, 0.04, 0.36, 0x9aa0a8, 0, 0.04, 0], [0.03, 0.12, 0.1, 0xa85a4a, 0, 0, 0.25]],
    catfish: [[0.14, 0.1, 0.38, 0x5a5a4a, 0, 0, 0], [0.2, 0.01, 0.02, 0x3a3a2a, 0, -0.02, -0.2], [0.03, 0.1, 0.1, 0x4a4a3a, 0, 0, 0.24]],
    perch: [[0.1, 0.12, 0.28, 0xa8a84a, 0, 0, 0], [0.102, 0.1, 0.03, 0x4a5a2a, 0, 0, -0.05], [0.102, 0.1, 0.03, 0x4a5a2a, 0, 0, 0.05], [0.03, 0.1, 0.08, 0xd86a3a, 0, 0, 0.18]],
    koi: [[0.13, 0.11, 0.36, 0xf4b728, 0, 0, 0], [0.132, 0.06, 0.1, 0xf4f0e0, 0, 0.03, -0.06], [0.04, 0.12, 0.12, 0xe8901a, 0, 0, 0.24]],
    penguin: [[0.34, 0.16, 0.26, 0x8a4a20, 0, 0, 0], [0.28, 0.06, 0.2, 0xb8662e, 0, 0.09, 0], [0.12, 0.04, 0.08, 0xf0902a, 0, 0.05, -0.16]],
    bird: [[0.3, 0.16, 0.24, 0xb8662e, 0, 0, 0], [0.24, 0.06, 0.2, 0xd88a44, 0, 0.09, 0], [0.06, 0.06, 0.16, 0xf2e6d0, -0.12, 0.02, 0.14], [0.06, 0.06, 0.16, 0xf2e6d0, 0.12, 0.02, 0.14]],
    bread: [[0.36, 0.14, 0.2, 0xc8873e, 0, 0, 0], [0.32, 0.06, 0.16, 0xe0a85a, 0, 0.08, 0], [0.04, 0.065, 0.17, 0x9a6328, -0.08, 0.085, 0], [0.04, 0.065, 0.17, 0x9a6328, 0.06, 0.085, 0]],
    milk: [[0.16, 0.26, 0.16, 0xdfe9f2, 0, 0.13, 0], [0.13, 0.2, 0.13, 0xfaf8f2, 0, 0.11, 0]],
    cheese: [[0.3, 0.16, 0.22, 0xf2c94c, 0, 0, 0], [0.06, 0.05, 0.02, 0xd9a92e, 0.06, 0.03, -0.111], [0.05, 0.04, 0.02, 0xd9a92e, -0.08, -0.03, -0.111], [0.05, 0.05, 0.02, 0xd9a92e, 0.08, 0.02, 0.111]],
    glass: [[0.16, 0.26, 0.16, 0xdfe9f2, 0, 0.13, 0], [0.13, 0.03, 0.13, 0xece6d8, 0, 0.02, 0]],
    garlic: [[0.2, 0.18, 0.2, 0xece6d2, 0, 0.09, 0], [0.04, 0.12, 0.04, 0x96b46a, 0, 0.24, 0]],
    thyme: [[0.03, 0.3, 0.03, 0x607a54, 0, 0.15, 0], [0.12, 0.05, 0.08, 0x7a9a6a, 0.04, 0.12, 0], [0.12, 0.05, 0.08, 0x7a9a6a, -0.04, 0.2, 0]],
    okra: [[0.08, 0.3, 0.08, 0x78b446, 0, 0.15, 0], [0.06, 0.05, 0.06, 0x4a7a2a, 0, 0.32, 0]],
    artichoke: [[0.24, 0.24, 0.24, 0x6e8c5a, 0, 0.12, 0], [0.16, 0.1, 0.16, 0x8c5a8c, 0, 0.27, 0]],
    cabbage: [[0.3, 0.26, 0.3, 0x78b45a, 0, 0.13, 0], [0.22, 0.22, 0.22, 0xb0d696, 0, 0.15, 0]],
    carrot: [[0.08, 0.3, 0.08, 0xec8228, 0, 0.15, 0], [0.04, 0.12, 0.04, 0x50a03c, 0, 0.36, 0]],
    onion: [[0.22, 0.2, 0.22, 0xaa465a, 0, 0.1, 0], [0.04, 0.1, 0.04, 0x64a078, 0, 0.25, 0]],
    potato: [[0.26, 0.16, 0.2, 0xb48c5a, 0, 0.08, 0], [0.18, 0.12, 0.14, 0xc8a06e, 0.03, 0.09, 0]],
    pinto: [[0.24, 0.06, 0.12, 0xd6ba8c, 0, 0.03, 0], [0.05, 0.065, 0.04, 0x965a3c, 0.05, 0.03, 0]],
    pea: [[0.3, 0.07, 0.1, 0x82c85a, 0, 0.035, 0], [0.26, 0.075, 0.06, 0xa8e07a, 0, 0.04, 0]],
    soy: [[0.24, 0.06, 0.14, 0xb0aa64, 0, 0.03, 0], [0.05, 0.065, 0.05, 0x8a8448, 0.06, 0.03, 0]],
    potion: [[0.18, 0.2, 0.18, 0xd8303c, 0, 0.1, 0], [0.07, 0.08, 0.07, 0xd9e6ee, 0, 0.24, 0], [0.06, 0.03, 0.06, 0x8a6a3a, 0, 0.29, 0]],
    bigpotion: [[0.24, 0.26, 0.24, 0xb01828, 0, 0.13, 0], [0.08, 0.1, 0.08, 0xd9e6ee, 0, 0.31, 0], [0.07, 0.03, 0.07, 0xd9a93a, 0, 0.37, 0]],
    antidote: [[0.14, 0.24, 0.14, 0x4ad46a, 0, 0.12, 0], [0.06, 0.08, 0.06, 0xd9e6ee, 0, 0.28, 0], [0.05, 0.03, 0.05, 0x8a6a3a, 0, 0.33, 0]],
    manapotion: [[0.18, 0.2, 0.18, 0x3a6aff, 0, 0.1, 0], [0.07, 0.08, 0.07, 0xd9e6ee, 0, 0.24, 0], [0.06, 0.03, 0.06, 0x8a6a3a, 0, 0.29, 0]],
    stew: [[0.22, 0.05, 0.22, 0x6f9fd0, 0, -0.06, 0], [0.34, 0.12, 0.34, 0x8fbfe8, 0, 0.02, 0], [0.28, 0.125, 0.28, 0x8a4a20, 0, 0.025, 0], [0.06, 0.13, 0.06, 0xe08a3a, 0.05, 0.03, 0]],
    pie: [[0.34, 0.1, 0.34, 0x9a6328, 0, 0, 0], [0.3, 0.06, 0.3, 0xe0a85a, 0, 0.06, 0]],
    honeycake: [[0.28, 0.16, 0.28, 0xe8c478, 0, 0, 0], [0.29, 0.04, 0.29, 0xffb800, 0, 0.08, 0]],
    ale: [[0.18, 0.24, 0.18, 0xd9a93a, 0, 0.12, 0], [0.19, 0.05, 0.19, 0xf6f0dc, 0, 0.25, 0], [0.04, 0.14, 0.08, 0x8a6a3a, 0.12, 0.12, 0]],
    mead: [[0.18, 0.24, 0.18, 0xe8b030, 0, 0.12, 0], [0.19, 0.05, 0.19, 0xf6e8b0, 0, 0.25, 0], [0.04, 0.14, 0.08, 0x6a4a2a, 0.12, 0.12, 0]],
    cider: [[0.18, 0.24, 0.18, 0xc8d84a, 0, 0.12, 0], [0.19, 0.05, 0.19, 0xf0f6d0, 0, 0.25, 0], [0.04, 0.14, 0.08, 0x8a6a3a, 0.12, 0.12, 0]],
    ammo: [[0.42, 0.26, 0.3, 0x556b2f, 0, 0, 0], [0.43, 0.06, 0.31, 0xd9b84a, 0, 0.04, 0], [0.14, 0.1, 0.01, 0xf2f2f2, 0, -0.02, -0.152], [0.14, 0.1, 0.01, 0xf2f2f2, 0, -0.02, 0.152]],
    surge: [[0.28, 0.28, 0.28, 0x9b4dff, 0, 0, 0], [0.1, 0.36, 0.1, 0xf2d9ff, 0, 0, 0], [0.36, 0.1, 0.1, 0xf2d9ff, 0, 0, 0], [0.1, 0.1, 0.36, 0xf2d9ff, 0, 0, 0]],
    // A blocky gold coin standing on its edge, with a pixel "Z" on both faces.
    zcash: [
      [0.42, 0.3, 0.06, 0xf4b728, 0, 0, 0], [0.3, 0.42, 0.06, 0xf4b728, 0, 0, 0],
      [0.2, 0.05, 0.08, 0x8a5a10, 0, 0.1, 0], [0.2, 0.05, 0.08, 0x8a5a10, 0, -0.1, 0],
      [0.05, 0.05, 0.08, 0x8a5a10, 0.05, 0.04, 0], [0.05, 0.05, 0.08, 0x8a5a10, 0, 0, 0], [0.05, 0.05, 0.08, 0x8a5a10, -0.05, -0.04, 0],
    ],
  };

/** A first-person model for a held item: tools, the wand, food, dishes (null for an empty hand). */
const darker = (c) => { const k = 0.62; return (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k); };
/** A cooked food (FOOD `cookedFrom`) looks like its raw self, browned. */
function cookedShape(kind) {
  const raw = FOOD[kind]?.cookedFrom;
  return raw && DROP_SHAPES[raw] ? DROP_SHAPES[raw].map(([w, h, d, c, ...rest]) => [w, h, d, darker(c), ...rest]) : null;
}
export function buildHeldModel(kind, material) {
  const shape = TOOL_SHAPES[kind] || DROP_SHAPES[kind] || cookedShape(kind) || (typeof kind === 'string' && kind.startsWith('scroll:') ? TOOL_SHAPES.scroll : null);
  return shape ? part(material, shape) : null;
}

const BUILDERS = {
  cat: buildCat,
  dog: buildDog,
  cow: buildCow,
  bird: (mat) => buildBird(mat, 'bird'),
  munia: (mat) => buildBird(mat, 'munia'),
  finch: (mat) => buildBird(mat, 'finch'),
  seagull: (mat) => buildBird(mat, 'seagull'),
  nutmunch: (mat) => buildBird(mat, 'nutmunch'),
  penguin: buildPenguin,
  zombie: buildZombie, skeleton: buildSkeleton, clerk: buildClerk, mildew: buildMildew,
  seedoil: buildSeedOil,
  sahur: buildSahur, pomodorino: buildPomodorino, lavatricio: buildLavatricio, ventilone: buildVentilone,
};
const REACHING = new Set(['zombie', 'clerk']); // arms held out in front

/** A fresh model of a mob type (for pictures, like the Bestiary's). */
export function buildMobModel(type, material) {
  return BUILDERS[type](material);
}

// Polymorph's coughing infant: a big head, a nappy, stubby limbs, sitting down. Front faces -Z.
const INFANT = { skin: 0xf1c7a5, cheek: 0xe89a8a, nappy: 0xf4f4f0, pin: 0x7fb3ff, eye: 0x1a1a1a, hair: 0x8a5a2b, mouth: 0xa04a4a };
export function buildInfantModel(mat) {
  const root = new THREE.Group();
  const body = part(mat, [
    [0.34, 0.3, 0.3, INFANT.skin, 0, 0.32, 0], [0.38, 0.2, 0.34, INFANT.nappy, 0, 0.12, 0], [0.04, 0.04, 0.02, INFANT.pin, 0.12, 0.16, -0.17],
    [0.12, 0.12, 0.3, INFANT.skin, -0.12, 0.06, -0.12], [0.12, 0.12, 0.3, INFANT.skin, 0.12, 0.06, -0.12], // legs out in front
    [0.1, 0.24, 0.1, INFANT.skin, -0.23, 0.3, 0], [0.1, 0.24, 0.1, INFANT.skin, 0.23, 0.3, 0],
  ]);
  const head = part(mat, [
    [0.42, 0.4, 0.4, INFANT.skin, 0, 0.2, 0], [0.12, 0.05, 0.12, INFANT.hair, 0, 0.42, 0],
    [0.06, 0.06, 0.02, INFANT.eye, -0.09, 0.24, -0.205], [0.06, 0.06, 0.02, INFANT.eye, 0.09, 0.24, -0.205],
    [0.07, 0.05, 0.02, INFANT.cheek, -0.15, 0.15, -0.205], [0.07, 0.05, 0.02, INFANT.cheek, 0.15, 0.15, -0.205],
    [0.08, 0.06, 0.02, INFANT.mouth, 0, 0.1, -0.205],
  ], 0, 0.47, 0);
  root.add(body, head);
  return { root, head };
}

/** While polymorphed (`poly`), a model's normal look hides and an infant takes its place; it coughs. */
export function showInfant(model, poly, material, rootKey = 'root') {
  const root = model[rootKey];
  if (poly && !model.infant) {
    model.infant = buildInfantModel(material);
    root.add(model.infant.root);
  }
  if (!model.infant) return;
  for (const child of root.children) {
    if (child === model.infant.root) child.visible = poly;
    else if (!child.userData.keep) child.visible = !poly;
  }
  if (poly) model.infant.head.rotation.x = Math.max(0, Math.sin(performance.now() / 260)) * 0.35; // cough, cough
}

// CONSUME delivery drone: a quadcopter with a cardboard box slung underneath. Front faces -Z.
const DRONE = { body: 0x2b2f36, arm: 0x4a4f58, rotor: 0xb8c0cc, hub: 0x16181c, lens: 0x1f6fd1, led: 0x3cff6a, box: 0xb98a52, tape: 0xe2c98f, strap: 0x22252a };
/** A drone model; `userData.rotors` spin, `userData.package` hides once it's dropped off. */
export function buildDroneModel(mat) {
  const root = new THREE.Group();
  root.add(part(mat, [
    [0.5, 0.16, 0.5, DRONE.body], [0.3, 0.06, 0.3, DRONE.arm, 0, 0.11, 0],
    [0.12, 0.08, 0.04, DRONE.lens, 0, -0.02, -0.26], [0.05, 0.03, 0.05, DRONE.led, 0, 0.15, 0.2],
    [1.1, 0.05, 0.07, DRONE.arm], [0.07, 0.05, 1.1, DRONE.arm],
  ]));
  const rotors = [];
  for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) {
    root.add(part(mat, [[0.08, 0.1, 0.08, DRONE.hub, 0, 0.06, 0]], x * 0.95, 0, z * 0.95));
    const r = part(mat, [[0.56, 0.02, 0.07, DRONE.rotor], [0.07, 0.02, 0.56, DRONE.rotor]], x * 0.95, 0.13, z * 0.95);
    root.add(r);
    rotors.push(r);
  }
  const pkg = part(mat, [
    [0.02, 0.3, 0.02, DRONE.strap, -0.15, -0.23, 0], [0.02, 0.3, 0.02, DRONE.strap, 0.15, -0.23, 0],
    [0.46, 0.34, 0.4, DRONE.box, 0, -0.55, 0], [0.47, 0.06, 0.41, DRONE.tape, 0, -0.55, 0],
  ]);
  root.add(pkg);
  root.userData = { rotors, package: pkg };
  return root;
}

export class MobModels {
  constructor(scene) {
    this.scene = scene;
    this.models = new Map(); // mob id -> model
    this.arrowModels = new Map();
    this.arrowMaterial = withFlashlight(new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.coinMaterial = new THREE.MeshBasicMaterial({ vertexColors: true }); // never dimmed: coins glint at night
  }

  _dropModel(kind) {
    const g = part(kind === 'zcash' || kind === 'surge' ? this.coinMaterial : this.arrowMaterial, DROP_SHAPES[kind] || cookedShape(kind) || DROP_SHAPES.bread);
    this.scene.add(g);
    return g;
  }

  /** Bobbing, spinning food items on the ground. */
  syncDrops(drops) {
    const live = new Set();
    this.dropModels ??= new Map();
    for (const d of drops.list) {
      live.add(d.id);
      let g = this.dropModels.get(d.id);
      if (!g) this.dropModels.set(d.id, (g = this._dropModel(d.kind)));
      if (d.dir) { // an arrow stuck in a block: still, pointing the way it flew, its head buried a little
        g.position.set(d.body.pos.x + d.dir.x * 0.15, d.body.pos.y + d.dir.y * 0.15, d.body.pos.z + d.dir.z * 0.15);
        g.lookAt(g.position.x - d.dir.x, g.position.y - d.dir.y, g.position.z - d.dir.z); // (models face -Z, so look backwards)
        continue;
      }
      if (d.kind === 'arrow') g.rotation.set(0, 0, 0); // (it was stuck; now it lies flat and turns like any drop)
      const coin = d.kind === 'zcash' || d.kind === 'surge';
      g.position.set(d.body.pos.x, d.body.pos.y + (coin ? 0.4 : 0.2) + Math.sin(d.age * 3) * 0.06, d.body.pos.z);
      g.rotation.y = d.age * (coin ? 3.5 : 2);
    }
    for (const [id, g] of this.dropModels) {
      if (live.has(id)) continue;
      this.scene.remove(g);
      this.dropModels.delete(id);
    }
  }

  _arrow() {
    const g = part(this.arrowMaterial, [
      [0.03, 0.03, 0.6, 0x8a6a44, 0, 0, 0],
      [0.05, 0.05, 0.08, 0x9aa0a8, 0, 0, 0.32],
      [0.1, 0.1, 0.04, 0xf2f2f2, 0, 0, -0.26],
    ]);
    this.scene.add(g);
    return g;
  }

  sync(mobs, light) {
    const alive = new Set();
    for (const m of mobs.list) {
      alive.add(m.id);
      let model = this.models.get(m.id);
      if (!model) {
        const material = withFlashlight(new THREE.MeshBasicMaterial({ vertexColors: true }));
        model = { extra: [], ...BUILDERS[m.type](material), material };
        this.scene.add(model.root);
        this.models.set(m.id, model);
      }
      model.root.position.set(m.pos.x, m.pos.y, m.pos.z);
      model.root.rotation.y = m.yaw;
      showInfant(model, !!m.poly, model.material); // polymorph
      model.root.scale.setScalar(m.scale ?? 1); // shrink
      // Arrows stuck in it (they fall out when it dies): little shafts poking out of its body at odd angles.
      model.stuck ??= [];
      while (model.stuck.length < (m.arrows || 0)) {
        const i = model.stuck.length;
        const a = part(this.arrowMaterial, DROP_SHAPES.arrow);
        const ang = ((m.id * 7 + i * 2.39) % (Math.PI * 2)); // spread round the body, the same for everyone
        const h = (m.height || 1) * (0.35 + ((i * 0.37) % 0.45));
        a.position.set(Math.sin(ang) * (m.halfW || 0.3), h, Math.cos(ang) * (m.halfW || 0.3));
        a.rotation.set(0.3 - ((i * 0.53) % 0.6), ang, 0); // head pointing inwards (models face -Z): the shaft sticks out
        a.scale.setScalar(0.7);
        model.root.add(a);
        model.stuck.push(a);
      }
      while (model.stuck.length > (m.arrows || 0)) model.root.remove(model.stuck.pop());

      const swing = Math.sin(m.walkPhase) * 0.7 * m.walkAmount;
      model.legs.forEach((leg, i) => { leg.rotation.x = i % 2 ? -swing : swing; });
      if (model.tail) {
        // Dogs wag hard; cats swish slowly.
        const t = performance.now() / 1000 + m.id;
        model.tail.rotation.y = m.type === 'dog' ? Math.sin(t * 16) * 0.6 : Math.sin(t * 2) * 0.35;
      }
      if (model.spin) model.spin.rotation.z = (performance.now() / 1000) * model.spinRate + m.id; // drum, blades
      if (model.punch) { // a boxer's guard, with quick jabs
        const j = performance.now() / 120 + m.id;
        model.arms[0].rotation.x = 1.1 + Math.max(0, Math.sin(j)) * 0.5;
        model.arms[1].rotation.x = 1.1 + Math.max(0, -Math.sin(j)) * 0.5;
      }
      if (model.drum) { // tung, tung, tung... (three quick strikes, then a breath)
        const c = (performance.now() / 1000 + m.id * 0.37) % 1.4;
        const k = c < 0.66 ? Math.abs(Math.sin((c / 0.22) * Math.PI)) : 0;
        model.arms[1].rotation.x = 0.5 + k * 1.4;
        model.arms[0].rotation.x = -swing * 0.6;
      }
      if (model.hop) model.root.position.y += Math.abs(Math.sin(m.walkPhase)) * 0.18 * m.walkAmount; // on one leg
      if (model.neck) model.neck.rotation.x = Math.sin(m.walkPhase * 0.5) * 0.12 * m.walkAmount; // the neck sways
      if (model.waddle) {
        // Rock side to side; the knife arm jabs when it's close enough to use it.
        model.body.rotation.z = Math.sin(m.walkPhase) * 0.12 * m.walkAmount;
        model.arms[1].rotation.x = 0.9 + Math.sin(performance.now() / 160 + m.id) * 0.25;
        model.arms[0].rotation.z = -0.25 - Math.abs(Math.sin(m.walkPhase)) * 0.2 * m.walkAmount;
      }
      if (model.wings) {
        // Wingbeats in flight; folded (with a little peck) on the ground.
        const beat = m.walkAmount > 0.5 ? Math.sin(m.walkPhase) * 0.9 : -0.15;
        model.wings[0].rotation.z = beat;
        model.wings[1].rotation.z = -beat;
        model.body.rotation.x = m.walkAmount > 0.5 ? 0 : Math.max(0, Math.sin(m.walkPhase * 2)) * 0.4;
      }
      if (m.type === 'cow' && model.head) {
        // Graze: dip the head now and then while standing still.
        model.head.rotation.x = m.walkAmount < 0.1 ? Math.max(0, Math.sin(m.id * 7 + performance.now() / 900)) * 0.7 : 0;
      }
      if (REACHING.has(m.type)) {
        model.arms[0].rotation.x = 1.45 + Math.sin(m.walkPhase * 0.5) * 0.08;
        model.arms[1].rotation.x = 1.45 - Math.sin(m.walkPhase * 0.5) * 0.08;
      } else if (m.type === 'skeleton') {
        const aim = m.aiming ? 1.5 : 0;
        model.arms[0].rotation.x += (aim - model.arms[0].rotation.x) * 0.2;
        model.arms[1].rotation.x = m.aiming ? 1.3 : -swing;
      }

      // Colour: daylight level, red when hurt.
      const c = model.material.color;
      const lit = light * (this.shadeAt ? this.shadeAt(m) : 1); // (dark in caves: main.js sets shadeAt)
      if (m.hurtT > 0) c.setRGB(lit * 1.6, lit * 0.5, lit * 0.5);
      else c.setScalar(lit);
      for (const extra of model.extra) extra.color.copy(c);
      if (m.type === 'seedoil') {
        // Stretch while rising, squash while falling or landing.
        const k = Math.max(-1, Math.min(1, m.vel.y / 8));
        const s = m.size / 2;
        model.body.scale.set(s * (1 - k * 0.12), s * (1 + k * 0.2), s * (1 - k * 0.12));
      }
    }
    for (const [id, model] of this.models) {
      if (alive.has(id)) continue;
      this.scene.remove(model.root);
      model.material.dispose();
      for (const extra of model.extra) extra.dispose();
      this.models.delete(id);
    }

    // Arrows
    const liveArrows = new Set();
    this.arrowMaterial.color.setScalar(light);
    for (const a of mobs.arrows) {
      liveArrows.add(a.id);
      let g = this.arrowModels.get(a.id);
      if (!g) this.arrowModels.set(a.id, (g = this._arrow()));
      g.position.set(a.pos.x, a.pos.y, a.pos.z);
      if (!a.stuck) g.lookAt(a.pos.x + a.vel.x, a.pos.y + a.vel.y, a.pos.z + a.vel.z);
    }
    for (const [id, g] of this.arrowModels) {
      if (liveArrows.has(id)) continue;
      this.scene.remove(g);
      this.arrowModels.delete(id);
    }
  }
}
