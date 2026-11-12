// Sound effects, synthesised at play time with the Web Audio API: oscillators and filtered noise
// shaped by envelopes. No audio files. Sounds with a position are placed in 3D around the camera.
//
//   const sound = new SoundSystem(store);
//   sound.unlock();                         // from a click: browsers only allow audio after one
//   sound.play('explode', { pos, ref: 6 }); // in the world
//   sound.play('coin');                     // "in your head" (UI, your own body)
//   sound.setListener(cameraPos, forward);  // every frame
//   sound.setSpace(probeSpace(...));        // a couple of times a second: room echo, underwater, Hell
//   sound.track(movers);                    // every frame: things that hum as they fly (Doppler)
//
// Positional sounds are muffled by walls between them and you (`occlusion`, set by main.js), pan with
// 'HRTF' when the "3D sound for headphones" option is on, and everything you hear in the world (but not
// the UI's clicks and chimes) goes through the space you're in (acoustics.js).

import { Acoustics, muffle } from './acoustics.js';
import { GRASS, DIRT, STONE, SAND, LOG, LEAVES, PLANKS, GLASS, BRICK, PRINTER, WHEAT, LAVA_LAMP, DOOR, STAIRS_PLANKS, STAIRS_STONE, SLAB_PLANKS, SLAB_STONE, COLD_WALLET, BED, FENCE, TRAPDOOR, LADDER, baseId } from './blocks.js';

const MAX_VOICES = 32;
const MAX_SAME = 5; // at most this many copies of one sound at once
const LISTENER_EVERY = 50; // ms between listener updates
const HEAR_RANGE = 48; // positional sounds farther than this aren't played at all
const OCCLUDE_RANGE = 40; // walls only muffle sounds this close (farther ones are quiet anyway)
/** Interface sounds: they play "in your head", straight to the speakers, with no room echo. */
const UI_SOUNDS = new Set(['ui', 'text', 'send', 'phone', 'coin', 'ding', 'level', 'deny', 'pickup', 'print', 'teleport', 'throb', 'empty', 'respawn', 'death', 'headshot']);
const SOUND_SPEED = 120; // blocks per second, for Doppler (slower than real, so it's noticeable at game speeds)
const MOVER_EVERY = 50; // ms between moving-sound updates
/**
 * Continuous sounds that follow something moving (projectiles, drones): built from an oscillator and/or
 * filtered noise. Their pitch bends with Doppler as they come and go.
 */
const MOVERS = {
  fireball: { noise: { type: 'lowpass', f: 700, Q: 0.8 }, vol: 0.5, ref: 3 },
  rocket: { noise: { type: 'bandpass', f: 900, Q: 1.2 }, osc: { type: 'sawtooth', f: 90, vol: 0.15 }, vol: 0.6, ref: 4 },
  missile: { osc: { type: 'triangle', f: 620, vol: 0.25 }, noise: { type: 'bandpass', f: 3000, Q: 4 }, vol: 0.35, ref: 3 },
  icebolt: { noise: { type: 'highpass', f: 4500, Q: 0.7 }, vol: 0.35, ref: 3 },
  snowball: { noise: { type: 'bandpass', f: 1800, Q: 0.9 }, vol: 0.4, ref: 3 }, // a Blizzard on its way
  orb: { osc: { type: 'square', f: 70, vol: 0.12 }, noise: { type: 'bandpass', f: 400, Q: 2 }, vol: 0.6, ref: 5 },
  arrow: { noise: { type: 'bandpass', f: 2600, Q: 9 }, vol: 0.5, ref: 2 },
  drone: { osc: { type: 'sawtooth', f: 180, vol: 0.1 }, osc2: { type: 'sawtooth', f: 183.5, vol: 0.08 }, noise: { type: 'bandpass', f: 1400, Q: 1.5 }, vol: 0.35, ref: 4 },
};

// How each material sounds underfoot and when it breaks: a filtered noise burst.
const MATERIALS = {
  grass: { type: 'lowpass', f: 900, Q: 0.7, vol: 0.9 },
  dirt: { type: 'lowpass', f: 600, Q: 0.7, vol: 1 },
  sand: { type: 'highpass', f: 2200, Q: 0.5, vol: 0.55 },
  stone: { type: 'bandpass', f: 1700, Q: 1.3, vol: 1 },
  wood: { type: 'bandpass', f: 480, Q: 2, vol: 1.1 },
  leaves: { type: 'highpass', f: 3000, Q: 0.5, vol: 0.7 },
  glass: { type: 'bandpass', f: 3800, Q: 3, vol: 0.8 },
  metal: { type: 'bandpass', f: 2400, Q: 6, vol: 0.7 },
};
const BLOCK_MATERIAL = {
  [GRASS]: 'grass', [DIRT]: 'dirt', [SAND]: 'sand', [STONE]: 'stone', [BRICK]: 'stone',
  [LOG]: 'wood', [PLANKS]: 'wood', [LEAVES]: 'leaves', [GLASS]: 'glass', [PRINTER]: 'metal', [WHEAT]: 'leaves',
  [LAVA_LAMP]: 'glass', [DOOR]: 'wood', [STAIRS_PLANKS]: 'wood', [STAIRS_STONE]: 'stone', [SLAB_PLANKS]: 'wood', [SLAB_STONE]: 'stone', [COLD_WALLET]: 'metal', [BED]: 'wood', [FENCE]: 'wood', [TRAPDOOR]: 'wood', [LADDER]: 'wood',
};
export const blockMaterial = (id) => BLOCK_MATERIAL[baseId(id)] || 'stone';

const rnd = (a, b) => a + Math.random() * (b - a);

