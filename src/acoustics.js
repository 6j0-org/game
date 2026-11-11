// Acoustics: how the world changes what you hear. Shared by game sounds (audio.js) and nearby voices
// (voice.js), each with its own AudioContext.
//
//   blocksBetween(getBlock, a, b)  how much wall is between a sound and you (muffling)
//   probeSpace(getBlock, eye, ...) what kind of space you're in: open air, a room, a hall, a cave, a
//                                  street between tall buildings, underwater
//   new Acoustics(ctx)             an input -> echo and muffle -> output chain for that space
//
// The echoes are generated impulse responses (decaying noise and a few discrete reflections), no files.
// AudioParams are only ever set (.value), a few times a second, never scheduled every frame.

import { SOLID, SEE_THROUGH, LEAFY, FLUID } from './blocks.js';

/**
 * How much wall is on the straight line from a to b: solid blocks count 1, glass and shaped blocks
 * (doors, fences, slabs) half, leaves a quarter. Stops counting at `max`.
 */
export function blocksBetween(getBlock, a, b, max = 6) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.5) return 0;
  const steps = Math.ceil(len / 0.35);
  let total = 0;
  let last = '';
  for (let i = 1; i < steps; i++) { // (not the cells the two ends are in)
    const t = i / steps;
    const x = Math.floor(a.x + dx * t);
    const y = Math.floor(a.y + dy * t);
    const z = Math.floor(a.z + dz * t);
    const key = `${x},${y},${z}`;
    if (key === last) continue;
    last = key;
    if ((x === Math.floor(b.x) && y === Math.floor(b.y) && z === Math.floor(b.z))) continue;
    const id = getBlock(x, y, z);
    if (!SOLID[id] || FLUID[id]) continue;
    total += LEAFY[id] ? 0.25 : SEE_THROUGH[id] ? 0.5 : 1;
    if (total >= max) return max;
  }
  return total;
}

/** What `n` blocks of wall do to a sound: a low-pass cutoff (Hz) and a volume factor, or null for none. */
export function muffle(n) {
  if (!(n > 0.1)) return null;
  return { cutoff: Math.max(300, 5000 / (1 + n * 2)), gain: Math.max(0.1, 0.62 ** n) };
}

// Directions for the space probe: straight up, eight around, four up at 45°.
const PROBE = [[0, 1, 0]];
for (let i = 0; i < 8; i++) PROBE.push([Math.cos((i / 8) * Math.PI * 2), 0, Math.sin((i / 8) * Math.PI * 2)]);
for (let i = 0; i < 4; i++) PROBE.push([Math.cos((i / 4) * Math.PI * 2 + 0.4) * 0.707, 0.707, Math.sin((i / 4) * Math.PI * 2 + 0.4) * 0.707]);
const PROBE_RANGE = 32;

/**
 * The space around your head: { space: 'open' | 'room' | 'hall' | 'cave' | 'canyon', underwater, hell }.
 * Casts a dozen short rays (call it a couple of times a second, not every frame).
 */
export function probeSpace(getBlock, eye, { underwater = false, hell = false } = {}) {
  const hit = (d) => {
    for (let t = 0.5; t <= PROBE_RANGE; t += 0.5) {
      const id = getBlock(Math.floor(eye.x + d[0] * t), Math.floor(eye.y + d[1] * t), Math.floor(eye.z + d[2] * t));
      if (SOLID[id] && !LEAFY[id]) return t;
    }
    return Infinity;
  };
  const dist = PROBE.map(hit);
  const up = dist[0];
  const around = dist.slice(1, 9);
  const diag = dist.slice(9);
  const walls = around.filter((d) => d < 24);
  const roof = up < 24 || diag.filter((d) => d < 24).length >= 3;
  let space = 'open';
  if (roof && walls.length >= 6) {
    const size = walls.reduce((a, b) => a + b, 0) / walls.length;
    space = size < 5 ? 'room' : size < 12 ? 'hall' : 'cave';
  } else if (!roof && walls.length >= 5) space = 'canyon'; // tall walls but open sky: city streets, ravines
  return { space, underwater, hell };
}

