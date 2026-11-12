// The game client: draws the world, runs your own movement, and turns your input into messages for
// the game. The game itself (mobs, items, health, saves) runs on the multiplayer server when this
// page is served by one, or right here in the browser for single-player. See game.js and net.js.

import * as THREE from 'three';
import { World, CS } from './world.js';
import { Body } from './body.js';
import { buildChunkMesh } from './mesher.js';
import { createAtlasCanvas, drawBlockIcon } from './textures.js';
import { Player } from './player.js';
import { AIR, WATER, FLUID, LAVA, PRINTER, COLD_WALLET, BED, FENCE, TRAPDOOR, LADDER, isBed, isTrapdoor, shapeBoxes, BLOCKS, TILE_COUNT, breakTime, SHAPES, LAVA_LAMP, DOOR, STAIRS_PLANKS, STAIRS_STONE, SLAB_PLANKS, SLAB_STONE,
  isDoor, doorInfo, doorId, orientedId, facingOf, BED_FOOT, bedOther, isShopCounter, shopOfBlock, isCrop, isSoil, cropInfo, CROPS, CROP,
  RANGE, CAMPFIRE, OLIVE_PRESS, SNOW_LAYER, POTTERY_WHEEL, KILN, GLAZING_TABLE, POT_OBJECTS, POT_NAMES, CLAYS, CLAY_NAMES, CLAY_BLOCKS, GLAZE_NAMES, isPottery, isLuminary, potteryId, potteryInfo, potteryName } from './blocks.js';
import { RECIPES, STATIONS, stationOf, canCook, needsText, cookSeconds } from './cooking.js';
import { CRAFTS, craftById, canCraft, craftNeedsText, craftName } from './crafting.js';
import { findWater } from './fishing.js';
import { UNFIRED, unfiredInfo, unfiredName, firedId, fireSeconds, clayFor, glazedKey, toggledLuminary } from './pottery.js';
import { GARDEN_TOOLS } from './garden.js';
import { Lamps, lavaLampModel } from './lamps.js';
import { MOB_TYPES } from './mobs.js';
import { MobModels, buildHeldModel, buildMobModel, buildDroneModel } from './mobModels.js';
import { BESTIARY, bestiaryFacts } from './bestiary.js';
import { Effects } from './effects.js';
import { Sky } from './sky.js';
import { ammoCount, meleeStyle } from './items.js';
import { FOOD, DISHES, TOOLS, TRAITS, BLOCK_PRINTS, shopCatalog, shopOffer, printUsd, inventoryList, filterItems, tabComplete, itemName, itemCount, blockKind, blockIdOf, isMiningKind, isGun, isTwoHanded,
  SHOPS, townCatalog, townOffer, isArmor, scrollOf, allItems, giveDefault } from './items.js';
import { Picker } from './picker.js';
import { TileShop } from './tileshop.js';
import { Game, cleanName } from './game.js';
import { openLink } from './net.js';
import { Avatars } from './avatars.js';
import { signIn } from './account.js';
import { daylight, lightMultiplier, clockString } from './daycycle.js';
import { SETTINGS, SETTING_GROUPS, loadSettings, settingText, gunStats, T, setTuning } from './settings.js';
import { SPELLS, SPELL_ORDER, isFocus, spellCost, spellCooldown } from './spells.js';
import { Phantoms } from './phantoms.js';
import { COMMANDS, PLACES, MOB_WORDS, commandOf } from './commands.js';
import { SoundSystem, blockMaterial } from './audio.js';
import { withFlashlight, setFlashlights, setLamps } from './flashlight.js';
import { Voice } from './voice.js';
import { skillName, title as skillTitle, totalPoints, pointsFor } from './skills.js';
import { blocksBetween, probeSpace } from './acoustics.js';
import { PhoneApps } from './phone.js';
import { MapView } from './map.js';
import { zecFor, usd } from './market.js';
import { GUNS, AMMO, GRAPPLE } from './weapons.js';
import { STATS, statEffects, effectText, verdict } from './stats.js';
import { questGoal, questProgress, questReady, lostName } from './quests.js';

let buildSwitch = null; // { to, t } while the hard hat is going on or off (from the game)

const REACH = 6;
const BUILD_BUDGET_MS = 6;
const ATTACK_COOLDOWN = 0.3;
const STATE_EVERY = 0.05; // send your position 20 times a second
const NO_INPUT = { forward: 0, right: 0, jump: false, down: false, crouch: false, sprint: false };
const UNDERWATER = new THREE.Color(0x1d4b8c);
const IN_LAVA = new THREE.Color(0xc2410c);
const IN_BALLS = new THREE.Color(0xe94f9b);

// ---------- storage (fails soft in private mode) ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
// Client settings (Esc -> Settings): how things look, sound and feel on this computer. Not gameplay, so
// not Server settings; remembered in this browser.
const CLIENT_DEFAULTS = { sensitivity: 1, invertY: false, fov: 75, shake: true, info: false, chat: true, renderDistance: 6, resScale: 1, echo: 1, ambient: true, fontScale: 1.25 };
const prefs = { ...CLIENT_DEFAULTS };
try { Object.assign(prefs, JSON.parse(store.get('game:client')) || {}); } catch { /* defaults */ }
const savePrefs = () => store.set('game:client', JSON.stringify(prefs));
let renderDistance = prefs.renderDistance; // in chunks (Settings: Graphics)

// ---------- sound (browsers only allow it after a click or key press) ----------
const sound = new SoundSystem(store);
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => sound.unlock(), { capture: true });
const materialUnder = (pos) => blockMaterial(world.getBlock(Math.floor(pos.x), Math.floor(pos.y - 0.05), Math.floor(pos.z)));
const centre = (x, y, z) => ({ x: x + 0.5, y: y + 0.5, z: z + 0.5 });
const recentEdits = new Map(); // your own block edits, so their echo from the game doesn't play twice

// ---------- connection and your Player (accounts.js, account.js) ----------
window.gameConnecting = true;
const netStatus = document.getElementById('net-status');
const link = await openLink({
  // No server answered: run the game in this browser, saving to localStorage (one save per Player).
  makeLocalGame: () => new Game({
    store,
    multiplayer: false,
    loadPlayer: (uid) => { try { return JSON.parse(store.get(`game:player:${uid}`) || 'null'); } catch { return null; } },
    savePlayer: (uid, data) => store.set(`game:player:${uid}`, data === null ? 'null' : JSON.stringify(data)),
  }),
});
window.gameConnecting = false;
const conn = await signIn({ store, link, status: netStatus }); // (asks on the title screen if this browser has no Player yet)
const multiplayer = conn.mode === 'multiplayer';
const welcome = conn.welcome;
const myId = welcome.id;
const identity = { name: welcome.name, uid: welcome.uid, look: welcome.look || null }; // your Player (and character)
let isAdmin = !!welcome.admin; // Admins get Settings > Players
let time = welcome.time;
let rate = welcome.rate; // USD per ZEC, from the game
const rateHistory = [rate]; // about one sample a second, for the printer's price chart
const settings = T; // the server's settings (Server settings on the main menu): the live values every module reads
setTuning(loadSettings(welcome.settings));
let rateSampleT = 0;

const buttons = { left: false, right: false }; // mouse buttons held (left = left hand, right = right hand)

// Your copy of the world, for drawing and for your own movement. The game owns the real one.
const world = new World(welcome.seed, null);
world.setLegacy(welcome.legacy); // chunks frozen on the first generation (before anything generates)
world.setGen2(welcome.gen2 || []); // and on the second (the one with the Ball Pit)
for (const [x, y, z, id] of welcome.edits) world.setBlock(x, y, z, id);
const player = new Player(world);
player.spawn(welcome.pos);
Object.assign(player.hands, welcome.hands);
applyYou(welcome.you);
player.attach(document);

/** Your health, XP and inventory, as the game reports them. */
function applyYou(y) {
  const wasDead = player.dead;
  for (const f of ['hp', 'maxHp', 'dead', 'level', 'cleaned']) player[f] = y[f];
  player.skills = { ...y.skills };
  for (const inv of ['food', 'dishes', 'wallet', 'tools']) player[inv] = { ...y[inv] };
  player.traits = { ...y.traits };
  player.gravityMul = player.traits.lowGravity ? T.lowGravityFactor : 1; // gravity resistant (a setting)
  player.stats = { ...y.stats };
  player.statBonus = { ...y.statBonus };
  player.statPoints = y.statPoints || 0;
  player.effects = { ...y.effects };
  if (!(player.effects.flap > 0)) player.effects.flap = 0;
  player.ammo = { ...y.ammo };
  player.mana = y.mana;
  player.maxMana = y.maxMana;
  player.bed = y.bed;
  player.blocks = { ...y.blocks };
  player.unfired = { ...y.unfired };
  player.cooking = y.cooking || null;
  player.materials = { ...y.materials };
  player.spells = [...(y.spells || [])];
  if (y.hotbars) player.hotbars = { left: [...y.hotbars.left], right: [...y.hotbars.right] };
  player.kiln = y.kiln || null;
  player.scrolls = { ...y.scrolls };
  player.worn = y.worn ?? null;
  player.orders = y.orders || [];
  player.buildy = y.buildy;
  player.quests = y.quests || { active: [], cool: [], done: 0 };
  buildSwitch = y.buildSwitch;
  if (!player.buildy && !(player.effects.flight > 0)) player.flying = false; // only Buildy Bois fly (and the Flying spell, while it lasts)
  player.validateHands();
  if (player.dead && !wasDead) {
    buttons.left = buttons.right = false;
    sound.play('death');
  }
}

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// CSS stretches the canvas over the whole viewport; fitRenderer() matches the drawing buffer to it.
renderer.setSize(window.innerWidth, window.innerHeight, false);
document.body.prepend(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0xffffff, renderDistance * CS * 0.55, renderDistance * CS * 0.95);

let BASE_FOV = prefs.fov; // Settings: Display
let adsT = 0; // 0 = hip, 1 = aiming down sights
const scopeEl = document.getElementById('scope');
const scopeZoomEl = document.getElementById('scope-zoom');
let scopeLevel = 0; // the Sniper Rifle's scope: 0 off, 1-3 the Scope zoom settings (right-click steps through them)
let zoomMag = 1; // the magnification right now (eases towards the one wanted)
const ADS_POS = { y: -0.3, z: -0.6 }; // where the aimed gun sits (centred under the crosshair)
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 1000);
camera.rotation.order = 'YXZ';

const atlasCanvas = createAtlasCanvas();
const atlas = new THREE.CanvasTexture(atlasCanvas);
atlas.magFilter = THREE.NearestFilter;
atlas.minFilter = THREE.NearestFilter;
atlas.generateMipmaps = false;
atlas.colorSpace = THREE.SRGBColorSpace;

const solidMaterial = withFlashlight(new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 }));
const waterMaterial = withFlashlight(new THREE.MeshBasicMaterial({
  map: atlas, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
}));

const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 }),
);
highlight.visible = false;
scene.add(highlight);

// First-person view of what's in each hand, parented to the camera (left hand mirrored).
scene.add(camera);
const heldMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
const heldBlockMaterial = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5 });
const glowMaterial = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true }); // lava and lights: never dimmed
const handViews = {};
for (const [hand, side] of [['left', -1], ['right', 1]]) {
  const pivot = new THREE.Group();
  pivot.position.set(0.5 * side, -0.45, -0.8);
  camera.add(pivot);
  handViews[hand] = { pivot, side, model: null, shown: null, swingT: 0, home: pivot.position.clone() };
}

/** A small textured cube for holding a block. */
function heldBlockModel(id) {
  if (id === LAVA_LAMP) {
    const lamp = lavaLampModel(0.18);
    lamp.position.set(0, 0.0, -0.05);
    const group = new THREE.Group();
    group.add(lamp);
    return group;
  }
  if (SHAPES[orientedId(id, 0)]) { // stairs, slabs, doors: their own boxes, scaled down
    const group = new THREE.Group();
    const def = BLOCKS[id];
    const tall = isDoor(id) ? 2 : 1;
    const s = isPottery(id) ? 0.36 : 0.16 / tall; // (a mug in your hand is mug-sized)
    const boxes = isDoor(id) ? [[0, 0, 0, 1, 2, 3 / 16]]
      : id === FENCE ? shapeBoxes(FENCE, (x) => (x === 0 ? AIR : FENCE), 0, 0, 0) // a post with rails both ways
        : SHAPES[orientedId(id, 0)];
    for (const b of boxes) {
      const g = new THREE.BoxGeometry((b[3] - b[0]) * s, (b[4] - b[1]) * s, (b[5] - b[2]) * s);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (def.side + 0.001 + (isPottery(id) ? 0.3 + uv.getX(i) * 0.4 : uv.getX(i) * 0.998)) / TILE_COUNT);
      const m = new THREE.Mesh(g, heldBlockMaterial);
      m.position.set(((b[0] + b[3]) / 2 - 0.5) * s, 0.1 + ((b[1] + b[4]) / 2 - 0.5) * s, -0.05 + ((b[2] + b[5]) / 2 - 0.5) * s);
      group.add(m);
    }
    return group;
  }
  const g = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const uv = g.attributes.uv;
  const def = BLOCKS[id];
  const faces = [def.side, def.side, def.top, def.bottom, def.side, def.side]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setX(i, (faces[f] + 0.001 + uv.getX(i) * 0.998) / TILE_COUNT);
    }
  }
  const m = new THREE.Mesh(g, heldBlockMaterial);
  m.position.set(0, 0.1, -0.05);
  const group = new THREE.Group();
  group.add(m);
  return group;
}

function refreshHeld() {
  for (const [hand, view] of Object.entries(handViews)) {
    const kind = player.hands[hand];
    if (kind === view.shown) continue;
    view.shown = kind;
    if (view.model) view.pivot.remove(view.model);
    const id = blockIdOf(kind);
    view.model = id !== null ? heldBlockModel(id) : buildHeldModel(kind, heldMaterial);
    if (view.model) {
      view.model.rotation.set(-0.5, 0.35 * view.side, 0.18 * view.side);
      if (kind === 'flashlight' || (isGun(kind) && GUNS[kind].type !== 'arrow') || kind === 'grapple') view.model.rotation.set(-1.42, 0.08 * view.side, 0); // point it where you look
      if (isGun(kind) && GUNS[kind].type === 'arrow') view.model.rotation.set(-1.42, 0.08 * view.side, kind === 'crossbow' ? 0 : -0.35); // bows: held a little canted
      if (id === null) view.model.scale.setScalar(0.8);
      view.pivot.add(view.model);
    }
  }
}

const sky = new Sky(scene);
const lamps = new Lamps(scene);
let lampsDirty = true;
const panelLights = []; // fluorescent panels near you
const PANEL_COLOR = new THREE.Vector3(0.95, 0.93, 0.75); // that flat, buzzing, slightly yellow light
const LUMINARY_COLOR = new THREE.Vector3(1, 0.7, 0.38); // a candle behind clay: warm and orange
let lampSyncT = 0;
/** Lava lamps in the chunks around you (they're not meshed: each is a little model and a light). */
function updateLamps(dt, lightMul) {
  lampSyncT -= dt;
  if (lampsDirty || lampSyncT <= 0) {
    lampsDirty = false;
    lampSyncT = 1;
    const spots = [];
    panelLights.length = 0;
    const pcx = Math.floor(player.pos.x / CS);
    const pcz = Math.floor(player.pos.z / CS);
    for (const chunk of world.chunks.values()) {
      if (!chunk.meshes) continue;
      if (Math.abs(chunk.cx - pcx) > renderDistance || Math.abs(chunk.cz - pcz) > renderDistance) continue;
      if (chunk.lamps?.length) spots.push(...chunk.lamps);
      for (const [x, y, z, kind] of chunk.lights || []) {
        panelLights.push(kind === 'luminary' ? { pos: new THREE.Vector3(x + 0.5, y + 0.45, z + 0.5), color: LUMINARY_COLOR }
          : { pos: new THREE.Vector3(x + 0.5, y - 0.2, z + 0.5), color: PANEL_COLOR });
      }
    }
    lamps.sync(spots);
  }
  const sources = lamps.update(dt, camera.position);
  for (const l of panelLights) l.d = l.pos.distanceToSquared(camera.position);
  setLamps([...sources, ...panelLights].sort((a, b) => a.d - b.d), lightMul);
}
const effects = new Effects(scene, atlasCanvas);
const phantoms = new Phantoms(world); // Hallucinate: monsters only you can see
const mobModels = new MobModels(scene);

// ---------- chunk meshes ----------
function toMesh(arrays, material, chunk) {
  if (!arrays.vertexCount) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(arrays.uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
  g.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.position.set(chunk.cx * CS, 0, chunk.cz * CS);
  return mesh;
}

function disposeMeshes(chunk) {
  for (const m of chunk.meshes || []) {
    scene.remove(m);
    m.geometry.dispose();
  }
  chunk.meshes = null;
}

function buildChunk(chunk) {
  const { solid, water, glow, lamps: lampSpots, lights } = buildChunkMesh(world, chunk);
  chunk.lamps = lampSpots;
  chunk.lights = lights;
  lampsDirty = true;
  disposeMeshes(chunk);
  chunk.meshes = [];
  const s = toMesh(solid, solidMaterial, chunk);
  const w = toMesh(water, waterMaterial, chunk);
  if (s) { scene.add(s); chunk.meshes.push(s); }
  if (w) { w.renderOrder = 1; scene.add(w); chunk.meshes.push(w); }
  const gl = toMesh(glow, glowMaterial, chunk);
  if (gl) { scene.add(gl); chunk.meshes.push(gl); }
  chunk.dirty = false;
}

let frameCount = 0;
function updateChunks() {
  const pcx = Math.floor(player.pos.x / CS);
  const pcz = Math.floor(player.pos.z / CS);
  const todo = [];
  for (let dz = -renderDistance; dz <= renderDistance; dz++) {
    for (let dx = -renderDistance; dx <= renderDistance; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > renderDistance * renderDistance) continue;
      const chunk = world.chunks.get(World.key(pcx + dx, pcz + dz));
      if (!chunk || !chunk.meshes || chunk.dirty) todo.push({ cx: pcx + dx, cz: pcz + dz, d2 });
    }
  }
  todo.sort((a, b) => a.d2 - b.d2);
  const start = performance.now();
  for (const t of todo) {
    buildChunk(world.getChunk(t.cx, t.cz));
    if (performance.now() - start > BUILD_BUDGET_MS) break;
  }

  if (++frameCount % 60 === 0) {
    for (const [key, chunk] of world.chunks) {
      const d = Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz));
      if (d > renderDistance + 2 && chunk.meshes) disposeMeshes(chunk);
      if (d > renderDistance + 4) world.chunks.delete(key);
    }
  }
}

// Fishing (fishing.js): everyone's bobber floats where they cast, bobs, and dips when a fish bites; a
// thin line runs to their rod's tip. The bobbers come in snapshots (`players[].bobber`).
let bobbers = [];
const bobberModels = new Map(); // player id -> { group, line }
const bobberMats = [new THREE.MeshBasicMaterial({ color: 0xd94a3a }), new THREE.MeshBasicMaterial({ color: 0xf4f4f0 })];
const lineMat = new THREE.LineBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.7 });
function updateBobbers() {
  const seen = new Set();
  const now = performance.now() / 1000;
  for (const b of bobbers) {
    seen.add(b.id);
    let m = bobberModels.get(b.id);
    if (!m) {
      const group = new THREE.Group();
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), bobberMats[0]);
      const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bobberMats[1]);
      group.add(top, bottom);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
      line.frustumCulled = false;
      scene.add(group, line);
      m = { group, line };
      bobberModels.set(b.id, m);
    }
    const dip = b.bite ? -0.12 + Math.sin(now * 30) * 0.03 : Math.sin(now * 2.2 + b.id) * 0.025; // a bite pulls it under
    m.group.position.set(b.x, b.y + dip, b.z);
    // The rod's tip: up and out in front of whoever's holding it.
    let tip;
    if (b.id === myId) tip = camera.position.clone().addScaledVector(dir, 1.1).add(new THREE.Vector3(0, 0.35, 0));
    else {
      const p = remote.players.get(b.id);
      if (!p) continue;
      const s = p.scale ?? 1;
      tip = new THREE.Vector3(p.pos.x - Math.sin(p.yaw) * 1.1 * s, p.pos.y + 2.0 * s, p.pos.z - Math.cos(p.yaw) * 1.1 * s);
    }
    const attr = m.line.geometry.attributes.position;
    attr.setXYZ(0, tip.x, tip.y, tip.z);
    attr.setXYZ(1, b.x, b.y + dip + 0.05, b.z);
    attr.needsUpdate = true;
  }
  for (const [id, m] of bobberModels) {
    if (seen.has(id)) continue;
    scene.remove(m.group, m.line);
    m.line.geometry.dispose();
    bobberModels.delete(id);
  }
}

const sackModels = new Map(); // thrown hackysacks in flight
const droneMaterial = withFlashlight(new THREE.MeshBasicMaterial({ vertexColors: true })); // CONSUME delivery drones
const avatarItem = (kind) => {
  const id = blockIdOf(kind);
  return id !== null ? heldBlockModel(id) : buildHeldModel(kind, heldMaterial);
};
const avatars = new Avatars(scene, avatarItem);
// Your own body: the same model everyone else sees, holding things and swinging exactly as they see it. In
// first person the camera floats just in front of its face (the head is hidden); P switches to a camera
// behind you or in front of you (`viewMode`). Swings and mining go out in `state` so others see them too.
const selfAvatar = new Avatars(scene, avatarItem);
const npcAvatars = new Avatars(scene, avatarItem); // the Fantasy Town's people (npcs.js)
const VIEWS = ['first person', 'behind you', 'facing you'];
let viewMode = 0;
let lastSelfPos = null;
function syncSelf(lightMul, dt) {
  const first = viewMode === 0 && !sheetOpen; // (the character sheet shows you from the front)
  const scale = player.bodyScale || 1;
  const pos = { ...player.pos };
  const moved = lastSelfPos ? Math.hypot(player.pos.x - lastSelfPos.x, player.pos.z - lastSelfPos.z) : 0;
  lastSelfPos = { ...player.pos };
  const me = {
    name: identity.name, pos, yaw: player.yaw, pitch: player.pitch, crouch: player.crouching, phone: phoneOut, hands: player.hands,
    // (looking through a scope: no arms or gun in the way)
    dead: player.dead || (first && (player.effects.polymorph > 0 || (scopeLevel > 0 && adsT > 0.5))),
    moved, scale, buildy: player.buildy, poly: player.effects.polymorph > 0,
    stone: player.effects.stoneskin > 0, surge: player.effects.surge > 0, self: true, firstPerson: first, worn: player.worn || null, look: identity.look, tall: player.stats?.tallness ?? 10, sw: mySwings, mine: myMineHand, draw: Math.max(bowDraw.left, bowDraw.right),
  };
  selfAvatar.sync(new Map([[myId, me]]), lightMul, dt);
}
/** Where the camera goes this frame for the view you picked: back along your aim (or in front, looking back), stopping at walls. */
function placeViewCamera() {
  if (sheetOpen) { // the character sheet: you, from the front (or wherever you've dragged it), framed on the right
    const s = Math.min(3, player.bodyScale || 1);
    const a = player.yaw + sheetOrbit;
    const chest = new THREE.Vector3(player.pos.x, player.pos.y + 1.05 * s, player.pos.z);
    const toward = new THREE.Vector3(-Math.sin(a), 0.12, -Math.cos(a)).normalize();
    const hit = world.raycast(chest, toward, 3.2 * s);
    camera.position.copy(chest).addScaledVector(toward, hit ? Math.max(0.6, hit.t - 0.2) : 3.2 * s);
    camera.lookAt(chest);
    return;
  }
  if (viewMode === 0) { // first person: just in front of your face, looking where you look
    camera.position.addScaledVector(dir, 0.3 * Math.min(3, player.bodyScale || 1));
    return;
  }
  const eye = camera.position.clone();
  const along = viewMode === 1 ? dir.clone().negate() : dir.clone();
  const want = 4 * Math.min(3, Math.max(0.5, player.bodyScale || 1));
  const hit = world.raycast(eye, along, want);
  const dist = hit ? Math.max(0.3, hit.t - 0.25) : want;
  camera.position.addScaledVector(along, dist);
  if (viewMode === 2) camera.lookAt(eye);
}

// ---------- HUD ----------
const infoEl = document.getElementById('info');
const overlayEl = document.getElementById('overlay');
const healthFill = document.getElementById('health-fill');
const hurtEl = document.getElementById('hurt');
const deathEl = document.getElementById('death');
const healEl = document.getElementById('heal');
let healFlash = 0;