/** Small synthesis kit bound to one AudioContext. Times are absolute (ctx.currentTime based). */
class Kit {
  constructor(ctx, noiseBuffer) {
    this.ctx = ctx;
    this.noiseBuffer = noiseBuffer;
  }

  /** A gain envelope: quick attack to `peak`, hold, then exponential fade to silence by t + dur. */
  env(out, t, dur, peak, attack = 0.005, hold = 0) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    if (hold) g.gain.setValueAtTime(Math.max(peak, 0.0002), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    return g;
  }

  tone(out, t, { type = 'sine', f0, f1 = f0, dur, peak = 0.3, attack = 0.005, hold = 0, vibrato = 0, vibratoRate = 6 }) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vibrato) {
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = vibratoRate;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    osc.connect(this.env(out, t, dur, peak, attack, hold));
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise(out, t, { dur, peak = 0.3, attack = 0.004, hold = 0, type = 'lowpass', f0 = 1000, f1 = f0, Q = 1 }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = Q;
    filter.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(filter).connect(this.env(out, t, dur, peak, attack, hold));
    src.start(t, Math.random() * (this.noiseBuffer.duration - dur - 0.1));
    src.stop(t + dur + 0.05);
  }

  /** A material's crunch: used for steps, mining chips and breaking. */
  crunch(out, t, material, dur, peak, sweep = 0.7) {
    const m = MATERIALS[material] || MATERIALS.stone;
    this.noise(out, t, { dur, peak: peak * m.vol, type: m.type, f0: m.f * rnd(0.85, 1.15), f1: m.f * sweep, Q: m.Q });
  }
}

