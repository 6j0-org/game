// The authoritative game: block edits, time of day, mobs, items, projectiles, explosions, health and
// inventories. The multiplayer server (server/index.js) runs one Game for everybody; single-player
// runs one inside the browser. Pure logic: no Three.js, DOM or Node APIs.
//
// Clients talk to it with plain messages (see `message`), and it answers through each player's
// `send` function: 'welcome', 'snap' (positions of everything), 'blocks', 'you' (your stats),
// 'hurt', 'respawn', 'fx' (visual effects), 'msg' (pop-up text), 'printing'/'printed', 'text', 'call'.
//
// Trust model: built for friends. Each browser simulates its own movement and reports it; the game
// owns everything else and sanity-checks actions (reach, cooldowns, what you're holding).

import { T, tune, bindTunable } from './tuning.js';
import { World, CH, CS } from './world.js';
import { Player } from './player.js';
import { Mobs, MOB_TYPES } from './mobs.js';
import { spend, ammoCount, scrollKind, meleeStyle, itemGroup } from './items.js';
import { Drops, Throwables, FOOD, DISHES, TOOLS, TRAITS, itemStats, isMiningKind, itemName, rollTraits, fallHealFor, fallDamageFor, itemCount, blockIdOf, printable, printUsd, BLOCK_PRINTS, shopOffer, grantItem,
  townOffer, isArmor, scrollOf } from './items.js';
import { SETTINGS, cleanSetting, loadSettings, migrateSettings, SETTINGS_VERSION, settingText, gunStats, setTuning } from './settings.js';
import { Drones } from './drones.js';
import { SPELLS, isFocus, maxMana, manaRegen, magic, spellCost, spellCooldown, potency as focusPotency, SIZE_SPELLS } from './spells.js';
import { Fireballs, explode } from './fireballs.js';
import { BlockGravity } from './gravity.js';
import { Accounts } from './accounts.js';
import { newCharacter, cleanLook } from './characters.js';
import { findWater, biteWait, rollCatch } from './fishing.js';
import { recipeFor, canCook, cookSeconds, stationOf, needsText } from './cooking.js';
import { craftById, canCraft, craftNeedsText, craftName, grantCraft } from './crafting.js';
import { unfiredInfo, unfiredKey, unfiredName, firedId, fireSeconds, upgradeUnfiredKey, clayFor, clayBlock, clayFind, glazedKey, toggledLuminary, piecesText } from './pottery.js';
import { SNOW_LAYER } from './blocks.js';
import { BLOCKS, POTTERY_WHEEL, KILN, GLAZING_TABLE, POT_OBJECTS, CLAYS, isLuminary, potteryId, potteryName } from './blocks.js';
import { AIR, WATER, ICE, FLUID, LAVA, WHEAT, HOTBAR, COLD_WALLET, SOLID, SHAPES, TRAPDOOR, LADDER, isBed, bedInfo, bedOther, BED_FOOT, isTrapdoor, isLadder, baseId, isDoor, doorInfo, doorId,
  UNBREAKABLE, shopOfBlock, isCrop, isSoil, cropInfo, CROPS, MINE_TOOL, rightTool, LEAFY, GRASS, SNOW_GRASS, PLANT } from './blocks.js';
import { daylight } from './daycycle.js';
import { nextRate, zecFor, round2 } from './market.js';
import { STATS, rollStats, statEffects, withBonus } from './stats.js';
import { GUNS, AMMO, spreadDir } from './weapons.js';
import { VoiceRoom } from './voiceroom.js';
import { runCommand } from './commands.js';
import { BESTIARY } from './bestiary.js';
import { GARDEN_TOOLS, TILLABLE, till, water, torch, newDay, harvest, canPlant } from './garden.js';
import { Npcs } from './npcs.js';
import { cleanQuests, questOffer, offerSeed, questReady, questGoal, questAsk, lostName, hello, thanks } from './quests.js';
import { forageFind } from './forage.js';
import { MARKET } from './townplan.js';
import { totalPoints, levelFor, maxHpFor, pointsFor } from './skills.js';

export const PROTOCOL = 1;
const SNAPSHOT_EVERY = 1 / 15; // multiplayer; single-player sends one every tick
const SAVE_EVERY = 10;
const PRUNE_EVERY = 5;
const REACH = 8; // a little generous: reported positions lag behind slightly
/** What each kind of projectile is called in a death message (guns set their own name on the shot). */
const PROJECTILE_NAMES = { snowball: 'Blizzard', fireball: 'Fireball', missile: 'Magic Missile', icebolt: 'Icebolt', rocket: 'Rocket Launcher', orb: 'Overcharge Cannon', arrow: 'a bow' };
const INVENTORIES = ['food', 'dishes', 'wallet', 'tools', 'blocks', 'scrolls', 'unfired', 'materials'];
const TEXT_MAX = 200; // characters per text message
const TEXT_COOLDOWN = 0.4;
const MAX_MESSES = 300;