// Each space's echo: length (s), how fast it dies away, a pre-delay, and discrete early reflections
// ([seconds, level], relative to the tail) for slap-back. `wet` is how loud the echo is compared with the
// sound itself (the impulses are normalized, so 0.25 really means a quarter as loud).
const SPACES = {
  room: { dur: 0.5, decay: 4, wet: 0.15, pre: 0.004, taps: [[0.011, 0.5], [0.019, 0.35]] },
  hall: { dur: 1.5, decay: 2.6, wet: 0.25, pre: 0.012, taps: [[0.03, 0.4], [0.05, 0.3]] },
  cave: { dur: 2.8, decay: 1.9, wet: 0.35, pre: 0.02, taps: [[0.06, 0.45], [0.11, 0.3], [0.17, 0.2]] },
  canyon: { dur: 0.9, decay: 3, wet: 0.15, pre: 0.03, taps: [[0.08, 0.55], [0.16, 0.3], [0.24, 0.15]] },
};
const UNDERWATER_WET = 0.1; // a little room echo underwater, under the muffling
export const SPACE_NAMES = Object.keys(SPACES);

function impulse(ctx, { dur, decay, pre, taps }) {
  const rate = ctx.sampleRate;
  const len = Math.ceil((dur + pre) * rate);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const start = Math.floor(pre * rate);
    for (let i = start; i < len; i++) {
      const t = (i - start) / rate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-decay * t) * 0.5;
    }
    for (const [at, level] of taps) { // slightly different in each ear, for width
      const i = Math.floor((at + (ch ? 0.0013 : 0)) * rate);
      if (i < len) d[i] += level * (ch ? -1 : 1);
    }
    // Normalize to unit energy: a long echo adds up to far more than its peak level, so without this the
    // echo would come out several times louder than the sound itself, and `wet` wouldn't mean anything.
    let energy = 0;
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
    const k = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  return buf;
}

/**
 * An input -> output chain that sounds like the space you're in: dry sound plus each space's echo (only
 * the current one turned up), through a low-pass that closes underwater. `rumble` adds Hell's drone.
 */
export class Acoustics {
  constructor(ctx, { rumble = false } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.filter = ctx.createBiquadFilter(); // underwater
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 22000;
    this.filter.Q.value = 0.5;
    this.filter.connect(this.output);
    this.input.connect(this.filter);
    this.wet = {};
    for (const [name, def] of Object.entries(SPACES)) {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = impulse(ctx, def);
      const g = ctx.createGain();
      g.gain.value = 0;
      this.input.connect(conv).connect(g).connect(this.filter);
      this.wet[name] = { gain: g, level: 0, target: 0, def };
    }
    if (rumble) {
      const n = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < d.length; i++) { v = v * 0.995 + (Math.random() * 2 - 1) * 0.05; d[i] = v; } // brown-ish noise
      n.buffer = buf;
      n.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 120;
      this.rumble = ctx.createGain();
      this.rumble.gain.value = 0;
      n.connect(lp).connect(this.rumble).connect(this.output);
      n.start();
    }
    this.state = { space: 'open', underwater: false, hell: false };
    this.amount = 1; // the player's "Room echo" setting: scales every echo
    this.cutoff = 22000;
    this.rumbleLevel = 0;
  }

  /** What `probeSpace` found (the levels ease towards it in `tick`). */
  set(state) {
    this.state = state;
    for (const [name, w] of Object.entries(this.wet)) w.target = state.space === name ? w.def.wet * this.amount : 0;
    if (state.underwater) this.wet.room.target = Math.max(this.wet.room.target, UNDERWATER_WET * this.amount);
  }

  /** The "Room echo" setting (1 is normal, 0 none). */
  setAmount(k) {
    this.amount = Math.max(0, k);
    this.set(this.state);
  }

  /** Eases towards the current space. Call a few times a second (it only sets .value). */
  tick(dt) {
    const k = Math.min(1, dt * 4);
    for (const w of Object.values(this.wet)) {
      if (Math.abs(w.level - w.target) < 0.002) continue;
      w.level += (w.target - w.level) * k;
      w.gain.gain.value = w.level;
    }
    const cut = this.state.underwater ? 600 : 22000;
    if (Math.abs(this.cutoff - cut) > 1) {
      this.cutoff = this.state.underwater ? cut : Math.min(22000, this.cutoff * 3); // closes at once, opens quickly
      this.filter.frequency.value = this.cutoff;
    }
    if (this.rumble) {
      const target = this.state.hell ? 0.5 : 0;
      if (Math.abs(this.rumbleLevel - target) > 0.002) {
        this.rumbleLevel += (target - this.rumbleLevel) * k;
        this.rumble.gain.value = this.rumbleLevel;
      }
    }
  }
}
