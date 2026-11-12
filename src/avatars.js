// Other players, as seen in multiplayer: a blocky person with a shirt colour from their id,
// a name tag, whatever is in their hands, and poses for walking, crouching and staring at a phone.

import * as THREE from 'three';
import { part, showInfant } from './mobModels.js';
import { withFlashlight } from './flashlight.js';
import { isGun, isTwoHanded, TOOLS, meleeStyle } from './items.js';
import { SKINS, defaultLook, tallScale } from './characters.js';

/**
 * How an arm holds an item: `arm` raises it forward (radians), `tilt` aims the item above level. Guns and
 * bows are aimed (`aim`): they follow where you look, held low with the elbows bent (see the pose code), so
 * your own arms stay out of your view. Swords and tools angle up and forward; anything else is held out a little.
 */
function holdPose(kind) {
  if (!kind || kind === 'empty') return null;
  if (isGun(kind)) return { arm: 1.35, tilt: 0, aim: true };
  if (TOOLS[kind] && !TOOLS[kind].armor) return { arm: 0.9, tilt: 0.7 };
  return { arm: 0.75, tilt: 0.25 };
}
const SWING_TIME = 0.3; // seconds for one swing of the arm
/** How hard each gun kicks your arms up when it fires (radians at the moment of the shot, easing back). The machine gun barely moves, so it stays on target. */
const RECOIL = { sniper: 0.15, pistol: 0.07, shotgun: 0.16, machinegun: 0.012, rocket: 0.12, railgun: 0.12, overcharge: 0.14 };
/** The Titan Blade's glow: a see-through gold shell round the (giant) item you hold. */
const GLOW = new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });

const SKIN = [0xe0b48c, 0xc68e62, 0x8d5a3b, 0xf1c9a5, 0xa8714a];
const HAIR = [0x2b1d14, 0x5a3a20, 0xc9a25a, 0x1a1a1a, 0x8a3b1e];
const PANTS_DEFAULT = 0x2f3f5c;
const SHOE = 0x2a2a2a;

function shirtColor(id) {
  return new THREE.Color().setHSL(((id * 0.61803) % 1 + 1) % 1, 0.55, 0.5).getHex();
}

function nameTag(name) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(248, ctx.measureText(name).width + 28);
  ctx.fillStyle = 'rgba(10, 14, 26, 0.6)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 10, w, 44, 12);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 33, 236);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.2;
  return sprite;
}

/** The icon over someone's head while they talk: a speaker, or a hush/megaphone when whispering/shouting. */
const VOICE_ICONS = { talk: '🔊', whisper: '🤫', shout: '📢' };
function voiceIcon(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10, 14, 26, 0.6)';
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '36px system-ui, "Noto Color Emoji", "Apple Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(VOICE_ICONS[kind], 32, 35);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(0.42, 0.42, 1);
  sprite.position.y = 2.68;
  sprite.visible = false;
  sprite.userData.keep = true;
  return sprite;
}

