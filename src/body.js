// Axis-aligned box physics against voxels, shared by the player and mobs.
// No Three.js dependency.

import { T, tune, bindTunable } from './tuning.js';
import { SOLID, FLUID, shapeBoxes, isLadder } from './blocks.js';

// Server settings (tuning.js): read the live values as T.key.
tune('Player', {
  ladderSpeed: [3.2, 'Ladder climbing speed', 'Blocks per second'],
  stepUp: [0.55, 'Step-up height', 'How high you (and mobs) step up without jumping, in blocks', { max: 1.5, step: 0.05 }],
  gravity: [28, 'Gravity', 'Downward acceleration for players and mobs'],
});

const FULL = [[0, 0, 0, 1, 1, 1]];


export class Body {
  constructor(world, halfWidth, height) {
    this.world = world;
    this.halfW = halfWidth;
    this.height = height;
    this.pos = { x: 0, y: 0, z: 0 }; // bottom centre
    this.vel = { x: 0, y: 0, z: 0 };
    this.knock = { x: 0, z: 0 }; // decaying horizontal knockback
    this.onGround = false;
    this.hitWall = false;
    this.gravityMul = 1; // the gravity-resistant trait halves it
  }

  get inWater() {
    const { x, y, z } = this.pos;
    return !!FLUID[this.world.getBlock(Math.floor(x), Math.floor(y + 0.4), Math.floor(z))]; // water, lava or ball-pit balls
  }

  /** Inside a ladder's space (feet or chest)? */
  get onLadder() {
    const { x, y, z } = this.pos;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    return isLadder(this.world.getBlock(bx, Math.floor(y + 0.05), bz)) || isLadder(this.world.getBlock(bx, Math.floor(y + 1), bz));
  }

  impulse(x, y, z) {
    this.knock.x += x;
    this.knock.z += z;
    this.vel.y = Math.max(this.vel.y, 0) + y;
    this.onGround = false;
  }

  /** Sets horizontal velocity to the wished walking velocity plus knockback. */
  applyWalk(wx, wz, dt) {
    this.vel.x = wx + this.knock.x;
    this.vel.z = wz + this.knock.z;
    const k = Math.exp(-6 * dt);
    this.knock.x *= k;
    this.knock.z *= k;
  }

