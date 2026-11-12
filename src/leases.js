// Land leases (multiplayer): anti-griefing. Spend leaseMinutes in a chunk (16×16 blocks, top to bottom) that
// nobody owns and change something there, and it's yours: other Players can only place, break or modify
// (doors, trapdoors, lights, garden tools) there if you allow it. A lease lasts leaseDays of real time and
// renews whenever you're on your land, so it only runs out once you've been away that long. Leases belong to the
// Player (accounts.js uid), so all your characters share them. Admins can always build. Saved with the world as
// `game:leases`. Logic only: no Three.js, no DOM.

import { T, tune } from './tuning.js';

tune('Land', {
  leaseMinutes: [3, 'Time to claim land', 'Minutes a player has to spend in a chunk nobody owns (and change something there) to lease it', { unit: ' min', min: 0, max: 120, step: 0.5 }],
  leaseDays: [30, 'Lease length', 'Days (real ones) a lease lasts after its owner was last there', { unit: ' days', min: 1, max: 365, step: 1 }],
  leaseMax: [64, 'Most land per player', 'How many chunks one Player can lease (0: no limit)', { min: 0, max: 10000, step: 1 }],
});

/** What owners can allow others to do. */
export const LAND_ACTIONS = { place: 'place blocks', break: 'break blocks', modify: 'use doors, trapdoors, lights and garden tools' };
const KEY = 'game:leases';
const DAY = 24 * 3600 * 1000;
export const landKey = (x, z) => `${Math.floor(x) >> 4},${Math.floor(z) >> 4}`;

export class Leases {
  constructor(store) {
    this.store = store;
    this.list = {}; // "cx,cz" -> { owner (uid), name, since, expires, allow: { place, break, modify } }
    try {
      const saved = JSON.parse(store?.get(KEY));
      if (saved && typeof saved === 'object') {
        for (const [k, l] of Object.entries(saved)) {
          if (!/^-?\d+,-?\d+$/.test(k) || typeof l?.owner !== 'string' || !Number.isFinite(l.expires)) continue;
          this.list[k] = { owner: l.owner, name: String(l.name || '?').slice(0, 40), since: l.since || Date.now(), expires: l.expires,
            allow: Object.fromEntries(Object.keys(LAND_ACTIONS).map((a) => [a, !!l.allow?.[a]])) };
        }
      }
    } catch { /* none yet */ }
    this.changed = false;
  }

  /** The lease on the chunk at (x, z) (block coordinates), or null. Expired ones go. */
  at(x, z) {
    const k = landKey(x, z);
    const l = this.list[k];
    if (l && l.expires < Date.now()) { delete this.list[k]; this._save(); return null; }
    return l || null;
  }

  /** May Player `uid` do `action` at (x, z)? (No lease, their own, or the owner allows it.) */
  may(uid, x, z, action) {
    const l = this.at(x, z);
    return !l || l.owner === uid || !!l.allow[action];
  }

  /** How many chunks Player `uid` has. */
  count(uid) {
    return Object.values(this.list).filter((l) => l.owner === uid && l.expires >= Date.now()).length;
  }

  claim(k, uid, name) {
    this.list[k] = { owner: uid, name, since: Date.now(), expires: Date.now() + T.leaseDays * DAY, allow: { place: false, break: false, modify: false } };
    this._save();
  }

  /** The owner's been here: the lease runs leaseDays from now. */
  renew(k) {
    const l = this.list[k];
    if (!l) return;
    l.expires = Date.now() + T.leaseDays * DAY;
    this._save(false);
  }

  allow(k, action, on) {
    if (!this.list[k] || !(action in LAND_ACTIONS)) return;
    this.list[k].allow[action] = !!on;
    this._save();
  }

  release(k) {
    delete this.list[k];
    this._save();
  }

  /** When a Player's renamed (or deleted: name null), their land follows. */
  renameOwner(uid, name) {
    for (const [k, l] of Object.entries(this.list)) {
      if (l.owner !== uid) continue;
      if (name) l.name = name;
      else delete this.list[k];
    }
    this._save();
  }

  /** For clients: [key, owner uid, owner name, allow] for every lease. */
  forClients() {
    return Object.entries(this.list).filter(([, l]) => l.expires >= Date.now()).map(([k, l]) => [k, l.owner, l.name, { ...l.allow }]);
  }

  _save(changed = true) {
    if (changed) this.changed = true; // (the game broadcasts the list when this is set)
    try { this.store?.set(KEY, JSON.stringify(this.list)); } catch { /* stays in memory */ }
  }
}