// Armor you can see (items.js armor TOOLS, worn with the `wear` message): boxes laid over the body parts,
// [w, h, d, colour, x, y, z] in each part's own frame. `torso` sits on the body, `upper`/`fore` on each arm,
// `leg` on each leg, `head` on the head (hidden in first person with the head).
const LEATHER = 0x7a4e2a;
const LEATHER_DARK = 0x5a3418;
const CHAIN = 0x9aa0a8;
const CHAIN_DARK = 0x737a84;
const STEEL = 0xc8ced6;
const STEEL_DARK = 0x8d949e;
const TRIM = 0xd9a93a;
const ARMOR_LOOKS = {
  leather: {
    torso: [[0.54, 0.62, 0.32, LEATHER, 0, 1.14, 0], [0.56, 0.06, 0.34, LEATHER_DARK, 0, 0.86, 0], [0.04, 0.5, 0.33, LEATHER_DARK, 0, 1.18, 0]], // a vest with a belt and laces
    fore: [[0.22, 0.12, 0.22, LEATHER, 0, -0.17, 0]], // bracers
  },
  chainmail: {
    torso: [[0.54, 0.7, 0.32, CHAIN, 0, 1.1, 0], [0.55, 0.04, 0.33, CHAIN_DARK, 0, 0.94, 0], [0.55, 0.04, 0.33, CHAIN_DARK, 0, 1.12, 0], [0.55, 0.04, 0.33, CHAIN_DARK, 0, 1.3, 0]],
    upper: [[0.23, 0.26, 0.23, CHAIN, 0, -0.06, 0]], // mail sleeves
    fore: [[0.22, 0.12, 0.22, CHAIN_DARK, 0, -0.17, 0]],
    head: [[0.47, 0.1, 0.47, CHAIN, 0, 0.45, 0], [0.47, 0.42, 0.05, CHAIN, 0, 0.22, 0.22], [0.05, 0.42, 0.47, CHAIN, -0.22, 0.22, 0], [0.05, 0.42, 0.47, CHAIN, 0.22, 0.22, 0]], // a coif (open at the face)
  },
  platearmor: {
    torso: [[0.56, 0.66, 0.34, STEEL, 0, 1.13, 0], [0.4, 0.3, 0.02, STEEL_DARK, 0, 1.22, -0.175], [0.57, 0.05, 0.35, TRIM, 0, 0.82, 0]], // breastplate, a raised chest, a gold-trimmed fauld
    upper: [[0.3, 0.16, 0.3, STEEL, 0, 0.02, 0], [0.31, 0.03, 0.31, TRIM, 0, -0.06, 0]], // pauldrons
    fore: [[0.23, 0.2, 0.23, STEEL, 0, -0.13, 0]], // vambraces
    leg: [[0.28, 0.34, 0.28, STEEL, 0, -0.44, 0], [0.29, 0.08, 0.3, STEEL_DARK, 0, -0.3, -0.01]], // greaves and knees
    head: [[0.48, 0.32, 0.48, STEEL, 0, 0.3, 0], [0.49, 0.04, 0.49, TRIM, 0, 0.46, 0], [0.3, 0.04, 0.02, 0x1a1a1a, 0, 0.25, -0.245], [0.06, 0.12, 0.04, STEEL, 0, 0.5, 0]], // helmet: visor slit and a crest
  },
};
/** Puts on (or takes off) the armor look for `kind` (null: none). */
function dressArmor(a, kind, material) {
  for (const m of a.armorParts || []) m.parent?.remove(m);
  a.armorParts = [];
  a.armorKind = kind;
  const look = ARMOR_LOOKS[kind];
  if (!look) return;
  const put = (boxes, parent) => { if (!boxes) return; const m = part(material, boxes); parent.add(m); a.armorParts.push(m); return m; };
  put(look.torso, a.body);
  for (const arm of a.arms) put(look.upper, arm);
  for (const fore of a.elbows) put(look.fore, fore);
  for (const leg of a.legs) put(look.leg, leg);
  a.helmet = put(look.head, a.head) || null;
}

/**
 * The head boxes for a look (characters.js): a normal head with its hair and brows, or a novelty head.
 * [w, h, d, colour, x, y, z] from the neck; the face is at -Z.
 */