// 16x16 pixel-art icons for inventory slots: [colour, x, y, w, h] rectangles.
const ICONS = {
  steak: [['#7a2a1e', 2, 4, 12, 9], ['#a8402e', 3, 5, 10, 7], ['#f0e0d0', 3, 10, 10, 2], ['#f5f0e6', 11, 5, 2, 2], ['#c4583f', 5, 6, 3, 2]],
  liver: [['#4a1219', 2, 5, 12, 7], ['#6a1f2a', 3, 6, 10, 5], ['#7d2a35', 2, 8, 5, 4], ['#9a3a45', 5, 6, 3, 1]],
  plate: [['#cfcfc8', 1, 5, 14, 7], ['#f4f4f0', 2, 6, 12, 5], ['#8a6a3a', 6, 7, 3, 2], ['#a07d48', 9, 8, 2, 1]],
  bowl: [['#5f8fc0', 2, 6, 12, 2], ['#8fbfe8', 3, 8, 10, 3], ['#6f9fd0', 5, 11, 6, 2], ['#7a5a30', 3, 6, 10, 1]],
  cutlery: [['#c8ccd2', 4, 5, 2, 9], ['#c8ccd2', 3, 2, 1, 4], ['#c8ccd2', 5, 2, 1, 4], ['#b0b4ba', 10, 2, 2, 12], ['#8a8e94', 11, 2, 1, 6]],
  shovel: [['#8a6a44', 7, 5, 2, 10], ['#3a3a3a', 5, 14, 6, 1], ['#b8bec6', 5, 1, 6, 5], ['#d8dee6', 6, 1, 2, 4]],
  pick: [['#8a6a44', 7, 4, 2, 11], ['#b8bec6', 2, 2, 12, 2], ['#b8bec6', 1, 3, 2, 3], ['#b8bec6', 13, 3, 2, 3]],
  axe: [['#8a6a44', 7, 3, 2, 12], ['#b8bec6', 9, 2, 4, 5], ['#e2e7ee', 12, 1, 2, 7], ['#6b5233', 6, 3, 1, 3]],
  sword: [['#d4dae2', 7, 1, 2, 10], ['#f0f4f8', 7, 1, 1, 9], ['#d9a93a', 4, 11, 8, 1], ['#4a3020', 7, 12, 2, 3]],
  pillow: [['#3aa7a0', 2, 3, 12, 10], ['#4cc0b8', 3, 4, 10, 8], ['#f2e6c8', 2, 3, 12, 1], ['#f2e6c8', 2, 12, 12, 1], ['#f2e6c8', 1, 2, 1, 2], ['#f2e6c8', 14, 2, 1, 2]],
  hackysack: [['#d8433a', 4, 4, 8, 8], ['#f2c230', 3, 6, 10, 4], ['#3fae5a', 6, 3, 4, 10], ['#3a7fd8', 6, 6, 4, 4]],
  penguin: [['#8a4a20', 1, 6, 14, 7], ['#b8662e', 2, 5, 12, 6], ['#f0902a', 6, 9, 4, 2], ['#f2e6d0', 3, 6, 3, 2]],
  bird: [['#8a4a20', 2, 6, 12, 7], ['#b8662e', 3, 5, 10, 6], ['#d88a44', 4, 5, 7, 3], ['#f2e6d0', 1, 11, 3, 2], ['#f2e6d0', 12, 11, 3, 2]],
  bread: [['#9a6328', 1, 5, 14, 8], ['#c8873e', 2, 5, 12, 7], ['#e0a85a', 3, 5, 10, 3], ['#9a6328', 5, 5, 1, 3], ['#9a6328', 9, 5, 1, 3]],
  milk: [['#b9c7d3', 4, 2, 8, 13], ['#faf8f2', 5, 4, 6, 10], ['#dfe9f2', 4, 2, 8, 2], ['#ffffff', 6, 5, 1, 7]],
  cheese: [['#d9a92e', 1, 6, 14, 8], ['#f2c94c', 2, 7, 12, 6], ['#f2c94c', 4, 4, 10, 3], ['#c08a1e', 5, 9, 2, 2], ['#c08a1e', 10, 8, 2, 2], ['#c08a1e', 8, 11, 1, 1]],
  glass: [['#b9c7d3', 4, 2, 8, 13], ['#e6eef5', 5, 3, 6, 11], ['#ece6d8', 5, 12, 6, 2], ['#a08060', 7, 6, 2, 1]],
  pistol: [['#2d3036', 2, 4, 11, 4], ['#4a3324', 3, 8, 4, 6], ['#bfc5cc', 11, 3, 2, 1]],
  shotgun: [['#3a3e46', 4, 5, 12, 2], ['#6b4a2b', 0, 6, 5, 4], ['#6b4a2b', 8, 7, 4, 2], ['#2d3036', 4, 8, 2, 3]],
  machinegun: [['#2d3036', 1, 5, 9, 4], ['#55595f', 10, 6, 6, 2], ['#2d3036', 5, 9, 3, 5], ['#2d3036', 2, 9, 2, 4], ['#d9a93a', 7, 4, 2, 1]],
  rocket: [['#4f5d3a', 0, 5, 14, 5], ['#2d3036', 13, 4, 3, 7], ['#d94a3a', 15, 6, 1, 3], ['#2d3036', 5, 10, 2, 4]],
  sniper: [['#3d4a2e', 1, 8, 9, 3], ['#2d3036', 9, 8, 7, 1], ['#1a1a1a', 4, 5, 6, 2], ['#7fb8d8', 9, 5, 1, 2], ['#4a3324', 0, 9, 3, 4], ['#1a1a1a', 6, 11, 1, 2]],
  railgun: [['#3a4a6b', 1, 6, 13, 4], ['#7fd8ff', 3, 5, 12, 1], ['#7fd8ff', 3, 10, 12, 1], ['#9adfff', 5, 4, 1, 8], ['#9adfff', 8, 4, 1, 8], ['#9adfff', 11, 4, 1, 8], ['#2d3036', 2, 10, 2, 4]],
  overcharge: [['#3d4a3a', 1, 4, 10, 8], ['#2d3036', 10, 3, 4, 10], ['#7dffb0', 14, 5, 2, 6], ['#7dffb0', 2, 3, 8, 1], ['#7dffb0', 2, 12, 8, 1]],
  grapple: [['#55595f', 2, 7, 8, 3], ['#bfc5cc', 10, 4, 2, 9], ['#bfc5cc', 12, 3, 3, 2], ['#bfc5cc', 12, 11, 3, 2], ['#b8863b', 4, 10, 3, 3]],
  fence: [['#b88a52', 2, 2, 3, 13], ['#b88a52', 11, 2, 3, 13], ['#a07440', 0, 5, 16, 2], ['#a07440', 0, 10, 16, 2]],
  trapdoor: [['#684828', 1, 3, 14, 10], ['#b88a52', 2, 4, 12, 8], ['#46484e', 2, 5, 8, 1], ['#46484e', 2, 10, 8, 1], ['#46484e', 11, 7, 2, 2]],
  ladder: [['#785630', 3, 0, 2, 16], ['#785630', 11, 0, 2, 16], ['#a87c4c', 5, 2, 6, 2], ['#a87c4c', 5, 7, 6, 2], ['#a87c4c', 5, 12, 6, 2]],
  bed: [['#684828', 0, 10, 16, 3], ['#684828', 0, 13, 2, 3], ['#684828', 14, 13, 2, 3], ['#c44652', 4, 6, 12, 4], ['#e8c478', 8, 6, 4, 4], ['#f4f4fa', 0, 7, 4, 3]],
  lavalamp: [['#8a8f99', 4, 12, 8, 3], ['#8a8f99', 6, 1, 4, 2], ['#ff5ab4', 5, 3, 6, 9], ['#ffb03a', 7, 4, 2, 2], ['#ffb03a', 6, 8, 3, 3], ['#ffb03a', 8, 11, 2, 1]],
  door: [['#785630', 3, 0, 10, 16], ['#b88a52', 4, 1, 8, 14], ['#a8d2e6', 5, 2, 6, 4], ['#3c3c42', 10, 9, 1, 2]],
  stairsPlanks: [['#b88a52', 1, 9, 14, 6], ['#b88a52', 8, 2, 7, 7], ['#785630', 1, 9, 7, 1], ['#785630', 8, 2, 7, 1]],
  stairsStone: [['#8d8d8d', 1, 9, 14, 6], ['#8d8d8d', 8, 2, 7, 7], ['#5f5f5f', 1, 9, 7, 1], ['#5f5f5f', 8, 2, 7, 1]],
  slabPlanks: [['#b88a52', 1, 8, 14, 7], ['#785630', 1, 8, 14, 1]],
  slabStone: [['#8d8d8d', 1, 8, 14, 7], ['#5f5f5f', 1, 8, 14, 1]],
  ammo: [['#556b2f', 1, 4, 14, 9], ['#d9b84a', 1, 6, 14, 2], ['#f2f2f2', 6, 9, 4, 3]],
  surge: [['#9b4dff', 3, 3, 10, 10], ['#f2d9ff', 7, 1, 2, 14], ['#f2d9ff', 1, 7, 14, 2]],
  phone: [['#16181d', 4, 1, 8, 14], ['#ff6ad5', 5, 3, 6, 9], ['#5fd4ff', 7, 5, 3, 4], ['#ffd257', 5, 9, 3, 2], ['#3a3e46', 7, 13, 2, 1]],
  flashlight: [['#2b2e34', 6, 5, 4, 10], ['#4a4f58', 6, 11, 4, 1], ['#3a3e46', 5, 2, 6, 3], ['#fff3c4', 6, 1, 4, 1],
    ['#ffe58a', 4, 0, 1, 1], ['#ffe58a', 11, 0, 1, 1], ['#d94a3a', 9, 7, 1, 1]],
  staff: [['#5a4030', 2, 13, 2, 2], ['#5a4030', 4, 11, 2, 2], ['#5a4030', 6, 9, 2, 2], ['#3b2a1e', 8, 7, 2, 2], ['#5a4030', 9, 3, 1, 4],
    ['#5a4030', 13, 3, 1, 4], ['#9b4dff', 10, 2, 3, 4], ['#e6ccff', 11, 3, 1, 2], ['#c9a2ff', 9, 1, 1, 1], ['#c9a2ff', 13, 1, 1, 1]],
  wand: [['#3b2a1e', 3, 11, 2, 2], ['#4a3424', 5, 9, 2, 2], ['#5a4030', 7, 7, 2, 2], ['#d9a93a', 8, 6, 2, 1],
    ['#ff6a1a', 9, 3, 4, 4], ['#ffe27a', 10, 4, 2, 2], ['#ffb347', 13, 2, 1, 1], ['#ffb347', 8, 2, 1, 1], ['#ffb347', 13, 7, 1, 1]],
  empty: [['#d9a77c', 4, 6, 8, 7], ['#c48f66', 4, 12, 8, 2], ['#d9a77c', 3, 4, 2, 4], ['#d9a77c', 5, 3, 2, 4],
    ['#d9a77c', 7, 3, 2, 4], ['#d9a77c', 9, 4, 2, 4], ['#d9a77c', 11, 8, 2, 3], ['#b37d58', 5, 7, 6, 1]],
  // Fantasy Town wares
  dagger: [['#4a3020', 7, 11, 2, 4], ['#d9a93a', 5, 10, 6, 1], ['#d4dae2', 7, 4, 2, 6], ['#f0f4f8', 7, 4, 1, 5], ['#d4dae2', 7, 3, 1, 1]],
  longsword: [['#4a3020', 7, 13, 2, 3], ['#8a6a3a', 7, 15, 2, 1], ['#d9a93a', 3, 12, 10, 1], ['#d4dae2', 7, 0, 2, 12], ['#f0f4f8', 7, 0, 1, 11]],
  greatsword: [['#3a2416', 7, 13, 2, 3], ['#b03030', 6, 12, 4, 1], ['#9aa2ac', 2, 11, 12, 1], ['#c8ced6', 6, 0, 4, 11], ['#eef2f6', 7, 0, 1, 10]],
  leather: [['#7a4a24', 3, 2, 10, 12], ['#9a6232', 4, 3, 8, 10], ['#7a4a24', 1, 2, 3, 4], ['#7a4a24', 12, 2, 3, 4], ['#d9a93a', 7, 9, 2, 2], ['#5a3418', 4, 8, 8, 1]],
  chainmail: [['#6f747c', 3, 2, 10, 12], ['#a8aeb6', 4, 3, 8, 10], ['#6f747c', 1, 2, 3, 4], ['#6f747c', 12, 2, 3, 4], ['#6f747c', 5, 5, 1, 1], ['#6f747c', 8, 5, 1, 1], ['#6f747c', 6, 8, 1, 1], ['#6f747c', 9, 8, 1, 1], ['#6f747c', 5, 11, 1, 1], ['#6f747c', 9, 11, 1, 1]],
  platearmor: [['#8a919a', 3, 2, 10, 12], ['#d0d6de', 4, 3, 8, 10], ['#8a919a', 1, 1, 4, 5], ['#8a919a', 11, 1, 4, 5], ['#eef2f6', 6, 4, 2, 6], ['#d9a93a', 4, 12, 8, 1]],
  shortbow: [['#8a5a2a', 4, 2, 2, 2], ['#8a5a2a', 3, 4, 2, 8], ['#8a5a2a', 4, 12, 2, 2], ['#ece8dc', 6, 3, 1, 10], ['#b0b4ba', 6, 7, 8, 1], ['#d94a3a', 13, 6, 2, 3]],
  longbow: [['#6a4420', 5, 0, 2, 2], ['#6a4420', 4, 2, 2, 12], ['#6a4420', 5, 14, 2, 2], ['#ece8dc', 7, 1, 1, 14], ['#b0b4ba', 7, 7, 8, 1], ['#3fae5a', 13, 6, 2, 3]],
  crossbow: [['#5a3a1e', 6, 4, 3, 11], ['#55595f', 1, 4, 14, 2], ['#ece8dc', 2, 6, 12, 1], ['#b0b4ba', 7, 1, 1, 6], ['#2d3036', 6, 11, 3, 2]],
  runewand: [['#2a2a3a', 3, 11, 2, 2], ['#3a3a52', 5, 9, 2, 2], ['#4a4a6a', 7, 7, 2, 2], ['#7dd8ff', 8, 6, 2, 1],
    ['#3aa0ff', 9, 3, 4, 4], ['#c8f0ff', 10, 4, 2, 2], ['#7dd8ff', 13, 2, 1, 1], ['#7dd8ff', 8, 2, 1, 1], ['#7dd8ff', 13, 7, 1, 1]],
  archstaff: [['#e8e0c8', 2, 13, 2, 2], ['#e8e0c8', 4, 11, 2, 2], ['#e8e0c8', 6, 9, 2, 2], ['#d9a93a', 8, 7, 2, 2], ['#d9a93a', 9, 2, 1, 5],
    ['#d9a93a', 13, 2, 1, 5], ['#ffd257', 10, 1, 3, 5], ['#fff6c8', 11, 2, 1, 3]],
  scroll: [['#c8b07a', 2, 3, 12, 2], ['#f2e6c4', 3, 5, 10, 7], ['#c8b07a', 2, 12, 12, 2], ['#8a6a3a', 5, 7, 6, 1], ['#8a6a3a', 5, 9, 4, 1], ['#b03030', 10, 9, 2, 2]],
  potion: [['#d9e6ee', 7, 1, 2, 2], ['#8a6a3a', 7, 1, 2, 1], ['#d9e6ee', 4, 4, 8, 10], ['#d8303c', 5, 7, 6, 6], ['#ff8a96', 6, 8, 1, 2]],
  bigpotion: [['#d9e6ee', 7, 0, 2, 2], ['#8a6a3a', 7, 0, 2, 1], ['#d9e6ee', 3, 3, 10, 12], ['#b01828', 4, 5, 8, 9], ['#ff8a96', 5, 6, 1, 3], ['#ffd257', 6, 9, 4, 1]],
  antidote: [['#d9e6ee', 7, 1, 2, 2], ['#8a6a3a', 7, 1, 2, 1], ['#d9e6ee', 5, 3, 6, 11], ['#4ad46a', 6, 6, 4, 7], ['#c8ffd0', 7, 7, 1, 2]],
  manapotion: [['#d9e6ee', 7, 1, 2, 2], ['#8a6a3a', 7, 1, 2, 1], ['#d9e6ee', 4, 4, 8, 10], ['#3a6aff', 5, 7, 6, 6], ['#a8c8ff', 6, 8, 1, 2]],
  stew: [['#5f8fc0', 2, 7, 12, 2], ['#8fbfe8', 3, 9, 10, 3], ['#6f9fd0', 5, 12, 6, 2], ['#8a4a20', 3, 6, 10, 2], ['#e08a3a', 5, 6, 2, 1], ['#4a8a3a', 9, 6, 2, 1]],
  pie: [['#9a6328', 1, 8, 14, 5], ['#e0a85a', 2, 6, 12, 3], ['#c8873e', 3, 5, 10, 1], ['#9a6328', 5, 6, 1, 2], ['#9a6328', 10, 6, 1, 2]],
  honeycake: [['#e8c478', 2, 6, 12, 7], ['#f2d9a0', 2, 5, 12, 2], ['#ffb800', 3, 4, 10, 2], ['#ffb800', 5, 6, 1, 2], ['#ffb800', 10, 6, 1, 3]],
  ale: [['#d9a93a', 3, 5, 8, 9], ['#f6f0dc', 3, 3, 8, 3], ['#8a6a3a', 11, 6, 3, 5], ['#8a6a3a', 3, 13, 8, 1]],
  mead: [['#e8b030', 3, 5, 8, 9], ['#f6e8b0', 3, 3, 8, 3], ['#6a4a2a', 11, 6, 3, 5], ['#6a4a2a', 3, 13, 8, 1]],
  cider: [['#c8d84a', 3, 5, 8, 9], ['#f0f6d0', 3, 3, 8, 3], ['#8a6a3a', 11, 6, 3, 5], ['#8a6a3a', 3, 13, 8, 1]],
  // Gardening
  tiller: [['#8a6a44', 7, 1, 2, 10], ['#55595f', 3, 11, 10, 2], ['#bfc5cc', 3, 13, 2, 3], ['#bfc5cc', 7, 13, 2, 3], ['#bfc5cc', 11, 13, 2, 3], ['#2d3036', 5, 1, 6, 2]],
  sprayer: [['#3fae5a', 3, 5, 9, 9], ['#6fd88a', 4, 6, 3, 7], ['#2d3036', 6, 2, 3, 3], ['#55595f', 12, 7, 3, 1], ['#7fc4ff', 14, 6, 2, 1], ['#7fc4ff', 14, 8, 2, 1]],
  weedtorch: [['#c43c2c', 2, 6, 5, 9], ['#e8643c', 3, 7, 2, 7], ['#55595f', 6, 8, 7, 2], ['#2d3036', 3, 4, 3, 2], ['#ff8a1a', 13, 7, 2, 4], ['#ffe27a', 14, 8, 2, 2]],
  garlic: [['#ece6d2', 4, 6, 8, 8], ['#fffaf0', 5, 7, 3, 5], ['#c8b896', 7, 6, 1, 8], ['#96b46a', 7, 1, 2, 5]],
  thyme: [['#607a54', 7, 2, 1, 13], ['#7a9a6a', 5, 3, 2, 2], ['#7a9a6a', 9, 5, 2, 2], ['#7a9a6a', 5, 8, 2, 2], ['#7a9a6a', 9, 10, 2, 2], ['#aa78c8', 6, 1, 3, 2]],
  okra: [['#78b446', 6, 3, 4, 11], ['#96d064', 7, 4, 1, 9], ['#4a7a2a', 6, 1, 4, 2]],
  artichoke: [['#6e8c5a', 4, 5, 8, 9], ['#8ca870', 5, 6, 2, 3], ['#8ca870', 9, 8, 2, 3], ['#8c5a8c', 6, 3, 4, 3], ['#5a6e46', 7, 13, 2, 2]],
  cabbage: [['#78b45a', 2, 4, 12, 10], ['#b0d696', 4, 5, 8, 8], ['#d8ecc8', 6, 7, 4, 4]],
  carrot: [['#ec8228', 6, 5, 4, 7], ['#ec8228', 7, 12, 2, 3], ['#c86418', 7, 6, 1, 6], ['#50a03c', 5, 1, 2, 4], ['#50a03c', 9, 1, 2, 4], ['#50a03c', 7, 2, 2, 3]],
  onion: [['#aa465a', 4, 5, 8, 9], ['#c8647a', 5, 6, 3, 6], ['#64a078', 7, 1, 2, 4], ['#e6d6b0', 7, 14, 2, 1]],
  potato: [['#b48c5a', 3, 5, 10, 8], ['#c8a06e', 4, 6, 6, 5], ['#7a5a36', 6, 7, 1, 1], ['#7a5a36', 10, 9, 1, 1], ['#7a5a36', 5, 10, 1, 1]],
  pinto: [['#d6ba8c', 2, 7, 4, 3], ['#d6ba8c', 7, 5, 4, 3], ['#d6ba8c', 10, 9, 4, 3], ['#965a3c', 3, 8, 1, 1], ['#965a3c', 8, 6, 1, 1], ['#965a3c', 12, 10, 1, 1]],
  pea: [['#82c85a', 2, 6, 12, 5], ['#a8e07a', 3, 7, 10, 3], ['#5a9a3c', 4, 8, 2, 2], ['#5a9a3c', 8, 8, 2, 2], ['#5a9a3c', 12, 8, 1, 2]],
  soy: [['#b0aa64', 3, 4, 3, 9], ['#b0aa64', 7, 3, 3, 10], ['#b0aa64', 11, 5, 3, 8], ['#8a8448', 4, 6, 1, 1], ['#8a8448', 8, 6, 1, 1], ['#8a8448', 12, 8, 1, 1]],
  // Cooking (cooking.js)
  wheat: [['#d9b45a', 5, 4, 2, 11], ['#d9b45a', 9, 4, 2, 11], ['#e8c870', 4, 1, 4, 5], ['#e8c870', 8, 1, 4, 5], ['#8a6a3a', 4, 10, 8, 2]],
  yeast: [['#e8d8a0', 3, 5, 10, 7], ['#c84a3a', 3, 5, 10, 2], ['#a88a5a', 5, 9, 6, 1]],
  butter: [['#f8f4ec', 2, 9, 12, 3], ['#f4e08a', 3, 5, 10, 5], ['#fff0a0', 4, 6, 4, 1]],
  cornmeal: [['#d8b878', 3, 4, 10, 11], ['#b89858', 4, 2, 8, 3], ['#f0c040', 6, 8, 4, 3]],
  water: [['#9aa0a8', 3, 6, 10, 8], ['#4a8ad8', 4, 6, 8, 2], ['#55595f', 2, 2, 1, 5], ['#55595f', 13, 2, 1, 5], ['#55595f', 2, 2, 12, 1]],
  oliveoil: [['#9aaa3a', 5, 6, 6, 9], ['#9aaa3a', 7, 3, 2, 3], ['#3a2a1a', 7, 1, 2, 2], ['#c8d860', 6, 8, 2, 4]],
  chives: [['#46963c', 5, 4, 1, 11], ['#46963c', 8, 3, 1, 12], ['#46963c', 11, 5, 1, 10], ['#be82d2', 4, 2, 3, 3], ['#be82d2', 7, 1, 3, 3]],
  corn: [['#f0ce46', 6, 2, 5, 11], ['#d8b030', 7, 3, 1, 9], ['#78a046', 3, 6, 3, 8], ['#78a046', 11, 7, 2, 7]],
  jalapeno: [['#347828', 6, 4, 4, 10], ['#4a9a3a', 7, 5, 1, 7], ['#5a8a3a', 7, 1, 2, 3]],
  garbanzo: [['#dec482', 2, 7, 4, 4], ['#dec482', 7, 5, 4, 4], ['#dec482', 10, 9, 4, 4], ['#b89a5a', 3, 8, 1, 1], ['#b89a5a', 8, 6, 1, 1]],
  olive: [['#46581e', 3, 6, 4, 5], ['#3a2848', 8, 4, 4, 5], ['#46581e', 9, 10, 4, 5], ['#6a7a3a', 4, 7, 1, 1]],
  bakedpotato: [['#f4f4f0', 1, 10, 14, 3], ['#b48c5a', 3, 5, 10, 6], ['#f4e08a', 6, 4, 4, 2], ['#46963c', 9, 4, 2, 1]],
  chips: [['#e8b850', 2, 8, 5, 5], ['#d8a840', 6, 5, 5, 5], ['#e8b850', 9, 9, 5, 5]],
  povertynachos: [['#f4f4f0', 1, 11, 14, 3], ['#e8b850', 2, 6, 12, 5], ['#f0a020', 3, 5, 10, 3]],
  timsnachos: [['#f4f4f0', 1, 11, 14, 3], ['#e8b850', 2, 6, 12, 5], ['#f0a020', 3, 5, 10, 3], ['#347828', 5, 4, 2, 2], ['#965a3c', 9, 4, 2, 2]],
  hummus: [['#5f8fc0', 2, 7, 12, 2], ['#8fbfe8', 3, 9, 10, 3], ['#e0c890', 3, 6, 10, 2], ['#9aaa3a', 7, 5, 2, 2]],
  // Crafting (crafting.js)
  stick: [['#8a6a44', 3, 12, 2, 2], ['#8a6a44', 5, 10, 2, 2], ['#8a6a44', 7, 8, 2, 2], ['#8a6a44', 9, 6, 2, 2], ['#8a6a44', 11, 4, 2, 2], ['#6a4a2a', 8, 3, 1, 3]],
  fiber: [['#7aa050', 5, 2, 1, 12], ['#8ab060', 8, 3, 1, 11], ['#6a9040', 11, 2, 1, 12], ['#c8b078', 4, 9, 9, 1]],
  cord: [['#c8b078', 3, 5, 10, 6], ['#a89058', 5, 7, 6, 2], ['#c8b078', 12, 9, 3, 1]],
  axehead: [['#8a8e94', 3, 4, 10, 8], ['#a8acb2', 4, 5, 4, 2], ['#6a6e74', 3, 11, 10, 1]],
  pickhead: [['#8a8e94', 1, 6, 14, 3], ['#a8acb2', 2, 6, 6, 1], ['#8a8e94', 1, 8, 2, 3], ['#8a8e94', 13, 8, 2, 3]],
  shovelhead: [['#8a8e94', 4, 3, 8, 10], ['#a8acb2', 5, 4, 3, 4], ['#6a6e74', 4, 12, 8, 1]],
  blade: [['#8a8e94', 7, 1, 3, 13], ['#a8acb2', 7, 2, 1, 10]],
  // Found while mining and digging (forage.js)
  coal: [['#26262a', 3, 5, 10, 8], ['#3a3a40', 5, 4, 6, 2], ['#4a4a52', 5, 6, 2, 2], ['#4a4a52', 9, 9, 2, 1]],
  ironore: [['#8d8d8d', 2, 4, 12, 9], ['#a0a0a0', 3, 5, 4, 2], ['#c89a78', 4, 8, 2, 2], ['#c89a78', 9, 5, 2, 2], ['#b07a58', 10, 10, 2, 2]],
  copperore: [['#8d8d8d', 2, 4, 12, 9], ['#a0a0a0', 3, 5, 4, 2], ['#d8743a', 4, 8, 2, 2], ['#d8743a', 9, 5, 2, 2], ['#3aa88a', 10, 10, 2, 2]],
  silverore: [['#8d8d8d', 2, 4, 12, 9], ['#a0a0a0', 3, 5, 4, 2], ['#e8eef4', 4, 8, 2, 2], ['#e8eef4', 9, 5, 2, 2], ['#c8d0d8', 10, 10, 2, 2]],
  sulfur: [['#d8c42a', 3, 6, 10, 7], ['#f4e46a', 5, 5, 5, 3], ['#b8a41a', 4, 11, 8, 2]],
  yarrow: [['#5a8a3a', 7, 6, 2, 9], ['#5a8a3a', 4, 9, 3, 1], ['#f0ece0', 3, 2, 10, 4], ['#fffcf0', 5, 1, 6, 2]],
  mint: [['#3a7a3a', 7, 3, 2, 12], ['#5ab45a', 3, 9, 4, 3], ['#5ab45a', 9, 6, 4, 3], ['#6ac46a', 5, 2, 6, 3]],
  mushroom: [['#ece6d2', 6, 8, 4, 7], ['#8a5a34', 2, 4, 12, 4], ['#a06a3e', 4, 3, 8, 2], ['#ece6d2', 5, 5, 2, 1], ['#ece6d2', 10, 6, 1, 1]],
  glowcap: [['#d8f0f0', 6, 8, 4, 7], ['#3ae0d0', 2, 4, 12, 4], ['#a8fff4', 4, 3, 8, 2], ['#ffffff', 5, 5, 2, 1], ['#ffffff', 10, 6, 1, 1]],
  feather: [['#c8c4b8', 2, 13, 1, 2], ['#c8c4b8', 3, 12, 1, 1], ['#f0ece0', 4, 6, 4, 6], ['#e8e4d8', 6, 3, 5, 5], ['#f0ece0', 9, 1, 4, 4], ['#c8c4b8', 4, 11, 1, 1], ['#a8a498', 7, 5, 4, 1]],
  stoneaxe: [['#8a6a44', 7, 5, 2, 10], ['#8a8e94', 3, 2, 7, 5], ['#c8b078', 7, 6, 2, 1]],
  stonepick: [['#8a6a44', 7, 4, 2, 11], ['#8a8e94', 2, 2, 12, 2], ['#8a8e94', 2, 4, 2, 2], ['#8a8e94', 12, 4, 2, 2], ['#c8b078', 7, 4, 2, 1]],
  stoneshovel: [['#8a6a44', 7, 1, 2, 9], ['#8a8e94', 5, 9, 6, 6], ['#c8b078', 7, 8, 2, 1]],
  stoneknife: [['#8a6a44', 7, 10, 2, 5], ['#8a8e94', 7, 1, 2, 9], ['#c8b078', 7, 9, 2, 1]],
  stonespear: [['#8a6a44', 2, 12, 2, 2], ['#8a6a44', 4, 10, 2, 2], ['#8a6a44', 6, 8, 2, 2], ['#8a6a44', 8, 6, 2, 2], ['#8a8e94', 10, 2, 3, 4], ['#c8b078', 9, 6, 2, 1]],
  bucket: [['#9aa0a8', 3, 6, 10, 8], ['#b8bec6', 4, 7, 3, 6], ['#4a5058', 3, 6, 10, 1], ['#55595f', 2, 2, 1, 5], ['#55595f', 13, 2, 1, 5], ['#55595f', 2, 2, 12, 1], ['#7a8088', 4, 13, 8, 1]],
  rod: [['#8a6a44', 2, 13, 2, 2], ['#8a6a44', 4, 11, 2, 2], ['#8a6a44', 6, 9, 2, 2], ['#8a6a44', 8, 7, 2, 2], ['#3a2a1a', 10, 5, 2, 2], ['#3a2a1a', 12, 3, 2, 2],
    ['#55595f', 4, 13, 3, 2], ['#e8e8e8', 14, 3, 1, 9], ['#d94a3a', 13, 12, 3, 2]],
  minnow: [['#9aa8b0', 4, 7, 7, 3], ['#7a8890', 11, 6, 2, 5], ['#222', 5, 8, 1, 1]],
  trout: [['#8a9a6a', 2, 6, 10, 4], ['#d88a8a', 3, 8, 8, 1], ['#6a7a4a', 12, 5, 2, 6], ['#222', 3, 7, 1, 1]],
  salmon: [['#c87a6a', 1, 6, 11, 5], ['#9aa0a8', 2, 6, 9, 1], ['#a85a4a', 12, 5, 3, 7], ['#222', 2, 8, 1, 1]],
  catfish: [['#5a5a4a', 2, 6, 10, 4], ['#3a3a2a', 0, 9, 3, 1], ['#3a3a2a', 0, 6, 3, 1], ['#4a4a3a', 12, 5, 2, 6], ['#ddd', 3, 7, 1, 1]],
  perch: [['#a8a84a', 3, 5, 8, 6], ['#4a5a2a', 5, 5, 1, 6], ['#4a5a2a', 8, 5, 1, 6], ['#d86a3a', 11, 5, 2, 6], ['#d86a3a', 6, 11, 2, 1], ['#222', 4, 7, 1, 1]],
  koi: [['#f4b728', 2, 6, 10, 4], ['#f4f0e0', 5, 6, 3, 2], ['#e8901a', 12, 4, 3, 8], ['#222', 3, 7, 1, 1]],
  arrows: [['#8a6a44', 2, 12, 12, 1], ['#8a6a44', 2, 8, 12, 1], ['#8a6a44', 2, 4, 12, 1], ['#b0b4ba', 13, 3, 2, 3], ['#b0b4ba', 13, 7, 2, 3], ['#b0b4ba', 13, 11, 2, 3], ['#d94a3a', 1, 3, 2, 3], ['#d94a3a', 1, 7, 2, 3], ['#d94a3a', 1, 11, 2, 3]],
  zcash: [['#b07a12', 4, 1, 8, 14], ['#b07a12', 1, 4, 14, 8], ['#f4b728', 5, 2, 6, 12], ['#f4b728', 2, 5, 12, 6],
    ['#7a4e08', 5, 4, 6, 2], ['#7a4e08', 5, 10, 6, 2], ['#7a4e08', 8, 6, 2, 1], ['#7a4e08', 7, 7, 2, 1], ['#7a4e08', 6, 8, 2, 2]],
};
function pixelIcon(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  for (const [col, x, y, w, h] of ICONS[kind]) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
  return c;
}
/** Icon for any item kind: blocks are drawn as little cubes, everything else as pixel art. */
const BLOCK_ICONS = { [LAVA_LAMP]: 'lavalamp', [DOOR]: 'door', [STAIRS_PLANKS]: 'stairsPlanks', [STAIRS_STONE]: 'stairsStone',
  [SLAB_PLANKS]: 'slabPlanks', [SLAB_STONE]: 'slabStone', [BED]: 'bed', [FENCE]: 'fence', [TRAPDOOR]: 'trapdoor', [LADDER]: 'ladder' };
