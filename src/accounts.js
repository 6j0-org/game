// Players (accounts): who may join this world, kept with the world's data (the server's world.json, or
// the browser's world save in single player) under `game:accounts`.
//
//   Create Player   the game makes an ID and a random 256-bit key; the browser keeps the key, the game keeps
//                   only its SHA-256 hash. Joining sends ID + key ('hello'); after that the browser never has
//                   to sign in again.
//   Recover Player  an Admin makes a recovery code (Settings > Players; it never expires, and works once);
//                   typing it in gives that browser a fresh key for the Player (the old one stops working).
//   Admin           the first Player created on a world. Admins can see every Player, make recovery codes,
//                   rename, kick, ban, delete, and make others Admins.
// Logic only: no Three.js, no DOM (the server runs it). Uses crypto.getRandomValues (fine over plain http).

const KEY = 'game:accounts';
export const UID = /^[a-f0-9]{16}$/;
export const SECRET = /^[a-f0-9]{64}$/;

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export function randomHex(nBytes) {
  const bytes = new Uint8Array(nBytes);
  globalThis.crypto.getRandomValues(bytes);
  return hex(bytes);
}

/** SHA-256 of a string, as hex (synchronous and dependency-free: WebCrypto needs https). */
export function sha256(text) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const msg = new TextEncoder().encode(text);
  const len = Math.ceil((msg.length + 9) / 64) * 64;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(len - 4, msg.length * 8);
  view.setUint32(len - 8, Math.floor((msg.length * 8) / 2 ** 32));
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < len; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

export class Accounts {
  /** @param {{get(k:string):string|null, set(k:string,v:string):void}} store  the world's storage */
  constructor(store) {
    this.store = store;
    this.list = {}; // uid -> { name, keyHash, created, seen, admin, banned, recovery: { code } | null }
    try { this.list = JSON.parse(store.get(KEY)) || {}; } catch { this.list = {}; }
  }

  _save() {
    this.store.set(KEY, JSON.stringify(this.list));
  }

  get(uid) {
    return UID.test(uid) && Object.hasOwn(this.list, uid) ? this.list[uid] : null;
  }

  /** Is `name` free (no other Player and no character has it, any case)? `except`: a Player's uid or a character's "uid.charId". */
  nameFree(name, except = null) {
    return !Object.entries(this.list).some(([uid, a]) => (uid !== except && sameName(a.name, name))
      || Object.entries(a.characters || {}).some(([cid, c]) => `${uid}.${cid}` !== except && sameName(c.name, name)));
  }

  // ---------- characters (characters.js) ----------

  /** A Player's characters: { id: { name, look, stats, spare, traits, created } }. */
  characters(uid) {
    return this.get(uid)?.characters || {};
  }

  /** Adds a character (made by characters.js newCharacter). Returns its id or { error }. */
  addCharacter(uid, ch, max) {
    const a = this.get(uid);
    if (!a) return { error: 'No such Player' };
    a.characters ??= {};
    if (Object.keys(a.characters).length >= max) return { error: `You have ${max} characters already (the most a Player can have)` };
    if (!this.nameFree(ch.name, uid)) return { error: `Someone is already called ${ch.name}. Pick another name.` };
    let id;
    do id = randomHex(4); while (a.characters[id]);
    a.characters[id] = ch;
    a.lastChar = id;
    this._save();
    return id;
  }

  removeCharacter(uid, id) {
    const a = this.get(uid);
    if (!a?.characters?.[id]) return false;
    delete a.characters[id];
    if (a.lastChar === id) a.lastChar = null;
    this._save();
    return true;
  }

  renameCharacter(uid, id, name) {
    const c = this.get(uid)?.characters?.[id];
    if (!c) return { error: 'No such character' };
    if (!this.nameFree(name, `${uid}.${id}`)) return { error: `Someone is already called ${name}.` };
    c.name = name;
    this._save();
    return c;
  }

  /** A new Player. Returns { uid, key, name } or { error }. The first one is the Admin. */
  create(name) {
    if (!this.nameFree(name)) return { error: `Someone is already called ${name}. Pick another name.` };
    let uid;
    do uid = randomHex(8); while (this.list[uid]);
    const key = randomHex(32);
    const first = Object.keys(this.list).length === 0;
    this.list[uid] = { name, keyHash: sha256(key), created: Date.now(), seen: Date.now(), admin: first, banned: false, recovery: null, characters: {}, lastChar: null };
    this._save();
    return { uid, key, name };
  }

  /** Checks an ID and key. Returns the account, or { error }. */
  verify(uid, key) {
    const a = this.get(uid);
    if (!a || !SECRET.test(key) || sha256(key) !== a.keyHash) return { error: 'This browser\'s Player isn\'t on this world (it may have been deleted). Create a Player, or ask the Admin to recover yours.' };
    if (a.banned) return { error: 'You\'re banned from this server.' };
    a.seen = Date.now();
    this._save();
    return a;
  }

  /** A recovery code typed in: a fresh key for that Player. Returns { uid, key, name } or { error }. */
  recover(code) {
    const c = String(code || '').trim().toUpperCase();
    const found = Object.entries(this.list).find(([, a]) => a.recovery && a.recovery.code === c); // (codes never expire)
    if (!c || !found) return { error: 'That recovery code isn\'t right (or it\'s been used). Ask the Admin for a new one.' };
    const [uid, a] = found;
    if (a.banned) return { error: 'You\'re banned from this server.' };
    const key = randomHex(32);
    a.keyHash = sha256(key);
    a.recovery = null;
    this._save();
    return { uid, key, name: a.name };
  }

  /** An Admin makes a recovery code for a Player: good once, and it never expires (a new one replaces it). */
  issueRecovery(uid) {
    const a = this.get(uid);
    if (!a) return null;
    const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // (no 0/O or 1/I to mix up)
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    const code = [...bytes].map((b) => ALPHA[b % ALPHA.length]).join('').replace(/^(.{4})/, '$1-');
    a.recovery = { code };
    this._save();
    return code;
  }

  rename(uid, name) {
    const a = this.get(uid);
    if (!a) return { error: 'No such Player' };
    if (!this.nameFree(name, uid)) return { error: `Someone is already called ${name}.` };
    a.name = name;
    this._save();
    return a;
  }

  set(uid, field, value) {
    const a = this.get(uid);
    if (!a) return;
    a[field] = !!value;
    this._save();
  }

  remove(uid) {
    if (!this.get(uid)) return;
    delete this.list[uid];
    this._save();
  }

  /** How many Admins there are (the last one can't be removed or demoted). */
  admins() {
    return Object.values(this.list).filter((a) => a.admin && !a.banned).length;
  }
}