function headBoxes(look, skin) {
  const hair = look.hairColor;
  const eye = 0x1a1a1a;
  const brow = look.hair === 'bald' ? 0x3b2414 : hair;
  switch (look.head) {
    case 'shiba': return [ // a blocky shiba: tan with a cream muzzle, pointed ears, a knowing side-eye
      [0.44, 0.4, 0.42, 0xd88a3a, 0, 0.2, 0], [0.26, 0.16, 0.16, 0xf2e2c8, 0, 0.12, -0.27], [0.08, 0.06, 0.04, 0x1a1a1a, 0, 0.18, -0.36],
      [0.1, 0.14, 0.08, 0xd88a3a, -0.15, 0.46, 0.02], [0.1, 0.14, 0.08, 0xd88a3a, 0.15, 0.46, 0.02],
      [0.08, 0.04, 0.02, 0xf2f2f2, -0.11, 0.28, -0.215], [0.08, 0.04, 0.02, 0xf2f2f2, 0.11, 0.28, -0.215],
      [0.04, 0.04, 0.025, eye, -0.08, 0.28, -0.22], [0.04, 0.04, 0.025, eye, 0.14, 0.28, -0.22], // (both eyes looking the same way: smug)
      [0.3, 0.12, 0.3, 0xf2e2c8, 0, 0.04, -0.06]];
    case 'hunk': return [ // absurdly square: a jaw like a brick, a cleft chin, a brow you could shelter under
      [0.46, 0.5, 0.44, skin, 0, 0.23, 0], [0.5, 0.18, 0.46, skin, 0, 0.04, -0.01], [0.04, 0.08, 0.02, 0x8a6a5a, 0, 0.0, -0.245],
      [0.48, 0.07, 0.06, brow, 0, 0.36, -0.215], [0.07, 0.05, 0.02, eye, -0.1, 0.3, -0.225], [0.07, 0.05, 0.02, eye, 0.1, 0.3, -0.225],
      [0.48, 0.16, 0.46, hair, 0, 0.5, 0.01], [0.16, 0.03, 0.02, 0x7a3a2a, 0, 0.12, -0.235]];
    case 'stone': return [ // a long stone face: heavy brow, long nose, tight mouth
      [0.42, 0.62, 0.4, 0x8a8478, 0, 0.3, 0], [0.44, 0.08, 0.06, 0x6e685e, 0, 0.44, -0.2], [0.1, 0.24, 0.1, 0x7a746a, 0, 0.28, -0.23],
      [0.06, 0.06, 0.02, 0x3a3630, -0.1, 0.38, -0.21], [0.06, 0.06, 0.02, 0x3a3630, 0.1, 0.38, -0.21], [0.2, 0.04, 0.02, 0x4a463e, 0, 0.1, -0.21]];
    case 'frog': return [ // wide, flat and unimpressed
      [0.56, 0.3, 0.46, 0x5aa04a, 0, 0.15, 0], [0.14, 0.12, 0.14, 0x5aa04a, -0.17, 0.32, -0.08], [0.14, 0.12, 0.14, 0x5aa04a, 0.17, 0.32, -0.08],
      [0.08, 0.06, 0.02, 0xf2f2c8, -0.17, 0.33, -0.16], [0.08, 0.06, 0.02, 0xf2f2c8, 0.17, 0.33, -0.16],
      [0.08, 0.03, 0.025, eye, -0.17, 0.34, -0.165], [0.08, 0.03, 0.025, eye, 0.17, 0.34, -0.165], [0.4, 0.03, 0.02, 0x2a5a24, 0, 0.08, -0.235]];
    default: break;
  }
  const out = [
    [0.42, 0.42, 0.42, skin, 0, 0.21, 0],
    [0.07, 0.07, 0.02, eye, -0.09, 0.24, -0.215],
    [0.07, 0.07, 0.02, eye, 0.09, 0.24, -0.215],
    ...(look.brows === 'uni' ? [[0.26, 0.04, 0.02, brow, 0, 0.31, -0.215]] : [[0.1, 0.035, 0.02, brow, -0.09, 0.31, -0.215], [0.1, 0.035, 0.02, brow, 0.09, 0.31, -0.215]]),
  ];
  const H = {
    short: [[0.44, 0.12, 0.44, hair, 0, 0.42, 0], [0.44, 0.3, 0.06, hair, 0, 0.3, 0.2]],
    long: [[0.44, 0.12, 0.44, hair, 0, 0.42, 0], [0.44, 0.56, 0.08, hair, 0, 0.18, 0.2], [0.05, 0.4, 0.4, hair, -0.22, 0.24, 0.02], [0.05, 0.4, 0.4, hair, 0.22, 0.24, 0.02]],
    curly: [[0.5, 0.18, 0.5, hair, 0, 0.44, 0.01], [0.5, 0.34, 0.1, hair, 0, 0.3, 0.2], [0.08, 0.22, 0.42, hair, -0.24, 0.32, 0.02], [0.08, 0.22, 0.42, hair, 0.24, 0.32, 0.02]],
    ponytail: [[0.44, 0.12, 0.44, hair, 0, 0.42, 0], [0.44, 0.28, 0.06, hair, 0, 0.3, 0.2], [0.12, 0.34, 0.12, hair, 0, 0.14, 0.27]],
    mohawk: [[0.1, 0.16, 0.44, hair, 0, 0.48, 0.02]],
    bald: [],
  };
  return [...out, ...(H[look.hair] || H.short)];
}