/** A seed packet for a crop: paper with the vegetable on it. */
function seedIcon(crop) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8dcb8'; ctx.fillRect(2, 1, 12, 14);
  ctx.fillStyle = '#b89a62'; ctx.fillRect(2, 1, 12, 2);
  ctx.save(); ctx.translate(3, 4); ctx.scale(0.62, 0.62);
  for (const [col, x, y, w, h] of ICONS[CROPS[crop]] || []) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
  ctx.restore();
  return c;
}
// Pottery icons: the piece's outline in its clay colour, with its glaze pattern. Unfired pieces look duller:
// thrown pots dark and wet, trimmed ones dry, glazed ones with a chalky, pale glaze (it only turns glossy in the kiln).
const POT_ICON_SHAPES = [ // [x, y, w, h] rows of each object on a 16×16 grid
  [[4, 5, 7, 9], [11, 7, 2, 1], [12, 8, 1, 3], [11, 11, 2, 1], [3, 4, 9, 1]], // mug
  [[5, 1, 6, 2], [6, 3, 4, 3], [4, 6, 8, 2], [3, 8, 10, 4], [4, 12, 8, 2], [5, 14, 6, 1]], // vase
  [[1, 9, 14, 2], [3, 11, 10, 1], [5, 12, 6, 1]], // plate
  [[1, 6, 14, 2], [2, 8, 12, 2], [3, 10, 10, 2], [5, 12, 6, 2]], // bowl
  [[6, 2, 4, 2], [4, 4, 8, 10], [3, 14, 10, 1]], // luminary
];
const POT_CLAY_COL = [[240, 234, 222], [160, 106, 66], [196, 98, 64]];
const POT_GLAZE_COL = [null, '#2c54c4', '#38a870', '#ec9c28'];
function potteryIcon(obj, clay, glaze = 0, { lit = false, raw = false, wet = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const [r, g, b] = POT_CLAY_COL[clay].map((v) => (wet ? v * 0.68 : raw ? v * 0.85 : v));
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  for (const [x, y, w, h] of POT_ICON_SHAPES[obj]) ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'source-atop'; // patterns and shading only on the piece
  ctx.globalAlpha = raw ? 0.5 : 1; // (unfired glaze: chalky)
  if (glaze === 1) { ctx.fillStyle = POT_GLAZE_COL[1]; for (let y = 1; y < 16; y += 4) ctx.fillRect(0, y, 16, 2); }
  if (glaze === 2) { ctx.fillStyle = POT_GLAZE_COL[2]; for (let i = 0; i < 40; i++) ctx.fillRect((i * 7) % 16, (i * 11) % 16, 1, 1); }
  if (glaze === 3) { ctx.fillStyle = POT_GLAZE_COL[3]; for (let x = 0; x < 16; x++) for (const y0 of [3, 10]) ctx.fillRect(x, y0 + Math.abs((x % 6) - 3), 1, 1); }
  ctx.globalAlpha = 1;
  if (obj === 4 && lit) { ctx.fillStyle = '#ffd27a'; for (const [x, y] of [[6, 7], [9, 7], [7, 10], [8, 10], [6, 12], [9, 12]]) ctx.fillRect(x, y, 1, 1); }
  else if (obj === 4) { ctx.fillStyle = 'rgba(40,24,16,0.8)'; for (const [x, y] of [[6, 7], [9, 7], [7, 10], [8, 10], [6, 12], [9, 12]]) ctx.fillRect(x, y, 1, 1); }
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(11, 0, 5, 16); // shade on the right
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, 5, 16); // light on the left
  return c;
}
function iconFor(kind) {
  if (scrollOf(kind)) return pixelIcon('scroll');
  if (FOOD[kind]?.cookedFrom && ICONS[FOOD[kind].cookedFrom] && !ICONS[kind]) { // cooked: the raw food, browned
    const c = pixelIcon(FOOD[kind].cookedFrom);
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(110, 60, 20, 0.45)';
    ctx.fillRect(0, 0, 16, 16);
    return c;
  }
  if (unfiredInfo(kind)) { const u = unfiredInfo(kind); return potteryIcon(u.obj, u.clay, u.glaze, { raw: true, wet: u.stage === 'thrown' }); }
  if (blockIdOf(kind) !== null && isPottery(blockIdOf(kind))) { const p = potteryInfo(blockIdOf(kind)); return potteryIcon(p.obj, p.clay, p.glaze, { lit: p.lit }); }
  if (blockIdOf(kind) !== null && isCrop(blockIdOf(kind))) return seedIcon(cropInfo(blockIdOf(kind)).crop);
  if (kind === 'ammo:arrows') return pixelIcon('arrows');
  const id = blockIdOf(kind);
  if (id !== null && BLOCK_ICONS[id]) return pixelIcon(BLOCK_ICONS[id]);
  return id !== null ? drawBlockIcon(atlasCanvas, id) : pixelIcon(ICONS[kind] ? kind : 'empty');
}
const walletEl = document.getElementById('wallet');
walletEl.prepend(pixelIcon('zcash'));
const walletCount = document.getElementById('wallet-count');
const walletUsd = document.getElementById('wallet-usd');
const traitsEl = document.getElementById('traits');
const headacheEl = document.getElementById('headache');
let throbT = 0;
function updateTraitsAndEffects(dt) {
  traitsEl.hidden = true; // (traits are on the character sheet, I)
  const aching = player.effects.headache > 0 && !player.dead;
  headacheEl.hidden = !aching;
  // Blind (the spell): the world blurs over (the HUD stays readable); it clears over the last couple of seconds.
  const blind = player.dead ? 0 : player.effects.blind || 0;
  const blur = blind > 0 ? `blur(${(settings.blindBlur * Math.min(1, blind / 2)).toFixed(1)}px)` : '';
  if (canvas.style.filter !== blur) canvas.style.filter = blur;
  if (aching && (throbT -= dt) <= 0) {
    throbT = 1.1; // in time with the CSS throb
    sound.play('throb');
  }
}
const xpFill = document.getElementById('xp-fill');
const levelEl = document.getElementById('level');
const healthEl = document.getElementById('health');
const washBar = document.getElementById('washbar');
const washFill = document.getElementById('washbar-fill');
const chatEl = document.getElementById('chat');

/** Floating text that rises and fades, e.g. "ACHOO!" or "+3 XP". */
/**
 * A notification: a line in the message log in the bottom right (it keeps the last 100). `kind` colours it
 * (heal, xp, deny, text...). The same line again straight after just counts up (×2, ×3...).
 */
function popup(text, kind = '') {
  const last = chatEl.lastElementChild;
  const stick = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 24; // (don't yank the view if you've scrolled up to read)
  if (last && last.dataset.text === text) {
    last.dataset.n = String(Number(last.dataset.n || 1) + 1);
    last.querySelector('.chat-count').textContent = ` ×${last.dataset.n}`;
  } else {
    const line = document.createElement('div');
    line.className = `chat-line ${kind}`;
    line.dataset.text = text;
    line.append(text, Object.assign(document.createElement('span'), { className: 'chat-count' }));
    chatEl.append(line);
    while (chatEl.childElementCount > 100) chatEl.firstElementChild.remove();
  }
  chatEl.hidden = false;
  chatEl.classList.remove('quiet');
  clearTimeout(popup.quietT);
  popup.quietT = setTimeout(() => chatEl.classList.add('quiet'), 8000); // fades back when nothing new has come in for a while
  if (stick) chatEl.scrollTop = chatEl.scrollHeight;
}

// ---------- phone ----------
const phoneEl = document.getElementById('phone');
const phoneCanvas = document.getElementById('phone-screen');
const phoneCtx = phoneCanvas.getContext('2d');
const phoneImg = phoneCtx.createImageData(phoneCanvas.width, phoneCanvas.height);
const phoneClock = document.getElementById('phone-clock');
let phoneOut = false;

function hsl(h, s, l, out, i) {
  // h in [0,1)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  out[i] = ch(h + 1 / 3) * 255;
  out[i + 1] = ch(h) * 255;
  out[i + 2] = ch(h - 1 / 3) * 255;
  out[i + 3] = 255;
}

/** Swirling colours: hue follows a spiral that twists over time. */
function drawPhone(t) {
  const { width: w, height: h } = phoneCanvas;
  const d = phoneImg.data;
  const cx = Math.sin(t * 0.4) * 0.25;
  const cy = Math.cos(t * 0.3) * 0.35;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x / w - 0.5) * 2 - cx;
      const v = ((y / h - 0.5) * 2 * h) / w - cy;
      const r = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      const swirl = a / (Math.PI * 2) + r * 0.9 - t * 0.25 + Math.sin(r * 5 - t * 2) * 0.08;
      const light = 0.5 + 0.12 * Math.sin(r * 9 - t * 3 + a * 2);
      hsl(swirl + t * 0.05, 0.85, light, d, (y * w + x) * 4);
    }
  }
  phoneCtx.putImageData(phoneImg, 0, 0);
}

let showInfo = prefs.info; // the F3 info panel (Settings: Display; hidden unless you turn it on)
let hurtFlash = 0;
let shake = 0;
const bowDraw = { left: 0, right: 0 }; // how far you've drawn a bow in each hand (0-1): hold the button, let go to shoot

// ---------- what other things in the world look like right now (from the game's snapshots) ----------
const remote = {
  mobs: new Map(), arrows: new Map(), drops: new Map(), fireballs: new Map(), sacks: new Map(), players: new Map(), messes: new Map(), drones: new Map(), storms: new Map(), backpacks: new Map(),
  npcs: new Map(), // the Fantasy Town's people (npcs.js)
};

function syncMap(map, list, create, update, removed) {
  const seen = new Set();
  for (const d of list) {
    seen.add(d.id);
    let o = map.get(d.id);
    if (!o) map.set(d.id, (o = create(d)));
    update(o, d);
  }
  for (const [id, o] of map) {
    if (seen.has(id)) continue;
    map.delete(id);
    removed?.(o);
  }
}
const at = (d) => ({ x: d.x, y: d.y, z: d.z });

let firstSnap = true; // don't play a sound for everything that already exists when you join
const soundsOn = () => !firstSnap;
const nearMe = (p, r) => Math.hypot(p.x - camera.position.x, p.y - camera.position.y, p.z - camera.position.z) < r;

function applySnap(s) {
  bobbers = s.players.filter((p) => p.bobber).map((p) => ({ id: p.id, ...p.bobber }));
  time = s.time;
  rate = s.rate;
  syncMap(remote.mobs, s.mobs, (d) => {
    const t = MOB_TYPES[d.type];
    const m = new Body(world, t.sized ? 0.25 * d.size : t.halfW, t.sized ? 0.4 * d.size : t.height);
    Object.assign(m, { id: d.id, type: d.type, size: d.size, pos: at(d), walkPhase: 0, walkAmount: 0 });
    return m;
  }, (m, d) => {
    if (soundsOn()) {
      if (d.hurt && !(m.hurtT > 0)) sound.play('mobHurt', { pos: m.pos, p: MOB_VOICE_PITCH[m.type] ?? 1 });
      if (m.type === 'seedoil' && d.vy > 3 && !(m.vel.y > 1)) sound.play('boing', { pos: m.pos, p: 1.6 - 0.2 * m.size });
    }
    Object.assign(m, { target: at(d), yaw: d.yaw, walkAmount: d.walk, hurtT: d.hurt ? 0.3 : 0, burning: d.burning, aiming: d.aiming, poly: d.poly, scale: d.scale ?? 1, chill: d.chill, arrows: d.arrows || 0 });
    m.vel.y = d.vy;
  });
  syncMap(remote.arrows, s.arrows, (d) => {
    if (soundsOn()) sound.play('bow', { pos: at(d) });
    return { id: d.id, pos: at(d), vel: {} };
  }, (a, d) => {
    if (soundsOn() && d.stuck && !a.stuck) sound.play('thunk', { pos: at(d) });
    Object.assign(a, { target: at(d), stuck: d.stuck, vel: { x: d.vx, y: d.vy, z: d.vz } });
  });
  syncMap(remote.drops, s.drops, (d) => ({ id: d.id, kind: d.kind, body: { pos: at(d) }, age: 0 }), (o, d) => { o.target = at(d); o.dir = d.dir || null; });
  syncMap(remote.fireballs, s.fireballs, (d) => {
    if (soundsOn() && !nearMe(d, 2.5) && d.kind === 'fireball') sound.play('fireball', { pos: at(d) }); // your own played when you shot
    const fb = { id: d.id, kind: d.kind, pos: at(d) };
    effects.addFireball(fb);
    return fb;
  }, (fb, d) => { fb.target = at(d); }, (fb) => effects.removeFireball(fb));
  syncMap(remote.messes, s.messes || [], (d) => {
    const m = buildHeldModel('mess', heldMaterial) || new THREE.Group();
    m.position.set(d.x, d.y, d.z);
    m.rotation.y = d.id * 1.7;
    scene.add(m);
    return { id: d.id, pos: at(d), model: m };
  }, () => {}, (o) => scene.remove(o.model));
  // Backpacks dead players dropped (game.js `_dropBackpack`): a bag on the ground; your own has a beam of light
  // over it so you can find it again.
  syncMap(remote.backpacks, s.backpacks || [], (d) => {
    const g = new THREE.Group();
    const bag = buildHeldModel('backpack', heldMaterial);
    if (bag) { bag.rotation.y = d.id * 1.3; g.add(bag); }
    if (d.owner === myId) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 24, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0.35, depthWrite: false }));
      beam.position.y = 12;
      g.add(beam);
    }
    g.position.set(d.x, d.y, d.z);
    scene.add(g);
    return { id: d.id, pos: at(d), model: g };
  }, () => {}, (o) => { scene.remove(o.model); o.model.traverse((c) => { if (c.isMesh && c.material !== heldMaterial) { c.geometry.dispose(); c.material.dispose(); } }); });
  syncMap(remote.storms, s.storms || [], (d) => ({ id: d.id, pos: at(d), r: d.r, gustT: 0 }), (o, d) => { o.pos = at(d); o.r = d.r; });
  syncMap(remote.drones, s.drones || [], (d) => {
    const model = buildDroneModel(droneMaterial);
    model.position.set(d.x, d.y, d.z);
    scene.add(model);
    return { id: d.id, pos: at(d), model };
  }, (o, d) => { o.target = at(d); o.yaw = d.yaw; o.carrying = d.carrying; }, (o) => scene.remove(o.model));
  syncMap(remote.sacks, s.sacks, (d) => {
    if (soundsOn() && !nearMe(d, 2.5)) sound.play('throw', { pos: at(d) });
    return { id: d.id, pos: at(d) };
  }, (o, d) => { o.target = at(d); });
  syncMap(remote.npcs, s.npcs || [], (d) => {
    const body = new Body(world, 0.3, 1.8);
    body.pos = at(d);
    return { id: d.id, body, pos: body.pos, moved: 0 };
  }, (n, d) => { Object.assign(n, { key: d.key, name: d.name, role: d.role, target: at(d), yaw: d.yaw, hands: d.hands, look: d.look, worn: d.worn }); });
  syncMap(remote.players, s.players.filter((p) => p.id !== myId), (d) => {
    const body = new Body(world, 0.3, 1.8);
    body.pos = at(d);
    return { id: d.id, body, pos: body.pos, moved: 0 };
  }, (p, d) => {
    Object.assign(p, {
      name: d.name, target: at(d), yaw: d.yaw, pitch: d.pitch, crouch: d.crouch, phone: d.phone, hands: d.hands, dead: d.dead,
      surge: d.surge, grapple: d.grapple, buildy: d.buildy, flying: d.flying,
      invisible: d.invisible, poly: d.poly, scale: d.scale ?? 1, stone: d.stone, chill: d.chill, voice: d.voice ?? null,
      sw: d.sw, mine: d.mine ?? null, draw: d.draw || 0, worn: d.worn || null, look: d.look || null, tall: d.tall ?? 10,
    });
    p.body.height = (d.crouch ? 1.5 : 1.8) * (d.scale ?? 1);
    p.body.halfW = 0.3 * (d.scale ?? 1);
  });
  firstSnap = false;
}

// Creature voices: how often (seconds, min-max) and how they sound.
const MOB_VOICES = {
  zombie: ['groan', 6, 14], skeleton: ['rattle', 5, 12],
  cow: ['moo', 8, 20], cat: ['meow', 7, 16], dog: ['bark', 6, 14],
  bird: ['tweet', 5, 14], munia: ['tweet', 4, 10], finch: ['tweet', 4, 12], nutmunch: ['tweet', 6, 16], seagull: ['caw', 5, 12],
  penguin: ['honk', 4, 10],
  clerk: ['hum', 5, 11], mildew: ['squelch', 3, 8],
  sahur: ['tung', 3, 7],
  pomodorino: ['brainrot', 4, 9], lavatricio: ['brainrot', 5, 11], ventilone: ['brainrot', 4, 10],
};
const MOB_VOICE_PITCH = { cow: 0.6, cat: 1.6, dog: 1.2, seedoil: 1.3, munia: 1.25, finch: 1.1, nutmunch: 0.7, penguin: 0.9, pomodorino: 1.35, lavatricio: 0.7, ventilone: 1 };
function mobVoices(dt) {
  for (const m of remote.mobs.values()) {
    const v = MOB_VOICES[m.type];
    if (!v) continue;
    m.voiceT ??= v[1] * Math.random() + 1;
    if ((m.voiceT -= dt) > 0) continue;
    m.voiceT = v[1] + Math.random() * (v[2] - v[1]);
    if (nearMe(m.pos, 24)) sound.play(v[0], { pos: m.pos, p: (MOB_VOICE_PITCH[m.type] ?? 1) * (0.93 + Math.random() * 0.14) });
  }
}

/** Other players' footsteps. */
function remoteSteps() {
  for (const p of remote.players.values()) {
    if (p.dead || p.flying) continue;
    p.stepDist = (p.stepDist || 0) + p.moved;
    if (p.stepDist < (p.crouch ? 1.1 : 1.7)) continue;
    p.stepDist = 0;
    sound.play('step', { pos: p.pos, material: materialUnder(p.pos), volume: p.crouch ? 0.4 : 1 });
  }
}

/** Ease everything towards its latest reported position (positions arrive ~15 times a second). */
function smoothRemote(dt) {
  const k = multiplayer ? 1 - Math.exp(-dt * 15) : 1;
  const ease = (o) => {
    if (!o.target) return 0;
    const before = o.pos;
    const nx = before.x + (o.target.x - before.x) * k;
    const nz = before.z + (o.target.z - before.z) * k;
    const moved = Math.hypot(nx - before.x, nz - before.z);
    before.x = nx;
    before.y += (o.target.y - before.y) * k;
    before.z = nz;
    return moved;
  };
  for (const m of remote.mobs.values()) m.walkPhase += ease(m) * 3;
  for (const a of remote.arrows.values()) ease(a);
  for (const d of remote.drops.values()) {
    d.pos = d.body.pos;
    ease(d);
    d.age += dt;
  }
  for (const f of remote.fireballs.values()) ease(f);
  for (const s of remote.sacks.values()) ease(s);
  for (const d of remote.drones.values()) ease(d);
  for (const p of remote.players.values()) p.moved = ease(p);
  for (const n of remote.npcs.values()) n.moved = ease(n);
}

// ---------- messages from the game ----------
function onMessage(m) {
  switch (m.type) {
    case 'snap': applySnap(m); break;
    case 'blocks':
      for (const [x, y, z, id] of m.list) {
        const key = `${x},${y},${z}`;
        const mine = recentEdits.has(key) && performance.now() - recentEdits.get(key) < 3000;
        const old = world.getBlock(x, y, z);
        if (!mine && old !== id && !m.quiet) { // (quiet: blocks falling, which make their noise when they land)
          if (id === AIR) sound.play('break', { pos: centre(x, y, z), material: blockMaterial(old) });
          else if (id !== WATER) sound.play('place', { pos: centre(x, y, z), material: blockMaterial(id) });
        }
        recentEdits.delete(key);
        world.setBlock(x, y, z, id);
      }
      break;
    case 'you':
      applyYou(m);
      if (questsOpen) renderQuests(); // (the quest log shows what you're carrying)
      break;
    case 'hurt':
      if (m.knock) player.impulse(m.knock.x, m.knock.y, m.knock.z);
      hurtFlash = Math.min(1, hurtFlash + 0.25 + m.amount * 0.05);
      shake = Math.max(shake, 0.08);
      sound.play('hurt');
      break;
    case 'teleport': // the game moved you (/teleport)
      player.pos = { ...m.pos };
      player.vel = { x: 0, y: 0, z: 0 };
      player.grapple = null;
      sound.play('teleport');
      break;
    case 'console': consoleLine(m.text, m.error ? 'error' : ''); break;
    case 'respawn':
      player.spawn(m.pos);
      player.dead = false;
      if (phoneOut) closePhone(false);
      sound.play('respawn');
      break;
    case 'fx': applyFx(m); break;
    case 'msg':
      popup(m.text, m.kind || '');
      if (m.kind !== 'coin' && m.kind !== 'death' && m.kind !== 'event') sound.play(MSG_SOUNDS[m.kind] || (m.text.startsWith('+1') ? 'pickup' : m.text === 'Not hungry' ? 'deny' : 'ui'));
      if (m.kind === 'heal') healFlash = 0.6;
      if (m.kind === 'vault') vaultStatus.textContent = m.text;
      if (shopOpen && (m.kind === 'buy' || m.kind === 'deny')) shopStatus.textContent = m.text;
      if (potteryOpen && (m.kind === 'pottery' || m.kind === 'deny')) potteryNote = m.text;
      if (kitchenOpen && (m.kind === 'cook' || m.kind === 'deny')) kitchenNote = m.text;
      if (craftingOpen && (m.kind === 'craft' || m.kind === 'deny')) craftingNote = m.text;
      if (m.kind === 'level') healFlash = 0.8;
      if (m.kind === 'sneeze') {
        shake = Math.max(shake, 0.25);
        player.pitch = Math.max(-Math.PI / 2 + 0.01, player.pitch - 0.18); // head jerks down
        effects.sneeze(camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z);
      }
      break;
    case 'printing':
      printPending = false;
      printJob = { kind: m.kind, t: 0, seconds: m.seconds, zec: m.zec, rate: m.rate };
      sound.play('print', { dur: m.seconds });
      break;
    case 'printed':
      printJob = null;
      printerStatus.textContent = `Printed ${itemName(m.kind)}! Press Q or E in game to hold it.`;
      popup(`Printed ${itemName(m.kind)}`);
      sound.play('ding');
      break;
    case 'printFailed':
      printPending = false;
      printerStatus.textContent = m.reason === 'busy' ? 'The printer is busy.'
        : m.zec ? `Not enough Zcash: it costs ${m.zec.toFixed(2)} ZEC at ${usd(m.rate)}/ZEC right now.`
          : "The game server doesn't know that item. It's probably running older code: restart the server.";
      sound.play('deny');
      break;
    case 'settings':
      setTuning(loadSettings(m.settings));
      settingsPanel.update();
      break;
    case 'text': // chat from the console (T): everyone's, or a private /msg
      popup(m.to === 'all' ? `${m.fromName}: ${m.text}` : `${m.fromName} → you: ${m.text}`, 'text');
      sound.play('text', { volume: m.to === 'all' ? 0.4 : 1 });
      break;
    case 'players': renderPlayers(m.list); break; // Settings > Players
    case 'adminNote': playersNote.textContent = m.text; playersNote.classList.toggle('error', !!m.error); break;
    case 'adminRole': setAdmin(m.admin); popup(m.admin ? 'You\'re an Admin now (Settings > Players)' : 'You\'re not an Admin any more', 'event'); break;
    case 'renamed': // your name changed (you asked, or an Admin did), or the name you wanted was taken
      if (m.error) popup(m.error, 'deny');
      identity.name = m.name;
      nameInput.value = m.name;
      break;
    case 'headshot': // you got one (game.js `_headshot`)
      sound.play('headshot');
      sound.announce('HEADSHOT!');
      break;
    case 'textFailed': popup("Not delivered: they've gone offline", 'deny'); break;
    case 'voice': voice.onMessage(m).catch(() => {}); break;
    case 'npc': showNpc(m); break; // a townsperson talking to you (game.js `_sendNpc`)
    default:
  }
}

// Pop-up kinds that come with a sound ('coin' plays from the sparkle everyone sees).
const MSG_SOUNDS = { found: 'pickup', quest: 'ui', questDone: 'level', craft: 'pickup', cook: 'ui', clay: 'pickup', pottery: 'ui', heal: 'eat', level: 'level', coin: null, cough: 'cough', sneeze: 'sneeze', join: 'join', sick: 'eat', trait: 'ui', ammo: 'ammo', surge: 'ui', weird: 'respawn', vault: 'pickup', lost: 'deny', bed: 'ui', buildy: 'ui', order: 'ui', buy: 'pickup', armor: 'ui', delivery: 'pickup', deny: 'deny', flap: 'level', stolen: 'caw' };

function applyFx(m) {
  const pos = { x: m.x, y: m.y, z: m.z };
  const fxSound = { explode: ['explode', 8], fizzle: ['fizzle', 3], puff: ['poof', 3], splat: ['splat', 3], sparkle: ['sparkle', 3], feathers: ['pillow', 3], poop: ['poop', 3] }[m.fx];
  if (fxSound) sound.play(fxSound[0], { pos, ref: fxSound[1] });
  switch (m.fx) {
    case 'explode': {
      effects.explosion(m.x, m.y, m.z, m.radius, m.removed.map(([x, y, z, id]) => ({ x, y, z, id })));
      const d = camera.position.distanceTo(new THREE.Vector3(m.x, m.y, m.z));
      shake = Math.max(shake, 0.5 * Math.max(0, 1 - d / 28));
      break;
    }
    case 'fizzle': effects.fizzle(m.x, m.y, m.z); break;
    case 'puff': effects.puff(m.x, m.y, m.z); break;
    case 'delivery': effects.sparkle(m.x, m.y, m.z); break;
    case 'splat': effects.splat(m.x, m.y, m.z, m.size); break;
    case 'sparkle': effects.sparkle(m.x, m.y, m.z); break;
    case 'garden': // a Tiller, Sprayer or Weed Torch at work
      if (m.action === 'water') { effects.spray(m.x, m.y, m.z); sound.play('splash', { pos: m, volume: 0.6 }); }
      else if (m.action === 'torch') { effects.torch(m.x, m.y, m.z); sound.play('fizzle', { pos: m }); }
      else { effects.dust(m.x, m.y, m.z); sound.play('chip', { pos: m, material: 'dirt' }); }
      break;
    case 'feathers': effects.feathers(m.x, m.y, m.z); break;
    case 'poop': effects.poop(m.x, m.y, m.z); break;
    case 'shot': {
      const gun = GUNS[m.gun];
      if (m.by !== myId) { // your own shots already played when you pulled the trigger
        sound.play(gun.type === 'arrow' ? 'bow' : m.gun, { pos: m.o, ref: m.gun === 'pistol' || m.gun === 'machinegun' ? 5 : 7 });
        if (gun.type !== 'arrow') effects.muzzle(m.o, { x: 0, y: 0, z: 0 });
      }
      if (gun.type === 'rail') {
        for (const e of m.ends) {
          effects.beam(m.o, e, 0x7fd8ff, 0.09, 0.7, 0.8);
          effects.beam(m.o, e, 0xffffff, 0.03, 0.45, 1);
        }
      } else {
        for (const e of m.ends) effects.beam(m.o, e, 0xffe9a8, 0.012, 0.07, 0.85);
      }
      for (const e of m.ends) effects.impact(e);
      break;
    }
    case 'cast': // someone cast a spell
      sound.play(m.spell === 'fireball' ? 'fireball' : 'spell', { pos, p: { missile: 1.4, lightning: 0.8, stoneskin: 0.6, invisibility: 1.6, icebolt: 1.8, blizzard: 0.5, flight: 1.3, teleport: 1.5, dragon: 0.5, blind: 0.9, shrink: 1.2, enlarge: 0.7, polymorph: 1, hallucinate: 1.1 }[m.spell] ?? 1 });
      break;
    case 'chain': // chain lightning: a crackling line through everything it hit
      for (let i = 1; i < m.points.length; i++) effects.zap(m.points[i - 1], m.points[i]);
      sound.play('zap', { pos: m.points[1] });
      break;
    case 'sizeFx': effects.sparkle(m.x, m.y, m.z); sound.play(m.spell === 'enlarge' ? 'enlarge' : 'shrink', { pos }); break;
    case 'frost': effects.frost(m.x, m.y, m.z); sound.play('frost', { pos }); break;
    case 'bonk': sound.play('thunk', { pos, ref: 4, volume: 1.2 }); if (m.by === myId) shake = Math.max(shake, 0.12); break; // a tall head meets a ceiling
    case 'milk': sound.play('splash', { pos, volume: 0.3, ref: 2 }); effects.sparkle(m.x, m.y, m.z); break; // a cow milked
    case 'breath': // Dragon's Breath: a roar of fire
      effects.breath(m.x, m.y, m.z, { x: m.dx, y: m.dy, z: m.dz }, m.range, m.arc);
      sound.play('fireball', { pos, ref: 5, p: 0.6 });
      sound.play('explode', { pos, volume: 0.35, ref: 4 });
      break;
    case 'fishCast': sound.play('splash', { pos, volume: 0.3, ref: 2 }); break; // the bobber lands
    case 'fishBite': // a fish takes it: the bobber dips (see updateBobbers)
      effects.bubbles(m.x, m.y, m.z);
      sound.play('splash', { pos, volume: m.by === myId ? 1 : 0.5, ref: m.by === myId ? 6 : 2 });
      break;
    case 'fishCatch': effects.bubbles(m.x, m.y, m.z); effects.bubbles(m.x, m.y, m.z); sound.play('splash', { pos, ref: 3 }); if (m.by === myId) sound.play('pickup'); break;
    case 'blockLand': { // a falling structure hit the ground (gravity.js)
      effects.dust(m.x, m.y, m.z);
      sound.play('land', { pos, material: blockMaterial(world.getBlock(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))), ref: m.size > 20 ? 8 : 4 });
      if (m.size > 20) shake = Math.max(shake, Math.min(0.4, m.size / 500) * Math.max(0, 1 - camera.position.distanceTo(new THREE.Vector3(m.x, m.y, m.z)) / 28));
      break;
    }
    case 'halluFx': effects.sparkle(m.x, m.y, m.z); sound.play('hallucinate', { pos }); break;
    case 'missileHit': effects.sparkle(m.x, m.y, m.z); sound.play('zap', { pos }); break;
    case 'arrowHit': effects.impact(m); sound.play(m.hit ? 'thwack' : 'thunk', { pos }); break;
    case 'babyCough': sound.play('cough', { pos, p: 1.8 }); break;
    case 'zap':
      for (const t of m.to) effects.zap({ x: m.x, y: m.y, z: m.z }, t);
      sound.play('zap', { pos: { x: m.x, y: m.y, z: m.z } });
      break;
    case 'surge':
      effects.surge(m.x, m.y, m.z);
      sound.play('surge', { pos: { x: m.x, y: m.y, z: m.z }, ref: 6 });
      break;
    default:
  }
}

