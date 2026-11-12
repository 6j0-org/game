// The player: input, movement modes, health. No Three.js dependency.

import { T, tune, bindTunable } from './tuning.js';
import { Body } from './body.js';
import { FOOD, DISHES, TOOLS, MATERIALS, STARTING_BLOCKS, CURES, blockKind, itemCount, isTwoHanded, spend } from './items.js';

import { AVERAGE, statEffects } from './stats.js';
import { UNFIRED } from './pottery.js';
import { AMMO } from './weapons.js';
import { maxMana, sizeScale, sizeSpeed, magic, SPELLS } from './spells.js';
import { totalPoints, levelFor, maxHpFor } from './skills.js';
import { emptyQuests } from './quests.js';
import { WATER, GRASS, SOLID, HOTBAR, SINK } from './blocks.js';

// Server settings (tuning.js): read the live values as T.key.
tune('Player', {
  flapSpeed: [7.5, 'Flap strength', 'Upward speed of one flap (Roast Bird)'],
  crouchSpeed: [1.6, 'Crouch speed', 'Blocks per second while crouching'],
  flySprint: [1.7, 'Fast flying', 'Shift multiplies flying speed by this', { unit: '×' }],
  jumpSpeed: [8.6, 'Jump strength', 'Upward speed of a jump'],
  walkSpeed: [4.4, 'Walking speed', 'Blocks per second'],
  sprintSpeed: [6.4, 'Sprinting speed', 'Blocks per second with Shift'],
  flySpeed: [11, 'Flying speed', 'Blocks per second (Buildy Bois)'],
  washTime: [1.2, 'Dish washing time', 'Seconds to wash one dish', { unit: ' s', min: 0.1 }],
  grappleSpeed: [20, 'Grapple pull speed', 'Blocks per second the grappling hook reels you in'],
});
tune('Food & traits', {
  lowGravityFactor: [0.5, 'Gravity resistance', 'Gravity a gravity-resistant player feels, compared with normal', { max: 1, step: 0.05, unit: '×' }],
});
tune('Health & XP', {
  startMaxHp: [20, 'Starting max health', 'Max health of a new player', { min: 1, step: 1 }],
  hpPerLevel: [2, 'Max health per level', 'Max health gained each level', { step: 1 }],
  invulnerable: [0.5, 'Invulnerability after a hit', "Seconds you can't be hurt again after taking damage", { unit: ' s' }],
  maxHpCap: [40, 'Max health cap', "Levelling up can't raise max health beyond this"],
  fallSafe: [3, 'Safe fall height', "Falls up to this many blocks don't hurt"],
});

export const EYE_HEIGHT = 1.62;
const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.5;
const CROUCH_EYE = 1.27;
const LOOK_SENSITIVITY = 0.0022;
const WASH_ORDER = ['bowl', 'plate', 'glass', 'cutlery'];
/** Timed conditions, in seconds left. stoneskin/invisible/polymorph/shrink/enlarge/hallucinate/chill come from spells. */
export const NO_EFFECTS = { headache: 0, upset: 0, surge: 0, flap: 0, stoneskin: 0, invisible: 0, polymorph: 0, shrink: 0, enlarge: 0, hallucinate: 0, chill: 0, flight: 0, blind: 0 };