  /** One physics step with gravity and swimming. `wantDown` dives while in water. */
  step(dt, wx, wz, wantJump, jumpSpeed, wantDown = false) {
    const inWater = this.inWater;
    this.applyWalk(wx, wz, dt);
    if (inWater) {
      this.vel.y = Math.max(this.vel.y - T.gravity * this.gravityMul * 0.3 * dt, -3);
      if (wantJump) this.vel.y = this.hitWall ? 5 : 3;
      else if (wantDown) this.vel.y = -3.5;
    } else if (this.onLadder) {
      // Climb with jump (or by walking into the ladder's wall), go down with crouch, otherwise slide slowly.
      if (wantJump || (this.hitWall && Math.hypot(wx, wz) > 0.1)) this.vel.y = T.ladderSpeed;
      else if (wantDown) this.vel.y = -T.ladderSpeed;
      else this.vel.y = Math.max(this.vel.y - T.gravity * this.gravityMul * dt, -1.2);
    } else {
      this.vel.y = Math.max(this.vel.y - T.gravity * this.gravityMul * dt, -50);
      if (wantJump && this.onGround) this.vel.y = jumpSpeed;
    }
    this.move(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
  }

  move(dx, dy, dz) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.35));
    const wasGrounded = this.onGround;
    this.onGround = false;
    this.hitWall = false;
    for (let s = 0; s < steps; s++) {
      if (this._moveAxis('y', dy / steps)) {
        if (dy < 0) this.onGround = true;
        this.vel.y = 0;
        dy = 0;
      }
      for (const axis of ['x', 'z']) {
        const amount = (axis === 'x' ? dx : dz) / steps;
        if (!amount) continue;
        const before = { ...this.pos };
        if (!this._moveAxis(axis, amount)) continue;
        // Blocked: if we're walking on the ground, try stepping up onto a low ledge (slab, stair).
        const snapped = { ...this.pos };
        if (wasGrounded || this.onGround) {
          this.pos = { ...before, y: before.y + T.stepUp };
          if (!this.collides() && !this._moveAxis(axis, amount)) continue; // stepped up
        }
        this.pos = snapped;
        this.hitWall = true;
        if (axis === 'x') dx = 0; else dz = 0;
      }
    }
  }

  // Moves along one axis; on collision snaps flush against what it hit and returns true.
  _moveAxis(axis, amount) {
    if (amount === 0) return false;
    this.pos[axis] += amount;
    const p = this.pos;
    const hw = this.halfW;
    const i = { x: 0, y: 1, z: 2 }[axis];
    // Only boxes we ran into while moving along this axis count; anything we were already overlapping
    // (say, a block placed inside your head) must not shove you on top of it.
    const lo = (axis === 'y' ? p.y : p[axis] - hw) - amount; // our near edge before the move
    const hi = lo + (axis === 'y' ? this.height : 2 * hw);
    const e = 1e-6;
    const hits = this._boxesHit(false).filter((b) => (amount > 0 ? b[i] >= hi - e : b[i + 3] <= lo + e));
    if (!hits.length) return false;
    if (axis === 'y') {
      p.y = amount > 0 ? Math.min(...hits.map((b) => b[1])) - this.height : Math.max(...hits.map((b) => b[4]));
    } else {
      p[axis] = amount > 0 ? Math.min(...hits.map((b) => b[i])) - hw : Math.max(...hits.map((b) => b[i + 3])) + hw;
    }
    return true;
  }

  collides() {
    return this._boxesHit(true).length > 0;
  }

  /**
   * Resizes the body (size spells): `apply(k)` sets its size for scale k. Shrinking always works; growing
   * goes only as far as there's room (it tries smaller steps down to `from`). Returns the scale reached.
   */
  fitScale(from, to, apply) {
    let k = to;
    apply(k);
    while (k > from && this.collides()) {
      k = Math.max(from, k * 0.85);
      apply(k);
    }
    return k;
  }

  /** World-space boxes of solid blocks (full cubes or shaped: slabs, stairs, doors) overlapping this body. */
  _boxesHit(firstOnly) {
    const { x, y, z } = this.pos;
    const hw = this.halfW;
    const e = 1e-6;
    const x0 = x - hw;
    const x1 = x + hw;
    const y1 = y + this.height;
    const z0 = z - hw;
    const z1 = z + hw;
    const out = [];
    const at = (bx, by, bz) => this.world.getBlock(bx, by, bz);
    for (let by = Math.floor(y) - 1; by <= Math.floor(y1 - e); by++) { // (one layer down: fences reach up into ours)
      for (let bz = Math.floor(z0); bz <= Math.floor(z1 - e); bz++) {
        for (let bx = Math.floor(x0); bx <= Math.floor(x1 - e); bx++) {
          const id = this.world.getBlock(bx, by, bz);
          if (!SOLID[id]) continue;
          for (const b of shapeBoxes(id, at, bx, by, bz, true) || FULL) {
            const box = [bx + b[0], by + b[1], bz + b[2], bx + b[3], by + b[4], bz + b[5]];
            if (box[0] < x1 - e && box[3] > x0 + e && box[1] < y1 - e && box[4] > y + e && box[2] < z1 - e && box[5] > z0 + e) {
              out.push(box);
              if (firstOnly) return out;
            }
          }
        }
      }
    }
    return out;
  }

  /** True if the unit block at (bx,by,bz) overlaps this body. */
  intersectsBlock(bx, by, bz) {
    const { x, y, z } = this.pos;
    const hw = this.halfW;
    return (
      bx < x + hw && bx + 1 > x - hw &&
      by < y + this.height && by + 1 > y &&
      bz < z + hw && bz + 1 > z - hw
    );
  }

  /** True if point p is inside this body grown by `pad` on every side. */
  containsPoint(p, pad = 0) {
    const hw = this.halfW + pad;
    return (
      Math.abs(p.x - this.pos.x) <= hw && Math.abs(p.z - this.pos.z) <= hw &&
      p.y >= this.pos.y - pad && p.y <= this.pos.y + this.height + pad
    );
  }

  /** Ray vs this body's box. Returns entry distance or null. */
  rayHit(o, d, maxDist) {
    const min = [this.pos.x - this.halfW, this.pos.y, this.pos.z - this.halfW];
    const max = [this.pos.x + this.halfW, this.pos.y + this.height, this.pos.z + this.halfW];
    const oo = [o.x, o.y, o.z];
    const dd = [d.x, d.y, d.z];
    let tmin = 0;
    let tmax = maxDist;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dd[a]) < 1e-9) {
        if (oo[a] < min[a] || oo[a] > max[a]) return null;
        continue;
      }
      const t1 = (min[a] - oo[a]) / dd[a];
      const t2 = (max[a] - oo[a]) / dd[a];
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax) return null;
    }
    return tmin;
  }

  get center() {
    return { x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z };
  }
}