let stateT = 0;
let voiceMode = null; // 'whisper' (holding Z), 'shout' (holding X) or null: how far your voice carries
const mySwings = { left: 0, right: 0 }; // counts, sent in `state`: each new one is a swing everyone sees
let myMineHand = null; // the hand chopping at a block right now
function sendState() {
  const p = player.pos;
  conn.send({
    type: 'state', x: p.x, y: p.y, z: p.z, yaw: player.yaw, pitch: player.pitch,
    crouch: player.crouching, flying: player.flying, hands: player.hands, phone: multiplayer && phoneOut,
    grapple: player.grapple, voice: voiceMode, sw: mySwings, mine: myMineHand, draw: Math.round(Math.max(bowDraw.left, bowDraw.right) * 10) / 10,
  });
}
sendState();

// ---------- start screen: connection, name, identity ----------
const nameInput = document.getElementById('player-name');
nameInput.value = identity.name;
nameInput.addEventListener('change', () => {
  const name = cleanName(nameInput.value);
  if (name !== identity.name) conn.send({ type: 'rename', name }); // the game says yes ('renamed') or that it's taken
  nameInput.value = identity.name;
});
nameInput.addEventListener('keydown', (e) => e.stopPropagation()); // typing your name isn't game input
document.getElementById('new-world').hidden = multiplayer; // the server's world is shared
const volumeInput = document.getElementById('volume');
volumeInput.value = Math.round(sound.volume * 100);
volumeInput.addEventListener('input', () => {
  sound.unlock();
  sound.setVolume(volumeInput.value / 100);
  if (sound.muted) sound.toggleMute();
  sound.play('ui');
});
volumeInput.addEventListener('keydown', (e) => e.stopPropagation());
function updateNetStatus() {
  if (conn.closed) {
    netStatus.textContent = `${conn.closeReason} Reload the page to reconnect.`;
    netStatus.classList.add('error');
  } else if (multiplayer) {
    netStatus.textContent = `Multiplayer on ${location.host} · ${remote.players.size + 1} online`;
  } else {
    netStatus.textContent = 'Single player (no multiplayer server here)';
  }
}
updateNetStatus();
setInterval(updateNetStatus, 1000);

// ---------- input ----------
document.getElementById('play').addEventListener('click', () => {
  if (!conn.closed) canvas.requestPointerLock();
});
document.getElementById('new-world').addEventListener('click', () => {
  store.remove(`game:edits:${welcome.seed}`);
  store.remove('game:seed');
  store.remove('game:time');
  location.reload();
});

// ---------- server settings (Settings > Server) ----------
// Anyone playing can change these; the game applies them for everyone and tells us (`settings`).
const settingsPanel = (() => {
  const list = document.getElementById('settings-list');
  const rows = {};
  const heads = {}; // group -> its heading
  let group = null;
  const groups = SETTING_GROUPS;
  const ordered = Object.entries(SETTINGS).sort(([, a], [, b]) => groups.indexOf(a.group) - groups.indexOf(b.group));
  for (const [key, s] of ordered) {
    if (s.group !== group) {
      group = s.group;
      const hd = document.createElement('h3');
      hd.className = 'settings-group';
      hd.textContent = group;
      list.append(hd);
      heads[group] = hd;
    }
    const row = document.createElement('label');
    row.className = 'setting';
    const name = document.createElement('span');
    name.className = 'setting-name';
    name.textContent = s.name;
    const value = document.createElement('b');
    const input = document.createElement('input');
    if (s.type === 'bool') {
      input.type = 'checkbox';
      input.addEventListener('change', () => conn.send({ type: 'setting', key, value: input.checked }));
    } else {
      Object.assign(input, { type: 'range', min: s.min, max: s.max, step: s.step });
      input.addEventListener('input', () => { value.textContent = settingText(key, Number(input.value)); });
      input.addEventListener('change', () => conn.send({ type: 'setting', key, value: Number(input.value) }));
    }
    const desc = document.createElement('small');
    desc.textContent = s.desc;
    row.append(name, value, input, desc);
    list.append(row);
    rows[key] = { input, value, row };
  }
  // Search, like the Q/E picker: names (and section names) by the start of a word, then anywhere in a
  // name or description. Tab completes a name; Esc clears the search, then closes.
  const search = document.getElementById('settings-search');
  const none = document.getElementById('settings-none');
  const searchable = ordered.map(([key, s]) => ({ key, name: s.name, category: s.group, desc: s.desc.toLowerCase() }));
  const applySearch = () => {
    const q = search.value.trim().toLowerCase();
    const hits = new Set(filterItems(searchable, q).map((i) => i.key));
    if (q) for (const i of searchable) if (i.desc.includes(q)) hits.add(i.key);
    const shownGroups = new Set();
    for (const [key, { row }] of Object.entries(rows)) {
      row.hidden = !hits.has(key);
      if (!row.hidden) shownGroups.add(SETTINGS[key].group);
    }
    for (const [g, hd] of Object.entries(heads)) hd.hidden = !shownGroups.has(g);
    none.hidden = hits.size > 0;
  };
  search.addEventListener('input', applySearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const done = tabComplete(searchable, search.value);
      if (done && done.length > search.value.length) { search.value = done; applySearch(); }
    } else if (e.key === 'Escape' && search.value) {
      e.stopPropagation(); // clear first; Esc again closes
      search.value = '';
      applySearch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const first = Object.values(rows).find((r) => !r.row.hidden);
      first?.input.focus(); // jump to the first match: arrow keys then change it
    }
  });
  const update = () => {
    for (const [key, { input, value }] of Object.entries(rows)) {
      if (SETTINGS[key].type === 'bool') input.checked = settings[key];
      else if (document.activeElement !== input) input.value = settings[key];
      value.textContent = settingText(key, settings[key]);
    }
  };
  /** The Server tab was opened (showTab): fresh values, an empty search, ready to type. */
  const shown = () => {
    update();
    search.value = '';
    applySearch();
    search.focus();
  };
  document.getElementById('open-settings').addEventListener('click', () => { openClient('server', 'menu'); sound.play('ui'); }); // (a shortcut from the main menu)
  document.getElementById('settings-reset').addEventListener('click', () => {
    for (const [key, s] of Object.entries(SETTINGS)) if (settings[key] !== s.def) conn.send({ type: 'setting', key, value: s.def });
  });
  document.getElementById('settings-note').textContent = multiplayer
    ? 'Anyone playing can change these, and changes apply to everyone right away.'
    : 'Settings for this world. In multiplayer, anyone playing can change the server\'s.';
  return { update, shown, search };
})();

// ---------- 3D printer ----------
let printPending = false; // asked the game to print, waiting for its answer
const printerEl = document.getElementById('printer');
const printerBalance = document.getElementById('printer-balance');
const printerStatus = document.getElementById('printer-status');
const printerFill = document.getElementById('printer-fill');
let printerOpen = false;
let vaultOpen = false;
let bestiaryOpen = false;
let vaultAt = null; // the Cold Wallet block you opened
let printJob = null;
// The printer's catalogue, as a tile grid like the hand picker (see tileshop.js).
const rizzPrice = (usdPrice) => Math.round(usdPrice * statEffects(player.stats).price * 100) / 100; // Rizz haggles (shopkeepers only)
const printerShop = new TileShop({
  iconFor: (kind) => iconFor(kind.startsWith('ammo:') ? 'ammo' : kind),
  action: 'Print',
  live: (kind) => {
    const price = printUsd(kind); // (the printer doesn't care about Rizz)
    const zec = zecFor(price, rate);
    const id = blockIdOf(kind);
    return {
      price: usd(price),
      detail: `${usd(price)} · ${zec.toFixed(2)} ZEC now · ready in ${settings.printSeconds} s`,
      owned: itemCount(player, kind),
      canBuy: !printJob && !printPending && player.wallet.zcash >= zec,
      why: printJob || printPending ? 'Printing…' : 'Not enough ZEC',
    };
  },
  onBuy: (kind) => {
    if (printJob || printPending) return;
    printPending = true;
    printerStatus.textContent = 'Sending to the printer…';
    conn.send({ type: 'print', kind });
  },
});
printerShop.setItems([
  ...Object.entries(TOOLS).filter(([, def]) => !def.town && !def.crafted).map(([kind, def]) => ({ kind, name: def.name, category: def.gun ? 'Weapons' : def.magic ? 'Magic' : 'Tools', desc: def.desc })),
  ...Object.keys(AMMO).filter((type) => !AMMO[type].town).map((type) => ({ kind: `ammo:${type}`, name: itemName(`ammo:${type}`), category: 'Ammo', desc: 'A box of ammo for your guns' })),
  ...Object.entries(BLOCK_PRINTS).map(([id, def]) => ({
    kind: blockKind(Number(id)), name: `${BLOCKS[id].name} ×${def.n}`, category: 'Blocks', desc: 'Building blocks (Buildy Bois get these free)',
  })),
]);
document.getElementById('recipes').replaceWith(printerShop.el);

// ---------- menus (printer, hand picker) ----------
// While a menu is open the game is paused and ignores all game input, whatever the browser's
// pointer-lock state is. (Some browsers, e.g. LibreWolf, don't always release or keep the lock
// the way the spec suggests, so we never rely on it alone.)
function menuOpen() {
  return npcOpen || questsOpen || craftingOpen || kitchenOpen || recipesOpen || potteryOpen || printerOpen || vaultOpen || shopOpen || consoleOpen || clientOpen || sheetOpen || bestiaryOpen || picker.isOpen || phoneOut;
}
player.inputEnabled = () => !menuOpen();
function releaseMouseForMenu() {
  player.locked = false;
  player.keys.clear();
  buttons.left = buttons.right = false;
  document.exitPointerLock();
  // Belt and braces: if the lock is still (or again) held a moment later, release it again.
  setTimeout(() => { if (menuOpen() && document.pointerLockElement) document.exitPointerLock(); }, 150);
}
/** Back to the game after a menu closes. Must run inside a click/keypress so the browser allows the lock. */
function resumeGame() {
  overlayEl.hidden = true;
  resumeEl.hidden = true;
  if (document.pointerLockElement === canvas) player.locked = true; // the lock was never released
  else canvas.requestPointerLock();
}

function openPrinter() {
  printerOpen = true;
  printerEl.hidden = false;
  printerStatus.textContent = 'Pick something to print. Filament is paid in Zcash.';
  releaseMouseForMenu();
  printerShop.focus();
}
function closePrinter(resume) {
  printerOpen = false;
  printerEl.hidden = true;
  if (resume) resumeGame();
  else showPause(); // (Esc can't re-grab the mouse: click to resume)
}
document.getElementById('printer-close').addEventListener('click', () => closePrinter(true));
document.addEventListener('keydown', (e) => {
  if (printerOpen && e.code === 'Escape') closePrinter(false);
});
// ---------- acoustics (acoustics.js): walls, rooms, water, whisper and shout ----------
const getBlock = (x, y, z) => world.getBlock(x, y, z);
sound.occlusion = (pos) => blocksBetween(getBlock, camera.position, pos);
let spaceT = 0;
/** A couple of times a second: what space you're in (echo, underwater, Hell), for game sounds and nearby voices. */
function updateAcoustics(dt) {
  if ((spaceT -= dt) > 0) return;
  spaceT = 0.5;
  const eye = camera.position;
  const underwater = !!FLUID[world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z))];
  const hell = world.biomeAt(Math.floor(eye.x), Math.floor(eye.z)).biome === 'hell';
  const state = probeSpace(getBlock, eye, { underwater, hell });
  sound.setSpace(state);
  voice.setSpace(state);
}
const voiceHud = document.getElementById('voice-hud');
/** Hold Z to whisper or X to shout (multiplayer): changes how far you carry for "nearby only" listeners. */
function updateVoiceMode() {
  const keys = player.locked && !menuOpen() ? player.keys : new Set();
  const mode = !multiplayer ? null : keys.has('KeyX') ? 'shout' : keys.has('KeyZ') ? 'whisper' : null;
  if (mode !== voiceMode) {
    voiceMode = mode;
    sendState();
  }
  const muted = multiplayer && voice.micState === 'on' && !voice.prefs.micOn;
  const text = mode === 'shout' ? '📢 Shouting' : mode === 'whisper' ? '🤫 Whispering' : muted ? '🔇 Mic muted (V)' : '';
  if (voiceHud.textContent !== text) voiceHud.textContent = text;
  voiceHud.hidden = !text;
}
/** "3D sound for headphones": HRTF panning for game sounds and nearby voices (on the start screen and in the V menu). */
function setHrtf(on, save = true) {
  sound.setHrtf(on, save);
  voice.setHrtf(on);
  for (const id of ['hrtf', 'voice-hrtf']) { const box = document.getElementById(id); if (box) box.checked = on; }
}

// ---------- server voice (voice.js) ----------
// In multiplayer everyone is in one voice channel from the start. Settings > Voice (V jumps there): your
// microphone, overall volume, and for each player a volume and "nearby only" (fades with distance, silent
// past the Voice range server setting).
const voice = new Voice({ send: (msg) => conn.send({ type: 'voice', ...msg }), myId, store, note: (text) => popup(text) });
voice.occlusion = (a, b) => blocksBetween(getBlock, a, b);
if (multiplayer) voice.start();
for (const id of ['hrtf', 'voice-hrtf']) document.getElementById(id)?.addEventListener('change', (e) => setHrtf(e.target.checked));
setHrtf(sound.hrtf, false); // (just show it: saving here would turn a default into a choice)
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => voice.resume(), { capture: true }); // audio starts on a gesture
const voiceList = document.getElementById('voice-list');
let voiceMenuT = 0;
let voiceRosterKey = '';
/** The menu: rebuilt when the roster changes; the talking lights and statuses refresh in place. */
function updateVoiceMenu(dt) {
  if (!clientOpen || clientTab !== 'voice' || (voiceMenuT -= dt) > 0) return;
  voiceMenuT = 0.15;
  const mic = document.getElementById('voice-mic');
  const micNote = { asking: 'Asking for your microphone…', on: '', unavailable: "No microphone on this http:// address: you can listen but not talk (see the README to turn on HTTPS).", denied: 'Microphone blocked or missing: you can listen but not talk.' }[voice.micState];
  // (Only touch the button when something changed: rewriting it while the mouse is down eats the click.)
  const micLabel = voice.micState !== 'on' ? '🎙 No microphone' : voice.prefs.micOn ? '🎙 Mic on' : '🔇 Mic muted';
  if (mic.textContent !== micLabel) mic.textContent = micLabel;
  if (mic.disabled !== (voice.micState !== 'on')) mic.disabled = voice.micState !== 'on';
  mic.classList.toggle('off', voice.micState !== 'on' || !voice.prefs.micOn);
  document.getElementById('voice-mic-note').textContent = micNote;
  document.getElementById('voice-range-note').textContent = `"Nearby only": full volume within ${settings.voiceNear} blocks, fading to silence at ${settings.voiceRange}.`;
  const roster = voice.roster();
  const key = roster.map((r) => `${r.id}:${r.name}`).join('|');
  if (key !== voiceRosterKey) {
    voiceRosterKey = key;
    voiceList.replaceChildren(...(roster.length ? roster.map((r) => voiceRow(r)) : [el('div', 'voice-empty', 'No one else is in voice right now.')]));
  }
  for (const r of roster) {
    const row = voiceList.querySelector(`[data-id="${r.id}"]`);
    if (!row) continue;
    row.querySelector('.voice-dot').className = `voice-dot ${!r.connected ? 'connecting' : r.talking && r.heard ? 'talking' : r.heard ? '' : 'quiet'}`;
    row.querySelector('.voice-dot').title = !r.connected ? 'Connecting…' : r.heard ? (r.talking ? 'Talking' : 'Connected') : 'Too far away (or turned down to 0)';
  }
}
function voiceRow(r) {
  const pref = voice.prefFor(r.name);
  const row = el('div', 'voice-row');
  row.dataset.id = r.id;
  const vol = document.createElement('input');
  Object.assign(vol, { type: 'range', min: 0, max: 200, step: 5, value: Math.round(pref.vol * 100) });
  const pct = el('span', 'voice-pct', `${vol.value}%`);
  vol.addEventListener('input', () => { pct.textContent = `${vol.value}%`; voice.setPlayer(r.name, { vol: vol.value / 100 }); });
  const near = document.createElement('input');
  near.type = 'checkbox';
  near.checked = pref.near;
  near.addEventListener('change', () => voice.setPlayer(r.name, { near: near.checked }));
  const nearLabel = el('label', 'voice-near');
  nearLabel.append(near, ' Nearby only');
  row.append(el('span', 'voice-dot connecting'), el('span', 'voice-name', r.name), vol, pct, nearLabel);
  return row;
}
{
  const master = document.getElementById('voice-master');
  const masterPct = document.getElementById('voice-master-pct');
  master.value = Math.round(voice.prefs.master * 100);
  masterPct.textContent = `${master.value}%`;
  master.addEventListener('input', () => { masterPct.textContent = `${master.value}%`; voice.setMaster(master.value / 100); });
  document.getElementById('voice-mic').addEventListener('click', () => { voice.setMic(!voice.prefs.micOn); voiceMenuT = 0; updateVoiceMenu(0); });
}

// ---------- Client Settings (Esc) ----------
// Esc lets go of the mouse; once you've been in the game that opens Settings, in tabs: Controls (mouse,
// and every key), Sound, Voice, Display and Graphics. Choices are saved in this browser (`prefs`). Resume
// goes back in (a click: browsers won't let Esc re-grab the mouse); Main menu shows the title card.
const clientEl = document.getElementById('client');
let clientOpen = false;
let clientTab = store.get('game:client-tab') || 'controls';
let played = false; // been in the game yet? (before that, losing the mouse shows the title card)
const KEYS = [
  ['WASD', 'Move'], ['Mouse', 'Look'], ['Space', 'Jump, swim up, fly up'], ['Shift', 'Sprint (also flies faster)'],
  ['C', "Crouch (won't walk off edges), fly down, dive"], ['F', 'Toggle flying (Buildy Bois, or with the Flying spell)'], ['K', 'Recipe book'], ['R', 'Crafting'], ['B', 'Buildy Boi mode on/off (10 s)'],
  ['Q / E (tap)', 'Choose what\'s in your left / right hand (drag things onto that hand\'s hotbar)'], ['Q / E (hold) + scroll', 'Switch to the next thing on that hand\'s hotbar'], ['Left / right click', 'Use your left / right hand: place, mine (hold), attack, cast, fire, eat, read a scroll, put on armor, open your phone. Right-clicking a door, bed, counter, Cold Wallet or printer uses it. Click a townsperson to talk'],
  ['Right click (hold)', 'Aim down sights with a two-handed gun or bow'], ['Middle click', 'Put the block you\'re looking at in your right hand'],
  ['Scroll wheel', 'Pick a spell (or none, so empty hands punch and mine)'], ['G (hold)', 'Wash any dirty dish (near water)'],
  ['Tab', 'Map'], ['I', 'Character sheet'], ['J', 'Bestiary'], ['L', 'Quest log'], ['U', 'Take off your armor'], ['T', 'Chat: type a message to everyone (it shows in the message log)'],
  ['V', 'Voice settings (multiplayer)'], ['Z / X (hold)', 'Whisper / shout'], ['/', 'Console: /help, /msg, /teleport, /give, /summon, /skip'],
  ['P', 'Camera: first person, behind you, facing you'], ['M', 'Mute / unmute sound'], ['F3', 'Info panel'], ['Esc', 'Settings (this)'],
];
document.getElementById('client-keys').replaceChildren(...KEYS.flatMap(([k, d]) => [el('dt', '', k), el('dd', '', d)]));
const PREF_TEXT = {
  sensitivity: (v) => `${Math.round(v * 100)}%`, fov: (v) => `${v}°`, echo: (v) => `${Math.round(v * 100)}%`,
  renderDistance: (v) => `${v} chunks (${v * CS} blocks)`, resScale: (v) => `${Math.round(v * 100)}%`, fontScale: (v) => `${Math.round(v * 100)}%`,
};
/** Puts one client setting into effect. */
function applyPref(key) {
  const v = prefs[key];
  if (key === 'sensitivity') player.sensitivity = v;
  else if (key === 'invertY') player.invertY = v;
  else if (key === 'fov') BASE_FOV = v; // (the camera eases to it next frame)
  else if (key === 'info') { showInfo = v; infoEl.hidden = !v; }
  else if (key === 'chat') chatEl.classList.toggle('off', !v);
  else if (key === 'renderDistance') renderDistance = v; // (chunks load and unload to match; the fog follows)
  else if (key === 'resScale') fitRenderer();
  else if (key === 'echo') { sound.setEcho(v); voice.setEcho(v); }
  else if (key === 'ambient') sound.ambientOn = v;
  else if (key === 'fontScale') document.documentElement.style.setProperty('--fs', String(v)); // every font size in the page's CSS is multiplied by --fs
}
function setPref(key, value) {
  prefs[key] = value;
  savePrefs();
  applyPref(key);
  syncClient();
}
for (const key of Object.keys(CLIENT_DEFAULTS)) if (key !== 'resScale') applyPref(key); // (fitRenderer reads resScale itself when it first runs)
/** Shows the current values in the panel. */
function syncClient() {
  for (const input of clientEl.querySelectorAll('[data-pref]')) {
    const key = input.dataset.pref;
    if (input.type === 'checkbox') input.checked = !!prefs[key];
    else if (document.activeElement !== input) input.value = prefs[key];
  }
  for (const out of clientEl.querySelectorAll('[data-out]')) {
    const key = out.dataset.out;
    out.textContent = key === 'volume' ? `${Math.round(sound.volume * 100)}%` : PREF_TEXT[key](prefs[key]);
  }
  document.getElementById('muted').checked = sound.muted;
}
for (const input of clientEl.querySelectorAll('[data-pref]')) {
  input.addEventListener('input', () => setPref(input.dataset.pref, input.type === 'checkbox' ? input.checked : Number(input.value)));
  input.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); }); // arrow keys adjust it, not the game
}
volumeInput.addEventListener('input', () => syncClient());
document.getElementById('muted').addEventListener('change', (e) => { sound.unlock(); if (e.target.checked !== sound.muted) sound.toggleMute(); });
// ---------- Settings > Players (Admins: accounts.js, game.js `_admin`) ----------
const playersTab = document.getElementById('players-tab');
const playersList = document.getElementById('players-list');
const playersNote = document.getElementById('players-note');
let playersKey = ''; // the list as drawn (only redrawn when it changes: buttons mustn't be replaced mid-click)
let playersT = 0;
function setAdmin(on) {
  isAdmin = on;
  playersTab.hidden = !on;
  if (!on && clientTab === 'players' && clientOpen) showTab('controls');
}
setAdmin(isAdmin);
const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
function renderPlayers(list) {
  const key = JSON.stringify(list.map((p) => ({ ...p, seen: p.online ? 0 : Math.floor((Date.now() - p.seen) / 60000) })));
  if (key === playersKey) return;
  playersKey = key;
  playersList.replaceChildren(...list.map((p) => {
    const row = el('div', 'player-row');
    const info = el('div');
    const tags = el('div', 'tags');
    if (p.online) tags.append(el('span', 'on', 'online'));
    if (p.admin) tags.append(el('span', '', 'Admin'));
    if (p.banned) tags.append(el('span', 'bad', 'banned'));
    if (p.you) tags.append(el('span', '', 'you'));
    info.append(el('b', '', p.name), tags, el('small', '', `${p.playing ? `Playing ${p.playing} (level ${p.level}) · ` : ''}Characters: ${p.characters?.join(', ') || 'none'} · ID ${p.uid} · joined ${new Date(p.created).toLocaleDateString()} · seen ${p.online ? 'now' : ago(p.seen)}${p.recovery ? ` · recovery code ${p.recovery}` : ''}`));
    const acts = el('div', 'acts');
    const act = (label, op, extra = {}, ask = null) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (ask && !ask()) return;
        conn.send({ type: 'admin', op, uid: p.uid, ...extra });
        sound.play('ui');
      });
      acts.append(b);
      return b;
    };
    act('Recovery code', 'recover');
    const rename = el('button', '', 'Rename');
    rename.type = 'button';
    rename.addEventListener('click', () => {
      const name = prompt(`New name for ${p.name}:`, p.name);
      if (name && name.trim() && name.trim() !== p.name) conn.send({ type: 'admin', op: 'rename', uid: p.uid, name: name.trim() });
    });
    acts.append(rename);
    if (!p.you) {
      if (p.online) act('Kick', 'kick');
      act(p.banned ? 'Unban' : 'Ban', 'ban', { on: !p.banned }, p.banned ? null : () => confirm(`Ban ${p.name}? They won't be able to join until you unban them.`));
      act(p.admin ? 'Remove Admin' : 'Make Admin', 'adminRole', { on: !p.admin });
      act('Delete', 'delete', {}, () => confirm(`Delete ${p.name} and everything they have? This can't be undone.`));
    }
    row.append(info, acts);
    return row;
  }));
}
/** While the Players tab is open: ask for the list now and then (who's online, last seen). */
function updatePlayersTab(dt) {
  if (!clientOpen || clientTab !== 'players' || !isAdmin || (playersT -= dt) > 0) return;
  playersT = 3;
  conn.send({ type: 'admin', op: 'list' });
}