// Every sound: (kit, out, t, opts) => duration in seconds. `p` is a random pitch factor near 1.
const SOUNDS = {
  // ----- you and blocks -----
  step: (k, o, t, { material, p }) => { k.crunch(o, t, material, 0.09 / p, 0.22); return 0.1; },
  land: (k, o, t, { material }) => {
    k.crunch(o, t, material, 0.16, 0.35, 0.4);
    k.tone(o, t, { f0: 120, f1: 50, dur: 0.15, peak: 0.35 });
    return 0.2;
  },
  splash: (k, o, t) => {
    k.noise(o, t, { dur: 0.5, peak: 0.35, type: 'bandpass', f0: 1500, f1: 400, Q: 0.8, attack: 0.01 });
    for (let i = 0; i < 5; i++) k.tone(o, t + rnd(0.05, 0.35), { f0: rnd(500, 900), f1: rnd(900, 1400), dur: 0.06, peak: 0.08 });
    return 0.55;
  },
  swing: (k, o, t, { p }) => { k.noise(o, t, { dur: 0.18, peak: 0.3, type: 'bandpass', f0: 600 * p, f1: 1800 * p, Q: 1.5, attack: 0.04 }); return 0.2; },
  chip: (k, o, t, { material }) => { k.crunch(o, t, material, 0.05, 0.16, 0.9); return 0.06; },
  break: (k, o, t, { material }) => {
    k.crunch(o, t, material, 0.28, 0.45, 0.35);
    k.crunch(o, t + 0.04, material, 0.18, 0.25, 0.5);
    if (material === 'glass') {
      for (let i = 0; i < 6; i++) k.tone(o, t + rnd(0, 0.2), { f0: rnd(2200, 4200), dur: rnd(0.08, 0.2), peak: 0.07 });
    }
    return 0.35;
  },
  place: (k, o, t, { material }) => {
    k.tone(o, t, { f0: 170, f1: 70, dur: 0.1, peak: 0.4 });
    k.crunch(o, t, material, 0.05, 0.2, 1);
    return 0.12;
  },
  hurt: (k, o, t, { p }) => {
    k.tone(o, t, { type: 'triangle', f0: 260 * p, f1: 140 * p, dur: 0.22, peak: 0.35 });
    k.noise(o, t, { dur: 0.08, peak: 0.25, type: 'lowpass', f0: 900 });
    return 0.25;
  },
  death: (k, o, t) => {
    [392, 330, 262, 196].forEach((f, i) => k.tone(o, t + i * 0.18, { type: 'triangle', f0: f, f1: f * 0.97, dur: 0.3, peak: 0.25 }));
    return 0.9;
  },
  respawn: (k, o, t) => {
    [262, 330, 392, 523].forEach((f, i) => k.tone(o, t + i * 0.08, { f0: f, dur: 0.3, peak: 0.16 }));
    return 0.6;
  },
  eat: (k, o, t) => {
    for (let i = 0; i < 3; i++) k.noise(o, t + i * 0.12, { dur: 0.07, peak: 0.25, type: 'bandpass', f0: rnd(1500, 2500), Q: 2 });
    return 0.4;
  },
  bubble: (k, o, t) => { k.tone(o, t, { f0: rnd(350, 700), f1: rnd(900, 1500), dur: 0.07, peak: 0.07 }); return 0.08; },
  washed: (k, o, t) => { k.tone(o, t, { f0: 1100, f1: 2600, dur: 0.18, peak: 0.12 }); k.tone(o, t + 0.12, { f0: 2600, dur: 0.12, peak: 0.08 }); return 0.3; },
  level: (k, o, t) => {
    [523, 659, 784, 1047].forEach((f, i) => k.tone(o, t + i * 0.09, { type: 'triangle', f0: f, dur: 0.35, peak: 0.2, hold: 0.05 }));
    return 0.8;
  },
  coin: (k, o, t) => {
    k.tone(o, t, { type: 'square', f0: 988, dur: 0.08, peak: 0.07 });
    k.tone(o, t + 0.07, { type: 'square', f0: 1319, dur: 0.25, peak: 0.07 });
    return 0.35;
  },
  pickup: (k, o, t) => { k.tone(o, t, { f0: 520, f1: 880, dur: 0.12, peak: 0.15 }); return 0.13; },
  deny: (k, o, t) => { k.tone(o, t, { type: 'square', f0: 180, dur: 0.12, peak: 0.06 }); k.tone(o, t + 0.13, { type: 'square', f0: 150, dur: 0.14, peak: 0.06 }); return 0.3; },
  ui: (k, o, t) => { k.tone(o, t, { f0: 1500, f1: 1200, dur: 0.04, peak: 0.06 }); return 0.05; },
  join: (k, o, t) => { k.tone(o, t, { f0: 660, dur: 0.2, peak: 0.1 }); k.tone(o, t + 0.12, { f0: 880, dur: 0.3, peak: 0.1 }); return 0.45; },
  cough: (k, o, t, { p }) => {
    k.noise(o, t, { dur: 0.14, peak: 0.3, type: 'bandpass', f0: 500 * p, Q: 1.5 });
    k.noise(o, t + 0.2, { dur: 0.12, peak: 0.22, type: 'bandpass', f0: 450 * p, Q: 1.5 });
    return 0.35;
  },
  sneeze: (k, o, t) => {
    k.tone(o, t, { type: 'sawtooth', f0: 300, f1: 520, dur: 0.35, peak: 0.08, attack: 0.15 }); // "aaah..."
    k.noise(o, t + 0.42, { dur: 0.25, peak: 0.5, type: 'highpass', f0: 2500, f1: 1200, Q: 0.6 }); // "CHOO"
    return 0.7;
  },
  phone: (k, o, t) => {
    for (let i = 0; i < 3; i++) k.tone(o, t + i * 0.16, { type: 'square', f0: 170, dur: 0.1, peak: 0.05 });
    return 0.5;
  },
  print: (k, o, t, { dur = 2 }) => {
    for (let s = 0; s < dur; s += 0.25) {
      k.tone(o, t + s, { type: 'square', f0: rnd(330, 520), dur: 0.2, peak: 0.025 });
      if (s % 0.5 === 0) k.noise(o, t + s, { dur: 0.2, peak: 0.03, type: 'bandpass', f0: 2500, Q: 4 });
    }
    return dur;
  },
  text: (k, o, t) => { k.tone(o, t, { f0: 1318, dur: 0.1, peak: 0.12 }); k.tone(o, t + 0.1, { f0: 1760, dur: 0.18, peak: 0.12 }); return 0.3; },
  send: (k, o, t) => { k.noise(o, t, { dur: 0.18, peak: 0.12, type: 'bandpass', f0: 800, f1: 3000, Q: 1, attack: 0.03 }); return 0.2; },
  throb: (k, o, t) => { k.tone(o, t, { f0: 70, f1: 50, dur: 0.22, peak: 0.25 }); k.tone(o, t + 0.24, { f0: 65, f1: 48, dur: 0.18, peak: 0.15 }); return 0.45; },
  poop: (k, o, t, { p }) => {
    k.noise(o, t, { dur: 0.35, peak: 0.25, type: 'lowpass', f0: 500 * p, f1: 150, Q: 3 });
    k.tone(o, t, { type: 'sawtooth', f0: 95 * p, f1: 60 * p, dur: 0.3, peak: 0.1, vibrato: 18, vibratoRate: 28 });
    k.tone(o, t + 0.28, { f0: 260 * p, f1: 90, dur: 0.12, peak: 0.12 }); // plop
    return 0.45;
  },
  teleport: (k, o, t) => { // a rising shimmer that snaps shut
    k.tone(o, t, { type: 'triangle', f0: 300, f1: 1800, dur: 0.35, peak: 0.07 });
    k.noise(o, t, { dur: 0.35, peak: 0.08, type: 'bandpass', f0: 1500, f1: 6000, Q: 2 });
    k.tone(o, t + 0.33, { f0: 900, f1: 200, dur: 0.12, peak: 0.08 });
    return 0.5;
  },
  thwack: (k, o, t) => { // an arrow finding its mark
    k.noise(o, t, { dur: 0.1, peak: 0.25, type: 'lowpass', f0: 900, f1: 200 });
    k.tone(o, t, { f0: 160, f1: 70, dur: 0.12, peak: 0.25 });
    return 0.15;
  },
  sniper: (k, o, t, { p }) => { // a hard crack, a deep boom, and the bolt working
    k.noise(o, t, { dur: 0.05, peak: 0.6, type: 'highpass', f0: 2500 * p, f1: 1200, attack: 0.001 });
    k.noise(o, t, { dur: 0.6, peak: 0.45, type: 'lowpass', f0: 1400 * p, f1: 120, attack: 0.002 });
    k.tone(o, t, { f0: 110 * p, f1: 35, dur: 0.4, peak: 0.4 });
    k.noise(o, t + 0.55, { dur: 0.05, peak: 0.12, type: 'bandpass', f0: 2200, Q: 4 });
    k.noise(o, t + 0.7, { dur: 0.05, peak: 0.12, type: 'bandpass', f0: 1700, Q: 4 });
    return 0.8;
  },
  pistol: (k, o, t, { p }) => {
    k.noise(o, t, { dur: 0.16, peak: 0.45, type: 'lowpass', f0: 3500 * p, f1: 300, attack: 0.002 });
    k.tone(o, t, { f0: 180 * p, f1: 60, dur: 0.1, peak: 0.3 });
    return 0.18;
  },
  shotgun: (k, o, t, { p }) => {
    k.noise(o, t, { dur: 0.45, peak: 0.6, type: 'lowpass', f0: 2500 * p, f1: 120, attack: 0.002 });
    k.tone(o, t, { f0: 110 * p, f1: 40, dur: 0.3, peak: 0.45 });
    k.noise(o, t + 0.5, { dur: 0.05, peak: 0.12, type: 'bandpass', f0: 1800, Q: 3 }); // pump
    k.noise(o, t + 0.62, { dur: 0.05, peak: 0.12, type: 'bandpass', f0: 1400, Q: 3 });
    return 0.7;
  },
  machinegun: (k, o, t, { p }) => {
    k.noise(o, t, { dur: 0.07, peak: 0.35, type: 'lowpass', f0: 4000 * p, f1: 500, attack: 0.001 });
    k.tone(o, t, { type: 'square', f0: 140 * p, f1: 70, dur: 0.05, peak: 0.12 });
    return 0.08;
  },
  rocket: (k, o, t) => {
    k.noise(o, t, { dur: 0.6, peak: 0.4, type: 'bandpass', f0: 500, f1: 1800, Q: 0.8, attack: 0.02 });
    k.tone(o, t, { type: 'sawtooth', f0: 70, f1: 120, dur: 0.5, peak: 0.12 });
    return 0.6;
  },
  railgun: (k, o, t) => {
    k.tone(o, t, { type: 'sawtooth', f0: 1800, f1: 120, dur: 0.5, peak: 0.25 });
    k.noise(o, t, { dur: 0.3, peak: 0.3, type: 'highpass', f0: 3000, f1: 1200 });
    k.tone(o, t, { f0: 60, f1: 40, dur: 0.4, peak: 0.3 });
    return 0.55;
  },
  overcharge: (k, o, t) => {
    k.tone(o, t, { type: 'sawtooth', f0: 80, f1: 900, dur: 0.7, peak: 0.12, attack: 0.3 }); // charging
    k.tone(o, t + 0.65, { f0: 160, f1: 50, dur: 0.6, peak: 0.4 }); // release
    k.noise(o, t + 0.65, { dur: 0.5, peak: 0.35, type: 'lowpass', f0: 2000, f1: 200 });
    return 1.3;
  },
  spell: (k, o, t, { p }) => { // casting: a rising shimmer (pitched per spell)
    for (let i = 0; i < 3; i++) k.tone(o, t + i * 0.05, { type: 'triangle', f0: 500 * p * (1 + i * 0.5), f1: 1300 * p * (1 + i * 0.5), dur: 0.22, peak: 0.05 });
    k.noise(o, t, { dur: 0.3, peak: 0.08, type: 'bandpass', f0: 3000 * p, f1: 6000 * p, Q: 3 });
    return 0.35;
  },
  frost: (k, o, t) => { // ice shattering: a glassy tinkle
    k.noise(o, t, { dur: 0.25, peak: 0.18, type: 'highpass', f0: 5000, f1: 8000 });
    [2600, 3300, 4100].forEach((f, i) => k.tone(o, t + i * 0.04, { f0: f, f1: f * 0.9, dur: 0.15, peak: 0.04 }));
    return 0.3;
  },
  blizzard: (k, o, t) => { k.noise(o, t, { dur: 2, peak: 0.16, type: 'bandpass', f0: 500, f1: 1400, Q: 0.8, attack: 0.5 }); return 2; }, // a gust of wind
  enlarge: (k, o, t) => { k.tone(o, t, { type: 'square', f0: 70, f1: 420, dur: 0.6, peak: 0.07 }); k.tone(o, t, { f0: 45, f1: 160, dur: 0.7, peak: 0.25 }); return 0.7; }, // vrrOOOM
  hallucinate: (k, o, t) => { // a woozy, wobbling chord
    [300, 377, 449].forEach((f, i) => k.tone(o, t + i * 0.07, { type: 'sine', f0: f, f1: f * 0.7, dur: 0.9, peak: 0.06 }));
    return 1;
  },
  shrink: (k, o, t) => { k.tone(o, t, { type: 'square', f0: 900, f1: 120, dur: 0.45, peak: 0.05 }); return 0.5; }, // whee-ooo
  zap: (k, o, t) => { k.noise(o, t, { dur: 0.15, peak: 0.25, type: 'highpass', f0: 2500, f1: 5000 }); k.tone(o, t, { type: 'square', f0: 900, f1: 400, dur: 0.1, peak: 0.05 }); return 0.16; },
  surge: (k, o, t) => {
    [220, 330, 440, 660, 880].forEach((f, i) => k.tone(o, t + i * 0.06, { type: 'sawtooth', f0: f, dur: 0.5, peak: 0.06 }));
    k.tone(o, t, { f0: 55, f1: 110, dur: 0.8, peak: 0.3 });
    return 1;
  },
  grapple: (k, o, t) => { k.noise(o, t, { dur: 0.2, peak: 0.2, type: 'bandpass', f0: 700, f1: 2500, Q: 2 }); k.tone(o, t + 0.18, { type: 'square', f0: 1200, dur: 0.04, peak: 0.08 }); return 0.25; },
  caw: (k, o, t, { p }) => { // seagull
    for (let i = 0; i < 2; i++) k.tone(o, t + i * 0.22, { type: 'sawtooth', f0: 1400 * p, f1: 900 * p, dur: 0.18, peak: 0.06 });
    return 0.45;
  },
  honk: (k, o, t, { p }) => { k.tone(o, t, { type: 'square', f0: 330 * p, f1: 260 * p, dur: 0.22, peak: 0.07 }); return 0.25; }, // penguin
  flap: (k, o, t, { p }) => { k.noise(o, t, { dur: 0.16, peak: 0.25, type: 'bandpass', f0: 900 * p, f1: 300 * p, Q: 1.2, attack: 0.02 }); return 0.18; },
  tweet: (k, o, t, { p }) => {
    for (let i = 0; i < 3; i++) k.tone(o, t + i * 0.09, { f0: 3200 * p, f1: 4200 * p, dur: 0.06, peak: 0.05 });
    return 0.3;
  },
  door: (k, o, t, { p }) => {
    k.tone(o, t, { type: 'triangle', f0: 320 * p, f1: 520 * p, dur: 0.18, peak: 0.06 }); // creak
    k.crunch(o, t + 0.16, 'wood', 0.2, 0.15, 0.7); // thunk
    return 0.35;
  },
  empty: (k, o, t) => { k.noise(o, t, { dur: 0.03, peak: 0.15, type: 'bandpass', f0: 2500, Q: 5 }); return 0.04; },
  ammo: (k, o, t) => { k.noise(o, t, { dur: 0.06, peak: 0.2, type: 'bandpass', f0: 1500, Q: 3 }); k.noise(o, t + 0.1, { dur: 0.06, peak: 0.2, type: 'bandpass', f0: 1100, Q: 3 }); return 0.2; },
  headshot: (k, o, t) => { // a heavy thud and a bright ping under the announcer
    k.tone(o, t, { f0: 90, f1: 38, dur: 0.45, peak: 0.45 });
    k.noise(o, t, { dur: 0.12, peak: 0.3, type: 'lowpass', f0: 1800, f1: 300 });
    k.tone(o, t + 0.02, { type: 'triangle', f0: 2100, dur: 0.35, peak: 0.08 });
    return 0.5;
  },
  ding: (k, o, t) => { k.tone(o, t, { f0: 1568, dur: 0.9, peak: 0.15 }); k.tone(o, t, { f0: 3136, dur: 0.5, peak: 0.04 }); return 0.9; },

  // ----- the world -----
  explode: (k, o, t) => {
    k.noise(o, t, { dur: 1.6, peak: 0.55, type: 'lowpass', f0: 3000, f1: 80, Q: 0.5, attack: 0.005 });
    k.tone(o, t, { f0: 70, f1: 28, dur: 1.0, peak: 0.45 });
    for (let i = 0; i < 6; i++) k.noise(o, t + rnd(0.1, 0.8), { dur: 0.06, peak: 0.15, type: 'bandpass', f0: rnd(800, 2500), Q: 2 });
    return 1.7;
  },
  fireball: (k, o, t) => {
    k.noise(o, t, { dur: 0.45, peak: 0.35, type: 'bandpass', f0: 300, f1: 1400, Q: 1.2, attack: 0.03 });
    k.tone(o, t, { type: 'sawtooth', f0: 90, f1: 140, dur: 0.35, peak: 0.06 });
    return 0.5;
  },
  fizzle: (k, o, t) => { k.noise(o, t, { dur: 0.6, peak: 0.25, type: 'highpass', f0: 3000, f1: 6000, attack: 0.01 }); return 0.6; },
  poof: (k, o, t) => { k.noise(o, t, { dur: 0.35, peak: 0.3, type: 'lowpass', f0: 1200, f1: 200 }); return 0.35; },
  splat: (k, o, t, { p }) => {
    k.tone(o, t, { f0: 320 * p, f1: 70, dur: 0.25, peak: 0.35, vibrato: 40, vibratoRate: 30 });
    k.noise(o, t, { dur: 0.2, peak: 0.25, type: 'lowpass', f0: 700, f1: 200 });
    return 0.3;
  },
  boing: (k, o, t, { p }) => { k.tone(o, t, { f0: 160 * p, f1: 420 * p, dur: 0.18, peak: 0.12, vibrato: 25, vibratoRate: 25 }); return 0.2; },
  sparkle: (k, o, t) => SOUNDS.coin(k, o, t),
  pillow: (k, o, t) => {
    k.noise(o, t, { dur: 0.25, peak: 0.4, type: 'lowpass', f0: 500, f1: 150 });
    k.noise(o, t + 0.05, { dur: 0.5, peak: 0.08, type: 'highpass', f0: 4000, attack: 0.05 });
    return 0.55;
  },
  throw: (k, o, t) => SOUNDS.swing(k, o, t, { p: 1.3 }),
  bowdraw: (k, o, t, { dur = 0.6 }) => { // the string creaking back
    k.noise(o, t, { dur, peak: 0.07, type: 'bandpass', f0: 260, f1: 760, Q: 4, attack: dur * 0.8 });
    k.tone(o, t, { type: 'triangle', f0: 90, f1: 140, dur, peak: 0.04, attack: dur * 0.8 });
    return dur;
  },
  bow: (k, o, t) => {
    k.tone(o, t, { type: 'triangle', f0: 520, f1: 180, dur: 0.18, peak: 0.25 });
    k.noise(o, t, { dur: 0.04, peak: 0.2, type: 'highpass', f0: 2000 });
    return 0.2;
  },
  thunk: (k, o, t) => { k.tone(o, t, { f0: 220, f1: 90, dur: 0.08, peak: 0.3 }); k.noise(o, t, { dur: 0.05, peak: 0.2, type: 'bandpass', f0: 900, Q: 2 }); return 0.1; },

  // ----- creatures -----
  groan: (k, o, t, { p }) => {
    k.tone(o, t, { type: 'sawtooth', f0: 95 * p, f1: 75 * p, dur: 0.9, peak: 0.12, attack: 0.15, vibrato: 4, vibratoRate: 5 });
    k.noise(o, t, { dur: 0.9, peak: 0.05, type: 'bandpass', f0: 350, Q: 3, attack: 0.15 });
    return 1;
  },
  hum: (k, o, t) => { // the Clerk: a flat, wavering hum, like a light about to go
    k.tone(o, t, { type: 'sawtooth', f0: 118, f1: 112, dur: 1.4, peak: 0.05, attack: 0.3, vibrato: 3, vibratoRate: 7 });
    k.tone(o, t, { f0: 236, f1: 230, dur: 1.4, peak: 0.03, attack: 0.3 });
    return 1.4;
  },
  squelch: (k, o, t, { p }) => { // the Mildew: wet steps
    for (let i = 0; i < 3; i++) k.noise(o, t + i * 0.07, { dur: 0.06, peak: 0.18, type: 'lowpass', f0: 900 * p, f1: 300, attack: 0.005 });
    return 0.25;
  },
  tung: (k, o, t, { p }) => { // Tung Tung Tung Sahur: three hollow knocks of a wooden bat, then a low "sa-huuur"
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.22;
      k.tone(o, at, { type: 'triangle', f0: 520 * p, f1: 380 * p, dur: 0.09, peak: 0.16 }); // the knock
      k.tone(o, at, { f0: 180 * p, f1: 120 * p, dur: 0.12, peak: 0.2 }); // ...and the hollow log
      k.crunch(o, at, 'wood', 0.05, 0.12, 0.6);
    }
    k.tone(o, t + 0.8, { type: 'sawtooth', f0: 150 * p, dur: 0.16, peak: 0.04, attack: 0.02 }); // sa-
    k.tone(o, t + 0.98, { type: 'sawtooth', f0: 120 * p, f1: 105 * p, dur: 0.45, peak: 0.04, attack: 0.03, vibrato: 4, vibratoRate: 5 }); // -huuur
    return 1.5;
  },
  brainrot: (k, o, t, { p }) => { // the brainrot mobs: a bouncy sing-song "tra-la-le-ro, tra-la-la"
    const tunes = [[0, 4, 7, 4, -1, 0, 4, 0], [7, 5, 4, 2, -1, 4, 2, 0], [0, 0, 7, 7, -1, 9, 7, 4]];
    const tune = tunes[Math.floor(Math.random() * tunes.length)];
    let at = t;
    for (const n of tune) {
      if (n < 0) { at += 0.12; continue; } // a breath between the two halves
      const f = 330 * p * 2 ** (n / 12);
      k.tone(o, at, { type: 'triangle', f0: f * 1.03, f1: f, dur: 0.11, peak: 0.07, attack: 0.01 });
      k.tone(o, at, { type: 'square', f0: f / 2, dur: 0.09, peak: 0.015, attack: 0.01 }); // a nasal edge
      at += 0.13;
    }
    return at - t;
  },
  rattle: (k, o, t) => {
    for (let i = 0; i < 6; i++) k.noise(o, t + i * 0.05 + rnd(0, 0.02), { dur: 0.03, peak: 0.18, type: 'bandpass', f0: rnd(2000, 3200), Q: 4 });
    return 0.35;
  },
  moo: (k, o, t, { p }) => {
    k.tone(o, t, { type: 'sawtooth', f0: 150 * p, f1: 115 * p, dur: 1.1, peak: 0.12, attack: 0.12, hold: 0.4, vibrato: 3, vibratoRate: 5 });
    return 1.1;
  },
  meow: (k, o, t, { p }) => {
    k.tone(o, t, { type: 'triangle', f0: 650 * p, f1: 900 * p, dur: 0.22, peak: 0.12, attack: 0.04 });
    k.tone(o, t + 0.2, { type: 'triangle', f0: 900 * p, f1: 520 * p, dur: 0.35, peak: 0.1 });
    return 0.6;
  },
  bark: (k, o, t, { p }) => {
    for (const d of [0, 0.22]) {
      k.tone(o, t + d, { type: 'sawtooth', f0: 420 * p, f1: 260 * p, dur: 0.12, peak: 0.16 });
      k.noise(o, t + d, { dur: 0.1, peak: 0.12, type: 'bandpass', f0: 900, Q: 1.5 });
    }
    return 0.4;
  },
  mobHurt: (k, o, t, { p }) => { k.tone(o, t, { type: 'square', f0: 240 * p, f1: 140 * p, dur: 0.15, peak: 0.08 }); return 0.16; },

  // ----- ambience -----
  bird: (k, o, t, { p }) => {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) k.tone(o, t + i * 0.12, { f0: 2600 * p, f1: 3600 * p, dur: 0.08, peak: 0.035 });
    return n * 0.12;
  },
  cricket: (k, o, t, { p }) => {
    for (let i = 0; i < 4; i++) k.tone(o, t + i * 0.05, { type: 'square', f0: 4200 * p, dur: 0.025, peak: 0.012 });
    return 0.25;
  },
};