export class Player extends Body {
  constructor(world) {
    super(world, 0.3, 1.8);
    this.yaw = 0;
    this.pitch = 0;
    this.flying = false;
    this.locked = false;
    this.keys = new Set();
    this.maxHp = T.startMaxHp;
    this.hp = this.maxHp;
    this.dead = false;
    this.invuln = 0;
    this.sinceHurt = 99;
    this.onHurt = null; // callback(amount)
    this.onDodge = null; // callback(source): Cracked dodged an attack
    this.rand = Math.random;
    this.food = Object.fromEntries(Object.keys(FOOD).map((k) => [k, 0]));
    this.dishes = Object.fromEntries(Object.keys(DISHES).map((k) => [k, 0])); // dirty, waiting to be washed
    this.spells = []; // the spells you know (learned by reading their scrolls: spells.js)
    this.hotbars = { left: Array(8).fill(null), right: Array(8).fill(null) }; // what you've put on each hand's hotbar (item kinds)
    this.materials = Object.fromEntries(Object.keys(MATERIALS).map((k) => [k, 0])); // crafting materials (crafting.js)
    this.quests = emptyQuests(); // jobs for the Fantasy Town's people (quests.js); the game owns them, sent in `you`
    this.unfired = Object.fromEntries(UNFIRED.map((k) => [k, 0])); // pottery on its way: thrown, trimmed, or glazed and waiting for the kiln (pottery.js)
    this.traits = { gluten: false, lactose: false }; // rolled each time you spawn
    this.baseStats = { ...AVERAGE }; // rolled each time you spawn (see stats.js)
    this.statBonus = {}; // attribute points you've put in (stat -> points); they last from life to life
    this.statPoints = 0; // attribute points to spend (from levelling up)
    this.stats = { ...AVERAGE }; // the two together (withBonus): what everything reads
    this.effects = { ...NO_EFFECTS }; // seconds left
    this.bodyScale = 1; // how big your body actually is: sizeScale, once there's room to grow that big
    this.mana = maxMana(this.stats); // magic (spells.js); the game refills it
    this.armor = 0; // fraction of damage stoneskin stops while it lasts
    this.worn = null; // the armor you have on (a tool kind with `armor`), or null; it's not in `tools` while worn
    this.scrolls = Object.fromEntries(Object.keys(SPELLS).map((k) => [k, 0])); // spell -> how many scrolls
    this.ammo = Object.fromEntries(Object.keys(AMMO).map((k) => [k, 0])); // every ammo type (weapons.js)
    this.bed = null; // { x, y, z } of the bed you respawn at
    this.orders = []; // CONSUME deliveries on the way: [{ kind, t: seconds left }]
    this.blocks = Object.fromEntries(HOTBAR.map((id) => [id, STARTING_BLOCKS[id] || 0])); // block id -> how many you have
    this.buildy = false; // Buildy Boi mode: fly, unlimited blocks, invincible
    this.grapple = null; // { x, y, z } while the grappling hook is pulling you
    this.cleaned = 0;
    this.wallet = { zcash: 0, cold: 0 }; // cold: kept in cold storage, safe when you die
    this.tools = Object.fromEntries(Object.keys(TOOLS).map((k) => [k, 0]));
    // What's in each hand (an item kind). Left mouse button uses the left hand, right uses the right.
    this.hands = { left: 'empty', right: 'empty' };
    this.skills = {}; // skill (an item kind, or 'empty' / 'magic' / 'dishwash') -> points (skills.js)
    this.level = 1; // from your total skill points
    this.washT = 0;
    // main.js points this at "no menu is open", so typing in a menu never moves or turns you.
    this.inputEnabled = () => true;
    this.crouching = false;
    this.lookScale = 1; // main.js lowers it while aiming down sights
    this.sensitivity = 1; // mouse sensitivity and invert (Settings: Controls)
    this.invertY = false;
    this.eyeHeight = EYE_HEIGHT; // eases down while crouching
  }

  /** True if there's a solid block right under any part of your feet. */
  _groundBelow() {
    const y = Math.floor(this.pos.y - 0.05);
    const hw = this.halfW - 1e-3;
    for (let z = Math.floor(this.pos.z - hw); z <= Math.floor(this.pos.z + hw); z++) {
      for (let x = Math.floor(this.pos.x - hw); x <= Math.floor(this.pos.x + hw); x++) {
        if (SOLID[this.world.getBlock(x, y, z)]) return true;
      }
    }
    return false;
  }

  /** Crouch when asked (on land only); stand back up only if there's headroom. */
  _updateCrouch(want) {
    if (want && !this.crouching) {
      this.crouching = true;
      this.height = CROUCH_HEIGHT * this.bodyScale;
    } else if (!want && this.crouching) {
      this.height = STAND_HEIGHT * this.bodyScale;
      if (this.collides()) this.height = CROUCH_HEIGHT * this.bodyScale; // ceiling: stay down
      else this.crouching = false;
    }
  }

  /**
   * Empties any hand holding something you've run out of (ate the last steak, threw the last sack...).
   * An item you only have one of can't be in both hands: if that happens, `emptyFirst` lets go of it.
   * Two-handed items (big guns) are the exception: they're always in both hands.
   */
  validateHands(emptyFirst = 'left') {
    for (const hand of ['left', 'right']) {
      if (!(itemCount(this, this.hands[hand]) > 0)) this.hands[hand] = 'empty';
    }
    const other = emptyFirst === 'left' ? 'right' : 'left';
    if (isTwoHanded(this.hands[other])) this.hands[emptyFirst] = this.hands[other];
    else if (isTwoHanded(this.hands[emptyFirst])) this.hands[other] = this.hands[emptyFirst];
    const { left, right } = this.hands;
    if (left === right && itemCount(this, left) < 2 && !isTwoHanded(left)) this.hands[emptyFirst] = 'empty';
  }