function showTab(tab) {
  if (tab === 'players' && !isAdmin) tab = 'controls';
  if (tab === 'players') { playersT = 0; playersNote.textContent = ''; }
  if (tab === 'server') setTimeout(() => settingsPanel.shown(), 0); // (after the tab is showing, so the search can take focus)
  clientTab = tab;
  store.set('game:client-tab', tab);
  for (const b of clientEl.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const sec of clientEl.querySelectorAll('[data-panel]')) sec.hidden = sec.dataset.panel !== tab;
  if (tab === 'voice') {
    voiceRosterKey = '';
    voiceMenuT = 0;
    if (!multiplayer) {
      document.getElementById('voice-mic-note').textContent = 'Voice chat is for multiplayer: run the server (see the README) and play together.';
      voiceList.replaceChildren();
    }
  }
}
for (const b of clientEl.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { showTab(b.dataset.tab); sound.play('ui'); });
let clientFrom = 'menu'; // where Esc goes back to: the main menu, or the game (V opens Settings from the game)
function openClient(tab = clientTab, from = 'menu') {
  clientFrom = from;
  clientOpen = true;
  clientEl.hidden = false;
  overlayEl.hidden = true;
  showTab(tab);
  syncClient();
  releaseMouseForMenu();
}
function closeClient(resume) {
  clientOpen = false;
  clientEl.hidden = true;
  if (resume) resumeGame();
}
// ---------- Esc: game -> main menu -> back to the game; in any menu, up one level ----------
// Browsers only give the mouse back to the game on a click, never on Esc, so "back to the game" from a
// key press shows a click-anywhere prompt (#resume) and the click puts you back in.
const resumeEl = document.getElementById('resume');
let menuAt = 0; // when the main menu last opened (the Esc that let go of the mouse may arrive just after)
function openMainMenu() {
  resumeEl.hidden = true;
  overlayEl.hidden = false;
  menuAt = performance.now();
}
/** Back to the game from a key press: the click-to-resume prompt (or the title card if you haven't played yet). */
function showPause() {
  if (!played || conn.closed) { overlayEl.hidden = false; return; }
  overlayEl.hidden = true;
  resumeEl.hidden = false;
}
resumeEl.addEventListener('click', () => { resumeEl.hidden = true; resumeGame(); });
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (e.target === settingsPanel.search && settingsPanel.search.value) return; // Settings > Server: Esc clears the search first
  if (clientOpen) { // Settings: back to wherever it was opened from
    e.stopImmediatePropagation();
    closeClient(false);
    if (clientFrom === 'menu') openMainMenu();
    else showPause();
    return;
  }
  if (!overlayEl.hidden && played && !conn.closed && performance.now() - menuAt > 350) { // main menu: back to the game
    e.stopImmediatePropagation();
    showPause();
    return;
  }
  if (sheetOpen) { // the character sheet: back to the game
    e.stopImmediatePropagation();
    setSheet(false, false);
    showPause();
    return;
  }
  if (!resumeEl.hidden && !menuOpen()) { // at the click-to-resume prompt: the main menu again
    e.stopImmediatePropagation();
    openMainMenu();
  }
}, true);
document.getElementById('client-resume').addEventListener('click', () => closeClient(true));
document.getElementById('client-menu').addEventListener('click', () => { closeClient(false); openMainMenu(); });
document.getElementById('open-client').addEventListener('click', () => openClient(clientTab, 'menu'));
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyV' || e.repeat || e.target.tagName === 'INPUT') return;
  if (clientOpen && clientTab === 'voice') { closeClient(true); return; } // (a key press: allowed to grab the mouse again)
  if (!player.locked || menuOpen()) return;
  if (!multiplayer) { popup('Voice chat is for multiplayer: run the server and play together'); return; }
  openClient('voice', 'game');
});

// ---------- the / console ----------
// T to chat, / to type a command. Plain text goes to everyone (a 'text' message; it shows in everyone's
// message log); a line starting with / is a command (commands.js), which the game runs and answers here.
// It doesn't pause the game or let go of the mouse: it just takes the keyboard until Enter or Esc.
const consoleEl = document.getElementById('console');
const consoleLog = document.getElementById('console-log');
const consoleInput = document.getElementById('console-input');
let consoleOpen = false;
const consoleHistory = [];
let historyAt = 0;
function consoleLine(text, cls = '') {
  const line = el('div', cls, text);
  consoleLog.append(line);
  while (consoleLog.childElementCount > 60) consoleLog.firstElementChild.remove();
  consoleLog.scrollTop = consoleLog.scrollHeight;
  if (!consoleOpen && cls !== 'you') popup(text, cls === 'error' ? 'deny' : ''); // answers that come after you've closed it
}
function openConsole(start = '/') {
  consoleOpen = true;
  player.keys.clear();
  buttons.left = buttons.right = false;
  consoleEl.hidden = false;
  consoleInput.value = start;
  consoleInput.placeholder = 'Say something to everyone, or type / for commands (/help)';
  historyAt = consoleHistory.length;
  consoleInput.focus();
}
function closeConsole() {
  consoleOpen = false;
  consoleEl.hidden = true;
  consoleInput.blur();
  if (document.pointerLockElement !== canvas) showPause(); // (Esc may have let go of the mouse too)
}
/** Tab: complete the last word (a command, a player's name or a place); several matches are listed. */
function completeConsole() {
  const text = consoleInput.value;
  const words = text.split(' ');
  const last = words[words.length - 1].toLowerCase();
  const cmd = commandOf(words[0].replace(/^\//, ''));
  const names = [identity.name, ...[...remote.players.values()].map((p) => p.name)];
  const options = words.length === 1
    ? Object.entries(COMMANDS).flatMap(([k, c]) => [k, ...(c.aliases || [])]).map((k) => `/${k}`)
    : cmd === 'give' ? [...(words.length === 2 ? names : []), ...allItems().flatMap((i) => [i.word, i.name.toLowerCase().replace(/[^a-z0-9]/g, '')])] // (short ids, and full names run together)
      : cmd === 'summon' ? [...(words.length === 2 ? names : []), ...MOB_WORDS]
        : [...names, ...PLACES];
  const matches = [...new Set(options.filter((o) => o.toLowerCase().startsWith(last)))];
  if (!matches.length) return;
  let common = matches[0];
  for (const m of matches) while (!m.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1);
  words[words.length - 1] = matches.length === 1 ? `${matches[0]} ` : common;
  consoleInput.value = words.join(' ');
  if (matches.length > 1) consoleLine(matches.join('  '), 'you');
}
consoleInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // typing here never reaches the game's keys
  if (e.code === 'Escape') { e.preventDefault(); closeConsole(); return; }
  if (e.code === 'Tab') { e.preventDefault(); completeConsole(); return; }
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    e.preventDefault();
    historyAt = Math.max(0, Math.min(consoleHistory.length, historyAt + (e.code === 'ArrowUp' ? -1 : 1)));
    consoleInput.value = consoleHistory[historyAt] ?? '/';
    return;
  }
  if (e.code !== 'Enter') return;
  e.preventDefault();
  const text = consoleInput.value.trim();
  if (text && text !== '/') {
    if (consoleHistory[consoleHistory.length - 1] !== text) consoleHistory.push(text);
    if (/^\/give\s*$/i.test(text)) { // /give on its own: pick from every item, in the inventory's tile panel
      closeConsole();
      openGivePanel();
      return;
    }
    if (text.startsWith('/')) {
      consoleLine(text, 'you');
      conn.send({ type: 'command', text });
    } else { // chat: to everyone, and into your own message log
      popup(`${identity.name}: ${text}`, 'text');
      if (multiplayer) conn.send({ type: 'text', to: 'all', text });
      else popup("(You're playing single player: no one else can hear you.)");
    }
  }
  closeConsole();
});
document.addEventListener('keydown', (e) => { // / opens it for a command, T for chat
  if ((e.key !== '/' && e.code !== 'KeyT') || e.repeat || e.target.tagName === 'INPUT' || !player.locked || menuOpen()) return;
  e.preventDefault(); // (so the / or t isn't typed into it)
  openConsole(e.key === '/' ? '/' : '');
});

// ---------- Fantasy Town shops ----------
// Right-click a shop's counter: its wares as tiles, bought on the spot (no fee, no wait) in ZEC at the rate of the moment.
const shopEl = document.getElementById('shop');
const shopStatus = document.getElementById('shop-status');
const shopWallet = document.getElementById('shop-wallet');
let shopOpen = false;
let shopAt = null; // { x, y, z, shop } of the counter you opened
const townShop = new TileShop({
  iconFor: (kind) => iconFor(kind.startsWith('ammo:') && kind !== 'ammo:arrows' ? 'ammo' : kind),
  action: 'Buy',
  live: (kind) => {
    const offer = townOffer(shopAt?.shop, kind) || { usd: 0, n: 1 };
    const price = rizzPrice(offer.usd);
    const zec = zecFor(price, rate);
    const ammo = kind.startsWith('ammo:') ? kind.slice(5) : null;
    return {
      price: usd(price),
      detail: `${offer.n > 1 ? `${offer.n} for ` : ''}${usd(price)} · ${zec.toFixed(2)} ZEC now`,
      owned: itemCount(player, kind) + (!ammo && player.worn === kind ? 1 : 0),
      canBuy: player.wallet.zcash >= zec,
      why: 'Not enough ZEC',
    };
  },
  onBuy: (kind) => {
    if (!shopAt) return;
    shopStatus.textContent = '…';
    conn.send({ type: 'buy', x: shopAt.x, y: shopAt.y, z: shopAt.z, kind });
  },
});
document.getElementById('shop-wares').replaceWith(townShop.el);
function openShop(at) {
  const def = SHOPS[at.shop];
  if (!def) return;
  shopOpen = true;
  shopAt = at;
  document.getElementById('shop-name').textContent = def.name;
  document.getElementById('shop-greeting').textContent = def.greeting;
  townShop.setItems(townCatalog(at.shop).map((i) => ({ ...i, name: i.n > 1 ? `${i.name} ×${i.n}` : i.name })));
  shopStatus.textContent = 'Prices are in dollars, paid in Zcash at the rate of the moment.';
  shopEl.hidden = false;
  releaseMouseForMenu();
  townShop.focus();
}
function closeShop(resume) {
  shopOpen = false;
  shopEl.hidden = true;
  if (resume) resumeGame();
  else showPause(); // (Esc can't re-grab the mouse: click to resume)
}
function updateShop() {
  if (!shopOpen) return;
  const text = `${player.wallet.zcash.toFixed(2)} ZEC ≈ ${usd(player.wallet.zcash * rate)}`;
  if (shopWallet.textContent !== text) shopWallet.textContent = text;
  townShop.refresh();
  if (player.dead) closeShop(false);
}
document.getElementById('shop-close').addEventListener('click', () => closeShop(true));
document.addEventListener('keydown', (e) => {
  if (shopOpen && e.code === 'Escape') closeShop(false);
});

// ---------- townsfolk and quests (npcs.js, quests.js) ----------
// Click a townsperson to talk: the game answers with an `npc` message (what they say, your quest for them,
// or the one they'd give you), shown here with buttons that send `quest` messages. The quest log (L) lists
// your quests. Lost things and gardens to till have markers in the world and on the Tab map.

/** What's over a townsperson's head: ❗ a job for you, ❓ yours to hand in, ❔ yours in progress. */
function npcMarker(n) {
  const qs = player.quests || { active: [], cool: [] };
  const q = qs.active.find((x) => x.giver === n.key);
  if (q) return questReady(q, player) ? '❓ ' : '❔ ';
  if (player.buildy || qs.cool.includes(n.key) || qs.active.length >= settings.maxQuests) return '';
  return '❗ ';
}
/** The townsfolk as avatars.js wants them. */
function npcView() {
  const view = new Map();
  for (const n of remote.npcs.values()) {
    view.set(n.id, { name: npcMarker(n) + n.name, pos: n.pos, yaw: n.yaw, pitch: 0, moved: n.moved || 0, hands: n.hands, look: n.look, worn: n.worn, crouch: false, phone: false, dead: false });
  }
  return view;
}

const npcEl = document.getElementById('npc');
const npcButtons = document.getElementById('npc-buttons');
let npcOpen = false;
const ROLE_NAMES = { blacksmith: 'Blacksmith', healer: 'Healer', tavern: 'Innkeeper', fletcher: 'Fletcher', wizard: 'Wizard', villager: 'Villager' };
/** "$12 (about 0.52 ZEC right now)". */
const rewardUsd = (q) => Math.round(q.usd * statEffects(player.stats).reward * 100) / 100; // Rizz: bigger rewards (game.js does the same)
const rewardText = (q) => `${usd(rewardUsd(q))} (about ${zecFor(rewardUsd(q), rate).toFixed(2)} ZEC right now)`;
/** One quest as a box: what it wants, how far along you are, and what it pays. */
function questBox(q, extra = null) {
  const box = el('div', 'quest-box');
  const { have, need } = questProgress(q, player);
  const ready = have >= need;
  const row = el('div', 'quest-row');
  const text = el('div');
  text.append(el('b', '', questGoal(q)));
  if (q.id) text.append(el('small', ready ? 'ready' : '', ready ? `✔ Done: go back to ${q.name}` : `${have} / ${need}${q.spot && !q.found ? ` · marker ${Math.round(Math.hypot(q.spot.x - player.pos.x, q.spot.z - player.pos.z))} m away` : ''}`));
  text.append(el('small', '', `Reward: ${rewardText(q)}`));
  row.append(text);
  if (extra) row.append(extra);
  box.append(row);
  return box;
}
function npcButton(label, onClick, primary = false) {
  const b = el('button', primary ? 'primary' : '', label);
  b.addEventListener('click', onClick);
  return b;
}
function showNpc(m) {
  document.getElementById('npc-name').textContent = m.name;
  document.getElementById('npc-role').textContent = ROLE_NAMES[m.role] || '';
  document.getElementById('npc-note').textContent = m.note || '';
  document.getElementById('npc-text').textContent = `“${m.text}”`;
  const questEl = document.getElementById('npc-quest');
  questEl.replaceChildren(...(m.active ? [questBox(m.active)] : m.offer ? [questBox(m.offer)] : []));
  const send = (op) => conn.send({ type: 'quest', op, id: m.id, quest: m.active?.id });
  const buttons = [];
  if (m.offer) buttons.push(npcButton('Accept', () => send('accept'), true));
  if (m.active && m.ready) buttons.push(npcButton(m.active.kind === 'fetch' ? 'Hand it over' : m.active.kind === 'lost' ? 'Give it back' : 'Tell them it\'s done', () => send('turnin'), true));
  if (m.active && !m.ready) buttons.push(npcButton('Give up this quest', () => send('abandon')));
  if (m.counter && SHOPS[m.role]) buttons.push(npcButton('Browse wares', () => { closeNpc(null); openShop({ ...m.counter, shop: m.role }); }));
  buttons.push(npcButton(m.offer ? 'Not now' : 'Goodbye', () => closeNpc(true)));
  npcButtons.replaceChildren(...buttons);
  if (!npcOpen) {
    if (menuOpen()) return; // (something else got there first)
    npcOpen = true;
    npcEl.hidden = false;
    sound.play('ui');
    releaseMouseForMenu();
  }
}
/** `resume`: true goes back to the game, false shows the click-to-resume prompt, null leaves it to whatever opens next. */
function closeNpc(resume) {
  if (!npcOpen) return;
  npcOpen = false;
  npcEl.hidden = true;
  if (resume) resumeGame();
  else if (resume === false) showPause();
}
document.addEventListener('keydown', (e) => {
  if (npcOpen && e.code === 'Escape') closeNpc(false);
});

// The quest log (L).
const questsEl = document.getElementById('quests');
const questsList = document.getElementById('quests-list');
let questsOpen = false;
let questsKey = '';
function renderQuests() {
  const qs = player.quests || { active: [], done: 0 };
  // Only rebuild (and replace the buttons) when something you'd see has changed.
  const key = JSON.stringify([qs.active.map((q) => [q.id, questProgress(q, player).have, q.found, rewardUsd(q)]), qs.done, Math.round(rate * 20)]);
  if (key === questsKey) return;
  questsKey = key;
  document.getElementById('quests-done').textContent = `${qs.active.length} / ${settings.maxQuests} on the go · ${qs.done} done`;
  if (!qs.active.length) {
    questsList.replaceChildren(el('p', 'none', 'No quests yet. Talk to people in the Fantasy Town: shopkeepers need the makings of their trades, and villagers always want a hand with something. Someone with ❗ over their head has a job for you.'));
    return;
  }
  questsList.replaceChildren(...qs.active.map((q) => {
    const drop = el('button', '', 'Give up');
    drop.addEventListener('click', () => conn.send({ type: 'quest', op: 'abandon', quest: q.id }));
    const box = questBox(q, drop);
    box.append(el('small', '', `For ${q.name}: “${q.text}”`));
    return box;
  }));
}
function setQuests(open, resume = false) {
  if (open === questsOpen) return;
  questsOpen = open;
  questsEl.hidden = !open;
  sound.play('ui');
  if (open) {
    questsKey = '';
    renderQuests();
    releaseMouseForMenu();
  } else if (resume) resumeGame();
  else showPause();
}
document.getElementById('quests-close').addEventListener('click', () => setQuests(false, true));
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (questsOpen && (e.code === 'Escape' || e.code === 'KeyL')) { e.stopPropagation(); setQuests(false); return; }
  if (e.code === 'KeyL' && !e.repeat && !menuOpen() && player.locked) setQuests(true);
});

// Markers in the world: a lost thing lies glinting under a golden beam; a garden to till is a green ring.
const questMarks = new Map(); // quest id -> { group, item, kind, key }
function updateQuestMarkers(dt) {
  const want = new Map();
  for (const q of player.quests?.active || []) {
    if (!q.spot || (q.kind === 'lost' && q.found) || (q.kind === 'till' && q.progress >= q.n)) continue;
    want.set(q.id, q);
  }
  for (const [id, mk] of questMarks) {
    if (want.has(id) && want.get(id).kind === mk.kind) continue;
    scene.remove(mk.group);
    mk.group.traverse((c) => { if (c.isMesh && c.material !== heldMaterial) { c.geometry.dispose(); c.material.dispose(); } });
    questMarks.delete(id);
  }
  for (const [id, q] of want) {
    let mk = questMarks.get(id);
    if (!mk) {
      const group = new THREE.Group();
      const lost = q.kind === 'lost';
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(lost ? 0.07 : 0.12, lost ? 0.07 : 0.12, 30, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: lost ? 0xffd257 : 0x7fe07a, transparent: true, opacity: 0.32, depthWrite: false }));
      beam.position.y = 15;
      group.add(beam);
      let item = null;
      if (lost) {
        item = buildHeldModel(q.item, heldMaterial);
        if (item) { item.scale.multiplyScalar(1.6); item.position.y = 0.15; group.add(item); } // (a bit bigger than life, to be spotted)
      } else {
        const r = settings.questTillRadius;
        const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.5, r - 0.25), r, 48), new THREE.MeshBasicMaterial({ color: 0x7fe07a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        group.add(ring);
      }
      group.position.set(q.spot.x, q.spot.y, q.spot.z);
      scene.add(group);
      mk = { group, item, kind: q.kind };
      questMarks.set(id, mk);
    }
    if (mk.item) {
      mk.item.rotation.y += dt * 1.5;
      mk.item.position.y = 0.15 + Math.sin(performance.now() / 400) * 0.06;
    }
  }
}
/** Quest markers for the Tab map: lost things, gardens, and people waiting for what you've brought. */
function questMapMarks() {
  const active = player.quests?.active || [];
  const marks = active.filter((q) => q.spot && !(q.kind === 'lost' && q.found) && !(q.kind === 'till' && q.progress >= q.n))
    .map((q) => ({ x: q.spot.x, z: q.spot.z, label: q.kind === 'lost' ? lostName(q.item) : `${q.name.split(' ')[0]}'s garden`, color: q.kind === 'lost' ? '#ffd257' : '#7fe07a' }));
  for (const n of remote.npcs.values()) {
    if (active.some((q) => q.giver === n.key && questReady(q, player))) marks.push({ x: n.pos.x, z: n.pos.z, label: n.name.split(' ')[0], color: '#ff9a5a' });
  }
  return marks;
}

// ---------- pottery (pottery.js): Pottery Wheel, Kiln, Glazing Table ----------
// One panel, three stations. Item "kinds" here are this panel's own: 'throw:<object>:<clay>' and
// 'trim:<thrown key>' (wheel), an unfired key (kiln) and 'glaze:<block id>:<glaze>' (table). The game checks
// everything again (`pottery` message).
const potteryEl = document.getElementById('pottery');
const potteryStatus = document.getElementById('pottery-status');
const potteryHave = document.getElementById('pottery-have');
let potteryOpen = false;
let potteryAt = null; // { x, y, z, station } you opened
let potteryKey = ''; // what the item list was built from (rebuilt when that changes)
let potteryNote = ''; // the game's last word on what you did here
const POTTERY_TEXT = {
  [POTTERY_WHEEL]: { name: 'Pottery Wheel', greeting: 'Throw a pot from clay, then trim it here once it has firmed up. Trimmed pots go to the kiln.', action: 'Go' },
  [KILN]: { name: 'Kiln', greeting: 'Bisque-fire trimmed pots, or glaze-fire glazed ones. One batch at a time; you can walk away while it fires.', action: 'Fire' },
  [GLAZING_TABLE]: { name: 'Glazing Table', greeting: 'Glaze a bisque piece with a pattern: Cobalt Stripes, Jade Speckle or Amber Zigzag. Then glaze-fire it in the kiln.', action: 'Glaze' },
};
const unfired = (k) => player.unfired?.[k] || 0;
const potteryShop = new TileShop({
  iconFor: (kind) => {
    const [what, a, b] = kind.split(':');
    if (what === 'throw') return potteryIcon(POT_OBJECTS.indexOf(a), CLAYS.indexOf(b), 0, { raw: true, wet: true });
    if (what === 'trim') { const u = unfiredInfo(kind.slice(5)); return potteryIcon(u.obj, u.clay, 0, { raw: true }); }
    if (what === 'glaze') { const p = potteryInfo(Number(a)); return potteryIcon(p.obj, p.clay, Number(b), { raw: true }); }
    return iconFor(kind); // an unfired piece, for the kiln
  },
  action: 'Go',
  live: (kind) => {
    const [what, a, b] = kind.split(':');
    if (what === 'throw') {
      const o = POT_OBJECTS.indexOf(a);
      const c = CLAYS.indexOf(b);
      const need = clayFor(o);
      const have = player.buildy ? Infinity : player.blocks[CLAY_BLOCKS[c]] || 0;
      return { price: `${need} clay`, detail: `Throw it from ${need} ${CLAY_NAMES[c]} (you have ${player.buildy ? 'plenty' : have})`, owned: unfired(`thrown:${a}:${b}`), canBuy: have >= need, why: `Need ${need} ${CLAY_NAMES[c]}` };
    }
    if (what === 'trim') {
      const key = kind.slice(5);
      return { price: 'Trim', detail: `Trim a ${unfiredName(key).toLowerCase()}, ready for the kiln`, owned: unfired(key), canBuy: unfired(key) > 0, why: 'None left' };
    }
    if (what === 'glaze') {
      const id = Number(a);
      const have = player.buildy ? Infinity : player.blocks[id] || 0;
      return { price: GLAZE_NAMES[Number(b)], detail: `Glaze one ${potteryName(id)} (you have ${player.buildy ? 'plenty' : have})`, owned: unfired(glazedKey(id, Number(b))), canBuy: have > 0, why: 'None left' };
    }
    const n = unfired(kind);
    const glazed = unfiredInfo(kind).stage === 'glazed';
    return { price: `×${n}`, detail: player.kiln ? `The kiln is busy: ${player.kiln.text}, ${player.kiln.t} s left` : `${glazed ? 'Glaze' : 'Bisque'} fire ${Math.min(n, settings.kilnLoad)} in ${fireSeconds(kind)} s`,
      owned: n, canBuy: !player.kiln && n > 0, why: player.kiln ? 'Kiln busy' : 'None left' };
  },
  onBuy: (kind) => {
    if (!potteryAt) return;
    const [what, a, b] = kind.split(':');
    const at = { x: potteryAt.x, y: potteryAt.y, z: potteryAt.z };
    if (what === 'throw') conn.send({ type: 'pottery', op: 'throw', obj: a, clay: b, ...at });
    else if (what === 'trim') conn.send({ type: 'pottery', op: 'trim', key: kind.slice(5), ...at });
    else if (what === 'glaze') conn.send({ type: 'pottery', op: 'glaze', id: Number(a), glaze: Number(b), ...at });
    else conn.send({ type: 'pottery', op: 'fire', key: kind, ...at });
    sound.play('ui');
  },
});
document.getElementById('pottery-items').replaceWith(potteryShop.el);
/** The items for the station you're at. */
function potteryItems() {
  const st = potteryAt?.station;
  const owned = UNFIRED.filter((k) => unfired(k) > 0);
  if (st === POTTERY_WHEEL) {
    return [
      ...owned.filter((k) => unfiredInfo(k).stage === 'thrown').map((k) => ({ kind: `trim:${k}`, name: `Trim: ${unfiredName(k).slice(7)}`, category: 'Trim', desc: 'Trim a thrown pot' })),
      ...POT_OBJECTS.flatMap((o, i) => CLAYS.map((c, j) => ({ kind: `throw:${o}:${c}`, name: `Throw: ${CLAY_NAMES[j]} ${POT_NAMES[i]}`, category: POT_NAMES[i], desc: `${clayFor(i)} ${CLAY_NAMES[j]}` }))),
    ];
  }
  if (st === KILN) {
    return owned.filter((k) => firedId(k) !== null).map((k) => ({ kind: k, name: unfiredName(k), category: unfiredInfo(k).stage === 'glazed' ? 'Glaze firing' : 'Bisque firing', desc: '' }));
  }
  const list = [];
  for (let id = potteryId(0, 0); id < potteryId(4, 2) + 4; id++) {
    const p = potteryInfo(id);
    if (!p || p.glaze || !(player.buildy || player.blocks[id] > 0)) continue;
    for (let g = 1; g < GLAZE_NAMES.length; g++) list.push({ kind: `glaze:${id}:${g}`, name: `${potteryName(id).replace(' (Bisque)', '')}: ${GLAZE_NAMES[g]}`, category: POT_NAMES[p.obj], desc: GLAZE_NAMES[g] });
  }
  return list;
}
const POTTERY_EMPTY = {
  [KILN]: 'Nothing ready for the kiln: trim a thrown pot on the wheel, or glaze a bisque piece at a Glazing Table.',
  [GLAZING_TABLE]: 'Nothing to glaze yet: bisque-fire some trimmed pots in a kiln first.',
};
function openPottery(at) {
  potteryOpen = true;
  potteryAt = at;
  const text = POTTERY_TEXT[at.station];
  document.getElementById('pottery-name').textContent = text.name;
  document.getElementById('pottery-greeting').textContent = text.greeting;
  potteryShop.action = text.action;
  potteryKey = '';
  potteryNote = '';
  updatePottery(true);
  potteryEl.hidden = false;
  releaseMouseForMenu();
  potteryShop.focus();
}
function closePottery(resume) {
  potteryOpen = false;
  potteryEl.hidden = true;
  if (resume) resumeGame();
  else showPause(); // (Esc can't re-grab the mouse: click to resume)
}
/** Every frame while open: rebuild the list only when what it's built from changed, otherwise refresh labels. */
function updatePottery(force = false) {
  if (!potteryOpen) return;
  const st = potteryAt.station;
  const items = potteryItems();
  const key = items.map((i) => i.kind).join();
  if (force || key !== potteryKey) {
    potteryKey = key;
    potteryShop.setItems(items);
  } else potteryShop.refresh();
  const clay = CLAY_BLOCKS.map((id, c) => `${player.buildy ? '∞' : player.blocks[id] || 0} ${CLAYS[c]}`).join(' · ');
  const have = st === POTTERY_WHEEL ? `Clay: ${clay}` : st === KILN ? (player.kiln ? `🔥 ${player.kiln.text}: ${player.kiln.t} s` : 'Kiln is cold') : '';
  if (potteryHave.textContent !== have) potteryHave.textContent = have;
  const status = potteryNote || (!items.length ? POTTERY_EMPTY[st] || '' : '');
  if (potteryStatus.textContent !== status) potteryStatus.textContent = status;
  if (player.dead) closePottery(false);
}
document.getElementById('pottery-close').addEventListener('click', () => closePottery(true));
document.addEventListener('keydown', (e) => {
  if (potteryOpen && e.code === 'Escape') closePottery(false);
});