/** A person's model. `look` (characters.js) sets their skin, hair, brows, head and clothes; without one, colours come from `id`. */
export function buildAvatar(id, material, look = null) {
  const lk = look || { ...defaultLook(id), shirt: shirtColor(id), skin: id % SKINS.length };
  const skin = SKINS[lk.skin] ?? SKIN[id % SKIN.length];
  const shirt = lk.shirt;
  const PANTS = lk.pants ?? PANTS_DEFAULT;
  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts forward when crouching
  root.add(body);
  const legL = part(material, [[0.24, 0.72, 0.24, PANTS, 0, -0.36, 0], [0.25, 0.1, 0.27, SHOE, 0, -0.68, -0.01]], -0.13, 0.75, 0);
  const legR = part(material, [[0.24, 0.72, 0.24, PANTS, 0, -0.36, 0], [0.25, 0.1, 0.27, SHOE, 0, -0.68, -0.01]], 0.13, 0.75, 0);
  const torso = part(material, [[0.5, 0.72, 0.28, shirt, 0, 1.11, 0]]);
  // Arms bend at the elbow: the upper arm turns at the shoulder, the forearm (with the hand) at the elbow.
  // Straight, they're the same shape as ever: shoulder to hand, 0.69 long.
  const arm = (x) => {
    const upper = part(material, [[0.2, 0.38, 0.2, shirt, 0, -0.13, 0]], x, 1.42, 0);
    const fore = part(material, [[0.19, 0.26, 0.19, shirt, 0, -0.11, 0], [0.19, 0.18, 0.19, skin, 0, -0.3, 0]], 0, -0.3, 0);
    upper.add(fore);
    upper.userData.elbow = fore;
    return upper;
  };
  const armL = arm(-0.36);
  const armR = arm(0.36);
  const head = part(material, headBoxes(lk, skin), 0, 1.47, 0);
  const phone = part(material, [[0.12, 0.2, 0.02, 0x16181d, 0, 0, 0], [0.1, 0.17, 0.005, 0xff6ad5, 0, 0, -0.012]], 0, 1.15, -0.3);
  phone.rotation.x = -0.6;
  // Buildy Boi hard hat: a yellow dome with a brim and a ridge, sitting on the head.
  const hardhat = part(material, [
    [0.48, 0.16, 0.48, 0xf2c230, 0, 0.5, 0],
    [0.56, 0.04, 0.6, 0xf2c230, 0, 0.43, -0.03],
    [0.38, 0.06, 0.4, 0xf7d65a, 0, 0.6, 0],
    [0.06, 0.04, 0.5, 0xd9a91a, 0, 0.64, 0],
  ]);
  hardhat.visible = false;
  head.add(hardhat);
  body.add(legL, legR, torso, armL, armR, head, phone);
  // Items sit at the end of each arm.
  const holdL = new THREE.Group();
  const holdR = new THREE.Group();
  holdL.position.set(0, -0.38, -0.08);
  holdR.position.set(0, -0.38, -0.08);
  armL.userData.elbow.add(holdL); // (in the hand, at the end of the forearm)
  armR.userData.elbow.add(holdR);
  return { root, body, legs: [legL, legR], arms: [armL, armR], elbows: [armL.userData.elbow, armR.userData.elbow], head, phone, hardhat, hold: { left: holdL, right: holdR }, shown: {}, walkPhase: 0,
    swingT: { left: 0, right: 0 }, swSeen: null };
}