  /**
   * Puts an item in a hand. If it's your only one and it's in the other hand, it moves across.
   * A two-handed item takes both hands; anything else put in a hand frees the other from one.
   */
  hold(hand, kind) {
    const other = hand === 'left' ? 'right' : 'left';
    if (isTwoHanded(kind)) {
      this.hands.left = this.hands.right = kind;
      return;
    }
    if (isTwoHanded(this.hands[other])) this.hands[other] = 'empty';
    this.hands[hand] = kind;
    if (this.hands[other] === kind && itemCount(this, kind) < 2) this.hands[other] = 'empty';
  }

  /** Pays `zec` from your wallet. Returns true if you could afford it. */
  pay(zec) {
    if (!(zec > 0) || this.wallet.zcash < zec) return false;
    this.wallet.zcash = Math.round((this.wallet.zcash - zec) * 100) / 100;
    return true;
  }

  /** XP needed to go from the current level to the next. */
  /**
   * Adds points to a skill (skills.js). Your level follows your total, and each level raises your max health
   * (healing you by as much). Returns how many levels that gained.
   */
  gainSkill(kind, n = 1) {
    if (!kind || !(n > 0)) return 0;
    this.skills[kind] = (this.skills[kind] || 0) + n;
    const before = this.level;
    this.level = levelFor(totalPoints(this.skills));
    if (this.level > before) this.refreshMaxHp();
    return this.level - before;
  }

  /** Max health from your level and Built Different. */
  maxHpNow() {
    return Math.max(1, maxHpFor(this.level) + statEffects(this.stats).hp);
  }

  /** Recomputes max health (levelling up, a point in Built Different); a rise heals you by as much. */
  refreshMaxHp() {
    const maxHp = this.maxHpNow();
    this.hp = Math.min(maxHp, this.hp + Math.max(0, maxHp - this.maxHp));
    this.maxHp = maxHp;
  }

  /** True if there's water (or a Sink) touching or right next to the player. */
  get nearWater() {
    const x0 = Math.floor(this.pos.x);
    const y0 = Math.floor(this.pos.y);
    const z0 = Math.floor(this.pos.z);
    for (let y = y0 - 1; y <= y0 + 1; y++) {
      for (let z = z0 - 1; z <= z0 + 1; z++) {
        for (let x = x0 - 1; x <= x0 + 1; x++) {
          const b = this.world.getBlock(x, y, z);
          if (b === WATER || b === SINK) return true; // (a Sink is water for washing dishes)
        }
      }
    }
    return false;
  }

  /**
   * Call every frame. While `wanting` and near water with dirty dishes, scrubs the next one.
   * Returns null, { type: 'washing', kind, progress } or { type: 'washed', kind, xp, levels }.
   */
  wash(dt, wanting, onlyKind = null) {
    const kind = onlyKind ? (this.dishes[onlyKind] > 0 ? onlyKind : undefined) : WASH_ORDER.find((k) => this.dishes[k] > 0);
    if (!wanting || !kind || this.dead || !this.nearWater) {
      this.washT = 0;
      return null;
    }
    this.washT += dt;
    if (this.washT < T.washTime) return { type: 'washing', kind, progress: this.washT / T.washTime };
    this.washT = 0;
    this.dishes[kind]--;
    this.cleaned++;
    return { type: 'washed', kind, xp: 1, levels: 0 }; // (the game adds the skill point)
  }

  /**
   * Eats one of `kind` if you have it and aren't at full health.
   * Returns 'ate' (healed), 'intolerant' (eaten, but you can't digest it: no healing), or false.
   */
  eat(kind) {
    const f = FOOD[kind];
    const flap = f?.flap; // a bird is worth eating even when you're full
    const useful = (f?.heal > 0 && this.hp < this.maxHp) || flap || (f?.cure && this.ailing) || (f?.mana && this.mana < maxMana(this.stats, T));
    if (this.dead || !(itemCount(this, kind) > 0) || !useful) return false;
    spend(this, 'food', kind); // (Buildy Bois never run out)
    for (const dish of f.dishes) this.dishes[dish]++;
    if (flap) this.effects.flap = T.flapSeconds;
    const allergen = f.allergen;
    if (allergen && this.traits[allergen]) return 'intolerant';
    this.hp = Math.min(this.maxHp, this.hp + this.healFor(kind));
    if (f.cure) for (const k of CURES) this.effects[k] = 0;
    if (f.mana) this.mana = Math.min(maxMana(this.stats, T), this.mana + f.mana);
    return 'ate';
  }