// ---------- hotbars (one per hand) ----------
// Hold Q (left hand) or E (right hand) and scroll to put the next thing on that hand's hotbar in it; tap Q/E
// for the whole inventory, and drag things from it onto either hotbar (drag a slot off the bar to clear it).
// The game keeps them with your Player (`hotbar` message).
const hotbarHold = { left: null, right: null }; // Q/E held down: { at, scrolled }
player.hotbars ??= { left: Array(8).fill(null), right: Array(8).fill(null) };
const hotbarEls = { left: document.getElementById('hotbar-left'), right: document.getElementById('hotbar-right') };
let hotbarKey = '';
function setHotbar(hand, slots) {
  player.hotbars[hand] = slots;
  conn.send({ type: 'hotbar', hand, slots });
  hotbarKey = '';
}
/** Holding Q/E and scrolling: the next (or previous) thing on that hand's hotbar that you have. */
function stepHotbar(hand, dir) {
  if (hotbarHold[hand]) hotbarHold[hand].scrolled = true;
  const slots = player.hotbars[hand];
  const usable = slots.map((k, i) => (k && itemCount(player, k) > 0 ? i : -1)).filter((i) => i >= 0);
  if (!usable.length) { popup(`Your ${hand} hotbar is empty: tap ${hand === 'left' ? 'Q' : 'E'} and drag things onto it`); return; }
  const cur = slots.indexOf(player.hands[hand]);
  const pos = usable.indexOf(cur);
  const next = usable[pos < 0 ? (dir > 0 ? 0 : usable.length - 1) : (pos + dir + usable.length) % usable.length];
  player.hold(hand, slots[next]);
  sound.play('ui');
  sendState();
  hotbarKey = '';
}
document.addEventListener('keyup', (e) => {
  const hand = e.code === 'KeyQ' ? 'left' : e.code === 'KeyE' ? 'right' : null;
  if (!hand || !hotbarHold[hand]) return;
  const { at, scrolled } = hotbarHold[hand];
  hotbarHold[hand] = null;
  if (!scrolled && performance.now() - at < 350 && player.locked && !menuOpen() && !player.dead && !phoneOut) openPicker(hand); // a tap
});
window.addEventListener('blur', () => { hotbarHold.left = hotbarHold.right = null; });
/** Redraws the hotbars when something on them changes (what's in hand, counts, the slots). */
function updateHotbars() {
  const key = JSON.stringify([player.hotbars, player.hands, ['left', 'right'].map((h) => player.hotbars[h].map((k) => (k ? Math.min(999, itemCount(player, k)) : 0))), !!hotbarHold.left, !!hotbarHold.right, player.dead]);
  if (key === hotbarKey) return;
  hotbarKey = key;
  for (const hand of ['left', 'right']) {
    const bar = hotbarEls[hand];
    bar.hidden = player.dead;
    bar.classList.toggle('scrolling', !!hotbarHold[hand]);
    bar.replaceChildren(...player.hotbars[hand].map((kind, i) => {
      const slot = el('div', 'slot');
      slot.dataset.hand = hand;
      slot.dataset.i = i;
      if (kind) {
        const n = itemCount(player, kind);
        slot.title = itemName(kind);
        slot.append(iconFor(kind));
        if (n !== Infinity && n !== 1) slot.append(el('small', '', n > 999 ? '999+' : String(n)));
        slot.classList.toggle('out', !(n > 0));
        slot.classList.toggle('held', player.hands[hand] === kind);
        slot.draggable = true;
      }
      return slot;
    }));
  }
}
// Drag and drop: from the inventory (picker) or another slot onto a slot; a slot dragged off the bars is cleared.
let dragFrom = null; // { hand, i } when dragging a slot
document.addEventListener('dragstart', (e) => {
  const slot = e.target.closest?.('.hotbar .slot');
  if (!slot) return;
  dragFrom = { hand: slot.dataset.hand, i: Number(slot.dataset.i) };
  e.dataTransfer.setData('text/x-game-kind', player.hotbars[dragFrom.hand][dragFrom.i] || '');
});
document.addEventListener('dragover', (e) => {
  const slot = e.target.closest?.('.hotbar .slot');
  if (!slot) return;
  e.preventDefault();
  for (const s of document.querySelectorAll('.hotbar .slot.drop')) s.classList.remove('drop');
  slot.classList.add('drop');
});
document.addEventListener('drop', (e) => {
  const slot = e.target.closest?.('.hotbar .slot');
  for (const s of document.querySelectorAll('.hotbar .slot.drop')) s.classList.remove('drop');
  if (!slot) return;
  e.preventDefault();
  const kind = e.dataTransfer.getData('text/x-game-kind');
  if (!kind || kind === 'empty') return;
  const hand = slot.dataset.hand;
  const i = Number(slot.dataset.i);
  const target = [...player.hotbars[hand]];
  if (dragFrom) { // moving a slot: swap with where it lands
    const from = [...player.hotbars[dragFrom.hand]];
    const there = target[i];
    if (dragFrom.hand === hand) { target[dragFrom.i] = there; target[i] = kind; setHotbar(hand, target); }
    else { from[dragFrom.i] = there; target[i] = kind; setHotbar(dragFrom.hand, from); setHotbar(hand, target); }
  } else {
    target[i] = kind;
    setHotbar(hand, target);
  }
  dragFrom = null;
  sound.play('ui');
});
document.addEventListener('dragend', (e) => {
  for (const s of document.querySelectorAll('.hotbar .slot.drop')) s.classList.remove('drop');
  if (dragFrom && e.dataTransfer.dropEffect === 'none') { // dropped off the bars: clear that slot
    const slots = [...player.hotbars[dragFrom.hand]];
    slots[dragFrom.i] = null;
    setHotbar(dragFrom.hand, slots);
  }
  dragFrom = null;
});

// ---------- cooking (cooking.js): Range, Campfire, Olive Press, and the recipe book ----------
const kitchenEl = document.getElementById('kitchen');
const kitchenStatus = document.getElementById('kitchen-status');
const kitchenBusy = document.getElementById('kitchen-busy');
let kitchenOpen = false;
let kitchenAt = null; // { x, y, z, station }
let kitchenNote = '';
const KITCHEN_TEXT = {
  range: 'Stovetop and oven. Pick a recipe: the ingredients go in now, and the dish lands in your food when it\'s done (you can walk away).',
  campfire: 'Roast raw meat and grill fish here: they heal more cooked, and won\'t upset your stomach.',
  press: 'Three olives make a bottle of olive oil.',
};
const kitchenShop = new TileShop({
  iconFor: (kind) => iconFor(kind),
  action: 'Cook',
  live: (kind) => {
    const r = RECIPES.find((x) => x.out === kind);
    const ok = canCook(player, r);
    return {
      price: `${Math.round(cookSeconds(r))} s`,
      detail: player.cooking ? `Busy: ${FOOD[player.cooking.out].name}, ${player.cooking.t} s left` : `${r.n > 1 ? `Makes ${r.n} · ` : ''}needs ${needsText(r)}`,
      owned: player.food[kind] || 0,
      canBuy: ok && !player.cooking,
      why: player.cooking ? 'Busy' : 'Missing ingredients',
    };
  },
  onBuy: (kind) => {
    if (!kitchenAt) return;
    conn.send({ type: 'cook', out: kind, x: kitchenAt.x, y: kitchenAt.y, z: kitchenAt.z });
    sound.play('ui');
  },
});
document.getElementById('kitchen-items').replaceWith(kitchenShop.el);
function openKitchen(at) {
  kitchenOpen = true;
  kitchenAt = at;
  kitchenNote = '';
  document.getElementById('kitchen-name').textContent = STATIONS[at.station].name;
  document.getElementById('kitchen-greeting').textContent = KITCHEN_TEXT[at.station];
  // Recipes you can make now first, then the rest.
  const list = RECIPES.filter((r) => r.at.includes(at.station))
    .sort((a, b) => Number(canCook(player, b)) - Number(canCook(player, a)))
    .map((r) => ({ kind: r.out, name: r.n > 1 ? `${FOOD[r.out].name} ×${r.n}` : FOOD[r.out].name, category: FOOD[r.out].cookedFrom ? 'Roast' : FOOD[r.out].ingredient ? 'Ingredient' : 'Dish', desc: needsText(r) }));
  kitchenShop.setItems(list);
  kitchenEl.hidden = false;
  releaseMouseForMenu();
  kitchenShop.focus();
}
function closeKitchen(resume) {
  kitchenOpen = false;
  kitchenEl.hidden = true;
  if (resume) resumeGame();
  else showPause();
}
function updateKitchen() {
  if (!kitchenOpen) return;
  kitchenShop.refresh();
  const busy = player.cooking ? `🍳 ${FOOD[player.cooking.out].name}: ${player.cooking.t} s` : '';
  if (kitchenBusy.textContent !== busy) kitchenBusy.textContent = busy;
  if (kitchenStatus.textContent !== kitchenNote) kitchenStatus.textContent = kitchenNote;
  if (player.dead) closeKitchen(false);
}
document.getElementById('kitchen-close').addEventListener('click', () => closeKitchen(true));
document.addEventListener('keydown', (e) => { if (kitchenOpen && e.code === 'Escape') closeKitchen(false); });

// Crafting (R; crafting.js): by hand, anywhere, instantly.
const craftingEl = document.getElementById('crafting');
const craftingStatus = document.getElementById('crafting-status');
let craftingOpen = false;
let craftingNote = '';
const craftingShop = new TileShop({
  iconFor: (id) => iconFor(craftById(id).out),
  action: 'Craft',
  live: (id) => {
    const c = craftById(id);
    const ok = canCraft(player, c);
    return { price: c.n > 1 ? `×${c.n}` : '', detail: `Needs ${craftNeedsText(c)}`, owned: itemCount(player, c.out), canBuy: ok, why: 'Missing materials' };
  },
  onBuy: (id) => { conn.send({ type: 'craft', id }); },
});
document.getElementById('crafting-items').replaceWith(craftingShop.el);
function openCrafting() {
  craftingOpen = true;
  craftingNote = '';
  craftingShop.setItems(CRAFTS.map((c) => ({ kind: c.id, name: craftName(c), category: c.group, desc: craftNeedsText(c) })));
  craftingEl.hidden = false;
  releaseMouseForMenu();
  craftingShop.focus();
}
function closeCrafting(resume) {
  craftingOpen = false;
  craftingEl.hidden = true;
  if (resume) resumeGame();
  else showPause();
}
function updateCrafting() {
  if (!craftingOpen) return;
  craftingShop.refresh();
  if (craftingStatus.textContent !== craftingNote) craftingStatus.textContent = craftingNote;
  if (player.dead) closeCrafting(false);
}
document.getElementById('crafting-close').addEventListener('click', () => closeCrafting(true));
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && !(craftingOpen && e.code === 'Escape')) return;
  if (craftingOpen && (e.code === 'Escape' || (e.code === 'KeyR' && e.target.tagName !== 'INPUT'))) { e.stopPropagation(); closeCrafting(false); return; }
  if (e.code === 'KeyR' && !e.repeat && !menuOpen() && player.locked) openCrafting();
});

// The recipe book (K, or 📖 Recipes in the main menu): every recipe, by where you make it.
const recipesEl = document.getElementById('recipes-book');
const recipesList = document.getElementById('recipes-list');
let recipesOpen = false;
let recipesFrom = 'game';
function renderRecipes() {
  const out = [];
  for (const [key, st] of Object.entries(STATIONS)) {
    out.push(el('h3', '', `${st.name}: ${st.desc}`));
    for (const r of RECIPES.filter((x) => x.at[0] === key)) {
      const row = el('div', 'recipe-row');
      const icon = iconFor(r.out);
      const text = el('div');
      const needs = el('small');
      Object.entries(r.needs).forEach(([k, n], i) => {
        if (i) needs.append(', ');
        needs.append(el('span', (player.buildy || (player.food[k] || 0) >= n) ? 'got' : '', `${n} ${FOOD[k].name}`));
      });
      needs.append(` · ${r.at.map((a) => STATIONS[a].name).join(' or ')}, ${Math.round(cookSeconds(r))} s`);
      text.append(el('b', '', `${r.n > 1 ? `${r.n} ` : ''}${FOOD[r.out].name}`), needs);
      row.append(icon, text);
      out.push(row);
    }
  }
  // Crafting (R): by hand, anywhere.
  let group = null;
  for (const c of CRAFTS) {
    if (c.group !== group) { group = c.group; out.push(el('h3', '', `Crafting (R): ${group}`)); }
    const row = el('div', 'recipe-row');
    const text = el('div');
    const needs = el('small');
    Object.entries(c.needs).forEach(([inv, list]) => Object.entries(list).forEach(([k, n]) => {
      if (needs.childNodes.length) needs.append(', ');
      const have = player.buildy || (player[inv]?.[k] || 0) >= n;
      needs.append(el('span', have ? 'got' : '', `${n} ${inv === 'blocks' ? itemName(blockKind(Number(k))) : itemName(k)}`));
    }));
    text.append(el('b', '', craftName(c)), needs);
    row.append(iconFor(c.out), text);
    out.push(row);
  }
  out.push(el('h3', '', 'Where things come from'),
    el('p', 'recipes-note', 'Wheat: cut wild wheat. Yeast and butter: the Tavern or CONSUME. Cheese: cows (and the Tavern). Bucket of Water: hold a Bucket in your left hand and right-click water. Chives, corn, jalapeños, garbanzo beans, olives, potatoes, garlic and pinto beans: grow them (seeds on CONSUME). Raw meat: cows and birds; fish: a Fishing Rod. A Sink counts as water for washing dishes.'));
  recipesList.replaceChildren(...out);
}
function setRecipes(open, from = 'game') {
  if (open === recipesOpen) return;
  recipesOpen = open;
  recipesEl.hidden = !open;
  sound.play('ui');
  if (open) {
    recipesFrom = from;
    renderRecipes();
    releaseMouseForMenu();
  } else if (recipesFrom === 'menu') openMainMenu();
  else showPause();
}
document.getElementById('recipes-close').addEventListener('click', () => setRecipes(false));
document.getElementById('open-recipes').addEventListener('click', () => { overlayEl.hidden = true; setRecipes(true, 'menu'); });
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (recipesOpen && (e.code === 'Escape' || e.code === 'KeyK')) { e.stopPropagation(); setRecipes(false); return; }
  if (e.code === 'KeyK' && !e.repeat && !menuOpen() && player.locked) setRecipes(true);
});

// ---------- cold wallet ----------
const vaultEl = document.getElementById('vault');
const vaultAmount = document.getElementById('vault-amount');
const vaultStatus = document.getElementById('vault-status');
function openVault(at) {
  vaultOpen = true;
  vaultAt = at;
  vaultEl.hidden = false;
  vaultStatus.textContent = '';
  vaultAmount.value = '';
  releaseMouseForMenu();
  updateVault();
}
function closeVault(resume) {
  vaultOpen = false;
  vaultEl.hidden = true;
  if (resume) resumeGame();
  else showPause(); // (Esc can't re-grab the mouse: click to resume)
}
function vaultMove(op, all) {
  const have = op === 'deposit' ? player.wallet.zcash : player.wallet.cold;
  const amount = all ? have : Math.round(parseFloat(vaultAmount.value) * 100) / 100;
  if (!(amount > 0)) { vaultStatus.textContent = 'Type an amount first.'; sound.play('deny'); return; }
  if (amount > have + 1e-9) { vaultStatus.textContent = `You only have ${have.toFixed(2)} ZEC ${op === 'deposit' ? 'on you' : 'stored'}.`; sound.play('deny'); return; }
  conn.send({ type: 'vault', ...vaultAt, op, amount });
  vaultAmount.value = '';
}
document.getElementById('vault-deposit').addEventListener('click', () => vaultMove('deposit', false));
document.getElementById('vault-withdraw').addEventListener('click', () => vaultMove('withdraw', false));
document.getElementById('vault-deposit-all').addEventListener('click', () => vaultMove('deposit', true));
document.getElementById('vault-withdraw-all').addEventListener('click', () => vaultMove('withdraw', true));
document.getElementById('vault-close').addEventListener('click', () => closeVault(true));
vaultAmount.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') vaultMove('deposit', false); });
document.addEventListener('keydown', (e) => { if (vaultOpen && e.code === 'Escape') closeVault(false); });
function updateVault() {
  if (!vaultOpen) return;
  const fmt = (z) => `${z.toFixed(2)} ZEC ≈ ${usd(z * rate)}`;
  const hot = document.getElementById('vault-hot');
  const cold = document.getElementById('vault-cold');
  if (hot.textContent !== fmt(player.wallet.zcash)) hot.textContent = fmt(player.wallet.zcash);
  if (cold.textContent !== fmt(player.wallet.cold || 0)) cold.textContent = fmt(player.wallet.cold || 0);
  if (player.dead) closeVault(false);
}

function updatePrinter(realDt) {
  if (printJob) printJob.t += realDt;
  if (!printerOpen) return;
  printerBalance.textContent = `${player.wallet.zcash.toFixed(2)} ZEC ≈ ${usd(player.wallet.zcash * rate)}`;
  drawRateChart();
  printerFill.style.width = `${printJob ? Math.min(1, printJob.t / printJob.seconds) * 100 : 0}%`;
  if (printJob) {
    printerStatus.textContent = `Printing ${itemName(printJob.kind)}… ${Math.min(99, Math.floor((printJob.t / printJob.seconds) * 100))}%`
      + ` · paid ${printJob.zec.toFixed(2)} ZEC at ${usd(printJob.rate)}`;
  }
  printerShop.refresh();
}

// The ZEC price over the last minute or so, with the current rate and its change.
const rateCanvas = document.getElementById('rate-chart');
const rateLabel = document.getElementById('rate-label');
function sampleRate(dt) {
  if ((rateSampleT += dt) < 1) return;
  rateSampleT = 0;
  rateHistory.push(rate);
  if (rateHistory.length > 90) rateHistory.shift();
}
function rateChange() {
  const then = rateHistory[Math.max(0, rateHistory.length - 11)]; // ~10 s ago
  return then ? (rate - then) / then : 0;
}
function drawRateChart() {
  const ctx = rateCanvas.getContext('2d');
  const { width: w, height: h } = rateCanvas;
  const pts = [...rateHistory, rate];
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  ctx.clearRect(0, 0, w, h);
  const up = pts[pts.length - 1] >= pts[0];
  ctx.strokeStyle = up ? '#4cd17a' : '#ff6b6b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((v, i) => {
    const x = (i / Math.max(1, pts.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((v - lo) / Math.max(hi - lo, 1e-6)) * (h - 6);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.stroke();
  const ch = rateChange();
  rateLabel.textContent = `1 ZEC = ${usd(rate)}  ${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(1)}%`;
  rateLabel.className = ch >= 0 ? 'up' : 'down';
}

// ---------- phone ----------
// An item you hold: click with it to open CONSUME, the shop. While it's open your mouse is on the phone, so
// you can't move or act, but the world carries on. (Chat is T; the map is Tab.)
const phoneBadge = phoneEl.querySelector('#phone-status b');
const phoneAppEl = document.getElementById('phone-app');
const phoneApps = new PhoneApps({
  appEl: phoneAppEl,
  putAway: () => closePhone(true),
  shop: consumeShop(),
});
/** CONSUME, the phone shop: everything, delivered after a while, plus a fee (both server settings). */
function consumeShop() {
  const ownedOf = (kind) => {
    const id = blockIdOf(kind);
    if (id !== null) return player.blocks[id] || 0;
    if (kind.startsWith('ammo:')) return ammoCount(player, kind.slice(5));
    return itemCount(player, kind);
  };
  const view = new TileShop({
    iconFor: (kind) => iconFor(kind.startsWith('ammo:') ? 'ammo' : kind),
    action: 'Order',
    live: (kind) => {
      const offer = shopOffer(kind);
      const price = Math.round(offer.usd * (1 + settings.deliveryFee / 100) * 100) / 100; // (no Rizz on CONSUME)
      const zec = zecFor(price, rate);
      return {
        price: usd(price),
        detail: `${offer.n > 1 ? `${offer.n} for ` : ''}${usd(price)} incl. ${settings.deliveryFee}% delivery · ${zec.toFixed(2)} ZEC now · arrives in ${settings.deliveryMinutes} min`,
        owned: ownedOf(kind),
        canBuy: player.wallet.zcash >= zec,
        why: 'Not enough ZEC',
      };
    },
    onBuy: (kind) => conn.send({ type: 'order', kind }),
  });
  const descs = { Ammo: 'A box of ammo for your guns', Food: 'Eat it when you\'re hurt', Blocks: 'Building blocks' };
  view.setItems(shopCatalog().map((i) => ({ ...i, name: i.n > 1 ? `${i.name} ×${i.n}` : i.name, desc: TOOLS[i.kind]?.desc || descs[i.category] || '' })));
  return {
    view,
    orders: () => player.orders || [],
    wallet: () => `${player.wallet.zcash.toFixed(2)} ZEC ≈ ${usd(player.wallet.zcash * rate)}`,
    get fee() { return settings.deliveryFee; },
    name: itemName,
    get minutes() { return settings.deliveryMinutes; },
  };
}
function setPhone(on) {
  if (on && !phoneOut) sound.play('phone');
  phoneOut = on;
  phoneEl.hidden = !on;
  if (on) buttons.left = buttons.right = false;
  phoneEl.classList.toggle('interactive', on);
  chatEl.classList.toggle('behind-phone', on); // (the phone pops up in the same corner; texts are on its screen)
  phoneApps.open = on;
  if (on) {
    phoneApps.render();
    releaseMouseForMenu(); // free the mouse so you can tap and type
  }
  sendState();
}
/** Put the phone away. */
function closePhone(resume) {
  if (!phoneOut) return;
  setPhone(false);
  if (resume) resumeGame();
  else showPause(); // (Esc can't re-grab the mouse: click to resume)
}
document.addEventListener('keydown', (e) => {
  if (!phoneOut || e.target.tagName === 'INPUT' || e.code !== 'Escape') return;
  e.preventDefault();
  closePhone(false); // Esc can't re-grab the mouse, so it leaves you on the pause screen
});

// ---------- hand picker (Q = left hand, E = right hand) ----------
const picker = new Picker(
  document.getElementById('picker'),
  iconFor,
  (hand, kind) => {
    player.hold(hand, kind);
    sound.play('ui');
    sendState();
    resumeGame(); // the click/Enter that picked counts as the gesture to resume
  },
  () => showPause(), // Esc: back to the game (Esc can't re-grab the mouse, so click to resume)
);
/** /give with nothing after it: every item in the game, in the same tile panel as the Q/E inventory. Picking gives you one. */
function openGivePanel() {
  const ownedOf = (kind) => (kind === 'zcash' ? Math.floor(player.wallet.zcash) : itemCount(player, kind));
  const items = allItems().map((i) => ({ kind: i.kind, word: i.word, name: i.name, count: ownedOf(i.kind),
    category: i.kind.startsWith('block:') ? (isCrop(blockIdOf(i.kind)) ? 'Seeds' : 'Block') : i.kind.startsWith('ammo:') ? 'Ammo' : i.kind.startsWith('scroll:') ? 'Scroll'
      : TOOLS[i.kind] ? (TOOLS[i.kind].gun ? 'Weapon' : TOOLS[i.kind].armor ? 'Armor' : TOOLS[i.kind].magic ? 'Magic' : 'Tool') : FOOD[i.kind] ? 'Food' : i.kind === 'zcash' ? 'Money' : 'Dish',
    desc: `Click or Enter gives you ${giveDefault(i.kind) > 1 ? giveDefault(i.kind) : 'one'} · or type /give ${i.word} <count>` }));
  sound.play('ui');
  picker.open('right', items, null, {
    title: 'Give yourself anything', key: '/give', placeholder: 'Search every item…', stay: true,
    hint: 'Type to search · Tab completes · arrows move · click or Enter gives you one (ammo comes by the box, blocks by 64) · Esc closes',
    onPick: (hand, kind) => {
      const item = items.find((i) => i.kind === kind);
      conn.send({ type: 'command', text: `/give ${item.word}` });
      sound.play('pickup');
    },
    onCancel: () => showPause(),
  });
  releaseMouseForMenu();
}
function openPicker(hand) {
  sound.play('ui');
  player.validateHands();
  picker.open(hand, inventoryList(player, hand), player.hands[hand]);
  releaseMouseForMenu();
}

document.addEventListener('pointerlockerror', () => { if (!menuOpen()) showPause(); }); // the browser refused (e.g. Esc closed a menu): click to resume
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked && menuOpen()) {
    document.exitPointerLock(); // something grabbed the mouse while a menu is open: give it back
    return;
  }
  player.locked = locked;
  if (locked) { // in the game
    if (!played) document.getElementById('play').textContent = 'Resume';
    played = true;
    overlayEl.hidden = true;
    resumeEl.hidden = true;
  } else if (!menuOpen()) openMainMenu(); // Esc in the game: the main menu
  if (!player.locked) {
    player.keys.clear();
    conn.save?.();
  }
});
document.addEventListener('keydown', (e) => {
  if (!player.locked || menuOpen()) return;
  if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat && !player.dead && !phoneOut) {
    e.preventDefault(); // don't type the q/e into the search box
    hotbarHold[e.code === 'KeyQ' ? 'left' : 'right'] = { at: performance.now(), scrolled: false }; // a tap opens the inventory (on keyup); held, the wheel picks from the hotbar
    return;
  }
  if (e.code === 'F3') {
    e.preventDefault();
    setPref('info', !showInfo);
  }
  if (e.code === 'KeyP' && !e.repeat) { // the camera: first person, behind you, facing you
    viewMode = (viewMode + 1) % VIEWS.length;
    popup(`Camera: ${VIEWS[viewMode]} (P)`);
  }
  if (e.code === 'KeyM' && !e.repeat) {
    popup(sound.toggleMute() ? 'Sound off (M)' : 'Sound on (M)');
    document.getElementById('muted').checked = sound.muted;
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- character sheet (I) ----------
const sheetEl = document.getElementById('sheet');
const TRAIT_EFFECTS = {
  gluten: 'Bread gives you a throbbing headache instead of healing.',
  lactose: 'Milk and cheese hurt, slow you down, and… you know.',
  fallHealing: 'Big falls heal you (1 health per block past the first 3) instead of hurting. Nobody knows why.',
  lowGravity: 'You feel half as much gravity: you jump about twice as high, fall slower, and never take fall damage.',
};
let sheetT = 0;
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function renderSheet() {
  const card = sheetEl.querySelector('.sheet-card');
  const head = el('header');
  head.append(el('h2', '', identity.name), el('span', 'sheet-level', `Level ${player.level} ${skillTitle(player.skills)}`));
  const total = totalPoints(player.skills);
  const vitals = el('div', 'sheet-vitals');
  vitals.append(
    el('div', '', `❤ Health ${player.hp} / ${player.maxHp}`),
    el('div', '', `✦ Skill points ${total} (level ${player.level + 1} at ${pointsFor(player.level + 1)})`),
    el('div', '', `🍽 Dishes washed ${player.cleaned}`),
  );
  // Skills: only the ones you've used, best first. Your best one is your title.
  const skillsEl = el('div', 'sheet-skills');
  const used = Object.entries(player.skills || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!used.length) skillsEl.append(el('div', 'skill-none', 'None yet. Kill monsters with a weapon, break blocks with the right tool, garden, or wash dishes, and that skill shows up here.'));
  for (const [kind, n] of used) {
    const row = el('div', 'skill');
    const bar = el('div', 'stat-bar');
    const fill = el('div');
    fill.style.width = `${Math.max(3, (n / used[0][1]) * 100)}%`;
    bar.append(fill);
    row.append(el('b', '', skillName(kind)), el('span', 'skill-points', String(n)), bar);
    skillsEl.append(row);
  }
  const stats = el('div', 'sheet-stats');
  const spare = player.statPoints || 0;
  if (spare > 0) stats.append(el('div', 'stat-spare', `✚ ${spare} attribute point${spare === 1 ? '' : 's'} to spend: click + next to a stat (they stay with you every life)`));
  for (const [k, def] of Object.entries(STATS)) {
    const v = player.stats[k] ?? 10;
    const added = player.statBonus?.[k] || 0;
    const row = el('div', 'stat');
    const name = el('div', 'stat-name');
    name.append(el('b', '', def.name), el('small', '', def.abbr));
    const value = el('div', 'stat-value', String(v));
    if (added) value.title = `Rolled ${v - added}, +${added} from attribute points`;
    const plus = el('div', 'stat-plus');
    if (spare > 0) { // (pointerdown on the card, below: this redraws a few times a second)
      const b = el('button', '', '+');
      b.dataset.stat = k;
      b.title = `Add a point to ${def.name}`;
      plus.append(b);
    } else if (added) plus.append(el('small', '', `+${added}`));
    const bar = el('div', 'stat-bar');
    const fill = el('div');
    fill.style.width = `${Math.min(100, ((v - 3) / 15) * 100)}%`;
    bar.append(fill);
    const fx = effectText(k, player.stats);
    const about = el('div', 'stat-about');
    about.append(el('span', `verdict v${verdict(v).toLowerCase()}`, verdict(v)), ` ${def.desc}`);
    about.append(el('small', '', fx));
    row.append(name, value, plus, bar, about);
    stats.append(row);
  }
  const traits = el('div', 'sheet-traits');
  const mine = Object.entries(TRAITS).filter(([k]) => player.traits[k]);
  if (!mine.length) traits.append(el('div', '', 'Nothing unusual. Eat anything!'));
  for (const [k, t] of mine) {
    const row = el('div', 'trait');
    row.append(el('b', '', `${t.icon} ${t.name}`), el('small', '', TRAIT_EFFECTS[k]));
    traits.append(row);
  }
  const conds = el('div', 'sheet-conditions');
  if (player.effects.headache > 0) conds.append(el('div', '', `🤕 Headache: ${player.effects.headache}s left`));
  if (player.effects.flap > 0) conds.append(el('div', '', `🐦 Flappy: ${player.effects.flap}s left (tap Space in mid-air)`));
  if (player.effects.upset > 0) conds.append(el('div', '', `💩 Upset stomach: ${player.effects.upset}s left (half speed)`));
  if (player.worn && TOOLS[player.worn]) conds.append(el('div', '', `🛡 Wearing ${TOOLS[player.worn].name}: hits hurt ${Math.round(TOOLS[player.worn].armor)}% less${TOOLS[player.worn].speed < 100 ? `, ${100 - TOOLS[player.worn].speed}% slower` : ''} (U takes it off)`));
  if (!conds.childElementCount) conds.append(el('div', '', 'Feeling fine.'));
  const next = document.createElement('div');
  next.append(head, vitals, el('h3', '', 'Stats'), stats, el('h3', '', 'Traits'), traits,
    el('h3', '', 'Conditions'), conds, el('h3', '', 'Skills'), skillsEl, el('p', 'sheet-foot', 'Your stats and traits belong to this character; level-ups give attribute points · drag on the right to turn around · I or Esc to close'));
  // Only touch the page when something changed (it's redrawn a few times a second for the timers).
  if (next.innerHTML !== card.innerHTML) card.replaceChildren(...next.childNodes);
}
// The + buttons: on pointerdown, so a redraw between press and release can't swallow the click.
sheetEl.querySelector('.sheet-card').addEventListener('pointerdown', (e) => {
  const key = e.target.closest?.('button[data-stat]')?.dataset.stat;
  if (!key || !(player.statPoints > 0)) return;
  e.preventDefault();
  conn.send({ type: 'stat', key });
  sound.play('ui');
});
function updateSheet(dt) {
  if (sheetEl.hidden || (sheetT -= dt) > 0) return;
  sheetT = 0.25;
  renderSheet();
}
document.addEventListener('keydown', (e) => { // U: take off your armor
  if (e.code !== 'KeyU' || e.repeat || e.target.tagName === 'INPUT' || menuOpen() || !player.locked || !player.worn) return;
  conn.send({ type: 'wear', kind: 'none' });
});
// I: the character sheet, a menu on the left; the game turns to show you from the front on the right
// (`sheetOpen` in placeViewCamera). Drag on the right to turn the camera around you.
let sheetOpen = false;
let sheetOrbit = 0; // radians the camera has been dragged around you
function setSheet(open, resume = true) {
  if (open === sheetOpen) return;
  sheetOpen = open;
  sheetEl.hidden = !open;
  document.body.classList.toggle('sheet-open', open);
  sound.play('ui');
  if (open) {
    mapEl.hidden = true;
    sheetT = 0;
    sheetOrbit = 0;
    renderSheet();
    releaseMouseForMenu();
  } else if (resume) resumeGame();
}
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyI' || e.repeat || e.target.tagName === 'INPUT') return;
  if (sheetOpen) { setSheet(false); return; } // (a key press: allowed to grab the mouse again)
  if (menuOpen()) return;
  setSheet(true);
});
sheetEl.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) setSheet(false); });
document.addEventListener('mousemove', (e) => { // drag on the right half to look at yourself from another side
  if (sheetOpen && e.buttons && e.target === canvas) sheetOrbit += e.movementX * 0.01;
});