/** "You were born lactose intolerant." etc. */
function traitText(traits) {
  const names = ['gluten', 'lactose'].filter((k) => traits[k]);
  const food = names.length ? `This life you're ${names.join(' and ')} intolerant.` : 'No food intolerances this life. Eat anything!';
  const extras = [traits.fallHealing && 'Also, falling heals you. Somehow.', traits.lowGravity && 'Gravity barely bothers you: big jumps, soft landings.'].filter(Boolean);
  return [food, ...extras].join(' ');
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;

export function cleanName(name) {
  const n = String(name ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 20);
  return n || 'Player';
}

export class Game {
  /**
   * @param {object} o
   * @param {{get(k:string):string|null, set(k:string,v:string):void}} o.store  world/time storage
   * @param {boolean} o.multiplayer
   * @param {(uid:string) => object|null} o.loadPlayer   a Player's saved progress (by account ID)
   * @param {(uid:string, data:object|null) => void} o.savePlayer  (null: delete it)
   */
  constructor({ store, multiplayer = false, loadPlayer = () => null, savePlayer = () => {}, rand = Math.random }) {
    this.store = store;
    this.multiplayer = multiplayer;
    this.loadPlayer = loadPlayer;
    this.savePlayer = savePlayer;
    this.rand = rand;

    let seed = parseInt(store.get('game:seed'), 10);
    if (!Number.isFinite(seed)) {
      seed = Math.floor(rand() * 2 ** 31);
      store.set('game:seed', String(seed));
    }
    this.world = new World(seed, store);
    this.accounts = new Accounts(store); // Players: who may join (accounts.js), kept with the world
    this.clock = 0; // seconds this game has run (cooldowns)
    // Backpacks dead players dropped: { id, owner (Player ID), name, x, y, z, t (seconds left), items }.
    try { this.backpacks = JSON.parse(store.get('game:backpacks')) || []; } catch { this.backpacks = []; }
    this.backpacks = this.backpacks.filter((b) => b && typeof b.owner === 'string' && b.items && num(b.x) && num(b.t));
    this.nextPackId = this.backpacks.reduce((n, b) => Math.max(n, (b.id | 0) + 1), 1);
    this.changes = [];
    this.gravity = new BlockGravity(this.world); // unsupported blocks fall (gravity.js)
    // Snow from Icebolts and Blizzards melts after a while: "x,y,z" -> seconds left. Snow already in the
    // world (saved before it melted) gets a fresh timer.
    this.snow = new Map();
    this.snowT = 0;
    for (const [key, m] of this.world.edits) {
      const [cx, cz] = key.split(',').map(Number);
      for (const [i, id] of m) {
        if (id !== SNOW_LAYER) continue;
        const x = cx * CS + (i % CS);
        const y = Math.floor(i / (CS * CS));
        const z = cz * CS + (Math.floor(i / CS) % CS);
        this.snow.set(`${x},${y},${z}`, rand() * Math.max(10, magic(T, 'snowMelt')));
      }
    }
    this.fallen = []; // block changes made by falling blocks: sent separately, without break/place sounds
    this.world.onChange = (x, y, z, id) => {
      (this.gravity.moving ? this.fallen : this.changes).push([x, y, z, id]);
      this.gravity.changed(x, y, z, id);
    };
    const t = parseFloat(store.get('game:time'));
    this.time = Number.isFinite(t) ? t : 0.02;
    const r = parseFloat(store.get('game:rate'));
    this.rate = Number.isFinite(r) && r > 0 ? r : T.baseRate; // USD per ZEC
    this.rateT = 0;
    let saved = null;
    try { saved = JSON.parse(store.get('game:settings')); } catch { /* none yet */ }
    const version = parseInt(store.get('game:settings-version'), 10) || 1;
    if (version < SETTINGS_VERSION) {
      saved = migrateSettings(saved, version); // defaults that changed since this world was saved
      if (saved) store.set('game:settings', JSON.stringify(saved));
      store.set('game:settings-version', String(SETTINGS_VERSION));
    }
    setTuning(loadSettings(saved)); // see settings.js; anyone can change them
    this.settings = T; // the live values every module reads

    this.mobs = new Mobs(this.world, rand);
    this.mobs.settings = this.settings;
    this.drops = new Drops(this.world, rand);
    this.throwables = new Throwables(this.world);
    this.fireballs = new Fireballs(this.world);
    this.drones = new Drones(rand); // CONSUME deliveries in flight
    this.npcs = new Npcs(this.world, rand); // the Fantasy Town's people (npcs.js), out when someone's near a market
    this.storms = []; // Blizzards: { id, owner, x, y, z, t, damage, chill, biteT }
    this.nextStormId = 1;

    this.messes = []; // poop left behind by lactose-intolerant players who had dairy: { id, x, y, z, age }
    this.nextMessId = 1;
    this.players = new Map(); // id -> entry
    this.voice = new VoiceRoom((id, m) => this.players.get(id)?.send(m), (id) => this.players.get(id)?.name ?? null); // server voice (voice.js)
    this.nextId = 1;
    this.snapT = 0;
    this.saveT = 0;
    this.pruneT = 0;
    this.surgeT = T.surgeEvery / 2;
  }

  get seed() {
    return this.world.seed;
  }

  // ---------- joining and leaving ----------

  /** Adds a player. `send(obj)` delivers a message to them. Returns their id. */
  // ---------- Players (accounts.js) ----------

  /**
   * Before joining: { type: 'create', name } makes a Player, { type: 'recover', code } gets a fresh key with
   * an Admin's recovery code. Returns { type: 'created', uid, key, name } or { type: 'denied', reason }.
   */
  account(msg) {
    const r = msg?.type === 'create' ? this.accounts.create(cleanName(msg.name))
      : msg?.type === 'recover' ? this.accounts.recover(msg.code) : { error: 'Unknown request' };
    return r.error ? { type: 'denied', reason: r.error } : { type: 'created', ...r };
  }

  /** Checks a Player's ID and key before `join`. Returns null if they may join, or the reason they can't. */
  authenticate(uid, key) {
    const r = this.accounts.verify(uid, key);
    return r.error || null;
  }

  // ---------- characters (characters.js), before joining ----------

  /** A Player's characters, for the title screen: { type: 'characters', list, max, last, made? }. */
  characterList(uid, made = null) {
    const list = Object.entries(this.accounts.characters(uid)).map(([id, c]) => {
      const live = [...this.players.values()].find((o) => o.token === `${uid}.${id}`);
      const saved = live ? null : this.loadPlayer(`${uid}.${id}`);
      return { id, name: c.name, look: c.look, level: live ? live.p.level : saved?.skills ? levelFor(totalPoints(saved.skills)) : 1, created: c.created };
    }).sort((a, b) => a.created - b.created);
    return { type: 'characters', list, max: T.maxCharacters, last: this.accounts.get(uid)?.lastChar ?? null, startStat: T.startStat, startPoints: T.startPoints, ...(made ? { made } : {}) };
  }

  /** Makes a character: { name, look, stats }. Returns the updated list (with `made`), or { type: 'denied', reason }. */
  createCharacter(uid, msg) {
    const ch = newCharacter({ name: cleanName(msg?.name), look: msg?.look, stats: msg?.stats }, Object.keys(this.accounts.list).length, this.rand);
    if (ch.error) return { type: 'denied', reason: ch.error };
    const id = this.accounts.addCharacter(uid, ch, T.maxCharacters);
    if (id.error) return { type: 'denied', reason: id.error };
    return this.characterList(uid, id);
  }

  /** Deletes one of a Player's characters, and everything it had. */
  deleteCharacter(uid, id) {
    const token = `${uid}.${id}`;
    const online = [...this.players.values()].find((o) => o.token === token);
    if (online) { online.send({ type: 'kicked', reason: 'That character was deleted.' }); this.leave(online.id); }
    if (this.accounts.removeCharacter(uid, id)) this.savePlayer(token, null);
    return this.characterList(uid);
  }

  /** Joins an authenticated Player (see `authenticate`) as one of their characters. Returns the entry id, or null if there's no such character. */
  join(uid, charId, send) {
    const ch = this.accounts.characters(uid)[charId];
    if (!ch) return null;
    const token = `${uid}.${charId}`; // (saves are per character)
    const name = ch.name;
    const acc = this.accounts.get(uid);
    acc.lastChar = charId;
    this.accounts._save();
    for (const other of [...this.players.values()]) {
      if (other.uid === uid) { // one character at a time per Player
        other.send({ type: 'kicked', reason: 'You joined from another tab or browser.' });
        this.leave(other.id);
      }
    }
    const p = new Player(this.world);
    const saved = this.loadPlayer(token) || {};
    for (const [k, v] of Object.entries(saved.ammo || {})) if (k in p.ammo && num(v) && v >= 0) p.ammo[k] = Math.floor(v);
    for (const inv of INVENTORIES) {
      for (const [k, v] of Object.entries(saved[inv] || {})) {
        if (k in p[inv] && num(v) && v >= 0) p[inv][k] = inv === 'wallet' ? round2(v) : Math.floor(v);
      }
    }
    if (num(saved.cleaned)) p.cleaned = saved.cleaned;
    if (Array.isArray(saved.spells)) p.spells = saved.spells.filter((k, i, a) => k in SPELLS && a.indexOf(k) === i);
    for (const h of ['left', 'right']) if (Array.isArray(saved.hotbars?.[h])) p.hotbars[h] = Array.from({ length: 8 }, (_, i) => (typeof saved.hotbars[h][i] === 'string' ? saved.hotbars[h][i] : null));
    if (saved.cooking && FOOD[saved.cooking.out] && num(saved.cooking.t) && Number.isInteger(saved.cooking.n)) p.cooking = { out: saved.cooking.out, n: saved.cooking.n, t: saved.cooking.t }; // a dish still cooking when you left
    for (const [k, v] of Object.entries(saved.greenware || {})) { // (saves from before trimming: their pots count as trimmed)
      const key = upgradeUnfiredKey(k);
      if (key && Number.isInteger(v) && v > 0) p.unfired[key] += v;
    }
    if (saved.kiln && Array.isArray(saved.kiln.pieces) && num(saved.kiln.t)) { // a batch still firing when you left
      const pieces = saved.kiln.pieces.map((x) => (Array.isArray(x) ? [upgradeUnfiredKey(x[0]), x[1]] : []))
        .filter(([k, n]) => firedId(k) !== null && Number.isInteger(n) && n > 0);
      if (pieces.length) p.kiln = { pieces, t: Math.max(0, Math.min(fireSeconds(pieces[0][0]), saved.kiln.t)) };
    }
    // Skills (skills.js). Saves from before skills had XP and levels from washing dishes: that becomes Dishwash.
    if (saved.skills && typeof saved.skills === 'object') {
      for (const [k, v] of Object.entries(saved.skills)) if (typeof k === 'string' && k.length < 40 && num(v) && v > 0) p.skills[k] = Math.floor(v);
    } else if (num(saved.xp) || num(saved.level)) {
      // Keep everyone's level (and so their max health): old level L (from 0) is new level L + 1, plus their spare XP.
      const earned = pointsFor((num(saved.level) ? saved.level : 0) + 1) + (num(saved.xp) ? saved.xp : 0);
      if (earned > 0) p.skills.dishwash = Math.floor(earned);
    }
    p.level = levelFor(totalPoints(p.skills));
    p.maxHp = maxHpFor(p.level);
    p.buildy = !!saved.buildy;
    p.quests = cleanQuests(saved.quests); // (quests.js)
    if (typeof saved.worn === 'string' && isArmor(saved.worn)) { p.worn = saved.worn; p.wornFree = !!saved.wornFree; }
    for (const h of ['left', 'right']) if (typeof saved.hands?.[h] === 'string') p.hands[h] = saved.hands[h];
    p.validateHands();
    // Stats and traits belong to the character (characters.js): chosen and rolled when it was made.
    const firstTime = !saved.pos && !saved.skills;
    p.traits = Object.fromEntries(Object.keys(TRAITS).map((k) => [k, !!ch.traits?.[k]]));
    p.baseStats = this._cleanStats(ch.stats || {});
    // Attribute points (stats.js): what you've put in, and what's left. Saves from before them get the points
    // their level would have earned.
    if (saved.statBonus && typeof saved.statBonus === 'object') {
      for (const k of Object.keys(STATS)) if (Number.isInteger(saved.statBonus[k]) && saved.statBonus[k] > 0) p.statBonus[k] = saved.statBonus[k];
    }
    p.statPoints = Number.isInteger(saved.statPoints) && saved.statPoints >= 0 ? saved.statPoints : (ch.spare || 0) + (p.level - 1) * T.statPointsPerLevel; // (points left from making it)
    p.stats = withBonus(p.baseStats, p.statBonus);
    const sp = saved.pos;
    const resume = saved.seed === this.seed && sp && num(sp.x) && num(sp.y) && num(sp.z) && sp.y > 0;
    const b = saved.bed;
    if (saved.seed === this.seed && b && [b.x, b.y, b.z].every(Number.isInteger)) p.bed = { x: b.x, y: b.y, z: b.z };
    if (Array.isArray(saved.orders)) {
      p.orders = saved.orders.filter((o) => o && shopOffer(o.kind) && num(o.t)).slice(0, T.maxOrders)
        .map((o) => ({ kind: o.kind, t: Math.max(0, Math.min(this.settings.deliveryMinutes * 60, o.t)) }));
    }
    p.spawn(resume ? sp : this._spawnPoint({ p, send: () => {} })); // (quietly: no messages before 'welcome')

    const e = {
      id: this.nextId++, token, uid, charId, look: cleanLook(ch.look), name: cleanName(name ?? saved.name), send, p,
      yaw: 0, pitch: 0, crouch: false, flying: false,
      phoneOut: false, textCd: 0, poopT: 0, upsetHurtT: 0, gunCd: {}, grapple: null, deathT: 0, printJob: null, meleeCd: 0, castCd: {}, lastYou: '', buildSwitch: null,
    };
    p.onHurt = (amount) => e.send({ type: 'hurt', amount, knock: p.lastKnock });
    this.players.set(e.id, e);

    const you = this._you(e);
    e.lastYou = JSON.stringify(you);
    send({
      type: 'welcome', protocol: PROTOCOL, id: e.id, name: e.name, uid, look: e.look, admin: !!this.accounts.get(uid)?.admin, multiplayer: this.multiplayer,
      seed: this.seed, time: this.time, rate: this.rate, settings: { ...this.settings }, edits: this.world.allEdits(), legacy: [...this.world.legacy], gen2: [...this.world.gen2], pos: { ...p.pos }, hands: { ...p.hands }, you,
    });
    if (this.multiplayer) this._broadcast({ type: 'msg', text: `${e.name} joined`, kind: 'join' }, e);
    if (firstTime) e.send({ type: 'msg', text: traitText(p.traits), kind: 'trait' });
    this._sendSnapshot();
    return e.id;
  }

  leave(id) {
    const e = this.players.get(id);
    if (!e) return;
    this._savePlayer(e);
    const acc = this.accounts.get(e.uid);
    if (acc) { acc.seen = Date.now(); this.accounts._save(); }
    this.voice.drop(id);
    this.players.delete(id);
    if (this.multiplayer) this._broadcast({ type: 'msg', text: `${e.name} left`, kind: 'join' });
  }

  // ---------- messages from players ----------

  message(id, msg) {
    const e = this.players.get(id);
    if (!e || !msg || typeof msg.type !== 'string') return;
    const p = e.p;
    switch (msg.type) {
      case 'state': return this._state(e, msg);
      case 'admin': return this._admin(e, msg); // Settings > Players (Admins only)
      case 'rename': {
        const was = e.name;
        const r = this.accounts.renameCharacter(e.uid, e.charId, cleanName(msg.name));
        if (r.error) return e.send({ type: 'renamed', name: e.name, error: r.error });
        e.name = r.name;
        e.send({ type: 'renamed', name: e.name });
        this.voice.update();
        if (this.multiplayer && e.name !== was) this._broadcast({ type: 'msg', kind: 'join', text: `${was} is now called ${e.name}` });
        return;
      }
      case 'skipTime': if (!this.multiplayer) this.time = (this.time + 0.25) % 1; return;
      case 'text': return this._text(e, msg); // you can text from your phone (that's what it's for)
      case 'voice': return this._voice(e, msg); // works while dead or on the phone
      case 'order': return this._order(e, msg); // CONSUME is a phone app: works with the phone out, or dead
      case 'setting': return this._setting(e, msg); // from the main menu
      case 'command': return this._command(e, msg); // the / console
      case 'stat': return this._addStat(e, msg); // the character sheet: works any time
      default:
    }
    if (p.dead || e.phoneOut || p.effects.polymorph > 0) return; // dead, on your phone, or an infant: no actions
    switch (msg.type) {
      case 'place': return this._place(e, msg);
      case 'break': return this._break(e, msg);
      case 'attack': return this._attack(e, msg);
      case 'cast': return this._cast(e, msg);
      case 'throw': return this._throw(e, msg);
      case 'eat': return this._eat(e, msg);
      case 'washed': return this._washed(e, msg);
      case 'print': return this._print(e, msg);
      case 'fire': return this._fire(e, msg);
      case 'use': return this._use(e, msg);
      case 'vault': return this._vault(e, msg);
      case 'bed': return this._setBed(e, msg);
      case 'buy': return this._buy(e, msg);
      case 'pottery': return this._pottery(e, msg);
      case 'fish': return this._fish(e, msg);
      case 'milk': return this._milk(e, msg);
      case 'cook': return this._cook(e, msg);
      case 'craft': return this._craft(e, msg);
      case 'hotbar': return this._hotbar(e, msg);
      case 'fill': return this._fill(e, msg);
      case 'garden': return this._garden(e, msg);
      case 'wear': return this._wear(e, msg);
      case 'buildy': return this._buildy(e);
      case 'talk': return this._talk(e, msg); // a townsperson (npcs.js)
      case 'quest': return this._quest(e, msg);
      default:
    }
  }

  _state(e, msg) {
    const p = e.p;
    if (num(msg.yaw)) e.yaw = msg.yaw;
    if (num(msg.pitch)) e.pitch = msg.pitch;
    e.crouch = !!msg.crouch;
    e.flying = !!msg.flying && (e.p.buildy || e.p.effects.flight > 0); // only Buildy Bois fly (and the Flying spell)
    e.phoneOut = this.multiplayer && !!msg.phone;
    e.voiceMode = msg.voice === 'whisper' || msg.voice === 'shout' ? msg.voice : null; // holding Z / X (voice.js)
    if (msg.sw && num(msg.sw.left) && num(msg.sw.right)) e.sw = { left: msg.sw.left | 0, right: msg.sw.right | 0 }; // swing counts (avatars.js)
    e.mine = msg.mine === 'left' || msg.mine === 'right' ? msg.mine : null;
    e.draw = num(msg.draw) ? Math.max(0, Math.min(1, msg.draw)) : 0; // how far you've drawn your bow (avatars.js)
    const g = msg.grapple; // where your grappling hook is stuck (for others to see the rope)
    e.grapple = g && [g.x, g.y, g.z].every(num) ? { x: g.x, y: g.y, z: g.z } : null;
    p.height = (e.crouch ? 1.5 : 1.8) * p.sizeScale; // (shrunk: a fifth)
    p.halfW = 0.3 * p.sizeScale;
    for (const h of ['left', 'right']) {
      const k = msg.hands?.[h];
      if (typeof k === 'string' && k.length < 40) p.hands[h] = k;
    }
    p.validateHands();
    if (p.dead || !num(msg.x) || !num(msg.y) || !num(msg.z)) return;
    p.pos = { x: msg.x, y: msg.y, z: msg.z };
    if (p.pos.y < -30 && p.buildy) { // invincible, even to the void: back to your spawn point
      const pos = this._spawnPoint(e);
      p.spawn(pos); // (spawning keeps your hard hat on)
      e.send({ type: 'respawn', pos });
      return;
    }
    if (p.pos.y < -30) { // fell out of the world
      p.hp = 0;
      p.dead = true;
      p.lastHit = { cause: 'void', at: Date.now() };
      return;
    }
    this._trackFall(e);
    this._bonk(e);
  }

  /** Tall characters (Tallness over 10) sometimes bonk their heads stepping under a low ceiling. */
  _bonk(e) {
    const p = e.p;
    const cell = `${Math.floor(p.pos.x)},${Math.floor(p.pos.z)}`;
    if (cell === e.lastCell) return;
    e.lastCell = cell;
    const over = (p.stats.tallness ?? 10) - 10;
    if (over <= 0 || e.flying || p.inWater || p.buildy) return;
    const head = this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y) + 2, Math.floor(p.pos.z));
    if (!SOLID[head] || this.rand() * 100 >= over * T.bonkChance) return;
    p.damage(1, p.pos.x, p.pos.z, 0, { cause: 'bonk' });
    this._fx({ type: 'bonk', by: e.id, x: r2(p.pos.x), y: r2(p.pos.y + 1.9), z: r2(p.pos.z) });
    e.send({ type: 'msg', kind: 'sick', text: 'Bonk! Mind your head.' });
  }

  /** Falls: the highest point since you last stood on something. With the trait, a big drop heals you. */
  _trackFall(e) {
    const p = e.p;
    const y = p.pos.y;
    if (e.fallTop == null || e.teleportT > 0 || e.flying || e.grapple || p.inWater || p.onLadder || p.effects.flap > 0) { // (flapping isn't falling either) // flying, swinging and swimming aren't falling
      e.fallTop = y;
      return;
    }
    p.pos.y -= 0.08; // anything solid just under your feet?
    const grounded = p.collides();
    p.pos.y = y;
    if (!grounded) {
      e.fallTop = Math.max(e.fallTop, y);
      return;
    }
    const drop = e.fallTop - y;
    const heal = p.traits.fallHealing ? fallHealFor(drop) : 0;
    e.fallTop = y;
    if (heal > 0 && p.hp < p.maxHp) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + heal);
      e.send({ type: 'msg', text: `That was weird... (+${p.hp - before} health)`, kind: 'weird' });
    }
    // Fall damage (a server setting). Fall healers and gravity-resistant players are spared.
    const hurt = p.traits.fallHealing || p.traits.lowGravity ? 0 : fallDamageFor(drop, this.settings.fallDamage);
    if (hurt > 0 && p.damage(hurt, p.pos.x, p.pos.z, 0, { cause: 'fall', blocks: Math.round(drop) })) e.send({ type: 'msg', text: `Oof! A ${Math.round(drop)}-block fall`, kind: 'sick' });
  }

  /** A text to one player (`to` = their id) or to everyone (`to` = 'all'). */
  _text(e, { to, text }) {
    if (!this.multiplayer || e.textCd > 0) return;
    const body = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
    if (!body) return;
    e.textCd = TEXT_COOLDOWN;
    const msg = { type: 'text', from: e.id, fromName: e.name, to: to === 'all' ? 'all' : to, text: body };
    if (to === 'all') return this._broadcast(msg, e);
    const target = this.players.get(to);
    if (!target || target === e) return e.send({ type: 'textFailed', to });
    target.send(msg);
    return undefined;
  }

  /** Server voice (multiplayer): membership and the WebRTC set-up relay live in VoiceRoom; the audio goes browser to browser. */
  _voice(e, msg) {
    if (this.multiplayer && msg && typeof msg.op === 'string') this.voice.handle(e.id, msg);
  }

  _eye(e) {
    return { x: e.p.pos.x, y: e.p.pos.y + (e.crouch ? 1.27 : 1.62), z: e.p.pos.z };
  }

  _within(e, x, y, z, reach = REACH) {
    const eye = this._eye(e);
    return Math.hypot(x - eye.x, y - eye.y, z - eye.z) <= reach;
  }

  _holding(e, hand, test) {
    const kind = e.p.hands[hand];
    return (hand === 'left' || hand === 'right') && test(kind) ? kind : null;
  }

  /** Tell a client the real block at a spot after rejecting its edit. */
  _correct(e, x, y, z) {
    e.send({ type: 'blocks', list: [[x, y, z, this.world.getBlock(x, y, z)]] });
  }

  _place(e, { x, y, z, id }) {
    if (![x, y, z].every(Number.isInteger) || y < 0 || y >= CH || !Number.isInteger(id)) return;
    const base = baseId(id); // stairs facing east are still "Stairs" in your hand
    const kind = `block:${base}`;
    const door = isDoor(id);
    if (door && (doorInfo(id).top || doorInfo(id).open)) return this._correct(e, x, y, z);
    if (isTrapdoor(id) && (id - TRAPDOOR) % 2) return this._correct(e, x, y, z); // trapdoors go down closed
    if (isBed(id) && !bedInfo(id).head) return this._correct(e, x, y, z); // you place a bed by its head id
    // A bed's foot goes where you clicked and its head one block further away from you.
    const bed = isBed(id) ? { foot: BED_FOOT + bedInfo(id).facing, at: bedOther(BED_FOOT + bedInfo(id).facing, x, z) } : null;
    if (isLadder(id)) { // a ladder needs a solid wall behind it
      const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][id - LADDER];
      const wall = this.world.getBlock(x + dx, y, z + dz);
      if (!SOLID[wall] || SHAPES[wall]) return this._correct(e, x, y, z);
    }
    const free = (bx, by, bz) => {
      const b = this.world.getBlock(bx, by, bz);
      const blocked = [...this.players.values()].some((o) => !o.p.dead && o.p.intersectsBlock(bx, by, bz))
        || this.mobs.list.some((m) => m.intersectsBlock(bx, by, bz));
      return (b === AIR || FLUID[b] || b === SNOW_LAYER) && !blocked; // (snow gets built over)
    };
    if (isCrop(base) && (id !== base || !canPlant(this.world, x, y, z))) return this._correct(e, x, y, z); // seeds go on tilled dirt
    const ok = HOTBAR.includes(base) && (e.p.hands.left === kind || e.p.hands.right === kind) && itemCount(e.p, kind) > 0
      && this._within(e, x + 0.5, y + 0.5, z + 0.5) && free(x, y, z) && (!door || (y + 1 < CH && free(x, y + 1, z)))
      && (!bed || free(bed.at[0], y, bed.at[1]));
    if (!ok) {
      this._correct(e, x, y, z);
      if (door) this._correct(e, x, y + 1, z);
      if (bed) this._correct(e, bed.at[0], y, bed.at[1]);
      return;
    }
    this.world.setBlock(x, y, z, bed ? bed.foot : id);
    if (bed) this.world.setBlock(bed.at[0], y, bed.at[1], id); // the head half
    if (!e.p.buildy) { // Buildy Bois have unlimited blocks; everyone else uses one up
      e.p.blocks[base]--;
      e.p.validateHands();
    }
    if (door) this.world.setBlock(x, y + 1, z, doorId(doorInfo(id).facing, false, true)); // the top half
    if (isCrop(base)) this._skill(e, 'plant'); // a seed in the ground: a point in Plant
  }

  /** Press B: start putting on (or taking off) the hard hat; press again while switching to stop. */
  _buildy(e) {
    if (e.buildSwitch) {
      e.buildSwitch = null;
      e.send({ type: 'msg', kind: 'buildy', text: 'Never mind' });
    } else {
      e.buildSwitch = { to: !e.p.buildy, t: T.buildySwitch };
      e.send({ type: 'msg', kind: 'buildy', text: e.p.buildy ? 'Taking off the hard hat… (10 s)' : 'Putting on the hard hat… (10 s)' });
    }
    this._sendYou(e);
  }

  /** Standing (or swimming) in lava burns. Buildy Bois don't mind. */
  _lava(e, dt) {
    const p = e.p;
    if (p.dead) return;
    const at = (dy) => this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y + dy), Math.floor(p.pos.z));
    if (at(0.1) !== LAVA && at(1) !== LAVA) { e.lavaT = 0; return; }
    if ((e.lavaT = (e.lavaT || 0) - dt) > 0) return;
    e.lavaT = T.lavaEvery;
    if (p.damage(T.lavaDamage, p.pos.x, p.pos.z, 0, { cause: 'lava' })) e.send({ type: 'msg', kind: 'sick', text: 'Ouch! Lava!' });
  }

  /** Send your own state if it changed (every tick, and straight away after menu actions). */
  _sendYou(e) {
    const you = this._you(e);
    const json = JSON.stringify(you);
    if (json === e.lastYou) return;
    e.lastYou = json;
    e.send({ type: 'you', ...you });
  }

  /** Click a bed: it becomes where you respawn. */
  _setBed(e, { x, y, z }) {
    if (![x, y, z].every(Number.isInteger)) return;
    const id = this.world.getBlock(x, y, z);
    if (!isBed(id) || !this._within(e, x + 0.5, y + 0.5, z + 0.5)) return;
    if (!bedInfo(id).head) { // clicked the foot: the bed is remembered by its head
      const [hx, hz] = bedOther(id, x, z);
      if (isBed(this.world.getBlock(hx, y, hz))) [x, z] = [hx, hz];
    }
    const same = e.p.bed && e.p.bed.x === x && e.p.bed.y === y && e.p.bed.z === z;
    e.p.bed = { x, y, z };
    e.send({ type: 'msg', kind: 'bed', text: same ? 'This is already your bed' : 'Spawn point set: you\'ll wake up here' });
  }

  /** Where you come back to life: your bed if it's still there and has room above it, else the world spawn. */
  _spawnPoint(e) {
    const b = e.p.bed;
    if (b) {
      const free = (y) => !SOLID[this.world.getBlock(b.x, y, b.z)];
      if (isBed(this.world.getBlock(b.x, b.y, b.z)) && free(b.y + 1) && free(b.y + 2)) return { x: b.x + 0.5, y: b.y + 0.5625, z: b.z + 0.5 };
      e.p.bed = null;
      e.send({ type: 'msg', kind: 'bed', text: 'Your bed was missing or blocked, so you woke up at the world spawn' });
    }
    return this.world.findSpawn();
  }

  /** A line typed in the / console (commands.js); the replies go back to the console. */
  _command(e, { text }) {
    if (typeof text !== 'string' || text.length > 200) return;
    for (const line of runCommand(this, e, text)) e.send({ type: 'console', ...line });
  }

  /** Moves a player (their browser moves them, so tell it). `note` tells them who did it. */
  _teleport(e, pos, note = null) {
    const p = e.p;
    p.pos = { ...pos };
    p.vel = { x: 0, y: 0, z: 0 };
    e.grapple = null;
    e.fallTop = null;
    e.teleportT = 2; // seconds: positions from before the jump may still arrive, so don't count them as a fall
    e.send({ type: 'teleport', pos: { ...pos } });
    if (note) e.send({ type: 'msg', kind: 'teleport', text: note });
    this._fx({ type: 'sparkle', x: r2(pos.x), y: r2(pos.y + 1), z: r2(pos.z) });
  }

  // ---------- who did it (death messages, and whose skill gets a kill) ----------

  /** A damage source for a player's attack: their name (if they're still here), what they used, and its skill. */
  _src(id, weapon, skill = null) {
    const o = this.players.get(id);
    return { cause: 'player', by: o ? o.name : 'someone', byId: id, weapon, skill };
  }

  /** A projectile's damage source: whoever fired it, with the gun or spell it came from. */
  _shotBy(fb) {
    return this._src(fb.owner, fb.weapon || PROJECTILE_NAMES[fb.kind] || 'a projectile', fb.skill);
  }

  /** Points in a skill (skills.js): silent (the character sheet shows them), plus a level-up message (everyone hears about it) when it gives one. */
  _skill(e, kind, n = 1) {
    const p = e.p;
    if (!kind || p.buildy && kind !== 'dishwash') return; // (Buildy Bois don't train)
    const levels = p.gainSkill(kind, n);
    if (levels) {
      const pts = levels * T.statPointsPerLevel;
      p.statPoints += pts;
      e.send({ type: 'msg', text: `Level ${p.level}! Max health ${p.maxHp}${pts ? ` · ${pts} attribute point${pts === 1 ? '' : 's'} to spend (I)` : ''}`, kind: 'level' });
      if (this.multiplayer) this._broadcast({ type: 'msg', kind: 'event', text: `⭐ ${e.name} reached level ${p.level}` }, e);
    }
  }

  /**
   * Settings > Players, for Admins: { op: 'list' } and, for a Player `uid`: 'recover' (a one-time recovery
   * code), 'rename' (name), 'kick', 'ban' (on), 'adminRole' (on), 'delete'. Each answers with the list.
   */
  _admin(e, { op, uid, name, on }) {
    const me = this.accounts.get(e.uid);
    if (!me?.admin) return;
    const a = this.accounts.get(uid);
    const online = [...this.players.values()].find((o) => o.uid === uid);
    const note = (text, error = false) => e.send({ type: 'adminNote', text, error });
    if (op === 'recover' && a) {
      const code = this.accounts.issueRecovery(uid);
      note(`Recovery code for ${a.name}: ${code} (works once, for 24 hours). They type it in under Recover Player.`);
    } else if (op === 'rename' && a) {
      const r = this.accounts.rename(uid, cleanName(name));
      if (r.error) note(r.error, true);
      else if (online) { online.name = r.name; online.send({ type: 'renamed', name: r.name }); this.voice.update(); }
    } else if (op === 'kick' && online) {
      if (online === e) return note('You can\'t kick yourself.', true);
      online.send({ type: 'kicked', reason: 'An Admin removed you from the server.' });
      this.leave(online.id);
    } else if (op === 'ban' && a) {
      if (uid === e.uid) return note('You can\'t ban yourself.', true);
      if (on && a.admin && this.accounts.admins() <= 1) return note('That\'s the last Admin.', true);
      this.accounts.set(uid, 'banned', on);
      if (on && online) { online.send({ type: 'kicked', reason: 'You\'re banned from this server.' }); this.leave(online.id); }
    } else if (op === 'adminRole' && a) {
      if (!on && a.admin && this.accounts.admins() <= 1) return note('There has to be at least one Admin.', true);
      this.accounts.set(uid, 'admin', on);
      online?.send({ type: 'adminRole', admin: !!on });
    } else if (op === 'delete' && a) {
      if (uid === e.uid) return note('You can\'t delete yourself.', true);
      if (a.admin && this.accounts.admins() <= 1) return note('That\'s the last Admin.', true);
      if (online) { online.send({ type: 'kicked', reason: 'An Admin deleted your Player.' }); this.leave(online.id); }
      for (const cid of Object.keys(this.accounts.characters(uid))) this.savePlayer(`${uid}.${cid}`, null); // (and every character's saves)
      this.accounts.remove(uid);
      note(`Deleted ${a.name}`);
    } else if (op !== 'list') return;
    const onlineIds = new Set([...this.players.values()].map((o) => o.uid));
    e.send({
      type: 'players',
      list: Object.entries(this.accounts.list).map(([id, acc]) => {
        const live = [...this.players.values()].find((o) => o.uid === id);
        const chars = Object.values(acc.characters || {}).map((c) => c.name);
        return {
          uid: id, name: acc.name, admin: acc.admin, banned: acc.banned, online: onlineIds.has(id), you: id === e.uid,
          level: live ? live.p.level : null, playing: live ? live.name : null, characters: chars,
          created: acc.created, seen: live ? Date.now() : acc.seen,
          recovery: acc.recovery && acc.recovery.expires > Date.now() ? acc.recovery.code : null,
        };
      }).sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name)),
    });
  }

  /** "Sam was killed by a Zombie", "Sam died from falling 14 blocks", "Sam was killed by Alex (Longsword)"... */
  _deathText(e) {
    const h = e.p.lastHit && Date.now() - e.p.lastHit.at < 15000 ? e.p.lastHit : null;
    const name = e.name;
    if (!h) return `💀 ${name} died`;
    switch (h.cause) {
      case 'mob': {
        const mob = BESTIARY.find((b) => b.type === h.mob)?.name ?? h.mob;
        const a = /^[aeiou]/i.test(mob) ? 'an' : 'a';
        if (h.mob === 'skeleton') return `🏹 ${name} was shot by ${a} ${mob}`;
        return `💀 ${name} was killed by ${a} ${mob}`;
      }
      case 'player':
        if (h.byId === e.id) return `💥 ${name} killed themselves (${h.weapon})`;
        return `⚔️ ${name} was killed by ${h.by}${h.weapon ? ` (${h.weapon})` : ''}`;
      case 'fall': return `🪂 ${name} died from falling ${h.blocks} block${h.blocks === 1 ? '' : 's'}`;
      case 'lava': return `🔥 ${name} burned to death in lava`;
      case 'lactose': return `🥛 ${name} died of lactose intolerance`;
      case 'rawmeat': return `🥩 ${name} died of eating raw meat`;
      case 'bonk': return `🤕 ${name} bonked their head one time too many`;
      case 'allergy': return `🤧 ${name} sneezed themselves to death (pet allergies)`;
      case 'void': return `🕳️ ${name} fell out of the world`;
      case 'crushed': return `🧱 ${name} was crushed by falling blocks`;
      default: return `💀 ${name} died`;
    }
  }

  // ---------- gardening (garden.js) ----------

  /** Till, water or weed with the tool in your hand, at a block within reach. */
  _garden(e, { hand, x, y, z, facing }) {
    if (![x, y, z].every(Number.isInteger) || (e.gardenCd || 0) > performance.now()) return;
    const kind = this._holding(e, hand, (k) => k in GARDEN_TOOLS);
    if (!kind || !(itemCount(e.p, kind) > 0) || !this._within(e, x + 0.5, y + 0.5, z + 0.5)) return;
    e.gardenCd = performance.now() + 250;
    const action = GARDEN_TOOLS[kind];
    const n = action === 'till' ? till(this.world, x, y, z, Number.isInteger(facing) ? facing : 0)
      : action === 'water' ? water(this.world, x, y, z) : torch(this.world, x, y, z);
    this._fx({ type: 'garden', action, by: e.id, x: x + 0.5, y: y + 1, z: z + 0.5, n });
    if (n) this._skill(e, kind);
    if (n && action === 'till') this._tilledFor(e, x, y, z, n);
    if (!n && action === 'till') e.send({ type: 'msg', kind: 'deny', text: 'Till dirt or grass with nothing on top' });
    if (!n && action !== 'till') e.send({ type: 'msg', kind: 'deny', text: `Aim at your garden (tilled dirt) to ${action === 'water' ? 'water' : 'weed'} it` });
  }

  /** Picking a crop: vegetables if it was ripe (as drops you walk over), and sometimes a second seed. */
  _harvest(e, id, x, y, z, soil = this.world.getBlock(x, y - 1, z)) {
    const h = harvest(id, this.rand, soil);
    for (let i = 0; i < h.n; i++) this.drops.spawn(h.food, x + 0.5, y + 0.4, z + 0.5);
    if (h.extraSeed && !e.p.buildy) e.p.blocks[baseId(id)] = (e.p.blocks[baseId(id)] || 0) + 1;
    if (cropInfo(id).stage === 3 && h.n) e.send({ type: 'msg', kind: 'heal', text: `Harvested ${h.n} ${FOOD[h.food].name.toLowerCase()}${h.extraSeed ? ' and a spare seed' : ''}${h.weedy ? ' (the weeds took their share)' : ''}` });
    else if (h.weedy) e.send({ type: 'msg', kind: 'deny', text: 'The weeds choked this one: nothing to harvest' });
  }

  /** Sunrise: the gardens grow (and the weeds too). */
  _newDay() {
    const { grew } = newDay(this.world, this.rand);
    if (grew) this._broadcast({ type: 'msg', kind: 'event', text: `🌱 Morning in the garden: ${grew} plant${grew === 1 ? '' : 's'} grew` });
  }

  /** Buy something at a Fantasy Town shop counter: its dollar price in ZEC at this moment's rate, no fee, no wait. */
  _buy(e, { x, y, z, kind }) {
    if (![x, y, z].every(Number.isInteger) || typeof kind !== 'string') return;
    const shop = shopOfBlock(this.world.getBlock(x, y, z));
    if (!shop || !this._within(e, x + 0.5, y + 0.5, z + 0.5)) return;
    const offer = townOffer(shop, kind);
    if (!offer) return;
    const zec = zecFor(this.priceFor(e.p, kind, offer.usd), this.rate);
    if (!e.p.pay(zec)) {
      e.send({ type: 'msg', kind: 'deny', text: `Not enough Zcash: ${itemName(kind)} costs ${zec.toFixed(2)} ZEC right now` });
      return;
    }
    grantItem(e.p, kind, offer);
    this._sendYou(e); // menus pause single player, so don't wait for a tick
    e.send({ type: 'msg', kind: 'buy', text: `Bought ${offer.n > 1 ? `${offer.n} ` : ''}${itemName(kind)} for ${zec.toFixed(2)} ZEC` });
  }

  /** Put on the armor in your hand (what you had on goes back in your inventory), or take it off ({ kind: 'none' }). */
  _wear(e, { hand, kind }) {
    const p = e.p;
    if (kind === 'none') {
      if (!p.worn) return;
      if (!p.wornFree) p.tools[p.worn] = (p.tools[p.worn] || 0) + 1; // (armor a Buildy Boi put on was never theirs to keep)
      p.wornFree = false;
      e.send({ type: 'msg', kind: 'armor', text: `You took off your ${itemName(p.worn).toLowerCase()}` });
      p.worn = null;
      this._sendYou(e);
      return;
    }
    const held = this._holding(e, hand, isArmor);
    if (!held || !(itemCount(p, held) > 0)) return;
    spend(p, 'tools', held);
    if (p.worn && !p.wornFree) p.tools[p.worn] = (p.tools[p.worn] || 0) + 1;
    p.worn = held;
    p.wornFree = !!p.buildy; // a Buildy Boi's armor comes from nowhere, and goes back there
    p.validateHands(hand);
    e.send({ type: 'msg', kind: 'armor', text: `You put on your ${itemName(held).toLowerCase()}: hits hurt ${Math.round(TOOLS[held].armor)}% less` });
    this._sendYou(e);
  }

  /** Move Zcash between your wallet and cold storage, at a Cold Wallet block. */
  _vault(e, { x, y, z, op, amount }) {
    const w = e.p.wallet;
    if (![x, y, z].every(Number.isInteger) || this.world.getBlock(x, y, z) !== COLD_WALLET || !this._within(e, x + 0.5, y + 0.5, z + 0.5)) return;
    if (!num(amount) || amount <= 0 || (op !== 'deposit' && op !== 'withdraw')) return;
    const from = op === 'deposit' ? 'zcash' : 'cold';
    const to = op === 'deposit' ? 'cold' : 'zcash';
    const n = round2(Math.min(amount, w[from]));
    if (n <= 0) return;
    w[from] = round2(w[from] - n);
    w[to] = round2(w[to] + n);
    this._sendYou(e); // menus pause single player, so don't wait for a tick
    e.send({ type: 'msg', kind: 'vault', text: op === 'deposit' ? `Moved ${n.toFixed(2)} ZEC to cold storage` : `Took ${n.toFixed(2)} ZEC out of cold storage` });
  }

  /** Open or close a door (both halves) or a trapdoor. */
  _use(e, { x, y, z }) {
    if (![x, y, z].every(Number.isInteger)) return;
    const id = this.world.getBlock(x, y, z);
    if (!(isDoor(id) || isTrapdoor(id) || isLuminary(id)) || !this._within(e, x + 0.5, y + 0.5, z + 0.5)) return this._correct(e, x, y, z);
    if (isLuminary(id)) { // light it, or put it out
      this.world.setBlock(x, y, z, toggledLuminary(id));
      return undefined;
    }
    if (isTrapdoor(id)) {
      this.world.setBlock(x, y, z, TRAPDOOR + ((id - TRAPDOOR) ^ 1)); // flip the open bit
      return undefined;
    }
    const { facing, open, top } = doorInfo(id);
    const otherY = top ? y - 1 : y + 1;
    this.world.setBlock(x, y, z, doorId(facing, !open, top));
    if (isDoor(this.world.getBlock(x, otherY, z))) this.world.setBlock(x, otherY, z, doorId(facing, !open, !top));
    return undefined;
  }

  _break(e, { x, y, z }) {
    if (![x, y, z].every(Number.isInteger) || y <= 0 || y >= CH) return; // y=0 is the unbreakable floor
    const existing = this.world.getBlock(x, y, z);
    const ok = (isMiningKind(e.p.hands.left) || isMiningKind(e.p.hands.right)) && this._within(e, x + 0.5, y + 0.5, z + 0.5);
    if (!ok || existing === AIR || FLUID[existing] || UNBREAKABLE[existing]) return this._correct(e, x, y, z);
    this.world.setBlock(x, y, z, AIR);
    const got = baseId(existing);
    if (!e.p.buildy && got in e.p.blocks) e.p.blocks[got]++; // you keep what you break (Buildy Bois don't need to)
    // A block broken with the right tool: a point for that tool.
    const tool = [e.p.hands.left, e.p.hands.right].find((k) => k !== 'empty' && rightTool(existing, k)); // (stone tools count)
    if (tool) this._skill(e, tool);
    const clay = e.p.buildy ? null : clayFind(existing, this.rand); // digging sometimes turns up clay (pottery.js)
    if (clay) {
      e.p.blocks[clay] = (e.p.blocks[clay] || 0) + 1;
      e.send({ type: 'msg', kind: 'clay', text: `Found some ${BLOCKS[clay].name.toLowerCase()}` });
    }
    // Gathering (forage.js): coal and ore in stone, herbs in grass, mushrooms in dirt and mud.
    if (!e.p.buildy) {
      for (const kind of forageFind(existing, this.rand)) {
        e.p.materials[kind] = (e.p.materials[kind] || 0) + 1;
        e.send({ type: 'msg', kind: 'found', text: `Found ${itemName(kind).replace(/^[A-Z]/, (c) => c.toLowerCase())}!` });
      }
    }
    // Gathering (crafting.js): leaves sometimes drop a stick, grass sometimes some plant fiber.
    if (LEAFY[existing] && this.rand() < T.stickChance) this.drops.spawn('stick', x + 0.5, y + 0.4, z + 0.5);
    if ((existing === GRASS || existing === SNOW_GRASS) && this.rand() < T.fiberChance) this.drops.spawn('fiber', x + 0.5, y + 0.9, z + 0.5);
    if (existing === WHEAT) this.drops.spawn('wheat', x + 0.5, y + 0.4, z + 0.5, false); // cut wheat: an ingredient for bread (cooking.js)
    if (isCrop(existing)) this._harvest(e, existing, x, y, z); // (you got its seed back above)
    if (isSoil(existing) && isCrop(this.world.getBlock(x, y + 1, z))) { // the plant on it comes up too
      const crop = this.world.getBlock(x, y + 1, z);
      this.world.setBlock(x, y + 1, z, AIR);
      this._harvest(e, crop, x, y + 1, z, existing); // (the dirt under it is already gone)
      if (!e.p.buildy) e.p.blocks[baseId(crop)] = (e.p.blocks[baseId(crop)] || 0) + 1;
    }
    if (isDoor(existing)) { // a door comes away whole
      const otherY = doorInfo(existing).top ? y - 1 : y + 1;
      if (isDoor(this.world.getBlock(x, otherY, z))) this.world.setBlock(x, otherY, z, AIR);
    }
    if (isBed(existing)) { // so does a bed
      const [ox, oz] = bedOther(existing, x, z);
      if (isBed(this.world.getBlock(ox, y, oz))) this.world.setBlock(ox, y, oz, AIR);
    }
  }

  _attack(e, { hand, mob, player, o, d }) {
    const kind = this._holding(e, hand, isMiningKind);
    if (!kind || e.meleeCd > 0) return;
    const style = meleeStyle(kind, hand);
    if (style === 'sweep') return this._sweep(e, kind, o, d);
    this._reveal(e);
    let target = null;
    if (num(mob)) target = this.mobs.list.find((m) => m.id === mob && !m.dead) || null;
    else if (num(player) && this.multiplayer && this.settings.pvp) {
      const o = this.players.get(player);
      if (o && o !== e && !o.p.dead) target = o.p;
    }
    if (!target) return;
    const c = target.center;
    if (!this._within(e, c.x, c.y, c.z)) return;
    const chop = style === 'chop'; // an overhead slash: harder, and slower to recover from
    e.meleeCd = T.meleeCooldown * (chop ? T.chopCooldown : 1);
    const stats = itemStats(kind);
    const damage = Math.max(1, Math.round(stats.damage * statEffects(e.p.stats).damage * this._mult(e) * (chop ? T.chopDamage / 100 : 1))); // Strongth, Power Surge
    target.damage(damage, e.p.pos.x, e.p.pos.z, stats.knock * (chop ? 1.3 : 1), this._src(e.id, itemName(kind), kind));
    if (kind === 'pillow') this._fx({ type: 'feathers', x: c.x, y: c.y, z: c.z });
  }

  /** A horizontal slash: everything (mobs, and players with PvP on) in an arc in front of you, within reach. */
  _sweep(e, kind, o, d) {
    const aim = this._aim(e, o, d);
    if (!aim) return;
    const [eye, dir] = aim;
    this._reveal(e);
    e.meleeCd = T.meleeCooldown;
    const stats = itemStats(kind);
    const damage = Math.max(1, Math.round(stats.damage * statEffects(e.p.stats).damage * this._mult(e) * T.sweepDamage / 100));
    const fx = dir.x;
    const fz = dir.z;
    const flen = Math.hypot(fx, fz) || 1;
    const cosHalf = Math.cos((Math.min(360, T.sweepArc) / 2) * (Math.PI / 180));
    const targets = [
      ...this.mobs.list.filter((m) => !m.dead),
      ...(this.multiplayer && this.settings.pvp ? [...this.players.values()].filter((o2) => o2 !== e && !o2.p.dead).map((o2) => o2.p) : []),
    ];
    for (const t of targets) {
      const c = t.center;
      const dx = c.x - eye.x;
      const dz = c.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist > T.sweepReach + (t.halfW || 0.3) || Math.abs(c.y - eye.y) > 2) continue;
      if (dist > 0.3 && (dx * fx + dz * fz) / (dist * flen) < cosHalf) continue; // outside the arc
      t.damage(damage, e.p.pos.x, e.p.pos.z, stats.knock, this._src(e.id, itemName(kind), kind));
    }
  }

  /** Origin must be near your eyes; direction is normalised. Returns [origin, dir] or null. */
  _aim(e, o, d) {
    if (!o || !d || ![o.x, o.y, o.z, d.x, d.y, d.z].every(num)) return null;
    if (!this._within(e, o.x, o.y, o.z, 3)) return null;
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1e-6) return null;
    return [{ x: o.x, y: o.y, z: o.z }, { x: d.x / len, y: d.y / len, z: d.z / len }];
  }

  /**
   * Cast the spell you picked (spells.js) with an empty hand, a Wand or a Staff. Costs mana; the focus
   * sets the potency. Targeted spells that find nothing to target cost nothing.
   */
  _cast(e, { hand, spell, o, d }) {
    const s = SPELLS[spell];
    // A Wand, Staff or empty hand casts with mana; a scroll of the spell casts it for free and is used up.
    const kind = this._holding(e, hand, (k) => isFocus(k) || scrollOf(k) === spell);
    const aim = this._aim(e, o, d);
    if (!s || !kind || !aim) return;
    const scroll = !!scrollOf(kind);
    if (scroll && !(itemCount(e.p, scrollKind(spell)) > 0)) return;
    const p = e.p;
    const knows = p.buildy || p.spells.includes(spell);
    if (scroll && !knows) { // reading a scroll of a spell you don't know teaches it to you (and uses the scroll up)
      p.spells.push(spell);
      spend(p, 'scrolls', spell);
      p.validateHands(hand);
      e.send({ type: 'msg', kind: 'level', text: `📜 You learned ${s.name}! Pick it with the scroll wheel and cast it with mana.` });
      this._sendYou(e);
      return;
    }
    if (!knows) return e.send({ type: 'msg', kind: 'deny', text: `You don't know ${s.name}: buy its scroll from the Wizard in the Fantasy Town and read it` });
    if ((e.castCd[spell] || 0) > 0) return;
    const cost = scroll ? 0 : spellCost(spell, this.settings);
    if (p.mana < cost) {
      e.send({ type: 'msg', kind: 'deny', text: `Not enough mana for ${s.name} (${cost})` });
      return;
    }
    const [origin, dir] = aim;
    const set = this.settings;
    const m = (key) => magic(set, key);
    const potency = scroll ? m('scrollPotency') : focusPotency(kind, set);
    e.castSkill = scroll || kind === 'empty' ? 'magic' : kind; // a kill by this spell trains the Wand or Staff (or Magic)
    const power = potency * this._mult(e); // damage also scales with Power Surge (and shrinking)
    const target = () => this._spellTarget(e, origin, dir, m('spellRange'));
    let ok = true;
    switch (spell) {
      case 'fireball':
        this.fireballs.shoot(origin, dir, e.id, { mult: m('fireballDamage') * power, skill: e.castSkill });
        break;
      case 'missile':
        this.fireballs.shoot(origin, dir, e.id, { kind: 'missile', speed: m('missileSpeed'), gravity: 0, radius: 0, mult: m('missileDamage') * power, lifetime: m('missileLifetime'), skill: e.castSkill });
        break;
      case 'icebolt': {
        const fb = this.fireballs.shoot(origin, dir, e.id, { kind: 'icebolt', speed: m('iceboltSpeed'), gravity: 0, radius: 0, mult: m('iceboltDamage') * power, skill: e.castSkill });
        fb.chill = m('chillSeconds') * potency;
        break;
      }
      case 'blizzard': { // a ball of ice, thrown like a fireball: the storm starts where it lands
        const fb = this.fireballs.shoot(origin, dir, e.id, { kind: 'snowball', speed: m('blizzardSpeed'), gravity: m('blizzardDrop'), radius: 0, mult: 0, skill: e.castSkill });
        fb.storm = { seconds: m('blizzardSeconds') * potency, damage: m('blizzardDamage') * power, chill: m('chillSeconds') * potency };
        break;
      }
      case 'lightning': ok = this._chainLightning(e, origin, target(), m('lightningDamage') * power); break;
      case 'shrink': case 'enlarge': ok = this._hex(e, target(), spell, m(SIZE_SPELLS[spell].seconds) * potency); break;
      case 'polymorph': ok = this._hex(e, target(), 'polymorph', m('polymorphSeconds') * potency); break;
      case 'hallucinate': ok = this._hex(e, target(), 'hallucinate', m('hallucinateSeconds') * potency); break;
      case 'stoneskin':
        p.effects.stoneskin = m('stoneskinSeconds') * potency;
        p.armor = Math.min(m('stoneskinMaxArmor'), m('stoneskinArmor') * potency) / 100;
        e.send({ type: 'msg', kind: 'spell', text: `🪨 Stoneskin: ${Math.round(p.armor * 100)}% less damage` });
        break;
      case 'invisibility':
        p.effects.invisible = m('invisibilitySeconds') * potency;
        e.send({ type: 'msg', kind: 'spell', text: '👻 You vanish (attacking ends it)' });
        break;
      case 'flight':
        p.effects.flight = m('flightSeconds') * potency;
        e.send({ type: 'msg', kind: 'spell', text: `🕊️ You can fly for ${Math.round(p.effects.flight)} s: press F to take off` });
        break;
      case 'teleport': ok = this._blink(e, origin, dir, m('teleportRange')); break;
      case 'dragon': this._breath(e, origin, dir, m('breathRange'), m('breathArc'), m('breathDamage') * power); break;
      case 'blind': ok = this._hex(e, target(), 'blind', m('blindSeconds') * potency); break;
      default: return;
    }
    if (!ok) {
      e.send({ type: 'msg', kind: 'deny', text: `${s.name}: nothing to target` });
      return;
    }
    p.mana = Math.max(0, p.mana - cost);
    if (scroll) {
      spend(p, 'scrolls', spell);
      p.validateHands(hand);
    }
    e.castCd[spell] = spellCooldown(spell, set);
    if (s.offensive) this._reveal(e);
    this._fx({ type: 'cast', spell, by: e.id, x: r2(origin.x), y: r2(origin.y), z: r2(origin.z) });
    this._sendYou(e);
  }

  /** The first mob, or other player (with PvP on), along a ray before any block: { target, entry? } or null. */
  _spellTarget(e, origin, dir, range) {
    const block = this.world.raycast(origin, dir, range);
    let best = null;
    let bestT = block ? block.t : range;
    const test = (target, entry = null) => {
      const t = target.rayHit(origin, dir, bestT);
      if (t !== null && t < bestT) { bestT = t; best = { target, entry }; }
    };
    for (const m of this.mobs.list) if (!m.dead) test(m);
    if (this.settings.pvp) for (const o of this.players.values()) if (o !== e && !o.p.dead) test(o.p, o);
    return best;
  }

  /** Lightning hits the target, then jumps to the nearest thing it hasn't hit (settings: jumps, distance, falloff). */
  _chainLightning(e, origin, first, damage) {
    if (!first) return false;
    const points = [{ x: r2(origin.x), y: r2(origin.y), z: r2(origin.z) }];
    const hit = new Set();
    let cur = first.target;
    let from = origin;
    const jumps = magic(this.settings, 'lightningJumps');
    for (let i = 0; cur && i <= jumps; i++) {
      hit.add(cur);
      cur.damage(Math.max(1, Math.round(damage)), from.x, from.z, 2, this._src(e.id, 'Chain Lightning', e.castSkill));
      const c = cur.center;
      points.push({ x: r2(c.x), y: r2(c.y), z: r2(c.z) });
      from = c;
      damage *= magic(this.settings, 'lightningFalloff') / 100;
      let next = null;
      let nextD = magic(this.settings, 'lightningJump');
      const candidates = [...this.mobs.list.filter((m) => !m.dead),
        ...(this.settings.pvp ? [...this.players.values()].filter((o) => o !== e && !o.p.dead).map((o) => o.p) : [])];
      for (const t of candidates) {
        if (hit.has(t)) continue;
        const tc = t.center;
        const dd = Math.hypot(tc.x - c.x, tc.y - c.y, tc.z - c.z);
        if (dd < nextD) { nextD = dd; next = t; }
      }
      cur = next;
    }
    this._fx({ type: 'chain', points });
    return true;
  }

  /**
   * Puts a spell on whatever was targeted, for `seconds`: a size spell (shrink, enlarge; a new one replaces
   * the old), polymorph or hallucinate.
   */
  _hex(e, found, kind, seconds) {
    if (!found) return false;
    const { target, entry } = found;
    const size = kind in SIZE_SPELLS;
    if (entry) { // another player
      if (size) for (const k in SIZE_SPELLS) target.effects[k] = 0;
      target.effects[kind] = seconds;
      const text = { blind: `${e.name} blinded you!`, shrink: `${e.name} shrank you!`, enlarge: `${e.name} made you huge!`, polymorph: `${e.name} turned you into a baby!`, hallucinate: `${e.name} messed with your head...` }[kind];
      entry.send({ type: 'msg', kind: 'sick', text });
      this._sendYou(entry);
    } else if (size) {
      target.sizeSpell = kind;
      target.sizeT = seconds;
    } else if (kind === 'polymorph') target.polyT = seconds;
    else if (kind === 'blind') target.blindT = seconds;
    else target.halluT = seconds;
    const c = target.center;
    this._fx({ type: size ? 'sizeFx' : kind === 'hallucinate' ? 'halluFx' : 'puff', spell: kind, x: r2(c.x), y: r2(c.y), z: r2(c.z) });
    return true;
  }

  /**
   * Teleportation: to the spot you're looking at (the face of the first block within `range`, with room to
   * stand), or as far as it reaches through open air. Returns false if there's nowhere to go.
   */
  _blink(e, origin, dir, range) {
    const hit = this.world.raycast(origin, dir, range);
    const room = (x, y, z) => !SOLID[this.world.getBlock(x, y, z)] && !SOLID[this.world.getBlock(x, y + 1, z)];
    let spot = null;
    if (hit) {
      const [nx, ny, nz] = hit.normal;
      const x = hit.x + nx;
      const z = hit.z + nz;
      for (const y of ny === 1 ? [hit.y + 1] : [hit.y + ny, hit.y + ny - 1, hit.y + ny + 1]) { // (on top, or beside it)
        if (y > 0 && y < CH - 2 && room(x, y, z)) { spot = { x: x + 0.5, y, z: z + 0.5 }; break; }
      }
    } else {
      spot = { x: origin.x + dir.x * range, y: Math.max(1, Math.min(CH - 3, origin.y + dir.y * range - 1.6)), z: origin.z + dir.z * range };
      if (!room(Math.floor(spot.x), Math.floor(spot.y), Math.floor(spot.z))) spot = null;
    }
    if (!spot) return false;
    this._fx({ type: 'sparkle', x: r2(e.p.pos.x), y: r2(e.p.pos.y + 1), z: r2(e.p.pos.z) }); // (where you were)
    this._teleport(e, spot);
    return true;
  }

  /** Dragon's Breath: fire in a cone in front of you burns every creature (and player, with PvP) in it. */
  _breath(e, origin, dir, range, arc, damage) {
    const cosHalf = Math.cos((Math.min(360, arc) / 2) * (Math.PI / 180));
    const targets = [
      ...this.mobs.list.filter((m) => !m.dead),
      ...(this.multiplayer && this.settings.pvp ? [...this.players.values()].filter((o) => o !== e && !o.p.dead).map((o) => o.p) : []),
    ];
    for (const t of targets) {
      const c = t.center;
      const dx = c.x - origin.x;
      const dy = c.y - origin.y;
      const dz = c.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > range + (t.halfW || 0.3) || (dist > 0.5 && (dx * dir.x + dy * dir.y + dz * dir.z) / dist < cosHalf)) continue;
      if (this.world.raycast(origin, { x: dx / dist, y: dy / dist, z: dz / dist }, dist)) continue; // behind a wall
      if (damage > 0) t.damage(Math.max(1, Math.round(damage)), origin.x, origin.z, 3, this._src(e.id, 'Dragon\'s Breath', e.castSkill));
    }
    this._fx({ type: 'breath', by: e.id, x: r2(origin.x), y: r2(origin.y), z: r2(origin.z), dx: r2(dir.x), dy: r2(dir.y), dz: r2(dir.z), range, arc });
  }

  /** A Blizzard's ball of ice landed (on a block, a creature or a player, in water, or ran out of time): the storm starts there. */
  _blizzard(fb, at) {
    const { seconds, damage, chill } = fb.storm;
    this.storms.push({ id: this.nextStormId++, owner: fb.owner, x: at.x, y: at.y, z: at.z, t: seconds, damage, chill, biteT: 0, skill: fb.skill });
    this._fx({ type: 'frost', x: r2(at.x), y: r2(at.y), z: r2(at.z) });
  }

  /** Blizzards bite (damage and chill) everything inside them but their caster, and freeze water. */
  _updateStorms(dt) {
    const set = this.settings;
    const r = magic(set, 'blizzardRadius');
    for (const s of this.storms) {
      s.t -= dt;
      if ((s.biteT -= dt) > 0) continue;
      s.biteT = magic(set, 'blizzardEvery');
      const owner = this.players.get(s.owner);
      const targets = [
        ...this.mobs.list.filter((m) => !m.dead),
        ...[...this.players.values()].filter((o) => o.id !== s.owner && !o.p.dead && (set.pvp || !owner)).map((o) => o.p),
      ];
      for (const t of targets) {
        const dy = t.pos.y - s.y;
        if (Math.hypot(t.pos.x - s.x, t.pos.z - s.z) > r || dy < -2 || dy > r) continue;
        if (s.damage > 0) t.damage(Math.max(1, Math.round(s.damage)), s.x, s.z, 0.5, this._src(s.owner, 'Blizzard', s.skill));
        this._chill(t, s.chill);
      }
      if (set.freezeWater) this._freeze(s.x, s.y, s.z, r, true);
      for (let i = 0; i < magic(set, 'blizzardSnow'); i++) { // snow settles in random spots under it
        const a = this.rand() * Math.PI * 2;
        const d = Math.sqrt(this.rand()) * r;
        this._snowAt(Math.floor(s.x + Math.cos(a) * d), Math.floor(s.z + Math.sin(a) * d), s.y + r);
      }
    }
    this.storms = this.storms.filter((s) => s.t > 0);
  }

  /**
   * Lays snow on the top of the column (x, z) at or below height `fromY` (down to a few blocks under it): on
   * a solid, full block with air above. Returns true if it snowed.
   */
  _snowAt(x, z, fromY) {
    if (!this.settings.snowCover) return false;
    for (let y = Math.floor(fromY); y > Math.floor(fromY) - 10 && y > 1; y--) {
      const here = this.world.getBlock(x, y, z);
      if (here === SNOW_LAYER) return false; // already snowy
      if (here !== AIR) return false; // (water, plants, anything: the snow stops on it)
      const below = this.world.getBlock(x, y - 1, z);
      if (below === AIR) continue;
      if (!SOLID[below] || SHAPES[below]) return false; // only on solid, full blocks
      this.world.setBlock(x, y, z, SNOW_LAYER);
      const melt = magic(this.settings, 'snowMelt');
      if (melt > 0) this.snow.set(`${x},${y},${z}`, melt * (0.75 + this.rand() * 0.5));
      return true;
    }
    return false;
  }

  /** Snow on everything within `radius` of a point (an icebolt landing). */
  _snowAround(cx, cy, cz, radius) {
    if (radius <= 0) return;
    const r = Math.ceil(radius);
    for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
      for (let z = Math.floor(cz) - r; z <= Math.floor(cz) + r; z++) {
        if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= radius) this._snowAt(x, z, cy + 1.5);
      }
    }
  }

  /** Once a second: melt the snow whose time is up (if it's still there). */
  _meltSnow(dt) {
    if ((this.snowT += dt) < 1) return;
    const step = this.snowT;
    this.snowT = 0;
    for (const [key, t] of this.snow) {
      if (t - step > 0) { this.snow.set(key, t - step); continue; }
      this.snow.delete(key);
      const [x, y, z] = key.split(',').map(Number);
      if (this.world.getBlock(x, y, z) === SNOW_LAYER) this.world.setBlock(x, y, z, AIR);
    }
  }

  /** Slows a mob or player for `seconds` (the Chilled speed setting). */
  _chill(target, seconds) {
    if (target.effects) target.effects.chill = Math.max(target.effects.chill || 0, seconds);
    else target.chillT = Math.max(target.chillT || 0, seconds);
  }

  /** Turns water within `radius` of a point into ice (`surface`: only the top layer, near the point's height). */
  _freeze(cx, cy, cz, radius, surface = false) {
    if (radius <= 0) return;
    const r = Math.ceil(radius);
    const y0 = Math.floor(cy);
    for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
      for (let z = Math.floor(cz) - r; z <= Math.floor(cz) + r; z++) {
        for (let y = y0 + r; y >= y0 - r; y--) {
          if (y <= 0 || y >= CH - 1) continue;
          const d = surface ? Math.hypot(x + 0.5 - cx, z + 0.5 - cz) : Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
          if (d > radius) continue;
          if (this.world.getBlock(x, y, z) !== WATER || this.world.getBlock(x, y + 1, z) === WATER) continue; // top layer only
          this.world.setBlock(x, y, z, ICE);
          if (surface) break;
        }
      }
    }
  }

  /** Attacking (or casting at something) ends invisibility. */
  _reveal(e) {
    if (e.p.effects.invisible > 0) {
      e.p.effects.invisible = 0;
      e.send({ type: 'msg', kind: 'spell', text: 'You reappear' });
    }
  }

  /** Magic missiles turn towards the nearest target in front of them. */
  _steerMissiles(dt) {
    for (const fb of this.fireballs.list) {
      if (fb.kind !== 'missile') continue;
      const speed = Math.hypot(fb.vel.x, fb.vel.y, fb.vel.z) || magic(this.settings, 'missileSpeed');
      const fwd = { x: fb.vel.x / speed, y: fb.vel.y / speed, z: fb.vel.z / speed };
      const targets = [...this.mobs.list.filter((m) => !m.dead && !MOB_TYPES[m.type].passive),
        ...(this.settings.pvp ? [...this.players.values()].filter((o) => o.id !== fb.owner && !o.p.dead && !(o.p.effects.invisible > 0)).map((o) => o.p) : [])];
      let best = null;
      let bestD = magic(this.settings, 'missileSeek');
      for (const t of targets) {
        const c = t.center;
        const dx = c.x - fb.pos.x;
        const dy = c.y - fb.pos.y;
        const dz = c.z - fb.pos.z;
        const dd = Math.hypot(dx, dy, dz);
        if (dd < bestD && (dx * fwd.x + dy * fwd.y + dz * fwd.z) / dd > 0) { bestD = dd; best = { x: dx / dd, y: dy / dd, z: dz / dd }; }
      }
      if (!best) continue;
      const k = Math.min(1, magic(this.settings, 'missileTurn') * dt);
      const nx = fwd.x + (best.x - fwd.x) * k;
      const ny = fwd.y + (best.y - fwd.y) * k;
      const nz = fwd.z + (best.z - fwd.z) * k;
      const len = Math.hypot(nx, ny, nz) || 1;
      fb.vel = { x: (nx / len) * speed, y: (ny / len) * speed, z: (nz / len) * speed };
    }
  }

  /** Damage multiplier from Power Surge. */
  _mult(e) {
    return (e.p.effects.surge > 0 ? T.surgeMult : 1) * e.p.sizeScale; // Power Surge; shrunk (or enlarged) players hit in proportion
  }

  /**
   * The nearest mob or other player along a ray, before any block. Returns { target, t } or null.
   * `skip` holds targets to ignore (the railgun goes through them).
   */
  _rayTarget(e, o, d, maxT, skip) {
    let best = null;
    const test = (target) => {
      if (skip?.has(target)) return;
      const t = target.rayHit(o, d, maxT);
      if (t !== null && (!best || t < best.t)) best = { target, t };
    };
    for (const m of this.mobs.list) if (!m.dead) test(m);
    if (this.settings.pvp) for (const o2 of this.players.values()) if (o2 !== e && !o2.p.dead) test(o2.p);
    return best;
  }

  /** Fire a gun: instant hits for bullets, pellets and the railgun; projectiles for rockets and orbs. */
  _fire(e, { hand, o, d, aim: ads, draw }) {
    const kind = this._holding(e, hand, (k) => k in GUNS);
    const aim = this._aim(e, o, d);
    if (!kind || !aim) return;
    this._reveal(e);
    const gun = gunStats(kind, this.settings); // damage, rate, pellets and spread are server settings
    const p = e.p;
    const cd = `${hand}:${kind}`; // per hand, so two pistols can both fire
    if ((e.gunCd[cd] || 0) > 0 || ammoCount(p, gun.ammo) < gun.per) return;
    e.gunCd[cd] = gun.cooldown * 0.9; // a little slack for network timing
    spend(p, 'ammo', gun.ammo, gun.per);
    const [origin, dir] = aim;
    const mult = this._mult(e);
    const at = (t, dd) => ({ x: r2(origin.x + dd.x * t), y: r2(origin.y + dd.y * t), z: r2(origin.z + dd.z * t) });

    if (gun.type === 'arrow') { // a real arrow: it arcs, and hurts what it hits (fireballs.js carries it)
      // A bow you draw (hold, then let go): a part-drawn arrow is slower and weaker. The client says how far.
      const pull = GUNS[kind].draw ? Math.max(T.bowMinDraw / 100, Math.min(1, num(draw) ? draw : 1)) : 1;
      Object.assign(this.fireballs.shoot(origin, dir, e.id, { kind: 'arrow', speed: gun.speed * (0.35 + 0.65 * pull), gravity: gun.gravity, radius: 0, mult: gun.damage * mult * pull, lifetime: 6, skill: kind }), { knock: gun.knock * pull, weapon: gun.name });
      this._fx({ type: 'shot', gun: kind, by: e.id, o: at(0, dir), ends: [] });
      return;
    }
    if (gun.type === 'rocket' || gun.type === 'orb') {
      this.fireballs.shoot(origin, dir, e.id, {
        kind: gun.type, speed: gun.speed, gravity: 0, radius: gun.radius, mult: gun.damage * mult, lifetime: gun.type === 'orb' ? 6 : 4, skill: kind,
      });
      this._fx({ type: 'shot', gun: kind, by: e.id, o: at(0, dir), ends: [] });
      return;
    }

    const ends = [];
    const hits = [];
    let headshot = false;
    if (gun.type === 'rail') {
      // Straight through everything until the first block.
      const block = this.world.raycast(origin, dir, gun.range);
      const maxT = block ? block.t : gun.range;
      const skip = new Set();
      for (let hit; (hit = this._rayTarget(e, origin, dir, maxT, skip));) {
        skip.add(hit.target);
        const head = this._isHead(hit.target, origin.y + dir.y * hit.t);
        if (head) headshot = true;
        hit.target.damage(Math.round(gun.damage * mult * (head ? T.headshotDamage : 1)), origin.x, origin.z, gun.knock, this._src(e.id, gun.name, kind));
        hits.push(at(hit.t, dir));
      }
      ends.push(at(maxT, dir));
    } else {
      // Add up every pellet per target and hit each once (players are briefly invulnerable after a hit,
      // so eight separate hits would only count the first).
      const totals = new Map();
      for (let i = 0; i < gun.pellets; i++) {
        const dd = spreadDir(dir, gun.spread * (ads ? (GUNS[kind].scope ? T.scopeSpread : T.adsSpread) / 100 : 1), this.rand); // aiming down sights (or a scope) tightens it
        const block = this.world.raycast(origin, dd, gun.range);
        const maxT = block ? block.t : gun.range;
        const hit = this._rayTarget(e, origin, dd, maxT, null);
        if (hit) {
          const head = this._isHead(hit.target, origin.y + dd.y * hit.t); // (each pellet counts on its own)
          if (head) headshot = true;
          totals.set(hit.target, (totals.get(hit.target) || 0) + gun.damage * mult * (head ? T.headshotDamage : 1));
          hits.push(at(hit.t, dd));
          ends.push(at(hit.t, dd));
        } else {
          ends.push(at(maxT, dd));
        }
      }
      for (const [target, dmg] of totals) target.damage(Math.round(dmg), origin.x, origin.z, gun.knock, this._src(e.id, gun.name, kind));
    }
    this._fx({ type: 'shot', gun: kind, by: e.id, o: at(0, dir), ends, hits });
    if (headshot) this._headshot(e.id);
  }

  /**
   * Where an arrow or bolt ends up, unless it broke (the Arrow break chance): stuck in the creature it hit
   * (it falls out when the creature dies), on the ground at the feet of a player it hit, stuck in the block it
   * hit (`dir`: pointing the way it flew), or, if it fell in water or ran out of flight, wherever it is.
   * Walk over one to get it back (items.js Drops).
   */
  _spentArrow(fb, at, target) {
    if (this.rand() * 100 < T.arrowBreak) return;
    if (target && !target.effects) { target.arrows = Math.min(12, (target.arrows || 0) + 1); return; } // a creature
    if (target) { this.drops.spawn('arrow', target.pos.x, target.pos.y + 0.2, target.pos.z); return; } // a player
    const d = this.drops.spawn('arrow', at.x, at.y, at.z, false);
    const len = Math.hypot(fb.vel.x, fb.vel.y, fb.vel.z) || 1;
    if (at.type === 'explode') d.dir = { x: r2(fb.vel.x / len), y: r2(fb.vel.y / len), z: r2(fb.vel.z / len) }; // stuck in a block
  }

  /** Does a shot hitting `target` at height `y` hit its head (the top Head size % of it)? */
  _isHead(target, y) {
    return !target.dead && y >= target.pos.y + target.height * (1 - T.headshotZone / 100);
  }

  /** A headshot by player `id`: they hear about it ("HEADSHOT!", in main.js). */
  _headshot(id) {
    this.players.get(id)?.send({ type: 'headshot' });
  }

  _throw(e, { hand, o, d }) {
    const aim = this._aim(e, o, d);
    if (!aim || !this._holding(e, hand, (k) => k === 'hackysack') || !(itemCount(e.p, 'hackysack') > 0)) return;
    this._reveal(e);
    spend(e.p, 'tools', 'hackysack');
    this.throwables.throw(aim[0], aim[1], e.id);
    e.p.validateHands(hand);
  }

  _eat(e, { hand }) {
    const kind = this._holding(e, hand, (k) => k in FOOD);
    if (!kind) return;
    const p = e.p;
    const result = p.eat(kind);
    if (result === 'ate' && FOOD[kind].flap) {
      e.send({ type: 'msg', text: `🐦 You feel… flappy. Tap Space in mid-air to flap (${T.flapSeconds} s)`, kind: 'flap' });
    } else if (result === 'ate' && FOOD[kind].flightless) {
      e.send({ type: 'msg', text: `+${p.healFor(kind)} health. Flight was never an option.`, kind: 'heal' });
    } else if (result === 'ate' && (FOOD[kind].cure || FOOD[kind].mana)) {
      const bits = [p.healFor(kind) > 0 ? `+${p.healFor(kind)} health` : '', FOOD[kind].cure ? 'You feel better' : '', FOOD[kind].mana ? `+${FOOD[kind].mana} mana` : ''];
      e.send({ type: 'msg', text: bits.filter(Boolean).join(' · '), kind: 'heal' });
    } else if (result === 'ate' && FOOD[kind].raw === 'meat' && this.rand() * 100 < T.rawUpset) { // raw meat: a gamble
      p.effects.upset = T.upsetSeconds;
      e.upsetHurtT = T.upsetEvery;
      e.upsetCause = 'rawmeat';
      e.poopT = 0.5;
      e.send({ type: 'msg', text: `+${p.healFor(kind)} health, but that was raw. Your stomach is not happy.`, kind: 'sick' });
    } else if (result === 'ate') e.send({ type: 'msg', text: `+${p.healFor(kind)} health`, kind: 'heal' });
    else if (result === 'intolerant' && FOOD[kind].allergen === 'gluten') {
      p.effects.headache = T.headacheSeconds;
      e.send({ type: 'msg', text: 'Ow. Gluten headache.', kind: 'sick' });
    } else if (result === 'intolerant') {
      p.effects.upset = T.upsetSeconds;
      e.upsetHurtT = T.upsetEvery;
      e.poopT = 0.5;
      e.upsetCause = 'lactose';
      p.damage(T.upsetHit, p.pos.x, p.pos.z, 0, { cause: 'lactose' });
      e.send({ type: 'msg', text: 'Uh oh. Lactose.', kind: 'sick' });
    } else if (FOOD[kind].cure) e.send({ type: 'msg', text: 'Nothing to cure' });
    else if (FOOD[kind].mana && !(FOOD[kind].heal > 0)) e.send({ type: 'msg', text: 'Your mana is full' });
    else if (p.hp >= p.maxHp) e.send({ type: 'msg', text: FOOD[kind].drink ? 'Not thirsty' : 'Not hungry' });
    p.validateHands(hand);
  }

  _washed(e, { kind, hand }) {
    const p = e.p;
    if (!(kind in DISHES) || !(p.dishes[kind] > 0) || !p.nearWater) return;
    p.dishes[kind]--;
    p.cleaned++;
    this._skill(e, 'dishwash', 1); // a point a dish
    p.validateHands(hand === 'right' ? 'right' : 'left');
  }

  /** Prints a tool, charging its dollar price in ZEC at this moment's rate. */
  _print(e, { kind }) {
    const zec = printable(kind) ? zecFor(this.priceFor(e.p, kind), this.rate) : 0;
    const reason = !zec ? 'unknown' : e.printJob ? 'busy' : !e.p.pay(zec) ? 'money' : null;
    if (reason) {
      e.send({ type: 'printFailed', reason, zec, rate: this.rate });
      return;
    }
    e.printJob = { kind, t: 0 };
    this._sendYou(e); // show the payment right away, even while the printer menu pauses single player
    e.send({ type: 'printing', kind, seconds: this.settings.printSeconds, zec, rate: this.rate });
  }

  /** Order something from CONSUME on your phone: the price plus the delivery fee now, the item the delivery time later (both are settings). */
  _order(e, { kind }) {
    const offer = shopOffer(kind);
    if (!offer) return;
    const usd = Math.round(this.priceFor(e.p, kind, offer.usd) * (1 + this.settings.deliveryFee / 100) * 100) / 100;
    const zec = zecFor(usd, this.rate);
    if (e.p.orders.length >= T.maxOrders) return e.send({ type: 'msg', kind: 'deny', text: `CONSUME: you already have ${T.maxOrders} deliveries on the way` });
    if (!e.p.pay(zec)) return e.send({ type: 'msg', kind: 'deny', text: `CONSUME: not enough Zcash (${itemName(kind)} costs ${zec.toFixed(2)} ZEC with delivery)` });
    const minutes = this.settings.deliveryMinutes;
    e.p.orders.push({ kind, t: minutes * 60 });
    e.send({ type: 'msg', kind: 'order', text: `CONSUME: ${itemName(kind)} ordered for ${zec.toFixed(2)} ZEC, arriving in ${minutes} minute${minutes === 1 ? '' : 's'}` });
    this._sendYou(e);
  }

  /** Anyone playing can change a server setting; everyone hears about it. */
  _setting(e, { key, value }) {
    const v = cleanSetting(key, value);
    if (v === undefined || v === this.settings[key]) return;
    this.settings[key] = v;
    this.store.set('game:settings', JSON.stringify(this.settings));
    this._broadcast({ type: 'settings', settings: { ...this.settings } });
    if (this.multiplayer) this._broadcast({ type: 'msg', kind: 'setting', text: `${e.name} set ${SETTINGS[key].name} to ${settingText(key, v)}` });
  }

  /** A dollar price for this player (Rizz haggles): `usd`, or the printer price of `kind`. */
  priceFor(p, kind, usd = printUsd(kind)) {
    return Math.round(usd * statEffects(p.stats).price * 100) / 100;
  }

  /** Your hotbars (hold Q or E and scroll): { hand, slots: 8 item kinds or null }. Anything goes; empty slots and things you've run out of are skipped. */
  _hotbar(e, { hand, slots }) {
    if ((hand !== 'left' && hand !== 'right') || !Array.isArray(slots)) return;
    e.p.hotbars[hand] = Array.from({ length: 8 }, (_, i) => (typeof slots[i] === 'string' && slots[i].length < 64 ? slots[i] : null));
    this._sendYou(e);
  }

  /** Crafting (R): by hand, anywhere, instantly. */
  _craft(e, { id }) {
    const p = e.p;
    const c = craftById(id);
    if (!c) return;
    if (!canCraft(p, c)) return e.send({ type: 'msg', kind: 'deny', text: `${craftName(c)} needs ${craftNeedsText(c)}` });
    for (const [inv, list] of Object.entries(c.needs)) for (const [k, n] of Object.entries(list)) spend(p, inv, k, n);
    grantCraft(p, c);
    p.validateHands();
    this._skill(e, 'crafting', 1);
    e.send({ type: 'msg', kind: 'craft', text: `🔨 Made ${craftName(c)}` });
    this._sendYou(e);
  }

  // ---------- cooking (cooking.js) ----------

  /** At a Range, Campfire or Olive Press you're next to: start a recipe (its ingredients go in now). */
  _cook(e, { x, y, z, out }) {
    const p = e.p;
    const r = recipeFor(out);
    if (!r || ![x, y, z].every(Number.isInteger) || !this._within(e, x + 0.5, y + 0.5, z + 0.5)) return;
    const station = stationOf(this.world.getBlock(x, y, z));
    const deny = (text) => { e.send({ type: 'msg', kind: 'deny', text }); this._sendYou(e); };
    if (!station || !r.at.includes(station)) return deny(`You can't make ${FOOD[out].name} there`);
    if (p.cooking) return deny(`You're already making ${FOOD[p.cooking.out].name}`);
    if (!canCook(p, r)) return deny(`${FOOD[out].name} needs ${needsText(r)}`);
    for (const [k, n] of Object.entries(r.needs)) spend(p, 'food', k, n);
    p.validateHands();
    p.cooking = { out, n: r.n, t: cookSeconds(r) };
    e.send({ type: 'msg', kind: 'cook', text: `🍳 Making ${FOOD[out].name} (${Math.round(p.cooking.t)} s)` });
    if (p.cooking.t <= 0) this._cooked(e);
    this._sendYou(e);
  }

  /** The dish is ready: it goes in your food (you don't have to be at the stove). */
  _cooked(e) {
    const p = e.p;
    const { out, n } = p.cooking;
    p.cooking = null;
    p.food[out] = (p.food[out] || 0) + n;
    this._skill(e, 'cooking', n);
    e.send({ type: 'msg', kind: 'cook', text: `🍽 ${n > 1 ? `${n} ` : ''}${FOOD[out].name} ready!` });
    this._sendYou(e);
  }

  /** A Bucket in your left hand, aimed at water nearby: a Bucket of Water (an ingredient). */
  _fill(e, { o, d }) {
    const p = e.p;
    const aim = this._aim(e, o, d);
    if (!aim || p.hands.left !== 'bucket' || !(itemCount(p, 'bucket') > 0)) return;
    if (!findWater(this.world, aim[0], aim[1], T.waterReach)) return e.send({ type: 'msg', kind: 'deny', text: 'Aim at water nearby to fill your bucket' });
    p.food.water = (p.food.water || 0) + 1;
    e.send({ type: 'msg', kind: 'heal', text: '🪣 Filled a bucket of water' });
    this._sendYou(e);
  }

  /** Right-click a cow with a Bucket in your left hand: a glass of milk (then it needs a while to make more). */
  _milk(e, { mob }) {
    const p = e.p;
    if (p.hands.left !== 'bucket' || !(itemCount(p, 'bucket') > 0)) return;
    const cow = this.mobs.list.find((m) => m.id === mob && !m.dead && m.type === 'cow');
    if (!cow) return;
    const c = cow.center;
    if (!this._within(e, c.x, c.y, c.z)) return;
    if ((cow.milkedAt ?? -Infinity) + T.milkCooldown > this.clock) return e.send({ type: 'msg', kind: 'deny', text: 'This cow has no milk left. Give her a minute.' });
    cow.milkedAt = this.clock;
    p.food.milk = (p.food.milk || 0) + 1;
    this._skill(e, 'bucket');
    this._fx({ type: 'milk', x: r2(c.x), y: r2(c.y), z: r2(c.z) });
    e.send({ type: 'msg', kind: 'heal', text: '🥛 You milked the cow: a glass of milk' });
    this._sendYou(e);
  }

  // ---------- backpacks ----------

  /**
   * A player died: everything they carried (items, blocks, food, ammo, scrolls, unfired pottery, the Zcash in
   * their wallet and the armor they wore) goes in a backpack where they fell. Only they can pick it up, by
   * walking into it, before the Backpack lifetime runs out. The phone, and Cold Wallet savings, stay theirs.
   */
  _dropBackpack(e) {
    const p = e.p;
    e.packed = true;
    const items = {};
    let any = false;
    for (const inv of ['tools', 'food', 'dishes', 'blocks', 'scrolls', 'ammo', 'unfired', 'materials']) {
      const held = Object.fromEntries(Object.entries(p[inv] || {}).filter(([, n]) => n > 0));
      if (inv === 'tools' && p.worn && !p.wornFree) held[p.worn] = (held[p.worn] || 0) + 1; // (armor comes off)
      if (Object.keys(held).length) { items[inv] = held; any = true; }
      for (const k of Object.keys(p[inv] || {})) p[inv][k] = 0;
    }
    p.worn = null;
    p.wornFree = false;
    const zcash = p.wallet.zcash;
    p.wallet.zcash = 0;
    if (zcash > 0) { items.zcash = zcash; any = true; }
    p.validateHands();
    this._sendYou(e);
    if (!any) return;
    let { x, y, z } = p.pos;
    if (y < 1) y = this.world.surfaceAt(Math.floor(x), Math.floor(z)); // (fell out of the world: it's left on the ground above)
    this.backpacks.push({ id: this.nextPackId++, owner: e.token, name: e.name, x: r2(x), y: r2(y), z: r2(z), t: T.backpackMinutes * 60, items });
    e.send({ type: 'msg', kind: 'lost', text: `🎒 You dropped your backpack where you died, with everything you had${zcash > 0 ? ` and ${zcash.toFixed(2)} ZEC` : ''}. Get it back within ${T.backpackMinutes} minutes!` });
  }

  /** Backpacks: their owners pick them up by walking into them; unclaimed ones are gone when their time's up. */
  _backpacks(dt, entries) {
    if (!this.backpacks.length) return;
    this.backpacks = this.backpacks.filter((b) => {
      const e = entries.find((o) => o.token === b.owner && !o.p.dead);
      if (e && Math.hypot(e.p.pos.x - b.x, e.p.pos.z - b.z) < 1.4 && Math.abs(e.p.pos.y - b.y) < 2) {
        const p = e.p;
        for (const [inv, held] of Object.entries(b.items)) {
          if (inv === 'zcash') p.wallet.zcash = round2(p.wallet.zcash + held);
          else for (const [k, n] of Object.entries(held)) if (p[inv]) p[inv][k] = (p[inv][k] || 0) + n;
        }
        e.send({ type: 'msg', kind: 'delivery', text: '🎒 You got your backpack back' });
        this._fx({ type: 'sparkle', x: b.x, y: b.y + 0.4, z: b.z });
        this._sendYou(e);
        return false;
      }
      if ((b.t -= dt) <= 0) {
        this.players.forEach((o) => { if (o.token === b.owner) o.send({ type: 'msg', kind: 'lost', text: '🎒 Your backpack is gone. Should\'ve kept more in cold storage.' }); });
        return false;
      }
      return true;
    });
  }

  // ---------- fishing (fishing.js) ----------

  /** Click with a Fishing Rod: cast into water; with a line out, reel in (a fish, if one is biting). */
  _fish(e, { hand, o, d }) {
    const p = e.p;
    const rod = this._holding(e, hand, (k) => k === 'rod');
    if (!rod || !(itemCount(p, 'rod') > 0)) return;
    if (e.fishing) {
      const f = e.fishing;
      e.fishing = null;
      if (!(f.bite > 0)) return e.send({ type: 'msg', kind: 'fish', text: 'Reeled in: nothing on the hook' });
      const what = rollCatch(this.rand, daylight(this.time) < 0.5);
      this._fx({ type: 'fishCatch', by: e.id, x: f.x, y: f.y, z: f.z });
      this._skill(e, 'rod');
      if (what === 'junk') {
        const dish = Object.keys(DISHES)[Math.floor(this.rand() * Object.keys(DISHES).length)];
        p.dishes[dish]++;
        e.send({ type: 'msg', kind: 'fish', text: `🥾 You reeled in a ${itemName(dish).toLowerCase()}. Who throws these in?` });
      } else {
        p.food[what] = (p.food[what] || 0) + 1;
        e.send({ type: 'msg', kind: 'fish', text: `🎣 Caught a ${itemName(what)}!` });
      }
      this._sendYou(e);
      return;
    }
    const aim = this._aim(e, o, d);
    if (!aim) return;
    const at = findWater(this.world, aim[0], aim[1], T.fishRange);
    if (!at) return e.send({ type: 'msg', kind: 'deny', text: 'Cast into water (within reach, with nothing in the way)' });
    e.fishing = { ...at, hand, t: biteWait(this.rand), bite: 0 };
    this._fx({ type: 'fishCast', by: e.id, x: at.x, y: at.y, z: at.z });
  }

  /** While a line is out: wait for a bite, give the player a moment to strike, and reel in if things go wrong. */
  _tickFishing(e, dt) {
    const f = e.fishing;
    const p = e.p;
    const gone = p.dead || p.hands[f.hand] !== 'rod' || e.phoneOut
      || Math.hypot(p.pos.x - f.x, p.pos.z - f.z) > T.fishRange + 4 || this.world.getBlock(f.bx, f.by, f.bz) !== WATER;
    if (gone) {
      e.fishing = null;
      if (!p.dead) e.send({ type: 'msg', kind: 'fish', text: 'Your line came in' });
      return;
    }
    if (f.bite > 0) {
      if ((f.bite -= dt) <= 0) { // too slow: it got away, and the wait starts again
        f.t = biteWait(this.rand);
        e.send({ type: 'msg', kind: 'fish', text: 'It got away…' });
      }
    } else if ((f.t -= dt) <= 0) {
      f.bite = T.fishBiteWindow;
      this._fx({ type: 'fishBite', by: e.id, x: f.x, y: f.y, z: f.z });
    }
  }

  // ---------- pottery (pottery.js) ----------

  /**
   * At a Pottery Wheel, Kiln or Glazing Table you're next to (x, y, z):
   *   { op: 'throw', obj, clay }  (wheel) clay blocks -> a thrown pot ('mug', 'red')
   *   { op: 'trim', key }         (wheel) a thrown pot -> trimmed
   *   { op: 'fire', key }         (kiln) trimmed pots (bisque firing) or glazed pieces (glaze firing), up to the kiln load
   *   { op: 'glaze', id, glaze }  (table) a bisque piece (block id) -> glazed, unfired, glaze 1-3
   */
  _pottery(e, { op, x, y, z, obj, clay, key, id, glaze }) {
    const p = e.p;
    if (![x, y, z].every(Number.isInteger) || !this._within(e, x + 0.5, y + 0.5, z + 0.5)) return;
    const station = this.world.getBlock(x, y, z);
    const deny = (text) => { e.send({ type: 'msg', kind: 'deny', text }); this._sendYou(e); };
    const say = (text) => e.send({ type: 'msg', kind: 'pottery', text });
    if (op === 'throw' && station === POTTERY_WHEEL) {
      const o = POT_OBJECTS.indexOf(obj);
      const c = CLAYS.indexOf(clay);
      if (o < 0 || c < 0) return;
      const need = clayFor(o);
      const block = clayBlock(c);
      if (!p.buildy && (p.blocks[block] || 0) < need) return deny(`You need ${need} ${BLOCKS[block].name} for that`);
      if (!p.buildy) p.blocks[block] -= need;
      const k = unfiredKey('thrown', o, c);
      p.unfired[k]++;
      p.validateHands();
      this._skill(e, 'pottery');
      say(`Threw a ${unfiredName(k).slice(7).toLowerCase()}: trim it on the wheel next`);
    } else if (op === 'trim' && station === POTTERY_WHEEL) {
      const u = unfiredInfo(key);
      if (!u || u.stage !== 'thrown') return;
      if (!(p.unfired[key] > 0)) return deny(`You don't have a ${unfiredName(key).toLowerCase()}`);
      p.unfired[key]--;
      const k = unfiredKey('trimmed', u.obj, u.clay);
      p.unfired[k]++;
      this._skill(e, 'pottery');
      say(`Trimmed the ${unfiredName(k).slice(8).toLowerCase()}: bisque-fire it in a kiln next`);
    } else if (op === 'fire' && station === KILN) {
      const u = unfiredInfo(key);
      if (!u) return;
      if (u.stage === 'thrown') return deny('Trim it on the wheel before it goes in the kiln');
      if (p.kiln) return deny('Your kiln is already firing a batch');
      const n = Math.min(p.unfired[key] || 0, T.kilnLoad);
      if (n < 1) return deny(`You don't have any ${unfiredName(key).toLowerCase()}`);
      p.unfired[key] -= n;
      p.kiln = { pieces: [[key, n]], t: fireSeconds(key) };
      say(`🔥 ${u.stage === 'glazed' ? 'Glaze' : 'Bisque'} firing ${piecesText(p.kiln.pieces)} (${fireSeconds(key)} s)`);
      if (p.kiln.t <= 0) this._kilnDone(e);
    } else if (op === 'glaze' && station === GLAZING_TABLE) {
      const k = Number.isInteger(id) ? glazedKey(id, glaze) : null;
      if (k === null) return;
      if (!p.buildy && !(p.blocks[id] > 0)) return deny(`You don't have a ${potteryName(id)}`);
      if (!p.buildy) p.blocks[id]--;
      p.unfired[k]++;
      p.validateHands();
      this._skill(e, 'pottery');
      say(`${unfiredName(k)}: glaze-fire it in a kiln to finish it`);
    } else return;
    this._sendYou(e); // (the station's menu pauses single player)
  }

  /** The kiln's batch is done: bisque pieces or finished glazed ones, as blocks you can place. */
  _kilnDone(e) {
    const p = e.p;
    const { pieces } = p.kiln;
    p.kiln = null;
    let n = 0;
    for (const [k, count] of pieces) {
      const id = firedId(k);
      p.blocks[id] = (p.blocks[id] || 0) + count;
      n += count;
    }
    this._skill(e, 'pottery', n); // a point a piece
    const glazed = unfiredInfo(pieces[0][0]).stage === 'glazed';
    e.send({ type: 'msg', kind: 'pottery', text: glazed ? `🏺 Out of the kiln, finished: ${piecesText(pieces)}` : `🏺 Out of the kiln: ${piecesText(pieces)} of bisque. Place them as they are, or glaze them at a Glazing Table` });
    this._sendYou(e);
  }

  /** Spend an attribute point on a stat (the + on the character sheet). */
  _addStat(e, { key }) {
    const p = e.p;
    if (!(key in STATS) || !(p.statPoints >= 1)) return;
    p.statPoints--;
    p.statBonus[key] = (p.statBonus[key] || 0) + 1;
    p.stats = withBonus(p.baseStats, p.statBonus);
    this._sendYou(e);
  }

  _cleanStats(s) {
    return Object.fromEntries(Object.keys(STATS).map((k) => [k, Number.isInteger(s[k]) && s[k] >= 1 && s[k] <= 60 ? s[k] : T.startStat]));
  }

  // ---------- simulation ----------

  tick(dt) {
    this.clock += dt; // seconds this game has run (cooldowns)
    for (const e of this.players.values()) if (e.teleportT > 0) e.teleportT -= dt;
    const before = this.time;
    this.time = (this.time + dt / (this.settings.dayMinutes * 60)) % 1;
    if (this.time < before) this._newDay(); // past sunrise: a new day in the garden
    this.rateT += dt;
    if (this.rateT >= 1) {
      this.rate = nextRate(this.rate, this.rateT, this.rand, this.settings.volatility);
      this.rateT = 0;
    }
    const light = daylight(this.time);
    const entries = [...this.players.values()];
    const bodies = entries.map((e) => e.p);

    for (const e of entries) {
      const p = e.p;
      p.tickVitals(dt);
      e.textCd -= dt;
      e.meleeCd -= dt;
      for (const k in e.castCd) e.castCd[k] -= dt;
      if (!p.dead) p.mana = Math.min(maxMana(p.stats, this.settings), p.mana + manaRegen(p.stats, this.settings) * dt); // mana refills (Smartness)
      if (e.buildSwitch && p.dead) e.buildSwitch = null;
      if (e.buildSwitch && (e.buildSwitch.t -= dt) <= 0) {
        p.buildy = e.buildSwitch.to;
        e.buildSwitch = null;
        if (!p.buildy) e.flying = false;
        if (!p.buildy && p.wornFree) { p.worn = null; p.wornFree = false; } // free armor goes with the hard hat
        p.validateHands(); // (and so do the free things in your hands)
        e.send({ type: 'msg', kind: 'buildy', text: p.buildy ? '👷 Buildy Boi mode: fly (F), every block, invincible' : 'Hard hat off: back to normal' });
      }
      if (e.p.kiln && (e.p.kiln.t -= dt) <= 0) this._kilnDone(e);
      if (e.p.cooking && (e.p.cooking.t -= dt) <= 0) this._cooked(e);
      if (e.printJob && (e.printJob.t += dt) >= this.settings.printSeconds) {
        grantItem(p, e.printJob.kind);
        e.send({ type: 'printed', kind: e.printJob.kind });
        e.printJob = null;
      }
      // CONSUME orders: when one is ready, a drone takes it to you (see drones.js and _droneArrived).
      for (const o of p.orders) {
        if (o.t > 0) o.t -= dt;
        else if (!o.drone && !p.dead) {
          o.drone = this.drones.launch(e.id, o.kind, p.pos).id;
          e.send({ type: 'msg', kind: 'order', text: `🚁 Your ${itemName(o.kind)} is on its way by drone` });
        }
      }
      this._effects(e, dt);
      this._lava(e, dt);
      if (e.fishing) this._tickFishing(e, dt);
      this._tickQuests(e);
      if (p.dead && !e.deathTold) { // tell everyone how it happened (the message log)
        e.deathTold = true;
        this._broadcast({ type: 'msg', kind: 'death', text: this._deathText(e) });
      }
      if (!p.dead) e.deathTold = false;
      if (p.dead && !e.packed) this._dropBackpack(e); // everything you carried, where you died (cold storage is safe)
      if (!p.dead) e.packed = false;
      if (p.dead && (e.deathT += dt) >= T.respawnDelay) {
        e.deathT = 0;
        const pos = this._spawnPoint(e);
        p.spawn(pos); // (stats and traits are the character's: they stay the same)
        p.mana = maxMana(p.stats, this.settings);
        e.fallTop = null;
        e.send({ type: 'respawn', pos });
      }
    }

    if (entries.length) {
      this._steerMissiles(dt);
      this._updateStorms(dt);
      for (const ev of this.fireballs.update(dt, (pos, fb) => this._targetAt(pos, fb.owner))) {
        const fb = ev.fireball;
        if (fb.kind === 'snowball') this._blizzard(fb, ev); // (wherever it ends up, hit or not)
        else if (fb.kind === 'icebolt') { // a direct hit: damage and chill; water where it lands freezes
          const t = ev.type === 'explode' ? this._targetAt(ev, fb.owner) : null;
          if (t) {
            t.damage(Math.max(1, Math.round(fb.mult)), ev.x - fb.vel.x, ev.z - fb.vel.z, 2, this._shotBy(fb));
            this._chill(t, fb.chill);
          }
          if (this.settings.freezeWater) this._freeze(ev.x, ev.y, ev.z, magic(this.settings, 'iceboltFreeze'));
          this._snowAround(ev.x, ev.y, ev.z, magic(this.settings, 'iceboltSnow'));
          this._fx({ type: 'frost', x: r2(ev.x), y: r2(ev.y), z: r2(ev.z) });
        } else if (fb.kind === 'arrow') { // a direct hit, no explosion
          const t = ev.type === 'explode' ? this._targetAt(ev, fb.owner) : null;
          const head = t && this._isHead(t, ev.y);
          if (t) t.damage(Math.max(1, Math.round(fb.mult * (head ? T.headshotDamage : 1))), ev.x - fb.vel.x, ev.z - fb.vel.z, fb.knock ?? 3, this._shotBy(fb));
          if (head) this._headshot(fb.owner);
          this._fx({ type: 'arrowHit', hit: !!t, x: r2(ev.x), y: r2(ev.y), z: r2(ev.z) });
          this._spentArrow(fb, ev, t);
        } else if (fb.kind === 'missile') { // a direct hit, no explosion
          const t = this._targetAt(ev, fb.owner);
          if (t) t.damage(Math.max(1, Math.round(fb.mult)), ev.x - fb.vel.x, ev.z - fb.vel.z, 3, this._shotBy(fb));
          this._fx({ type: t ? 'missileHit' : 'fizzle', x: r2(ev.x), y: r2(ev.y), z: r2(ev.z) });
        } else if (ev.type === 'explode' || fb.kind !== 'fireball') this._detonate(ev.x, ev.y, ev.z, fb.radius, fb.mult, this._shotBy(fb));
        else this._fx({ type: 'fizzle', x: ev.x, y: ev.y, z: ev.z });
      }
      this._zapOrbs(dt);
      for (const ev of this.mobs.update(dt, bodies, light)) this._mobEvent(ev, entries);
      this.npcs.update(dt, bodies);
      for (const ev of this.throwables.update(dt, (pos, s) => this._targetAt(pos, s.owner))) {
        if (ev.type === 'hit') {
          const t = TOOLS.hackysack;
          ev.mob.damage(t.throwDamage, ev.x - ev.vel.x, ev.z - ev.vel.z, t.throwKnock, this._src(ev.owner, 'Hackysack', 'hackysack'));
        } else {
          this.drops.spawn('hackysack', ev.x, ev.y, ev.z, false);
        }
      }
      for (const d of this.drops.update(dt, bodies)) this._pickedUp(d, entries);
      for (const ev of this.drones.update(dt, (dr) => {
        const owner = this.players.get(dr.owner);
        return !owner ? false : owner.p.dead ? null : owner.p.pos;
      })) this._droneArrived(ev.drone);
      // (Zcash and ammo never lie about in the wild: monsters drop them, and ammo is sold.)
      if ((this.surgeT -= dt) <= 0) {
        this.surgeT = T.surgeEvery;
        const e = entries[Math.floor(this.rand() * entries.length)];
        if (this.rand() < (T.surgeChance / 100)) this.drops.scatter('surge', e.p, CH, entries.length);
      }
    }

    this._blockGravity(dt, entries);
    if (this.snow.size) this._meltSnow(dt);
    this.messes = this.messes.filter((m) => (m.age += dt) < T.messLifetime);
    this._backpacks(dt, entries);

    if (this.changes.length) {
      this._broadcast({ type: 'blocks', list: this.changes });
      this.changes = [];
    }
    if (this.fallen.length) { // (after the others: falling happens last in the tick)
      this._broadcast({ type: 'blocks', list: this.fallen, quiet: true });
      this.fallen = [];
    }
    for (const e of entries) this._sendYou(e);
    this.snapT += dt;
    if (this.snapT >= (this.multiplayer ? SNAPSHOT_EVERY : 0)) {
      this.snapT = 0;
      this._sendSnapshot();
    }
    this.saveT += dt;
    if (this.saveT >= SAVE_EVERY) {
      this.saveT = 0;
      this.save();
    }
    this.pruneT += dt;
    if (this.pruneT >= PRUNE_EVERY) {
      this.pruneT = 0;
      this.world.pruneChunks([...bodies.map((b) => b.pos), ...this.npcs.list.map((n) => n.pos)]); // (townsfolk walk on chunks too)
    }
  }

  /** Headaches wear off; lactose trouble hurts every few seconds and leaves a trail. */
  _effects(e, dt) {
    const p = e.p;
    if (p.dead) return;
    p.effects.headache = Math.max(0, p.effects.headache - dt);
    p.effects.surge = Math.max(0, p.effects.surge - dt);
    p.effects.flap = Math.max(0, p.effects.flap - dt);
    const flew = p.effects.flight;
    for (const k of ['stoneskin', 'invisible', 'polymorph', 'shrink', 'enlarge', 'hallucinate', 'chill', 'flight', 'blind']) p.effects[k] = Math.max(0, p.effects[k] - dt); // spells
    if (flew > 3 && p.effects.flight <= 3 && !p.buildy) e.send({ type: 'msg', kind: 'deny', text: '🕊️ Your flight is wearing off: find somewhere to land!' });
    if (flew > 0 && p.effects.flight <= 0 && !p.buildy) e.flying = false;
    for (const k in e.gunCd) e.gunCd[k] -= dt;
    if (p.effects.upset <= 0) return;
    p.effects.upset = Math.max(0, p.effects.upset - dt);
    if ((e.upsetHurtT -= dt) <= 0) {
      e.upsetHurtT = T.upsetEvery;
      p.damage(1, p.pos.x, p.pos.z, 0, { cause: e.upsetCause || 'lactose' });
    }
    if ((e.poopT -= dt) <= 0) {
      e.poopT = T.poopEvery * (0.7 + this.rand() * 0.6);
      // Just behind you, on the ground.
      const bx = p.pos.x + Math.sin(e.yaw) * 0.6;
      const bz = p.pos.z + Math.cos(e.yaw) * 0.6;
      const mess = { id: this.nextMessId++, x: bx, y: p.pos.y, z: bz, age: 0 };
      this.messes.push(mess);
      if (this.messes.length > MAX_MESSES) this.messes.shift();
      this._fx({ type: 'poop', x: bx, y: p.pos.y + 0.2, z: bz });
    }
  }

  /** Overcharge orbs zap every mob and player (except whoever fired them) near their path. */
  _zapOrbs(dt) {
    const gun = GUNS.overcharge;
    for (const fb of this.fireballs.list) {
      if (fb.kind !== 'orb' || (fb.zapT = (fb.zapT ?? 0) - dt) > 0) continue;
      fb.zapT = gun.zapEvery;
      const targets = [
        ...this.mobs.list.filter((m) => !m.dead),
        ...[...this.players.values()].filter((o) => this.settings.pvp && o.id !== fb.owner && !o.p.dead).map((o) => o.p),
      ];
      const zaps = [];
      for (const t of targets) {
        const c = t.center;
        if (Math.hypot(c.x - fb.pos.x, c.y - fb.pos.y, c.z - fb.pos.z) > gun.zapRadius) continue;
        t.damage(Math.round(gun.zapDamage * (fb.mult / gun.damage)), fb.pos.x, fb.pos.z, 1, this._shotBy(fb));
        zaps.push({ x: r2(c.x), y: r2(c.y), z: r2(c.z) });
      }
      if (zaps.length) this._fx({ type: 'zap', x: r2(fb.pos.x), y: r2(fb.pos.y), z: r2(fb.pos.z), to: zaps });
    }
  }

  /** A delivery drone reached its customer: the package is theirs. */
  _droneArrived(d) {
    const e = this.players.get(d.owner);
    const i = e ? e.p.orders.findIndex((o) => o.drone === d.id) : -1;
    if (i < 0) return;
    e.p.orders.splice(i, 1);
    grantItem(e.p, d.kind);
    e.send({ type: 'msg', kind: 'delivery', text: `📦 Drone delivery: your ${itemName(d.kind)} arrived` });
    this._fx({ type: 'delivery', x: r2(d.pos.x), y: r2(d.pos.y - 0.6), z: r2(d.pos.z) });
    this._sendYou(e);
  }

  /** A mob, or a player other than `ownerId`, at this point (for fireballs and hackysacks). */
  _targetAt(pos, ownerId) {
    const mob = this.mobs.mobAt(pos, 0.2);
    if (mob) return mob;
    for (const e of this.players.values()) {
      if (!this.settings.pvp && this.players.has(ownerId)) break; // a player's projectile, and PvP is off
      if (e.id !== ownerId && !e.p.dead && e.p.containsPoint(pos, 0.2)) return e.p;
    }
    return null;
  }

  /** Falling blocks (gravity.js): move them, and crush whoever holds them up. */
  _blockGravity(dt, entries) {
    const bodies = [...entries.map((e) => e.p), ...this.mobs.list];
    for (const ev of this.gravity.update(dt, bodies)) {
      if (ev.type === 'land') this._fx({ type: 'blockLand', x: r2(ev.x), y: r2(ev.y), z: r2(ev.z), size: ev.size });
      else if (ev.type === 'crush' && T.crushDamage > 0) {
        const b = ev.body;
        if (b.invuln > 0 || b.hurtT > 0) continue; // one crush at a time
        b.damage(T.crushDamage, b.pos.x + (this.rand() - 0.5), b.pos.z + (this.rand() - 0.5), 4, { cause: 'crushed' });
      }
    }
  }

  _detonate(x, y, z, radius, mult = 1, source = null) {
    const removed = explode(this.world, x, y, z, radius, this.rand);
    this.mobs.blast(x, y, z, radius, [...this.players.values()].map((e) => e.p), mult, source);
    this._fx({ type: 'explode', x, y, z, radius, removed: removed.map((b) => [b.x, b.y, b.z, b.id]) });
  }

  _mobEvent(ev, entries) {
    if (ev.type === 'babyCough') this._fx({ type: 'babyCough', x: r2(ev.x), y: r2(ev.y), z: r2(ev.z) });
    else if (ev.type === 'death') {
      this._fx({ type: ev.mobType === 'seedoil' ? 'splat' : 'puff', x: ev.x, y: ev.y, z: ev.z, size: ev.size });
      for (const kind of ev.loot) this.drops.spawn(kind, ev.x, ev.y, ev.z);
      const by = ev.by?.cause === 'player' ? this.players.get(ev.by.byId) : null; // a kill: a point for the weapon that made it
      if (by && ev.by.skill) this._skill(by, ev.by.skill);
    }
    else if (ev.type === 'stolen') {
      const e = entries.find((x) => x.p === ev.player);
      if (e) {
        e.send({ type: 'msg', kind: 'stolen', text: `A seagull stole your ${itemName(ev.kind)}!` });
        e.p.validateHands();
      }
    } else if (ev.type === 'cough' || ev.type === 'sneeze') {
      const e = entries.find((x) => x.p === ev.player);
      if (e) e.send({ type: 'msg', kind: ev.type, text: ev.type === 'sneeze' ? 'ACHOO!' : '*cough*' });
    }
  }

  _pickedUp(d, entries) {
    const e = entries.find((x) => x.p === d.player);
    if (!e) return;
    const c = d.body.pos;
    if (d.kind === 'zcash') {
      this._fx({ type: 'sparkle', x: c.x, y: c.y + 0.4, z: c.z });
      e.send({ type: 'msg', text: `+${d.value.toFixed(2)} ZEC`, kind: 'coin' });
    } else if (d.kind === 'ammo') {
      e.send({ type: 'msg', text: `+${d.bundle.n} ${AMMO[d.bundle.ammo].name.toLowerCase()}`, kind: 'ammo' });
    } else if (d.kind === 'arrow') {
      e.send({ type: 'msg', text: '+1 arrow', kind: 'ammo' });
    } else if (d.kind === 'surge') {
      this._fx({ type: 'surge', x: c.x, y: c.y + 0.4, z: c.z });
      e.send({ type: 'msg', text: `POWER SURGE! ${T.surgeMult}× damage`, kind: 'surge' });
    } else {
      e.send({ type: 'msg', text: `+1 ${itemName(d.kind)}` });
    }
  }

  // ---------- townsfolk and quests (npcs.js, quests.js) ----------

  /** Is townsperson `n` there, and close enough to talk to? */
  _nearNpc(e, n) {
    return !!n && Math.hypot(n.pos.x - e.p.pos.x, n.pos.y - e.p.pos.y, n.pos.z - e.p.pos.z) <= REACH;
  }

  /** Right-clicked a townsperson: they turn to you and say their piece (an `npc` message: the dialog). */
  _talk(e, { id }) {
    const n = this.npcs.get(id);
    if (!this._nearNpc(e, n)) return;
    n.talkT = 10;
    n.talkTo = { x: e.p.pos.x, z: e.p.pos.z };
    this._sendNpc(e, n);
  }

  /**
   * The dialog with `n`: { type: 'npc', id, name, role, text, counter?, active?, ready?, offer?, note? }. `active`
   * is your quest for them (`ready` if you can finish it now), `offer` the one they'd give you.
   */
  _sendNpc(e, n, note = null) {
    const p = e.p;
    const msg = { type: 'npc', id: n.id, name: n.name, role: n.role, counter: n.counter ? { ...n.counter } : null, note };
    const active = p.quests.active.find((q) => q.giver === n.key);
    if (active) {
      msg.active = this._questCopy(active);
      msg.ready = !p.buildy && questReady(active, p);
      msg.text = msg.ready ? 'Oh, you\'ve done it! Is that for me?'
        : `${p.buildy ? 'Take that hard hat off first, then we\'ll talk. ' : ''}${questAsk(active)}`;
    } else if ((p.quests.cool[n.key] || 0) > Date.now()) {
      msg.text = `${hello(n.role, this.rand)} I've nothing more for you just now. Come back in a little while.`;
    } else if (p.buildy) {
      msg.text = `${hello(n.role, this.rand)} I might have work for you, but not while you're wearing that hard hat.`;
    } else if (p.quests.active.length >= T.maxQuests) {
      msg.text = `${hello(n.role, this.rand)} You've your hands full already. Come back when you've finished one of your jobs.`;
    } else {
      const offer = this._offer(e, n);
      if (offer) {
        msg.offer = this._questCopy(offer);
        msg.text = offer.text;
      } else msg.text = hello(n.role, this.rand);
    }
    e.send(msg);
  }

  /** A quest to send (its own copy: single player passes messages without copying them). */
  _questCopy(q) {
    return { ...q, ...(q.spot ? { spot: { ...q.spot } } : {}) };
  }

  /** `you.quests`: your quests, and who has nothing for you yet (cooling down). */
  _questsYou(p) {
    const now = Date.now();
    return { active: p.quests.active.map((q) => this._questCopy(q)), cool: Object.keys(p.quests.cool).filter((k) => p.quests.cool[k] > now), done: Object.values(p.quests.count).reduce((a, b) => a + b, 0) };
  }

  /** What `n` offers this character now (a quest without an id), or null. The same every time you ask, until you've done it. */
  _offer(e, n) {
    const seed = offerSeed(n.key, e.token, e.p.quests.count[n.key] || 0);
    for (let tries = 0; tries < 4; tries++) {
      const o = questOffer(n.role, seed + tries, tries === 3); // (the last try is always a fetching job: they need no spot)
      const q = { giver: n.key, name: n.name, role: n.role, kind: o.kind, item: o.item, n: o.n, usd: o.usd, text: o.text };
      if (o.kind === 'fetch') return q;
      const spot = n.market && (o.kind === 'lost' ? this._lostSpot(n, o.rand) : this._tillSpot(n, o.rand));
      if (!spot) continue;
      return { ...q, spot, ...(o.kind === 'lost' ? { found: false } : { progress: 0 }) };
    }
    return null;
  }

  /** Where a villager's lost thing lies: out in the open (nothing overhead) on solid ground near their market square. */
  _lostSpot(n, rand) {
    const cx = n.market.x + MARKET / 2;
    const cz = n.market.z + MARKET / 2;
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2;
      const r = 6 + rand() * Math.max(0, T.questLostRange - 6);
      const x = Math.floor(cx + Math.cos(a) * r);
      const z = Math.floor(cz + Math.sin(a) * r);
      const y = this.world.surfaceAt(x, z); // (one above the highest solid or fluid block: so the sky's above it)
      const ground = this.world.getBlock(x, y - 1, z);
      if (SOLID[ground] && !FLUID[ground] && !UNBREAKABLE[ground] && Math.abs(y - (this.world.heightAt(x, z) + 1)) <= 1) return { x: x + 0.5, y, z: z + 0.5 };
    }
    return null;
  }

  /** The middle of a patch of open, tillable ground near a villager's market square (for a garden quest), or null. */
  _tillSpot(n, rand) {
    const cx = n.market.x + MARKET / 2;
    const cz = n.market.z + MARKET / 2;
    const tillable = (x, z) => {
      const h = this.world.surfaceAt(x, z) - 1;
      const above = this.world.getBlock(x, h + 1, z);
      return TILLABLE.has(this.world.getBlock(x, h, z)) && (above === AIR || PLANT[above]) ? h : null;
    };
    for (let i = 0; i < 60; i++) {
      const a = rand() * Math.PI * 2;
      const r = MARKET / 2 + 4 + rand() * 30; // (just outside the square: its plaza is all cobbles)
      const x = Math.floor(cx + Math.cos(a) * r);
      const z = Math.floor(cz + Math.sin(a) * r);
      const h = tillable(x, z);
      if (h === null) continue;
      let good = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (tillable(x + dx, z + dz) === h) good++;
      if (good >= 18) return { x: x + 0.5, y: h + 1, z: z + 0.5 };
    }
    return null;
  }

  /**
   * The quest buttons: { op: 'accept' | 'turnin', id } with townsperson `id` (you have to be next to them), or
   * { op: 'abandon', quest } from anywhere (the quest log). Answers with the dialog again, if you're talking.
   */
  _quest(e, { op, id, quest }) {
    const p = e.p;
    if (op === 'abandon') {
      const q = p.quests.active.find((x) => x.id === quest);
      if (!q) return;
      p.quests.active = p.quests.active.filter((x) => x !== q);
      e.send({ type: 'msg', kind: 'quest', text: `Quest dropped: ${questGoal(q)}` });
      this._sendYou(e);
      const n = this.npcs.get(id);
      if (this._nearNpc(e, n) && n.key === q.giver) this._sendNpc(e, n);
      return;
    }
    const n = this.npcs.get(id);
    if (!this._nearNpc(e, n) || p.buildy) return;
    const active = p.quests.active.find((q) => q.giver === n.key);
    if (op === 'accept') {
      if (active || (p.quests.cool[n.key] || 0) > Date.now() || p.quests.active.length >= T.maxQuests) return this._sendNpc(e, n);
      const offer = this._offer(e, n);
      if (!offer) return this._sendNpc(e, n);
      const q = { id: p.quests.next++, ...offer };
      p.quests.active.push(q);
      e.send({ type: 'msg', kind: 'quest', text: `📜 New quest: ${questGoal(q)} (quest log: L)` });
      let note = null;
      if (q.kind === 'till' && !(itemCount(p, 'tiller') > 0)) { // they lend you theirs
        p.tools.tiller = (p.tools.tiller || 0) + 1;
        note = 'Here, take my old Tiller. Hold it and click the ground.';
        e.send({ type: 'msg', kind: 'quest', text: `${n.name.split(' ')[0]} gave you a Tiller` });
      }
      this._sendYou(e);
      return this._sendNpc(e, n, note);
    }
    if (op === 'turnin') {
      if (!active || !questReady(active, p)) return this._sendNpc(e, n);
      if (active.kind === 'fetch') spend(p, itemGroup(active.item), active.item, active.n);
      const zec = zecFor(active.usd, this.rate);
      p.wallet.zcash = round2(p.wallet.zcash + zec);
      p.quests.active = p.quests.active.filter((q) => q !== active);
      p.quests.count[n.key] = (p.quests.count[n.key] || 0) + 1;
      p.quests.cool[n.key] = Date.now() + T.questCooldown * 60000;
      this._skill(e, 'quest', Math.round(T.questSkill));
      e.send({ type: 'msg', kind: 'questDone', text: `✅ Quest done for ${n.name}: +${zec.toFixed(2)} ZEC` });
      this._fx({ type: 'sparkle', x: r2(n.pos.x), y: r2(n.pos.y + 1.6), z: r2(n.pos.z) });
      this._sendYou(e);
      return this._sendNpc(e, n, thanks(this.rand));
    }
    return undefined;
  }

  /** Lost things: walking up to one picks it up (you take it back to whoever lost it). */
  _tickQuests(e) {
    const p = e.p;
    if (p.dead) return;
    for (const q of p.quests.active) {
      if (q.kind !== 'lost' || q.found) continue;
      const c = p.center;
      if (Math.hypot(c.x - q.spot.x, c.y - (q.spot.y + 0.3), c.z - q.spot.z) > T.pickupRange + 0.5) continue;
      q.found = true;
      this._fx({ type: 'sparkle', x: q.spot.x, y: q.spot.y + 0.3, z: q.spot.z });
      e.send({ type: 'msg', kind: 'quest', text: `Found the ${lostName(q.item)}! Take it back to ${q.name}` });
    }
  }

  /** Ground tilled at (x, y, z) (`n` blocks in a row from there): it counts for any garden quest it's near. */
  _tilledFor(e, x, y, z, n) {
    for (const q of e.p.quests.active) {
      if (q.kind !== 'till' || q.progress >= q.n) continue;
      if (Math.hypot(x + 0.5 - q.spot.x, z + 0.5 - q.spot.z) > T.questTillRadius || Math.abs(y + 1 - q.spot.y) > 3) continue;
      q.progress = Math.min(q.n, q.progress + n);
      e.send({ type: 'msg', kind: 'quest', text: q.progress >= q.n ? `That's the garden tilled: tell ${q.name}` : `Garden for ${q.name.split(' ')[0]}: ${q.progress}/${q.n} blocks tilled` });
    }
  }

  // ---------- output ----------

  _you(e) {
    const p = e.p;
    return {
      hp: p.hp, maxHp: p.maxHp, dead: p.dead, level: p.level, cleaned: p.cleaned, skills: { ...p.skills },
      traits: { ...p.traits },
      stats: { ...p.stats }, statBonus: { ...p.statBonus }, statPoints: p.statPoints,
      effects: Object.fromEntries(Object.entries(p.effects).map(([k, v]) => [k, Math.ceil(v)])),
      mana: Math.floor(p.mana), maxMana: maxMana(p.stats, this.settings),
      ammo: { ...p.ammo },
      bed: p.bed ? { ...p.bed } : null,
      buildy: p.buildy, buildSwitch: e.buildSwitch ? { to: e.buildSwitch.to, t: Math.ceil(e.buildSwitch.t) } : null,
      blocks: { ...p.blocks },
      orders: p.orders.map((o) => ({ kind: o.kind, t: Math.max(0, Math.ceil(o.t)), drone: !!o.drone })),
      food: { ...p.food }, dishes: { ...p.dishes }, wallet: { ...p.wallet }, tools: { ...p.tools }, materials: { ...p.materials }, spells: [...p.spells], hotbars: { left: [...p.hotbars.left], right: [...p.hotbars.right] },
      scrolls: { ...p.scrolls }, worn: p.worn,
      quests: this._questsYou(p),
      cooking: p.cooking ? { out: p.cooking.out, n: p.cooking.n, t: Math.max(0, Math.ceil(p.cooking.t)) } : null, unfired: { ...p.unfired }, kiln: p.kiln ? { t: Math.max(0, Math.ceil(p.kiln.t)), n: p.kiln.pieces.reduce((a, [, n]) => a + n, 0), text: piecesText(p.kiln.pieces) } : null,
    };
  }

  _broadcast(msg, except = null) {
    for (const e of this.players.values()) if (e !== except) e.send(msg);
  }

  /** A visual effect for everyone: { type: 'fx', fx: 'explode' | 'puff' | ..., ...details }. */
  _fx({ type, ...details }) {
    this._broadcast({ ...details, type: 'fx', fx: type });
  }

  _sendSnapshot() {
    if (!this.players.size) return;
    const pos = (o) => ({ x: r2(o.x), y: r2(o.y), z: r2(o.z) });
    this._broadcast({
      type: 'snap',
      time: this.time,
      rate: round2(this.rate),
      players: [...this.players.values()].map((e) => ({
        id: e.id, name: e.name, ...pos(e.p.pos), yaw: r2(e.yaw), pitch: r2(e.pitch),
        crouch: e.crouch, flying: e.flying, phone: e.phoneOut, hands: { ...e.p.hands }, dead: e.p.dead,
        surge: e.p.effects.surge > 0, grapple: e.grapple, buildy: e.p.buildy,
        invisible: e.p.effects.invisible > 0, poly: e.p.effects.polymorph > 0, scale: e.p.sizeScale, stone: e.p.effects.stoneskin > 0,
        chill: e.p.effects.chill > 0, worn: e.p.worn || null, look: e.look, tall: e.p.stats.tallness ?? 10, bobber: e.fishing ? { ...pos(e.fishing), bite: e.fishing.bite > 0, hand: e.fishing.hand } : null, voice: e.voiceMode || null, sw: e.sw || { left: 0, right: 0 }, mine: e.mine || null, draw: e.draw || 0,
      })),
      mobs: this.mobs.list.map((m) => ({
        id: m.id, type: m.type, ...pos(m.pos), yaw: r2(m.yaw), size: m.size, hurt: m.hurtT > 0,
        burning: m.burning, aiming: m.aiming, walk: r2(m.walkAmount), vy: r2(m.vel.y),
        poly: m.polyT > 0, scale: m.scale, chill: m.chillT > 0, arrows: m.arrows || 0,
      })),
      arrows: this.mobs.arrows.map((a) => ({ id: a.id, ...pos(a.pos), vx: r2(a.vel.x), vy: r2(a.vel.y), vz: r2(a.vel.z), stuck: a.stuck })),
      drops: this.drops.list.map((d) => ({ id: d.id, kind: d.kind, ...pos(d.body.pos), ...(d.dir ? { dir: d.dir } : {}) })),
      fireballs: this.fireballs.list.map((f) => ({ id: f.id, kind: f.kind, ...pos(f.pos) })),
      sacks: this.throwables.list.map((s) => ({ id: s.id, ...pos(s.pos) })),
      messes: this.messes.map((m) => ({ id: m.id, ...pos(m) })),
      backpacks: this.backpacks.map((b) => ({ id: b.id, ...pos(b), name: b.name, owner: [...this.players.values()].find((o) => o.token === b.owner)?.id ?? null })),
      drones: this.drones.list.map((d) => ({ id: d.id, ...pos(d.pos), yaw: r2(d.yaw), carrying: d.carrying })),
      storms: this.storms.map((s) => ({ id: s.id, ...pos(s), r: magic(this.settings, 'blizzardRadius') })),
      npcs: this.npcs.list.map((n) => ({ id: n.id, key: n.key, name: n.name, role: n.role, ...pos(n.pos), yaw: r2(n.yaw), hands: { ...n.hands }, look: { ...n.look }, worn: n.worn })),
    });
  }

  // ---------- saving ----------

  _savePlayer(e) {
    const p = e.p;
    this.savePlayer(e.token, {
      name: e.name, seed: this.seed, pos: p.dead ? null : { ...p.pos }, traits: p.traits, stats: p.baseStats, statBonus: p.statBonus, statPoints: p.statPoints,
      food: p.food, dishes: p.dishes, wallet: p.wallet, tools: p.tools, materials: p.materials, spells: p.spells, hotbars: p.hotbars, hands: p.hands, ammo: p.ammo, scrolls: p.scrolls, worn: p.worn,
      skills: p.skills, cleaned: p.cleaned, bed: p.bed, quests: p.quests, blocks: p.blocks, buildy: p.buildy, wornFree: !!p.wornFree, unfired: p.unfired, kiln: p.kiln, cooking: p.cooking,
      orders: p.orders.map((o) => ({ kind: o.kind, t: Math.max(0, o.t) })), // a drone in flight is sent again next time
    });
  }

  save() {
    for (const e of this.players.values()) this._savePlayer(e);
    this.store.set('game:backpacks', JSON.stringify(this.backpacks));
    this.store.set('game:time', String(this.time));
    this.store.set('game:rate', String(this.rate));
    this.world.saveNow();
  }
}