  /** Suffering from something an Antidote cures. */
  get ailing() {
    return CURES.some((k) => this.effects[k] > 0);
  }

  /** How much a food heals you. */
  healFor(kind) {
    return FOOD[kind].heal > 0 ? Math.max(1, Math.round(FOOD[kind].heal)) : 0;
  }

  /** The armor you're wearing's definition, or null. */
  get armorWorn() {
    return this.worn && TOOLS[this.worn]?.armor ? TOOLS[this.worn] : null;
  }

  /** Movement speed multiplier from how you're feeling. */
  get speedMul() {
    if (this.effects.polymorph > 0) return 0; // an infant doesn't go anywhere
    return (this.effects.upset > 0 ? T.upsetSpeed : 1) * statEffects(this.stats).speed * sizeSpeed(this.sizeSpell)
      * (this.effects.chill > 0 ? magic(T, 'chillSpeed') / 100 : 1) // chilled by ice magic
      * (this.armorWorn ? this.armorWorn.speed / 100 : 1); // heavy armor
  }

  /** The size spell you're under ('shrink', 'enlarge') or null. The game keeps at most one going. */
  get sizeSpell() {
    return this.effects.shrink > 0 ? 'shrink' : this.effects.enlarge > 0 ? 'enlarge' : null;
  }

  /** 1, or your size under a size spell (your body, eyes and attacks scale with it). */
  get sizeScale() {
    return sizeScale(this.sizeSpell);
  }

  spawn({ x, y, z }) {
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.knock = { x: 0, z: 0 };
    this.hp = this.maxHp;
    this.dead = false;
    this.invuln = 1;
    this.crouching = false;
    this.height = STAND_HEIGHT;
    this.halfW = 0.3;
    this.bodyScale = 1;
    this.eyeHeight = EYE_HEIGHT;
    this.effects = { ...NO_EFFECTS };
    this.mana = maxMana(this.stats);
    this.grapple = null;
  }

  /**
   * Applies damage with knockback away from (fromX, fromZ). Returns true if it landed. `source` says what did
   * it, for the death message: { cause: 'mob', mob } | { cause: 'player', by, byId, weapon } | { cause: 'fall',
   * blocks } | { cause: 'lava' | 'lactose' | 'allergy' | 'void' } (game.js `_deathText`).
   */
  damage(amount, fromX, fromZ, knock = 7, source = null) {
    if (this.dead || this.invuln > 0 || amount <= 0 || this.buildy) return false; // Buildy Bois are invincible
    // Cracked: a chance to dodge an attack (mobs, weapons, spells), never falls, lava, blasts and the like.
    if ((source?.cause === 'mob' || source?.cause === 'player') && !source.blast && this.rand() < statEffects(this.stats).dodge) {
      this.invuln = T.invulnerable;
      this.onDodge?.(source);
      return false;
    }
    if (this.effects.stoneskin > 0) amount = Math.max(1, Math.round(amount * (1 - this.armor))); // stoneskin
    if (this.armorWorn) amount = Math.max(1, Math.round(amount * (1 - Math.min(100, this.armorWorn.armor) / 100))); // armor you're wearing
    this.hp = Math.max(0, this.hp - amount);
    if (source) this.lastHit = { ...source, at: Date.now() };
    this.invuln = T.invulnerable;
    this.sinceHurt = 0;
    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    // Remembered so a server can send the same shove to the player's own browser.
    this.lastKnock = knock > 0 ? { x: (dx / len) * knock, y: 4, z: (dz / len) * knock } : null;
    if (knock > 0) this.impulse(this.lastKnock.x, this.lastKnock.y, this.lastKnock.z);
    if (this.hp <= 0) this.dead = true;
    if (this.onHurt) this.onHurt(amount);
    return true;
  }