// ---------- bestiary (J) ----------
const bestiaryEl = document.getElementById('bestiary');
let bestiaryPictures = null;
/** A picture of each mob, rendered once from its real model (off screen, into a small render target). */
function renderBestiaryPictures() {
  const size = 128;
  const target = new THREE.WebGLRenderTarget(size, size);
  const shot = new THREE.Scene();
  shot.background = new THREE.Color(0xe9dcb8);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const pixels = new Uint8Array(size * size * 4);
  const pictures = {};
  for (const { type } of BESTIARY) {
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    const model = buildMobModel(type, material);
    if (type === 'seedoil') model.body?.scale.setScalar(1);
    model.root.rotation.y = 2.5; // three-quarter view
    if (model.wings) { model.wings[0].rotation.z = 0.5; model.wings[1].rotation.z = -0.5; } // wings up, mid-flap
    shot.add(model.root);
    const box = new THREE.Box3().setFromObject(model.root);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    cam.position.set(centre.x, centre.y + radius * 0.35, centre.z + (radius / Math.tan((15 * Math.PI) / 180)) * 1.05);
    cam.lookAt(centre);
    renderer.setRenderTarget(target);
    renderer.render(shot, cam);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    renderer.setRenderTarget(null);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4); // flip
    ctx.putImageData(img, 0, 0);
    pictures[type] = canvas.toDataURL();
    shot.remove(model.root);
    material.dispose();
  }
  target.dispose();
  return pictures;
}
function renderBestiary() {
  try {
    bestiaryPictures ??= renderBestiaryPictures();
  } catch {
    bestiaryPictures = {}; // no pictures, but the text is still worth reading
  }
  const list = bestiaryEl.querySelector('.bestiary-list');
  list.replaceChildren(...BESTIARY.map((b) => {
    const row = document.createElement('div');
    row.className = 'beast';
    const pic = bestiaryPictures[b.type] ? Object.assign(document.createElement('img'), { src: bestiaryPictures[b.type], alt: b.name }) : document.createElement('div');
    if (!bestiaryPictures[b.type]) pic.className = 'noimg';
    const text = document.createElement('div');
    const h = document.createElement('h4');
    const tag = document.createElement('span');
    tag.className = `tag ${b.group}`;
    tag.textContent = b.group;
    h.append(b.name, tag);
    const desc = document.createElement('p');
    desc.textContent = b.desc;
    const facts = document.createElement('small');
    facts.textContent = `${b.when} · ${bestiaryFacts(b.type)}`;
    const drops = document.createElement('small');
    drops.textContent = `Drops: ${b.drops}`;
    text.append(h, desc, facts, drops);
    row.append(pic, text);
    return row;
  }));
}
function setBestiary(open) {
  if (open === bestiaryOpen) return;
  bestiaryOpen = open;
  bestiaryEl.hidden = !open;
  if (open) {
    renderBestiary();
    mapEl.hidden = true;
    sheetEl.hidden = true;
    releaseMouseForMenu();
  } else {
    resumeGame();
  }
  sound.play('ui');
}
document.getElementById('bestiary-close').addEventListener('click', () => setBestiary(false));
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.repeat) return;
  if (e.code === 'KeyJ' && (bestiaryOpen || !menuOpen())) setBestiary(!bestiaryOpen);
  else if (e.code === 'Escape' && bestiaryOpen) setBestiary(false);
});

// ---------- map (Tab) ----------
const mapEl = document.getElementById('map');
const mapView = new MapView(document.getElementById('map-canvas'), world);
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Tab' || e.target.tagName === 'INPUT') return;
  e.preventDefault(); // Tab would otherwise move focus around the page
  if (menuOpen()) return;
  mapEl.hidden = !mapEl.hidden;
  if (!mapEl.hidden) sheetEl.hidden = true;
  sound.play('ui');
});
/** What the maps show: you (with your bed) and everyone else's phone. */
function mapArgs() {
  return [
    { x: player.pos.x, z: player.pos.z, yaw: player.yaw, bed: player.bed, quests: questMapMarks() },
    [...remote.players.values()].filter((p) => !p.invisible).map((p) => ({ id: p.id, name: p.name, x: p.pos.x, z: p.pos.z })), // (invisible players stay off the map)
  ];
}
function drawMap() {
  if (mapEl.hidden) return;
  mapView.draw(...mapArgs());
}

let target = null; // block under the crosshair
let targetEnt = null; // mob or player under the crosshair: { kind: 'mob' | 'player', id, ent, t }
const BUTTON_HAND = { 0: 'left', 2: 'right' };
let mineKey = '';
let mineProgress = 0;
const gunCooldown = { left: 0, right: 0 };
let emptyT = 0;
let chipT = 0;
let bubbleT = 0;
let attackCooldown = 0;

document.addEventListener('mouseup', (e) => {
  const hand = BUTTON_HAND[e.button];
  if (!hand) return;
  buttons[hand] = false;
  if (grappleHand === hand) letGoOfGrapple(); // let go of the button, let go of the rope
});
let grappleHand = null;
function letGoOfGrapple() {
  player.grapple = null;
  grappleHand = null;
}
document.addEventListener('mousedown', (e) => {
  if (!player.locked || menuOpen() || player.dead || phoneOut) return;
  if (e.button === 1) {
    // Middle click: put the block you're looking at in your right hand.
    if (target && BLOCKS[target.id]) {
      player.hold('right', blockKind(target.id));
      sendState();
    }
    return;
  }
  const hand = BUTTON_HAND[e.button];
  if (!hand) return;
  buttons[hand] = true;
  useHand(hand);
});

function swing(hand) {
  handViews[hand].swingT = 0.3;
  mySwings[hand]++;
}

/** Mobs and other players a ray hits first: { kind, id, ent, t } or null. */
function raycastEntities(o, d, max) {
  let best = null;
  const test = (kind, id, ent, body) => {
    const t = body.rayHit(o, d, max);
    if (t !== null && (!best || t < best.t)) best = { kind, id, ent, t };
  };
  for (const m of remote.mobs.values()) test('mob', m.id, m, m);
  for (const p of remote.players.values()) if (!p.dead) test('player', p.id, p, p.body);
  for (const n of remote.npcs.values()) test('npc', n.id, n, n.body);
  return best;
}

/**
 * Right-click on an interactive block (door, trapdoor, bed, Cold Wallet, 3D Printer) uses the block,
 * whatever is in your right hand, and doesn't use the item. Returns true if it did. (Break these
 * blocks with the left hand.)
 */
function interact(hand) {
  if (targetEnt?.kind === 'mob' && targetEnt.ent?.type === 'cow' && player.hands.left === 'bucket') { // milk it (game.js `_milk`)
    buttons[hand] = false;
    conn.send({ type: 'milk', mob: targetEnt.id });
    swing('left');
    return true;
  }
  if (target && isTrapdoor(target.id) && !targetEnt) {
    buttons[hand] = false; // it opens or closes
    recentEdits.set(`${target.x},${target.y},${target.z}`, performance.now());
    world.setBlock(target.x, target.y, target.z, TRAPDOOR + ((target.id - TRAPDOOR) ^ 1)); // show it now; the game confirms
    conn.send({ type: 'use', x: target.x, y: target.y, z: target.z });
    sound.play('door', { pos: centre(target.x, target.y, target.z), p: 1.3 });
    swing(hand);
    return true;
  }
  if (target && isDoor(target.id) && !targetEnt) {
    buttons[hand] = false; // it opens or closes
    const { facing, open, top } = doorInfo(target.id);
    const otherY = top ? target.y - 1 : target.y + 1;
    recentEdits.set(`${target.x},${target.y},${target.z}`, performance.now());
    world.setBlock(target.x, target.y, target.z, doorId(facing, !open, top)); // show it now; the game confirms
    if (isDoor(world.getBlock(target.x, otherY, target.z))) {
      recentEdits.set(`${target.x},${otherY},${target.z}`, performance.now());
      world.setBlock(target.x, otherY, target.z, doorId(facing, !open, !top));
    }
    conn.send({ type: 'use', x: target.x, y: target.y, z: target.z });
    sound.play('door', { pos: centre(target.x, target.y, target.z) });
    swing(hand);
    return true;
  }
  if (target && isBed(target.id) && !targetEnt) {
    buttons[hand] = false; // it becomes your spawn point
    conn.send({ type: 'bed', x: target.x, y: target.y, z: target.z });
    swing(hand);
    return true;
  }
  if (target && target.id === COLD_WALLET && !targetEnt) {
    buttons[hand] = false;
    openVault({ x: target.x, y: target.y, z: target.z });
    return true;
  }
  if (target && isLuminary(target.id) && !targetEnt) { // light it, or put it out
    buttons[hand] = false;
    recentEdits.set(`${target.x},${target.y},${target.z}`, performance.now());
    world.setBlock(target.x, target.y, target.z, toggledLuminary(target.id)); // show it now; the game confirms
    conn.send({ type: 'use', x: target.x, y: target.y, z: target.z });
    sound.play('fizzle', { pos: centre(target.x, target.y, target.z), volume: 0.4 });
    swing(hand);
    return true;
  }
  if (target && stationOf(target.id) && !targetEnt) { // a range, campfire or olive press (cooking.js)
    buttons[hand] = false;
    openKitchen({ x: target.x, y: target.y, z: target.z, station: stationOf(target.id) });
    return true;
  }
  if (player.hands.left === 'bucket' && findWater(world, camera.position, dir, settings.waterReach)) { // fill the bucket
    buttons[hand] = false;
    conn.send({ type: 'fill', o: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, d: { x: dir.x, y: dir.y, z: dir.z } });
    sound.play('splash', { volume: 0.4 });
    swing('left');
    return true;
  }
  if (target && (target.id === POTTERY_WHEEL || target.id === KILN || target.id === GLAZING_TABLE) && !targetEnt) {
    buttons[hand] = false;
    openPottery({ x: target.x, y: target.y, z: target.z, station: target.id });
    return true;
  }
  if (target && target.id === PRINTER && !targetEnt) {
    buttons[hand] = false;
    openPrinter();
    return true;
  }
  if (target && isShopCounter(target.id) && !targetEnt) {
    buttons[hand] = false;
    openShop({ x: target.x, y: target.y, z: target.z, shop: shopOfBlock(target.id) });
    return true;
  }
  return false;
}

/**
 * The right button aims down sights instead of using the right hand: with a two-handed gun, or a
 * one-handed gun in the left hand while the right hand is empty. Anything in the right hand: no aiming.
 */
const canAim = () => isGun(player.hands.left) && (isTwoHanded(player.hands.left) || player.hands.right === 'empty');

// ---------- magic (spells.js) ----------
// The scroll wheel picks a spell; clicking with an empty hand, a Wand or a Staff casts it.
let spellIndex = 0; // into spellList() (0 = no spell: empty hands punch and mine)
/** The spells you can pick with the wheel: the ones you know (Buildy Bois know them all), after 'none'. */
const spellList = () => ['none', ...SPELL_ORDER.filter((k) => k !== 'none' && (player.buildy || player.spells?.includes(k)))];
/** The spell you've picked ('none' for no spell). */
const currentSpell = () => spellList()[spellIndex] ?? 'none';
let babyCoughT = 0;
const castReadyAt = {}; // spell -> performance.now() when it's off cooldown (the game checks too)
document.addEventListener('wheel', (e) => {
  if (!player.locked || menuOpen() || player.dead || !e.deltaY) return;
  const held = hotbarHold.left ? 'left' : hotbarHold.right ? 'right' : null;
  if (held) { stepHotbar(held, e.deltaY > 0 ? 1 : -1); return; } // holding Q or E: that hand's hotbar
  const list = spellList();
  if (list.length < 2) { popup('You don\'t know any spells yet: buy scrolls from the Wizard in the Fantasy Town and read them'); return; }
  spellIndex = (spellIndex + (e.deltaY > 0 ? 1 : -1) + list.length) % list.length;
  sound.play('ui');
  updateSpellHud(true);
}, { passive: true });
function castSpell(hand, spell, scroll = false) {
  buttons[hand] = false; // one cast per click (and no mining with this hand)
  const s = SPELLS[spell];
  if (player.effects.polymorph > 0) return;
  if ((castReadyAt[spell] || 0) > performance.now()) return;
  const cost = scroll ? 0 : spellCost(spell, settings); // a scroll is free (the game uses it up)
  if ((player.mana ?? 0) < cost) {
    popup(`Not enough mana for ${s.name} (${cost})`);
    sound.play('deny');
    return;
  }
  castReadyAt[spell] = performance.now() + spellCooldown(spell, settings) * 1000;
  player.mana -= cost; // shown right away; the game's number follows in 'you'
  const o = camera.position.clone().addScaledVector(dir, 0.6);
  conn.send({ type: 'cast', hand, spell, o: { x: o.x, y: o.y, z: o.z }, d: { x: dir.x, y: dir.y, z: dir.z } });
  swing(isTwoHanded(player.hands[hand]) ? 'right' : hand);
}
// The spell bar: your spell, your mana, and what spells are doing to you.
const spellEl = document.getElementById('spell');
let spellFlashT = 0;
function updateSpellHud(changed = false) {
  if (changed) spellFlashT = 1.2;
  if (spellIndex >= spellList().length) spellIndex = 0; // (a spell you no longer know)
  const key = currentSpell();
  const s = SPELLS[key];
  const max = player.maxMana || 50;
  const mana = Math.max(0, Math.floor(player.mana ?? max));
  const fx = [['stoneskin', '🪨 Stoneskin'], ['invisible', '👻 Invisible'], ['shrink', '🔻 Shrunk'], ['enlarge', '🔺 Huge'], ['hallucinate', '🌀 Seeing things'], ['chill', '🧊 Chilled'], ['polymorph', '👶 A baby']]
    .filter(([k]) => player.effects[k] > 0).map(([k, n]) => `${n} ${player.effects[k]}s`).join(' · ');
  const html = `${s ? `<b>${s.icon} ${s.name}</b> <span>${spellCost(key, settings)} mana</span>` : (spellList().length < 2 ? '<b>✊ No spells yet</b> <span>buy scrolls from the town Wizard</span>' : '<b>✊ No spell</b> <span>hands punch and mine</span>')}`
    + `<div class="mana"><div style="width:${Math.min(100, (mana / max) * 100)}%"></div><em>${mana} / ${max}</em></div>`
    + (fx ? `<small>${fx}</small>` : '') + (spellFlashT > 0 ? '<small class="hint">Scroll to change spell</small>' : '');
  if (spellEl.innerHTML !== html) spellEl.innerHTML = html;
  spellEl.hidden = player.dead;
}

/** One click with a hand. Held-button effects (mining, wand, washing, guns, aiming) run in the frame loop. */
function useHand(hand) {
  const kind = player.hands[hand];
  if (targetEnt?.kind === 'npc') { // townsfolk: either button talks to them
    buttons[hand] = false;
    conn.send({ type: 'talk', id: targetEnt.id });
    return;
  }
  if (hand === 'right' && interact(hand)) return;
  if (hand === 'right' && GUNS[player.hands.right]?.scope) { // a scope: each right-click zooms further, then puts it away
    buttons.right = false;
    scopeLevel = (scopeLevel + 1) % 4;
    sound.play('empty');
    return;
  }
  if (hand === 'right' && canAim()) return; // aiming down sights (in the frame loop)
  if (isFocus(kind) && currentSpell() !== 'none') { castSpell(hand, currentSpell()); return; }
  if (TOOLS[kind]?.magic || kind in DISHES) return;
  if (scrollOf(kind)) { castSpell(hand, scrollOf(kind), true); return; }
  if (isArmor(kind)) {
    buttons[hand] = false;
    conn.send({ type: 'wear', hand, kind });
    swing(hand);
    return;
  }
  if (kind === 'phone') {
    buttons[hand] = false;
    setPhone(true);
    return;
  }
  if (isGun(kind)) return; // fired from the frame loop while the button is held
  if (kind === 'rod') { // cast, or reel in (fishing.js; the game decides which)
    buttons[hand] = false;
    conn.send({ type: 'fish', hand, o: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, d: { x: dir.x, y: dir.y, z: dir.z } });
    sound.play('swing', { p: 0.8 });
    swing(hand);
    return;
  }
  if (kind === 'grapple') {
    const hit = world.raycast(camera.position, dir, GRAPPLE.range);
    if (hit) {
      const t = hit.t;
      player.grapple = { x: camera.position.x + dir.x * t, y: camera.position.y + dir.y * t, z: camera.position.z + dir.z * t };
      grappleHand = hand;
      sound.play('grapple');
      swing(hand);
    } else {
      sound.play('empty');
    }
    return;
  }
  const id = blockIdOf(kind);
  if (id !== null) {
    if (!target || targetEnt) return;
    if (isCrop(id) && !(isSoil(target.id) && target.normal[1] === 1)) { // seeds go on top of tilled dirt
      popup(isSoil(target.id) ? 'Plant seeds on top of the tilled dirt' : 'Seeds only grow in tilled dirt: till some with a Tiller first', 'deny');
      sound.play('deny');
      return;
    }
    const [nx, ny, nz] = target.id === SNOW_LAYER ? [0, 0, 0] : target.normal; // clicking snow builds where the snow is
    const x = target.x + nx;
    const y = target.y + ny;
    const z = target.z + nz;
    const free = (bx, by, bz) => {
      const existing = world.getBlock(bx, by, bz);
      const blocked = player.intersectsBlock(bx, by, bz)
        || [...remote.mobs.values()].some((m) => m.intersectsBlock(bx, by, bz))
        || [...remote.players.values()].some((p) => !p.dead && p.body.intersectsBlock(bx, by, bz));
      return (existing === AIR || FLUID[existing] || existing === SNOW_LAYER) && !blocked; // (snow gets built over)
    };
    let placed = orientedId(id, facingOf(player.yaw)); // stairs climb, and doors face, away from you
    if (id === LADDER) { // ladders hang on the side of the block you clicked
      if (ny !== 0) { popup('Ladders go on the side of a block'); sound.play('deny'); return; }
      placed = LADDER + (nz === 1 ? 0 : nx === -1 ? 1 : nz === -1 ? 2 : 3);
    }
    const headAt = id === BED ? bedOther(BED_FOOT + facingOf(player.yaw), x, z) : null; // beds are two long, head away from you
    if (free(x, y, z) && (id !== DOOR || free(x, y + 1, z)) && (!headAt || free(headAt[0], y, headAt[1]))) {
      recentEdits.set(`${x},${y},${z}`, performance.now());
      sound.play('place', { pos: centre(x, y, z), material: blockMaterial(id) });
      world.setBlock(x, y, z, headAt ? BED_FOOT + facingOf(player.yaw) : placed); // show it now; the game confirms or corrects
      if (headAt) {
        recentEdits.set(`${headAt[0]},${y},${headAt[1]}`, performance.now());
        world.setBlock(headAt[0], y, headAt[1], placed);
      }
      if (!player.buildy) player.blocks[id]--; // (the game's count follows in 'you')
      if (id === DOOR) {
        recentEdits.set(`${x},${y + 1},${z}`, performance.now());
        world.setBlock(x, y + 1, z, doorId(facingOf(player.yaw), false, true));
      }
      conn.send({ type: 'place', x, y, z, id: placed });
      swing(hand);
    }
    return;
  }
  if (kind in FOOD) {
    conn.send({ type: 'eat', hand });
    swing(hand);
    return;
  }
  if (kind === 'hackysack') {
    if (itemCount(player, 'hackysack') > 0) {
      const o = camera.position.clone().addScaledVector(dir, 0.5);
      conn.send({ type: 'throw', hand, o: { x: o.x, y: o.y, z: o.z }, d: { x: dir.x, y: dir.y, z: dir.z } });
      swing(hand);
      sound.play('throw');
    }
    return;
  }
  // Garden tools: till, water or weed the block you're aiming at (the game does it for everyone).
  if (kind in GARDEN_TOOLS) {
    buttons[hand] = false;
    swing(hand);
    if (!target || targetEnt) { sound.play('swing'); return; }
    conn.send({ type: 'garden', hand, x: target.x, y: target.y, z: target.z, facing: facingOf(player.yaw) });
    return;
  }
  // Two-handed blades: the left button slashes sideways through everything in front of you, the right
  // button chops down on one target (items.js meleeStyle). Holding either on a block still mines it.
  const style = meleeStyle(kind, hand);
  if (style) {
    swing(hand);
    if (attackCooldown > 0) return;
    if (style === 'sweep') {
      attackCooldown = ATTACK_COOLDOWN;
      sound.play('swing', { p: 0.8 });
      conn.send({ type: 'attack', hand, o: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, d: { x: dir.x, y: dir.y, z: dir.z } });
    } else if (targetEnt) {
      attackCooldown = ATTACK_COOLDOWN * settings.chopCooldown;
      sound.play('swing', { p: 0.65 });
      conn.send({ type: 'attack', hand, [targetEnt.kind]: targetEnt.id });
    } else sound.play('swing', { p: 0.65 });
    return;
  }
  // Empty hand or a tool: every click swings; it hits a mob or player in reach; holding the button on a
  // block mines it (frame loop).
  swing(hand);
  if (targetEnt && attackCooldown <= 0) {
    attackCooldown = ATTACK_COOLDOWN;
    sound.play('swing');
    conn.send({ type: 'attack', hand, [targetEnt.kind]: targetEnt.id });
  } else if (!target) sound.play('swing', { volume: 0.6 }); // (a swing at thin air)
}

// Keep the render size in step with the canvas's on-screen size. A ResizeObserver catches every change
// (window resize, zoom, fullscreen, moving to a monitor with different scaling), not just 'resize' events.
// Warning on the start/pause screen when the browser's WebGL limits force a lower render resolution.
// In Firefox-based browsers (LibreWolf, Mullvad, Tor, Firefox with resistFingerprinting) this is
// usually fingerprinting protection, which can be relaxed for this site alone.
const gfxWarning = document.getElementById('gfx-warning');
let gfxWarningShown = '';
function updateGraphicsWarning(limited, wantedWidth, actualWidth) {
  const key = limited ? `${wantedWidth}:${actualWidth}` : '';
  if (key === gfxWarningShown) return;
  gfxWarningShown = key;
  gfxWarning.hidden = !limited;
  if (!limited) return;
  gfxWarning.querySelector('[data-limit]').textContent = `${glLimits.w}×${glLimits.h}`;
  gfxWarning.querySelector('[data-actual]').textContent = actualWidth;
  gfxWarning.querySelector('[data-wanted]').textContent = wantedWidth;
  gfxWarning.querySelector('[data-host]').textContent = location.hostname || 'localhost';
  const firefox = /Firefox\//.test(navigator.userAgent);
  gfxWarning.querySelector('[data-firefox]').hidden = !firefox;
  gfxWarning.querySelector('[data-other]').hidden = firefox;
}
for (const el of document.querySelectorAll('#gfx-warning code[data-copy]')) {
  el.title = 'Click to copy';
  el.addEventListener('click', () => {
    navigator.clipboard?.writeText(el.textContent).then(() => {
      el.dataset.copied = '1';
      setTimeout(() => delete el.dataset.copied, 1200);
    }, () => {});
  });
}

// The largest viewport/framebuffer this GPU + browser allows. WebGL silently clamps anything bigger,
// which drew the scene into only part of the canvas (e.g. 4096 of 5120 pixels on a 2x display in
// LibreWolf/Firefox, leaving the right fifth sky-coloured).
const glLimits = (() => {
  const gl = renderer.getContext();
  const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const rb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  return { w: Math.min(vp[0], rb), h: Math.min(vp[1], rb) };
})();

function fitRenderer() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const wanted = Math.min(window.devicePixelRatio, 2) * prefs.resScale; // (Settings: Graphics)
  let ratio = Math.min(wanted, glLimits.w / w, glLimits.h / h);
  updateGraphicsWarning(ratio < wanted * 0.99, Math.round(w * wanted), Math.round(w * ratio));
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  // Some GPUs/browsers silently give WebGL a smaller drawing buffer than the canvas asked for.
  // Three.js would then draw into only part of it (leaving a sky-coloured band), so lower the
  // render resolution until the buffer we get is the buffer we asked for.
  const gl = renderer.getContext();
  for (let i = 0; i < 4 && (gl.drawingBufferWidth < canvas.width || gl.drawingBufferHeight < canvas.height); i++) {
    ratio *= Math.min(gl.drawingBufferWidth / canvas.width, gl.drawingBufferHeight / canvas.height);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(fitRenderer).observe(canvas);
window.addEventListener('resize', fitRenderer);
fitRenderer();

document.getElementById('fullscreen').addEventListener('click', async () => {
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // Fullscreen refused (e.g. inside an iframe): just play in the window.
  }
  if (!conn.closed) canvas.requestPointerLock();
});
window.addEventListener('beforeunload', () => {
  sendState();
  conn.save?.();
});

// Handy in the browser console. In single player, game.game is the whole game.
// Clicking outside a pop-up closes it (and the click puts you back in the game): the Q/E picker, the
// printer, shops, pottery, the kitchen, the Cold Wallet, the recipe book, the bestiary, Settings and the
// phone. (Not the character sheet: dragging beside it turns the camera. Not the console: it keeps the mouse.)
const POPUPS = [
  [() => picker.isOpen, () => picker.root, () => picker.cancel()],
  [() => printerOpen, () => printerEl.querySelector('.card'), () => closePrinter(true)],
  [() => shopOpen, () => shopEl.querySelector('.card'), () => closeShop(true)],
  [() => npcOpen, () => npcEl.querySelector('.card'), () => closeNpc(true)],
  [() => questsOpen, () => questsEl.querySelector('.card'), () => setQuests(false, true)],
  [() => potteryOpen, () => potteryEl.querySelector('.card'), () => closePottery(true)],
  [() => kitchenOpen, () => kitchenEl.querySelector('.card'), () => closeKitchen(true)],
  [() => craftingOpen, () => craftingEl.querySelector('.card'), () => closeCrafting(true)],
  [() => vaultOpen, () => vaultEl.querySelector('.card'), () => closeVault(true)],
  [() => recipesOpen, () => recipesEl.querySelector('.card'), () => { setRecipes(false); if (recipesFrom !== 'menu') resumeGame(); }],
  [() => bestiaryOpen, () => bestiaryEl.querySelector('.bestiary-card'), () => setBestiary(false)],
  [() => clientOpen, () => clientEl.querySelector('.card'), () => { closeClient(clientFrom !== 'menu'); if (clientFrom === 'menu') openMainMenu(); }],
  [() => phoneOut, () => phoneEl, () => { setPhone(false); resumeGame(); }],
];
document.addEventListener('pointerdown', (e) => {
  for (const [open, box, close] of POPUPS) {
    if (!open()) continue;
    if (box()?.contains(e.target)) return; // inside it: nothing to do
    if (e.target.closest?.('dialog, #resume, #chat')) return; // (the message log stays scrollable)
    e.preventDefault();
    e.stopPropagation();
    close();
    return;
  }
}, true);