export const SOUND_NAMES = Object.keys(SOUNDS);

/** Renders one sound into an OfflineAudioContext (used by the tests to check every sound works). */
export async function renderSound(name, opts = {}, sampleRate = 22050) {
  const ctx = new OfflineAudioContext(1, sampleRate * 3, sampleRate);
  const kit = new Kit(ctx, makeNoise(ctx));
  const dur = SOUNDS[name](kit, ctx.destination, 0.01, { p: 1, material: 'stone', ...opts });
  const buf = await ctx.startRendering();
  return { dur, data: buf.getChannelData(0), sampleRate };
}

function makeNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class SoundSystem {
  constructor(store) {
    this.store = store;
    this.ctx = null;
    this.voices = 0;
    this.playing = new Map(); // sound name -> how many are playing
    this.listenerAt = 0;
    this.listener = { x: 0, y: 0, z: 0 };
    const v = parseFloat(store.get('game:volume'));
    this.volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
    this.muted = store.get('game:muted') === '1';
    // "3D sound for headphones": on unless you've turned it off. (Saved only when you click it, under a new key:
    // the old 'game:hrtf' was written by every page load, so it doesn't tell us what anyone chose.)
    this.hrtf = store.get('game:3d-sound') !== '0';
    this.occlusion = null; // (pos) => how much wall is between it and you (main.js sets it)
    this.movers = new Map(); // id -> a continuous sound following something (see MOVERS)
    this.moverAt = 0;
    this.spaceAt = 0;
    this.ambientT = 3;
    this.ambientOn = true; // birds and crickets (Settings: Sound)
    this.echo = 1; // room echo amount (Settings: Sound)
    // Let go of the audio device entirely while the tab is hidden.
    document.addEventListener('visibilitychange', () => this._applyVolume());
  }

  /** Creates/resumes audio. Call from a click or key press (browser autoplay rules). */
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      // 'balanced' uses bigger audio buffers than the default, so a busy frame can't starve the
      // browser's audio (which other tabs share).
      this.ctx = new AC({ latencyHint: 'balanced' });
      this.kit = new Kit(this.ctx, makeNoise(this.ctx));
      this.master = this.ctx.createGain(); // sounds in the world (and your own body): through the room
      this.uiBus = this.ctx.createGain(); // interface sounds: straight out
      const comp = this.ctx.createDynamicsCompressor(); // keeps explosions from clipping
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.acoustics = new Acoustics(this.ctx, { rumble: true });
      this.acoustics.setAmount(this.echo);
      this.master.connect(this.acoustics.input);
      this.acoustics.output.connect(comp);
      this.uiBus.connect(comp);
      comp.connect(this.ctx.destination);
      this._applyVolume();
    }
    this._applyVolume();
  }

  /**
   * The announcer: says `text` in the deepest, manliest voice the browser has (speech synthesis; there are
   * no recorded voices in the game). Quiet when muted, at the game's volume.
   */
  announce(text) {
    const speech = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!speech || this.muted || this.volume === 0 || typeof SpeechSynthesisUtterance === 'undefined') return;
    if (!this._announcer) { // pick a voice once the browser has listed them: an English male one if it says so
      const voices = speech.getVoices();
      if (voices.length) {
        const en = voices.filter((v) => /^en/i.test(v.lang));
        const male = /\b(male|man|david|daniel|fred|alex|george|guy|james|mark|richard|thomas|tom|aaron|arthur|gordon|rocko|ralph|bruce)\b/i;
        this._announcer = en.find((v) => male.test(v.name) && !/female/i.test(v.name)) || en[0] || voices[0];
      }
    }
    speech.cancel(); // one at a time: a new headshot interrupts the last
    const u = new SpeechSynthesisUtterance(text);
    if (this._announcer) u.voice = this._announcer;
    u.pitch = 0.2; // as low as it goes without turning to mush
    u.rate = 0.85;
    u.volume = this.volume;
    speech.speak(u);
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    this.store.set('game:volume', String(this.volume));
    this._applyVolume();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.store.set('game:muted', this.muted ? '1' : '0');
    this._applyVolume();
    return this.muted;
  }

  _applyVolume() {
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : this.volume * this.volume; // perceptual curve
    this.uiBus.gain.value = this.master.gain.value;
    // Muted, silent or hidden: suspend the whole audio context so it stops using the sound device.
    const idle = this.muted || this.volume === 0 || document.hidden;
    if (idle && this.ctx.state === 'running') this.ctx.suspend();
    else if (!idle && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** The "3D sound for headphones" option: HRTF panning (also used by voice.js). */
  setHrtf(on, save = true) {
    this.hrtf = !!on;
    if (save) this.store.set('game:3d-sound', on ? '1' : '0');
    for (const m of this.movers.values()) m.panner.panningModel = this._panModel();
  }

  _panModel() {
    return this.hrtf ? 'HRTF' : 'equalpower';
  }

  /** The "Room echo" setting: 1 normal, 0 none, 2 double. */
  setEcho(k) {
    this.echo = k;
    this.acoustics?.setAmount(k);
  }

  /** The space you're in (acoustics.js probeSpace). Eases over a moment. */
  setSpace(state) {
    if (!this.acoustics) return;
    this.acoustics.set(state);
  }

  setListener(pos, forward) {
    this.listener = { x: pos.x, y: pos.y, z: pos.z };
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - this.listenerAt < LISTENER_EVERY) return;
    this.listenerAt = now;
    this.acoustics.tick((now - (this.spaceAt || now)) / 1000 || LISTENER_EVERY / 1000);
    this.spaceAt = now;
    const L = this.ctx.listener;
    if (L.positionX) {
      // Set .value directly. (Scheduling setValueAtTime every frame piles up automation events,
      // which in Firefox makes the audio thread slower and slower until sound stutters or stops.)
      L.positionX.value = pos.x;
      L.positionY.value = pos.y;
      L.positionZ.value = pos.z;
      L.forwardX.value = forward.x;
      L.forwardY.value = forward.y;
      L.forwardZ.value = forward.z;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  /**
   * Plays a sound. Options: pos {x,y,z} (else it plays "in your head"), volume (0..1+),
   * ref (distance at full volume, default 3), material (for steps/breaks), dur (printer).
   */
  play(name, { pos = null, volume = 1, ref = 3, delay = 0, ...opts } = {}) {
    if (!this.ctx || this.ctx.state !== 'running' || this.muted || !SOUNDS[name]) return;
    if (this.voices >= MAX_VOICES || (this.playing.get(name) || 0) >= MAX_SAME) return;
    if (pos) {
      const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      if (d > HEAR_RANGE * Math.max(1, ref / 3)) return;
    }
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const out = gain;
    if (pos) {
      const panner = new PannerNode(ctx, {
        panningModel: this._panModel(), distanceModel: 'inverse', refDistance: ref, maxDistance: 200, rolloffFactor: 1.3,
        positionX: pos.x, positionY: pos.y, positionZ: pos.z,
      });
      // Walls in the way: duller and quieter.
      const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      const m = this.occlusion && d < OCCLUDE_RANGE ? muffle(this.occlusion(pos)) : null;
      if (m) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = m.cutoff;
        gain.gain.value = volume * m.gain;
        gain.connect(lp).connect(panner).connect(this.master);
      } else gain.connect(panner).connect(this.master);
    } else {
      gain.connect(UI_SOUNDS.has(name) ? this.uiBus : this.master);
    }
    const t = ctx.currentTime + 0.005 + delay;
    const dur = SOUNDS[name](this.kit, out, t, { p: rnd(0.93, 1.07), material: 'stone', ...opts });
    this.voices++;
    this.playing.set(name, (this.playing.get(name) || 0) + 1);
    setTimeout(() => {
      this.voices--;
      this.playing.set(name, this.playing.get(name) - 1);
      gain.disconnect();
    }, (dur + delay + 0.3) * 1000);
  }

  /**
   * Continuous sounds for things that move: `list` is [{ id, kind, pos }] (kind in MOVERS) for everything
   * that should be humming right now; anything missing from it stops. Doppler: the pitch rises as it comes
   * towards you and drops as it goes. Call every frame; it updates every MOVER_EVERY ms.
   */
  track(list) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - this.moverAt < MOVER_EVERY) return;
    const dt = Math.min(0.5, (now - this.moverAt) / 1000);
    this.moverAt = now;
    const seen = new Set();
    for (const { id, kind, pos } of list) {
      const def = MOVERS[kind];
      if (!def) continue;
      const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      if (d > HEAR_RANGE) continue;
      seen.add(id);
      let m = this.movers.get(id);
      if (!m) {
        m = this._mover(def, pos);
        this.movers.set(id, m);
        continue;
      }
      // How fast it's closing in on you (positive: coming closer) -> Doppler pitch.
      const closing = (m.dist - d) / dt;
      m.dist = d;
      const ratio = Math.min(1.6, Math.max(0.6, SOUND_SPEED / Math.max(20, SOUND_SPEED - closing)));
      m.ratio += (ratio - m.ratio) * 0.5;
      for (const [param, base] of m.pitched) param.value = base * m.ratio;
      m.panner.positionX.value = pos.x;
      m.panner.positionY.value = pos.y;
      m.panner.positionZ.value = pos.z;
      if ((m.occludeT -= dt) <= 0 && this.occlusion) { // walls, a few times a second
        m.occludeT = 0.25;
        const mu = muffle(this.occlusion(pos));
        m.lp.frequency.value = mu ? mu.cutoff : 20000;
        m.out.gain.value = def.vol * (mu ? mu.gain : 1);
      }
    }
    for (const [id, m] of this.movers) {
      if (seen.has(id)) continue;
      for (const s of m.sources) s.stop();
      m.out.disconnect();
      this.movers.delete(id);
    }
  }

  _mover(def, pos) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = def.vol;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    const panner = new PannerNode(ctx, { panningModel: this._panModel(), distanceModel: 'inverse', refDistance: def.ref, maxDistance: 200, rolloffFactor: 1.4,
      positionX: pos.x, positionY: pos.y, positionZ: pos.z });
    out.connect(lp).connect(panner).connect(this.master);
    const m = { out, lp, panner, sources: [], pitched: [], ratio: 1, occludeT: 0,
      dist: Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z) };
    if (def.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.kit.noiseBuffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = def.noise.type;
      f.frequency.value = def.noise.f;
      f.Q.value = def.noise.Q;
      src.connect(f).connect(out);
      src.start(0, Math.random());
      m.sources.push(src);
      m.pitched.push([f.frequency, def.noise.f]); // (noise has no pitch: moving its filter does the same job)
    }
    for (const o of [def.osc, def.osc2]) {
      if (!o) continue;
      const osc = ctx.createOscillator();
      osc.type = o.type;
      osc.frequency.value = o.f;
      const g = ctx.createGain();
      g.gain.value = o.vol;
      osc.connect(g).connect(out);
      osc.start();
      m.sources.push(osc);
      m.pitched.push([osc.frequency, o.f]);
    }
    return m;
  }

  /** Birds by day and crickets at night, when you're outdoors. Call every frame. */
  ambient(dt, light, outdoors) {
    if (!outdoors || !this.ambientOn) return;
    this.ambientT -= dt;
    if (this.ambientT > 0) return;
    const day = light > 0.6;
    const night = light < 0.4;
    this.ambientT = day ? rnd(2.5, 7) : night ? rnd(0.6, 1.8) : rnd(4, 9);
    const around = () => {
      const a = Math.random() * Math.PI * 2;
      return { x: this.listener.x + Math.cos(a) * rnd(6, 14), y: this.listener.y + rnd(1, 6), z: this.listener.z + Math.sin(a) * rnd(6, 14) };
    };
    if (day) this.play('bird', { pos: around(), ref: 6 });
    else if (night) this.play('cricket', { pos: around(), ref: 5 });
  }
}