  /** Wire keyboard and mouse-look listeners. Call once in the browser. */
  attach(doc) {
    doc.addEventListener('keydown', (e) => {
      if (!this.locked || !this.inputEnabled()) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF' && !e.repeat) {
        if (this.buildy || this.effects.flight > 0) { // Buildy Bois, and the Flying spell
          this.flying = !this.flying;
          this.vel.y = 0;
        } else {
          this.onCantFly?.(); // only Buildy Bois fly
        }
      }
      if (e.code === 'Space') e.preventDefault();
    });
    doc.addEventListener('keyup', (e) => this.keys.delete(e.code));
    doc.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.inputEnabled()) return;
      this.yaw -= e.movementX * LOOK_SENSITIVITY * this.lookScale * this.sensitivity;
      this.pitch -= e.movementY * LOOK_SENSITIVITY * this.lookScale * this.sensitivity * (this.invertY ? -1 : 1);
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });
  }

  /** Invulnerability frames. (Health doesn't come back on its own: you have to eat.) */
  tickVitals(dt) {
    this.invuln -= dt;
    this.sinceHurt += dt;
  }

  /** Movement for one frame. `vitals` false when a server owns health (multiplayer client). */
  update(dt, input = this._inputFromKeys(), vitals = true) {
    if (vitals) this.tickVitals(dt);
    if (this.dead) return;

    const inWater = !this.flying && this.inWater;
    this._updateCrouch(!!input.crouch && !this.flying && !inWater);
    // Size spells resize your body (when there's room to grow); eyes follow.
    if (this.bodyScale !== this.sizeScale) {
      this.bodyScale = this.fitScale(this.bodyScale, this.sizeScale, (k) => {
        this.halfW = 0.3 * k;
        this.height = (this.crouching ? CROUCH_HEIGHT : STAND_HEIGHT) * k;
      });
    }
    const s = this.bodyScale;
    const targetEye = (this.crouching ? CROUCH_EYE : EYE_HEIGHT) * s * (this.effects.polymorph > 0 ? 0.35 : 1);
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);

    let speed = (this.flying ? T.flySpeed * (input.sprint ? T.flySprint : 1)
      : this.crouching ? T.crouchSpeed : input.sprint ? T.sprintSpeed : T.walkSpeed) * this.speedMul;
    if (inWater) speed *= 0.55;

    let f = input.forward;
    let r = input.right;
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wx = (-sin * f + cos * r) * speed;
    const wz = (-cos * f - sin * r) * speed;

    if (this.grapple) {
      // Reel in: fly straight towards the hook, ignoring gravity, until you get there.
      const g = this.grapple;
      const dx = g.x - this.pos.x;
      const dy = g.y - (this.pos.y + 1);
      const dz = g.z - this.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1.4) {
        this.grapple = null;
        this.vel = { x: 0, y: 2, z: 0 };
      } else {
        const sp = Math.min(T.grappleSpeed, dist / dt);
        this.knock = { x: 0, z: 0 };
        this.vel = { x: (dx / dist) * sp, y: (dy / dist) * sp, z: (dz / dist) * sp };
        this.move(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
        if (this.hitWall && dist < 3) this.grapple = null; // arrived against the wall
        return;
      }
    }

    if (this.flying) {
      this.applyWalk(wx, wz, dt);
      this.vel.y = ((input.jump ? 1 : 0) - (input.down ? 1 : 0)) * speed;
      this.move(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
      return;
    }

    // Ate a bird: every fresh press of jump in mid-air is a flap upward.
    const flapNow = this.effects.flap > 0 && input.jump && !this.jumpHeld && !this.onGround && !this.inWater;
    this.jumpHeld = input.jump;
    if (flapNow) {
      this.vel.y = T.flapSpeed;
      this.onFlap?.();
    }

    const edgeGuard = this.crouching && this.onGround;
    const before = { ...this.pos };
    this.step(dt, wx, wz, input.jump, T.jumpSpeed, input.down);

    // Crouching on the ground never walks you off a ledge: undo whichever horizontal move would.
    if (edgeGuard && !input.jump && !this._groundBelow()) {
      const after = { ...this.pos };
      for (const [x, z] of [[after.x, before.z], [before.x, after.z], [before.x, before.z]]) {
        this.pos = { x, y: before.y, z };
        if (this._groundBelow() && !this.collides()) break;
      }
      if (this.pos.x === before.x) this.vel.x = 0;
      if (this.pos.z === before.z) this.vel.z = 0;
      this.vel.y = 0;
      this.onGround = true;
    }
  }

  _inputFromKeys() {
    const k = this.keys;
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    const c = k.has('KeyC');
    return {
      forward: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      right: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      jump: k.has('Space'),
      down: c, // fly down / dive
      crouch: c, // on land
      sprint: shift,
    };
  }
}