window.game = {
  world, player, conn, remote, game: conn.game,
  setTime: (t) => { time = t; if (conn.game) conn.game.time = t; },
  setPhone,
  openPrinter: () => openPrinter(),
  openVault: (at) => openVault(at),
  openPicker: (hand) => openPicker(hand),
  openQuests: () => setQuests(true),
  openPhone: () => setPhone(true),
  setRate: (r) => { if (conn.game) conn.game.rate = r; },
  phoneApps, voice, sound,
};

/** Everyone holding a flashlight (you first, then the nearest players). */
const flashOffset = new THREE.Vector3();
function flashlightSources() {
  const out = [];
  const holding = (hands) => hands && (hands.left === 'flashlight' || hands.right === 'flashlight');
  if (holding(player.hands) && !player.dead && !phoneOut) {
    // From your hand, slightly below and beside your eyes, along your view.
    const side = player.hands.right === 'flashlight' ? 1 : -1;
    flashOffset.set(0.3 * side, -0.25, 0).applyQuaternion(camera.quaternion);
    out.push({ pos: camera.position.clone().add(flashOffset), dir: dir.clone(), d: 0 });
  }
  for (const p of remote.players.values()) {
    if (p.dead || p.phone || !holding(p.hands)) continue;
    const pos = new THREE.Vector3(p.pos.x, p.pos.y + (p.crouch ? 1.2 : 1.5), p.pos.z);
    const c = Math.cos(p.pitch);
    out.push({ pos, dir: new THREE.Vector3(-Math.sin(p.yaw) * c, Math.sin(p.pitch), -Math.cos(p.yaw) * c), d: pos.distanceTo(camera.position) });
  }
  return out.sort((a, b) => a.d - b.d);
}

// ---------- Buildy Boi mode ----------
player.onCantFly = () => { popup('Only Buildy Bois can fly: press B'); sound.play('deny'); };
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyB' || e.repeat || !player.locked || menuOpen() || player.dead) return;
  conn.send({ type: 'buildy' });
});
const buildyEl = document.getElementById('buildy');
player.onFlap = () => sound.play('flap');
const flapEl = document.getElementById('flap');
function updateBuildyHud() {
  const flapText = player.effects.flap > 0 && !player.dead ? `🐦 Flappy ${player.effects.flap}s · tap Space in the air` : '';
  if (flapEl.textContent !== flapText) flapEl.textContent = flapText;
  flapEl.hidden = !flapText;
  const text = buildSwitch
    ? `${buildSwitch.to ? '👷 Putting on the hard hat' : 'Taking off the hard hat'}… ${buildSwitch.t}s · B to cancel`
    : player.buildy ? '👷 Buildy Boi · F to fly · B to stop' : '';
  if (buildyEl.textContent !== text) buildyEl.textContent = text;
  buildyEl.hidden = !text;
  buildyEl.classList.toggle('switching', !!buildSwitch);
}

// Grappling ropes: yours, from your hand, and everyone else's.
const ropeMat = new THREE.LineBasicMaterial({ color: 0x3b2a1e });
const ropes = new Map(); // 'me' or player id -> line
function rope(key, a, b) {
  let line = ropes.get(key);
  if (!line) {
    line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), ropeMat);
    line.frustumCulled = false;
    scene.add(line);
    ropes.set(key, line);
  }
  const pos = line.geometry.attributes.position;
  pos.setXYZ(0, a.x, a.y, a.z);
  pos.setXYZ(1, b.x, b.y, b.z);
  pos.needsUpdate = true;
}
const handOffset = new THREE.Vector3();
function drawRopes() {
  const live = new Set();
  if (player.grapple) {
    handOffset.set(grappleHand === 'left' ? -0.4 : 0.4, -0.35, -0.5).applyQuaternion(camera.quaternion);
    rope('me', camera.position.clone().add(handOffset), player.grapple);
    live.add('me');
  }
  for (const p of remote.players.values()) {
    if (!p.grapple || p.dead) continue;
    rope(p.id, { x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z }, p.grapple);
    live.add(p.id);
  }
  for (const [key, line] of ropes) {
    if (live.has(key)) continue;
    scene.remove(line);
    line.geometry.dispose();
    ropes.delete(key);
  }
}

// Ammo for the guns in your hands, and the Power Surge countdown.
const ammoEl = document.getElementById('ammo');
const surgeEl = document.getElementById('surge');
function updateWeaponHud() {
  const lines = [];
  for (const hand of ['left', 'right']) {
    const gun = GUNS[player.hands[hand]];
    if (gun && hand === 'right' && isTwoHanded(player.hands.right)) continue; // listed once
    if (gun) lines.push(`${isTwoHanded(player.hands[hand]) ? '⇄' : hand === 'left' ? 'L' : 'R'} ${gun.name}: ${player.buildy ? '∞' : player.ammo[gun.ammo] || 0} ${AMMO[gun.ammo].name.toLowerCase()}`);
  }
  const text = lines.join('\n');
  if (ammoEl.textContent !== text) ammoEl.textContent = text;
  ammoEl.hidden = !lines.length;
  surgeEl.hidden = !(player.effects.surge > 0) || player.dead;
  if (!surgeEl.hidden) surgeEl.dataset.left = `POWER SURGE ${player.effects.surge}s`;
}

function handLabel(hand) {
  const kind = player.hands[hand];
  const n = itemCount(player, kind);
  return `${hand === 'left' ? 'Left' : 'Right'}: ${itemName(kind)}${Number.isFinite(n) ? ` x${n}` : ''}`;
}

// ---------- main loop ----------
const dir = new THREE.Vector3();
const glInfo = renderer.getContext();
const viewportInfo = new THREE.Vector4();
let last = performance.now();
let fps = 0;
let fpsFrames = 0;
let fpsStart = performance.now();
let wasClosed = false;
let stepDist = 0;
let outdoors = true;
let outdoorsT = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min((now - last) / 1000, 0.05);
  last = now;

  conn.drain(onMessage);
  if (conn.closed && !wasClosed) {
    wasClosed = true;
    updateNetStatus();
    document.exitPointerLock();
    overlayEl.hidden = false;
  }

  // Single player pauses for the pause screen, the picker and the printer (not the phone);
  // a shared world never pauses.
  const pausingMenu = npcOpen || questsOpen || craftingOpen || kitchenOpen || recipesOpen || potteryOpen || printerOpen || vaultOpen || shopOpen || bestiaryOpen || picker.isOpen; // the phone isn't one
  const running = multiplayer ? !conn.closed : (player.locked || phoneOut) && !pausingMenu;
  sampleRate(realDt);
  if (multiplayer) {
    voice.update(realDt, remote.players, camera.position, dir);
    updateVoiceMenu(realDt);
  }
  phoneApps.tick(); // (single player too: CONSUME lives on the phone)
  const frozen = !player.locked || menuOpen() || phoneOut;
  let simDt = 0;
  if (running) {
    const before = { ...player.pos };
    const fallSpeed = -player.vel.y;
    const wasGrounded = player.onGround;
    const wasInWater = player.inWater;
    player.update(realDt, frozen || player.effects.polymorph > 0 ? NO_INPUT : undefined, false); // (an infant just sits there)
    // Footsteps, landings and splashes.
    if (player.onGround && !player.flying && !player.dead) {
      stepDist += Math.hypot(player.pos.x - before.x, player.pos.z - before.z);
      if (stepDist > (player.crouching ? 1.1 : 1.7)) {
        stepDist = 0;
        sound.play('step', { material: materialUnder(player.pos), volume: player.crouching ? 0.4 : 0.9 });
      }
      if (!wasGrounded && fallSpeed > 7) sound.play('land', { material: materialUnder(player.pos), volume: Math.min(1, fallSpeed / 20) });
    }
    if (!wasInWater && player.inWater && fallSpeed > 2) sound.play('splash', { volume: Math.min(1, fallSpeed / 10) });
    stateT += realDt;
    if (stateT >= STATE_EVERY) {
      stateT = 0;
      sendState();
    }
    if (conn.tick) {
      conn.tick(realDt);
      simDt = realDt;
      conn.drain(onMessage);
    } else {
      time = (time + realDt / (settings.dayMinutes * 60)) % 1; // between server snapshots
      simDt = realDt;
    }
  }
  smoothRemote(realDt);
  remoteSteps();
  mobVoices(realDt);
  const light = daylight(time);
  const lightMul = lightMultiplier(light);

  camera.position.set(player.pos.x, player.pos.y + player.eyeHeight, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.getWorldDirection(dir);
  sound.setListener(camera.position, dir);
  updateAcoustics(realDt);
  if ((outdoorsT -= realDt) <= 0) {
    outdoorsT = 1;
    outdoors = true; // sky overhead?
    for (let y = Math.floor(camera.position.y) + 1; y < 80 && outdoors; y++) {
      if (world.getBlock(Math.floor(camera.position.x), y, Math.floor(camera.position.z)) !== AIR) outdoors = false;
    }
  }
  if (running) sound.ambient(realDt, light, outdoors);

  const handsFree = running && player.locked && !menuOpen() && !player.dead && !phoneOut;
  if (!handsFree) buttons.left = buttons.right = false;
  player.validateHands();

  // Hallucinating: phantom monsters come for you (only you see them; they can't hurt you).
  for (const ev of phantoms.update(realDt, player.effects.hallucinate > 0 && !player.dead, player.pos)) {
    const { mob } = ev;
    if (ev.type === 'vanish') {
      effects.puff(mob.pos.x, mob.pos.y + 0.9, mob.pos.z);
      sound.play('mobHurt', { pos: mob.pos, p: (MOB_VOICE_PITCH[mob.type] ?? 1) * 0.8 });
    } else {
      const v = MOB_VOICES[mob.type];
      if (v) sound.play(v[0], { pos: mob.pos, p: MOB_VOICE_PITCH[mob.type] ?? 1 });
    }
  }

  // Polymorphed: you're an infant, and infants cough.
  if (player.effects.polymorph > 0 && !player.dead && (babyCoughT -= realDt) <= 0) {
    babyCoughT = 1 + Math.random() * 1.2;
    sound.play('cough', { p: 1.8 });
  }

  // Guns: hold a hand's button to fire the gun in it (a two-handed gun fires with the left button);
  // hold the right button to aim down sights when you can (see canAim).
  emptyT -= realDt;
  if (scopeLevel && (!GUNS[player.hands.right]?.scope || !handsFree || player.dead)) scopeLevel = 0; // (put the rifle away, or a menu: the scope comes down)
  const aiming = handsFree && (scopeLevel > 0 || (buttons.right && canAim() && !GUNS[player.hands.right]?.scope));
  for (const hand of ['left', 'right']) {
    gunCooldown[hand] -= realDt;
    const kind = player.hands[hand];
    if (hand === 'right' && isTwoHanded(kind)) continue; // (the left hand fires it)
    if (isGun(kind) && GUNS[kind].draw) { // a bow: hold the button to draw, let go to shoot
      const gun = gunStats(kind, settings);
      const drawTime = GUNS[kind].draw;
      if (menuOpen() || !player.locked) { bowDraw[hand] = 0; continue; } // (a menu took the mouse: let the string down)
      if (buttons[hand] && gunCooldown[hand] <= 0) {
        if (ammoCount(player, gun.ammo) < gun.per) {
          if (emptyT <= 0) { emptyT = 0.4; sound.play('empty'); popup(`Out of ${AMMO[gun.ammo].name.toLowerCase()}: buy more at a town fletcher`); }
          continue;
        }
        if (!bowDraw[hand]) sound.play('bowdraw', { dur: drawTime });
        bowDraw[hand] = Math.min(1, bowDraw[hand] + realDt / drawTime);
      } else if (!buttons[hand] && bowDraw[hand] > 0) {
        const pull = bowDraw[hand];
        bowDraw[hand] = 0;
        if (pull * 100 < settings.bowMinDraw) continue; // barely drawn: you let the string back down
        gunCooldown[hand] = gun.cooldown;
        if (!player.buildy) player.ammo[gun.ammo] -= gun.per;
        const o = camera.position.clone().addScaledVector(dir, 0.6);
        conn.send({ type: 'fire', hand, aim: aiming, draw: Math.round(pull * 100) / 100, o: { x: o.x, y: o.y, z: o.z }, d: { x: dir.x, y: dir.y, z: dir.z } });
        sound.play('bow', { volume: 0.4 + 0.5 * pull });
        swing('right');
      }
      continue;
    }
    if (!buttons[hand] || !isGun(kind) || gunCooldown[hand] > 0) continue;
    const gun = gunStats(kind, settings);
    if (ammoCount(player, gun.ammo) < gun.per) {
      if (emptyT <= 0) {
        emptyT = 0.4;
        sound.play('empty');
        popup(`Out of ${AMMO[gun.ammo].name.toLowerCase()}: ${AMMO[gun.ammo].town ? 'buy more at a town fletcher' : 'print or order more'}`);
      }
      continue;
    }
    gunCooldown[hand] = gun.cooldown;
    if (!player.buildy) player.ammo[gun.ammo] -= gun.per; // shown right away; the game confirms
    const o = camera.position.clone().addScaledVector(dir, 0.6);
    conn.send({ type: 'fire', hand, aim: aiming, o: { x: o.x, y: o.y, z: o.z }, d: { x: dir.x, y: dir.y, z: dir.z } });
    sound.play(gun.type === 'arrow' ? 'bow' : kind, { volume: 0.8 });
    swing(isTwoHanded(kind) ? 'right' : hand); // (two-handed guns are drawn in the right hand) (no particle flash for your own shots: right in front of the camera they'd fill the screen)
    shake = Math.max(shake, ({ shotgun: 0.12, rocket: 0.1, railgun: 0.15, overcharge: 0.2, machinegun: 0.006 }[kind] ?? 0.03) * (aiming ? 0.6 : 1)); // (the machine gun only buzzes: it fires too fast for more)
  }
  // Aiming down sights: zoom in a little, slow the mouse to match, and bring the gun to the middle.
  adsT += ((aiming ? 1 : 0) - adsT) * Math.min(1, realDt * 12);
  // Zoom as true magnification (the Aiming zoom setting: 100% = 2×, or the scope's 5/10/20×), whatever your field
  // of view. It eases between levels (in log steps, so 10× to 20× feels like 5× to 10×).
  const wantMag = scopeLevel ? Math.max(1, settings[`scopeZoom${scopeLevel}`]) : aiming ? 1 + settings.adsZoom / 100 : 1;
  zoomMag = Math.exp(Math.log(zoomMag) + (Math.log(wantMag) - Math.log(zoomMag)) * Math.min(1, realDt * 14));
  const mag = zoomMag;
  scopeEl.hidden = !(scopeLevel > 0 && adsT > 0.5);
  if (!scopeEl.hidden) { const t = `${settings[`scopeZoom${scopeLevel}`]}×`; if (scopeZoomEl.textContent !== t) scopeZoomEl.textContent = t; }
  const fov = (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) / mag) * 180) / Math.PI;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  player.lookScale = 1 / mag; // the mouse slows to match, so aiming feels the same
  if (player.grapple && (!handsFree || player.hands[grappleHand] !== 'grapple')) letGoOfGrapple();

  // Washing dishes: hold a hand's button while it holds a dirty dish (or hold G to wash any dish).
  const washHand = ['left', 'right'].find((h) => buttons[h] && player.hands[h] in DISHES);
  const washKind = washHand ? player.hands[washHand] : null;
  const gHeld = handsFree && player.keys.has('KeyG');
  const wash = player.wash(handsFree ? realDt : 0, gHeld || !!washHand, gHeld ? null : washKind);
  let progress = null; // drives the little bar under the crosshair
  if (wash) {
    progress = wash.type === 'washing' ? wash.progress : 1;
    const hand = camera.position.clone().addScaledVector(dir, 0.7);
    effects.bubbles(hand.x, hand.y - 0.35, hand.z);
    if ((bubbleT -= realDt) <= 0) {
      bubbleT = 0.12;
      sound.play('bubble');
    }
    if (wash.type === 'washed') {
      conn.send({ type: 'washed', kind: wash.kind, hand: washHand || 'left' });
      sound.play('washed'); // (the skill point itself is silent: no message)
    }
  }

  for (const m of remote.mobs.values()) {
    if (m.burning) effects.burn(m.pos.x, m.pos.y, m.pos.z, m.halfW, m.height);
    if (MOB_TYPES[m.type].pet) effects.dander(m.pos.x, m.pos.y + m.height * 0.6, m.pos.z);
    if (m.chill) effects.chill(m.pos.x, m.pos.y, m.pos.z, m.halfW * (m.scale ?? 1), m.height * (m.scale ?? 1));
  }
  for (const p of remote.players.values()) if (p.chill && !p.dead) effects.chill(p.pos.x, p.pos.y, p.pos.z, 0.3 * (p.scale ?? 1), 1.8 * (p.scale ?? 1));
  // Blizzards: whirling snow, and a gust of wind now and then when you're near one.
  for (const st of remote.storms.values()) {
    effects.blizzard(st.pos.x, st.pos.y, st.pos.z, st.r, realDt);
    if ((st.gustT -= realDt) <= 0) {
      st.gustT = 1.6;
      if (nearMe(st.pos, st.r + 20)) sound.play('blizzard', { pos: st.pos });
    }
  }
  deathEl.hidden = !player.dead;

  updateChunks();

  // What the crosshair points at: a mob or player in front of a block wins.
  const reach = REACH * statEffects(player.stats).reach; // (Tallness reaches further)
  target = world.raycast(camera.position, dir, reach);
  const hit = raycastEntities(camera.position, dir, reach);
  targetEnt = hit && (!target || hit.t < target.t) ? hit : null;
  highlight.visible = !!target && !targetEnt;
  if (target) highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);

  // Mining: hold the button of a hand that's empty or holds a tool; the tool sets the speed.
  attackCooldown -= realDt;
  const mineHand = ['left', 'right'].find((h) => buttons[h] && isMiningKind(player.hands[h]) && !(h === 'right' && canAim())
    && !(player.hands[h] === 'empty' && currentSpell() !== 'none')); // (an empty hand casts the picked spell instead) // (an aiming right hand doesn't mine)
  const mining = !!mineHand && handsFree && target && !targetEnt && target.y > 0; // y=0 is unbreakable
  myMineHand = mining ? mineHand : null;
  if (mining) {
    const key = `${target.x},${target.y},${target.z}`;
    if (key !== mineKey) { mineKey = key; mineProgress = 0; }
    const tool = player.hands[mineHand] in TOOLS ? player.hands[mineHand] : 'hand';
    mineProgress += realDt / breakTime(target.id, tool);
    effects.chip(target.x, target.y, target.z, target.id);
    if ((chipT -= realDt) <= 0) {
      chipT = 0.22;
      sound.play('chip', { pos: centre(target.x, target.y, target.z), material: blockMaterial(target.id) });
    }
    if (mineProgress >= 1) {
      recentEdits.set(`${target.x},${target.y},${target.z}`, performance.now());
      sound.play('break', { pos: centre(target.x, target.y, target.z), material: blockMaterial(target.id) });
      effects.breakBlock(target.x, target.y, target.z, target.id);
      world.setBlock(target.x, target.y, target.z, AIR); // show it now; the game confirms or corrects
      conn.send({ type: 'break', x: target.x, y: target.y, z: target.z });
      mineProgress = 0;
      mineKey = '';
    }
    progress = mineProgress;
  } else {
    mineProgress = 0;
    mineKey = '';
  }
  washBar.hidden = progress === null;
  if (progress !== null) washFill.style.width = `${progress * 100}%`;

  // Held items: a quick arc on clicks/shots, a steady chop while mining.
  refreshHeld();
  for (const [hand, view] of Object.entries(handViews)) {
    view.swingT = Math.max(0, view.swingT - realDt);
    const chopping = mining && hand === mineHand;
    const arc = chopping ? Math.abs(Math.sin(now / 110)) : view.swingT > 0 ? Math.sin((1 - view.swingT / 0.3) * Math.PI) : 0;
    view.pivot.rotation.x = -arc * (player.hands[hand] === 'wand' ? 0.5 : isGun(player.hands[hand]) ? 0.35 : 1.1);
    // A two-handed gun is one model, held a little nearer the middle; the left hand's view hides.
    const twoHanded = isTwoHanded(player.hands[hand]);
    view.pivot.visible = false; // (your body holds things now, in every view: see syncSelf)
    // Aiming: the aiming gun (right hand's if it has one) slides to the middle, under the crosshair.
    const aimHand = isTwoHanded(player.hands.right) ? 'right' : 'left'; // (two-handed guns are drawn in the right hand)
    const k = hand === aimHand && isGun(player.hands[hand]) ? adsT : 0;
    const homeX = twoHanded ? view.home.x * 0.6 : view.home.x;
    view.pivot.position.set(homeX * (1 - k), view.home.y + (ADS_POS.y - view.home.y) * k, view.home.z + (ADS_POS.z - view.home.z) * k);
    if (hand !== aimHand && isGun(player.hands[aimHand]) && adsT > 0.5 && !twoHanded) view.pivot.visible = false; // the other hand drops out of view
  }
  heldMaterial.color.setScalar(Math.max(lightMul, 0.25));
  heldBlockMaterial.color.setScalar(Math.max(lightMul, 0.25));

  // Hackysacks in flight
  for (const sk of remote.sacks.values()) {
    let m = sackModels.get(sk.id);
    if (!m) { m = buildHeldModel('hackysack', heldMaterial); scene.add(m); sackModels.set(sk.id, m); }
    m.position.set(sk.pos.x, sk.pos.y, sk.pos.z);
    m.rotation.x += realDt * 9;
    m.rotation.y += realDt * 7;
  }
  for (const [id, m] of sackModels) if (!remote.sacks.has(id)) { scene.remove(m); sackModels.delete(id); }

  // Delivery drones: spinning rotors, the package underneath until it's handed over, and a buzz.
  droneMaterial.color.setScalar(Math.max(lightMul, 0.3));
  for (const d of remote.drones.values()) {
    d.model.position.set(d.pos.x, d.pos.y, d.pos.z);
    d.model.rotation.y = d.yaw ?? 0;
    for (const r of d.model.userData.rotors) r.rotation.y += realDt * 40;
    d.model.userData.package.visible = d.carrying !== false;
  }
  updateBobbers();
  // Things that hum as they fly (with Doppler): projectiles and drones (audio.js MOVERS).
  const movers = [];
  if (soundsOn()) {
    for (const f of remote.fireballs.values()) movers.push({ id: `f${f.id}`, kind: f.kind, pos: f.pos });
    for (const d of remote.drones.values()) movers.push({ id: `d${d.id}`, kind: 'drone', pos: d.pos });
  }
  sound.track(movers);

  updatePrinter(realDt);
  updateShop();
  updatePlayersTab(realDt);
  updatePottery();
  updateKitchen();
  updateCrafting();
  updateHotbars();

  // Sky, fog and lighting
  const skyColor = sky.update(time, camera.position);
  const eyeBlock = world.getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z));
  if (FLUID[eyeBlock]) { // under water, in lava, or buried in the ball pit
    if (eyeBlock === WATER) scene.background.copy(UNDERWATER).multiplyScalar(lightMul);
    else scene.background.copy(eyeBlock === LAVA ? IN_LAVA : IN_BALLS);
    scene.fog.color.copy(scene.background);
    scene.fog.near = 0.5;
    scene.fog.far = 24;
  } else {
    scene.background.copy(skyColor);
    scene.fog.color.copy(skyColor);
    scene.fog.near = renderDistance * CS * 0.55;
    scene.fog.far = renderDistance * CS * 0.95;
  }
  solidMaterial.color.setScalar(lightMul);
  waterMaterial.color.setScalar(lightMul);
  setFlashlights(flashlightSources(), lightMul);
  highlight.material.color.setScalar(light < 0.5 ? 0.85 : 0.07);

  effects.update(simDt, [...remote.fireballs.values()]);
  mobModels.sync({ list: [...remote.mobs.values(), ...phantoms.list], arrows: [...remote.arrows.values()] }, lightMul);
  mobModels.syncDrops({ list: [...remote.drops.values()] });
  for (const [id, p] of remote.players) p.talking = multiplayer && voice.talking(id); // (the icon over their head)
  avatars.sync(remote.players, lightMul, realDt);
  npcAvatars.sync(npcView(), lightMul, realDt);
  updateQuestMarkers(realDt);
  syncSelf(lightMul, realDt);
  updateVoiceMode();
  drawRopes();

  // Camera shake
  if (!prefs.shake) shake = 0; // (Settings: Display)
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-8 * realDt);
  }

  // HUD
  healthEl.style.width = `${Math.min(15 * player.maxHp, 600)}px`;
  healthEl.style.setProperty('--segs', player.maxHp / 2);
  healthFill.style.width = `${(player.hp / player.maxHp) * 100}%`;
  { // the level bar: how far your total skill points are towards the next level
    const lo = pointsFor(player.level);
    const hi = pointsFor(player.level + 1);
    xpFill.style.width = `${Math.min(100, ((totalPoints(player.skills) - lo) / Math.max(1, hi - lo)) * 100)}%`;
    levelEl.textContent = player.level;
  }
  hurtFlash = Math.max(0, hurtFlash - realDt * 1.5);
  hurtEl.style.opacity = player.dead ? 0.8 : hurtFlash;
  healFlash = Math.max(0, healFlash - realDt * 1.2);
  healEl.style.opacity = healFlash;
  updateTraitsAndEffects(realDt);
  updateWeaponHud();
  spellFlashT -= realDt;
  updateSpellHud();
  updateBuildyHud();
  updateVault();
  updateLamps(realDt, lightMul);
  updateSheet(realDt);
  walletCount.textContent = player.wallet.zcash.toFixed(2);
  walletUsd.textContent = `≈ ${usd(player.wallet.zcash * rate)}${player.wallet.cold > 0 ? ` · ❄ ${player.wallet.cold.toFixed(2)}` : ''}`;
  walletUsd.className = rateChange() >= 0 ? 'up' : 'down';
  if (phoneOut) {
    drawPhone(now / 1000);
    phoneClock.textContent = clockString(time);
    phoneBadge.textContent = multiplayer ? '📶' : '';
  }
  drawMap();

  fpsFrames++;
  if (now - fpsStart >= 500) {
    fps = Math.round((fpsFrames * 1000) / (now - fpsStart));
    fpsFrames = 0;
    fpsStart = now;
  }
  if (showInfo) {
    const p = player.pos;
    const mobs = [...remote.mobs.values()];
    const counts = Object.entries(MOB_TYPES).map(([t, def]) => `${def.tag}${mobs.filter((m) => m.type === t).length}`);
    infoEl.textContent =
      `Game  ${fps} fps   Window ${innerWidth}x${innerHeight}  View ${canvas.clientWidth}x${canvas.clientHeight}  ` +
      `Canvas ${canvas.width}x${canvas.height}  Buffer ${glInfo.drawingBufferWidth}x${glInfo.drawingBufferHeight}  ` +
      `Viewport ${renderer.getCurrentViewport(viewportInfo).z}x${viewportInfo.w}  GPU max ${glLimits.w}x${glLimits.h}  Zoom ${Math.round(devicePixelRatio * 100)}%\n` +
      `${multiplayer ? `Multiplayer · ${remote.players.size + 1} online` : 'Single player'}   XYZ ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\n` +
      `Time ${clockString(time)}   1 ZEC = ${usd(rate)}   Level ${player.level}   Dishes washed ${player.cleaned}\n` +
      `Mobs ${counts.join(' ')}\n` +
      `${player.flying ? 'Flying' : player.crouching ? 'Crouching' : 'Walking'}   ${handLabel('left')} (Q)   ${handLabel('right')} (E)`;
  }

  // Draw from the view you picked, then put the camera back at your eyes: aiming, targeting and sound use it.
  const eyePos = camera.position.clone();
  const eyeRot = camera.rotation.clone();
  placeViewCamera();
  if (sheetOpen) { const w = canvas.clientWidth; const h = canvas.clientHeight; camera.setViewOffset(w, h, -w * 0.25, 0, w, h); } // (you, in the right half)
  renderer.render(scene, camera);
  if (sheetOpen) camera.clearViewOffset();
  camera.position.copy(eyePos);
  camera.rotation.copy(eyeRot);
}
refreshHeld();
requestAnimationFrame(frame);