export class Avatars {
  /** `itemModel(kind)` returns a model for a held item (or null for an empty hand). */
  constructor(scene, itemModel) {
    this.scene = scene;
    this.itemModel = itemModel;
    this.material = withFlashlight(new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.models = new Map();
  }

  /**
   * `players`: Map of id -> { name, pos, yaw, pitch, crouch, phone, hands, dead, moved, talking, voice, sw, mine }.
   * `sw` counts swings per hand ({ left, right }: a new count starts a swing), `mine` is the hand chopping at a
   * block. For your own body (main.js keeps a separate Avatars for it): `self` hides the name tag;
   * `firstPerson` also hides the head and hat (the camera floats just in front of the face).
   */
  sync(players, light, dt) {
    this.material.color.setScalar(light);
    for (const [id, p] of players) {
      let a = this.models.get(id);
      const lookKey = JSON.stringify(p.look || null);
      if (a && a.lookKey !== lookKey) { // a new look: build the model again
        this.scene.remove(a.root);
        a.material.dispose();
        this.models.delete(id);
        a = null;
      }
      if (!a) {
        const material = withFlashlight(new THREE.MeshBasicMaterial({ vertexColors: true }));
        a = buildAvatar(id, material, p.look || null);
        a.material = material;
        a.lookKey = lookKey;
        a.tag = nameTag(p.name);
        a.tagName = p.name;
        a.root.add(a.tag);
        a.voice = Object.fromEntries(Object.keys(VOICE_ICONS).map((k) => [k, voiceIcon(k)]));
        for (const icon of Object.values(a.voice)) a.root.add(icon);
        this.scene.add(a.root);
        this.models.set(id, a);
      }
      if (a.tagName !== p.name) {
        a.root.remove(a.tag);
        a.tag = nameTag(p.name);
        a.tagName = p.name;
        a.root.add(a.tag);
      }
      a.root.visible = !p.dead && !p.invisible; // invisibility (the spell)
      if (p.surge) a.material.color.setRGB(light * 1.6, light * 0.85, light * 1.9); // Power Surge glow
      else if (p.stone) a.material.color.setRGB(light * 0.75, light * 0.75, light * 0.8); // stoneskin: grey
      else a.material.color.setScalar(light);
      a.tag.userData.keep = true; // (the name tag stays when polymorphed)
      const talk = p.talking ? (p.voice || 'talk') : null; // talking (voice.js), and whispering or shouting
      for (const [k, icon] of Object.entries(a.voice)) icon.visible = talk === k;
      if (p.self) a.tag.visible = false;
      showInfant(a, !!p.poly, a.material);
      a.root.scale.setScalar((p.scale ?? 1) * tallScale({ tallness: p.tall ?? 10 })); // shrunk (or enlarged), and how tall they are (Tallness)
      a.root.position.set(p.pos.x, p.pos.y, p.pos.z);
      a.root.rotation.y = p.yaw;

      // Held items (a two-handed one is drawn once, in the right hand)
      for (const hand of ['left', 'right']) {
        let kind = p.hands?.[hand] || 'empty';
        if (hand === 'left' && isTwoHanded(kind)) kind = 'empty';
        if (a.shown[hand] === kind) continue;
        a.shown[hand] = kind;
        a.hold[hand].clear();
        const m = this.itemModel(kind);
        if (m) {
          m.scale.multiplyScalar(0.8);
          m.rotation.x = -Math.PI / 2;
          a.hold[hand].add(m);
        }
      }
      // Titan Blade (an ultimate, ultimates.js): what you're holding is three times bigger, and glows.
      const giant = p.ult === 'titan' ? `${a.shown.left}|${a.shown.right}` : '';
      if (a.giant !== giant) {
        a.giant = giant;
        for (const hand of ['left', 'right']) {
          const h = a.hold[hand];
          h.scale.setScalar(giant ? 3 : 1);
          for (const c of [...h.children]) if (c.userData.glow) h.remove(c);
          if (!giant) continue;
          for (const c of [...h.children]) {
            const shell = c.clone();
            shell.traverse((o) => { if (o.isMesh) o.material = GLOW; });
            shell.scale.multiplyScalar(1.15);
            shell.userData.glow = true;
            h.add(shell);
          }
        }
      }

      // Poses
      a.walkPhase += p.moved * 3.2;
      const walking = Math.min(1, p.moved / Math.max(dt, 1e-3) / 3);
      const swing = Math.sin(a.walkPhase) * 0.7 * walking;
      a.legs[0].rotation.x = swing;
      a.legs[1].rotation.x = -swing;
      a.phone.visible = p.phone;
      a.hardhat.visible = !!p.buildy && !p.firstPerson;
      if ((p.worn || null) !== (a.armorKind ?? null)) dressArmor(a, p.worn || null, a.material); // armor you can see
      if (a.helmet) a.helmet.visible = !p.buildy; // (the hard hat goes on instead)
      a.head.visible = !p.firstPerson; // (polymorph hides the whole body, head and all, separately)
      // Swings: a new count for a hand starts one; holding the button on a block chops steadily.
      const sw = p.sw || { left: 0, right: 0 };
      if (a.swSeen) for (const hand of ['left', 'right']) if (sw[hand] !== a.swSeen[hand]) a.swingT[hand] = SWING_TIME;
      a.swSeen = { ...sw };
      const twoHanded = isTwoHanded(p.hands?.right);
      const arc = (hand) => {
        a.swingT[hand] = Math.max(0, a.swingT[hand] - dt);
        const t = a.swingT[twoHanded ? 'right' : hand] || a.swingT[hand];
        if (p.mine === hand || (twoHanded && p.mine)) return Math.abs(Math.sin(performance.now() / 110)) * 0.9;
        return t > 0 ? Math.sin((1 - t / SWING_TIME) * Math.PI) * 1.1 : 0;
      };
      const pitch = Math.max(-0.8, Math.min(0.8, p.pitch || 0));
      if (p.phone) {
        a.arms[0].rotation.set(0.5, 0, 0.3); // elbows bent, the phone in front of the chest
        a.arms[1].rotation.set(0.5, 0, -0.3);
        a.elbows[0].rotation.set(0.8, 0, 0);
        a.elbows[1].rotation.set(0.8, 0, 0);
        a.head.rotation.x = -0.5;
      } else {
        const blade = twoHanded && TOOLS[p.hands.right]?.attacks ? p.hands.right : null;
        // A two-handed blade: both hands on the hilt. The left button's swing slashes sideways (the arms sweep
        // from your right to your left), the right button's chops down from over your head.
        const sweepT = blade ? a.swingT.left : 0;
        const chopT = blade ? a.swingT.right : 0;
        if (blade && (sweepT > 0 || chopT > 0)) {
          arc('left');
          arc('right');
          const u = 1 - Math.max(sweepT, chopT) / SWING_TIME; // 0 at the start of the swing, 1 at the end
          const ease = u * u * (3 - 2 * u);
          let armX;
          let yaw = 0;
          let blade3;
          if (sweepT >= chopT && meleeStyle(blade, 'left') === 'sweep') {
            armX = 1.35;
            yaw = 1.1 - ease * 2.2;
            blade3 = 0; // level
          } else {
            armX = 2.9 - ease * 2.0; // from overhead down to in front
            blade3 = 2.4 - ease * 2.7; // the blade carries on past the arms
          }
          a.arms[0].rotation.set(armX, yaw + 0.15, 0.25);
          a.arms[1].rotation.set(armX, yaw - 0.15, -0.1);
          a.elbows[0].rotation.set(0, 0, 0);
          a.elbows[1].rotation.set(0, 0, 0);
          a.hold.right.position.set(0, -0.38, -0.08);
          a.hold.right.rotation.x = blade3 - armX;
          a.head.rotation.x = pitch;
          a.body.rotation.x = p.crouch ? -0.35 : 0;
          a.body.position.y = p.crouch ? -0.25 : 0;
          continue;
        }
        ['left', 'right'].forEach((hand, i) => {
          const pose = holdPose(twoHanded ? p.hands.right : p.hands?.[hand]);
          const walk = (i ? swing : -swing) * 0.8 * (pose ? 0.25 : 1);
          if (pose?.aim) {
            // Aiming a gun or bow: upper arms hang down and forward, elbows bent so the forearms (and the gun)
            // point where you look, low in front of the chest instead of across your face. A shot only jolts it.
            arc(hand); // (counts the swing timer down)
            const gun = twoHanded ? p.hands.right : p.hands[hand];
            const t = a.swingT[twoHanded ? 'right' : hand] / SWING_TIME; // 1 at the shot, easing to 0
            const recoil = (RECOIL[gun] ?? 0.04) * t * t; // a kick that springs back, not a swing
            const support = twoHanded && !i; // the left hand steadies a two-handed gun from underneath
            const shoulder = (support ? 0.62 : 0.5) + pitch * 0.55 + walk * 0.3;
            const fore = Math.PI / 2 + pitch - (support ? 0.12 : 0) + recoil; // the forearm's angle from hanging straight down
            a.arms[i].rotation.set(shoulder, support ? 0.2 : 0, support ? 0.32 : 0);
            a.elbows[i].rotation.set(fore - shoulder, support ? 0.25 : 0, 0);
            a.hold[hand].rotation.x = pitch + pose.tilt - fore; // the gun points along your view
            // Drawing a bow: it comes back towards you as the string is pulled (and trembles a little at full draw).
            const draw = hand === 'right' ? p.draw || 0 : 0;
            a.hold[hand].position.y = -0.38 + draw * 0.2;
            a.hold[hand].position.x = draw >= 1 ? Math.sin(performance.now() / 40) * 0.006 : 0;
            return;
          }
          const base = pose ? pose.arm : 0;
          a.hold[hand].position.set(0, -0.38, -0.08); // (in case a bow was being drawn)
          a.arms[i].rotation.set(base + walk + arc(hand), 0, 0);
          a.elbows[i].rotation.set(pose ? 0 : Math.abs(walk) * 0.3, 0, 0); // (a little bend in the elbow when you walk)
          // Keep the item pointing where the pose wants it (the arm's raise is undone).
          a.hold[hand].rotation.x = pose ? -base + pose.tilt - (pose ? 0 : Math.abs(walk) * 0.3) : 0;
        });
        a.head.rotation.x = pitch;
      }
      a.body.rotation.x = p.crouch ? -0.35 : 0;
      a.body.position.y = p.crouch ? -0.25 : 0;
    }
    for (const [id, a] of this.models) {
      if (players.has(id)) continue;
      this.scene.remove(a.root);
      a.material.dispose();
      a.tag.material.map.dispose();
      a.tag.material.dispose();
      for (const icon of Object.values(a.voice)) { icon.material.map.dispose(); icon.material.dispose(); }
      this.models.delete(id);
    }
  }
}
