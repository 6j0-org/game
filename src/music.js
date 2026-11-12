// Music: generated as it plays, like every other sound (no audio files). Four moods, each its own little composer:
//   pastoral  the wilderness: slow and wistful. Soft strings, a harp arpeggiating a wandering minor-key
//             progression, and now and then a breathy flute melody
//   bard      the Fantasy Town: a medieval tavern tune in 3/4. A drone, lute plucks, a frame drum, and a recorder
//             playing a little AABA melody it makes up for each piece
//   creepy    caves (and Hell and the Backrooms): low beating drones, far-off dissonant bells, rumbling swells
//   techno    the Neon City: kick, hats, claps, a rolling bassline and a filtered arp, built up in sections
// Pieces end and leave a rest before the next one, like a game soundtrack. Moods crossfade when you move between
// places (main.js `updateMusic` picks one about once a second). Notes are scheduled a little ahead on a timer
// (never AudioParam automation every frame), through their own gain into the game's interface bus, so the main
// volume applies too. Rendering side only: not imported by the game.

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
const pick = (list, rand = Math.random) => list[Math.floor(rand() * list.length)];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
/** A scale degree (any integer, wrapping into octaves) as a MIDI note. */
const degree = (root, scale, d) => root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);

/** Notes: oscillators and noise with envelopes, into `out` (a mood's gain). */
export class Voice {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
  }

  /** A shaped tone. `f1` glides; `filter` is a low-pass cutoff (Hz); `vib` is vibrato depth in cents. */
  tone(t, { type = 'sine', f, f1 = f, dur, peak, attack = 0.01, release = 0.2, filter = 0, filterEnd = 0, q = 0.7, vib = 0, pan = 0, detune = 0 }) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f1 !== f) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (detune) osc.detune.value = detune;
    let node = osc;
    if (vib) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(vib, t + Math.min(0.4, dur / 2));
      lfo.connect(depth).connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + dur + release + 0.05);
    }
    if (filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(filter, t);
      if (filterEnd) lp.frequency.exponentialRampToValueAtTime(filterEnd, t + dur);
      lp.Q.value = q;
      node.connect(lp);
      node = lp;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, dur) + release);
    node.connect(g);
    this._out(g, pan);
    osc.start(t);
    osc.stop(t + Math.max(attack, dur) + release + 0.05);
  }

  /** A plucked string (harp, lute): bright at first, dying away. */
  pluck(t, midi, { peak = 0.06, decay = 1.2, bright = 2400, type = 'triangle', pan = 0 } = {}) {
    this.tone(t, { type, f: freq(midi), dur: 0.005, peak, attack: 0.004, release: decay, filter: bright, filterEnd: bright * 0.35, pan });
    this.tone(t, { type: 'sine', f: freq(midi) * 2, dur: 0.005, peak: peak * 0.25, attack: 0.003, release: decay * 0.4, pan });
  }

  /** A burst of filtered noise (drums, breath, wind). */
  hiss(t, { dur, peak, type = 'bandpass', f = 1000, f1 = f, q = 1, attack = 0.002, pan = 0 }) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = type;
    bp.frequency.setValueAtTime(f, t);
    if (f1 !== f) bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.connect(bp).connect(g);
    this._out(g, pan);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + dur + 0.05);
  }

  _out(node, pan) {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p).connect(this.out);
    } else node.connect(this.out);
  }
}

/**
 * A mood: `barDur` seconds a bar, and `bar(t)` schedules the bar starting at `t`. Each counts its way through
 * a piece and then a rest, and starts a new piece (new key, new tune) after.
 */
class Mood {
  constructor(v, { bars, rest, firstRest = [1, 4] }) {
    this.v = v;
    this.bars = bars;
    this.rest = rest;
    this.n = 0; // bar within the piece; negative: resting
    this.n = -(firstRest[0] + Math.floor(Math.random() * (firstRest[1] - firstRest[0] + 1))); // (a moment before the first piece)
  }

  bar(t) {
    if (this.n < 0) { this.n++; if (this.n === 0) this.newPiece(); return; }
    this.play(t, this.n);
    if (++this.n >= this.length) this.n = -(this.rest[0] + Math.floor(Math.random() * (this.rest[1] - this.rest[0] + 1)));
  }

  get length() { return this.bars; }
}

// Wilderness: wistful, slow, open. A minor-key progression that wanders (i, VI, III, VII, iv...).
const PASTORAL_NEXT = { 0: [5, 2, 6, 3], 5: [2, 6, 3, 0], 2: [6, 5, 3], 6: [0, 5, 2], 3: [0, 6, 4], 4: [0, 5] };
class Pastoral extends Mood {
  constructor(v) {
    super(v, { bars: 20, rest: [5, 10] });
    this.barDur = (60 / 62) * 4;
    this.newPiece();
  }

  newPiece() {
    this.root = pick([62, 57, 60, 64]);
    this.chord = 0;
    this.last = 9; // the flute's last note (a scale degree)
  }

  play(t, n) {
    const { v, root } = this;
    const beat = this.barDur / 4;
    if (n > 0) this.chord = pick(PASTORAL_NEXT[this.chord] || [0]);
    if (n === this.bars - 1) this.chord = 0; // come home to end
    const fade = n >= this.bars - 4 ? (this.bars - n) / 5 : 1;
    const tones = [0, 2, 4].map((k) => degree(root, AEOLIAN, this.chord + k));
    // Strings: the chord, low and soft, swelling in and out.
    for (const [i, m] of tones.entries()) {
      for (const d of [-7, 7]) this.v.tone(t, { type: 'sawtooth', f: freq(m - 12 - (i === 0 ? 12 : 0)), dur: this.barDur, peak: 0.012 * fade, attack: 1.4, release: 1.6, filter: 900, detune: d });
    }
    // Harp: up and down the chord over two octaves, in eighths.
    const harp = [tones[0], tones[1], tones[2], tones[0] + 12, tones[1] + 12, tones[0] + 12, tones[2], tones[1]];
    harp.forEach((m, i) => {
      if (n >= this.bars - 2 && i % 2) return; // thinning out at the end
      if (Math.random() < 0.08) return;
      v.pluck(t + i * beat / 2 + Math.random() * 0.015, m, { peak: 0.05 * fade, decay: 1.8, pan: (i % 4 - 1.5) * 0.15 });
    });
    // Flute: in the middle of the piece, long notes that move by step and land on the chord.
    if (n >= 4 && n < this.bars - 4 && !(n % 8 === 7 && Math.random() < 0.6)) {
      const rhythm = pick([[2, 2], [3, 1], [4], [1, 1, 2], [2, 1, 1], [1.5, 0.5, 2]]);
      let at = 0;
      rhythm.forEach((len, i) => {
        if (i === 0) { // on the chord at the start of the bar
          const options = [this.chord, this.chord + 2, this.chord + 4, this.chord + 7, this.chord + 9].filter((d) => d >= 5 && d <= 13);
          this.last = options.reduce((a, b) => (Math.abs(b - this.last) < Math.abs(a - this.last) ? b : a), options[0] ?? 9);
        } else this.last = Math.max(5, Math.min(13, this.last + pick([-2, -1, -1, 1, 1, 2])));
        const m = degree(root, AEOLIAN, this.last) + 12;
        v.tone(t + at * beat, { type: 'sine', f: freq(m), dur: len * beat * 0.92, peak: 0.045, attack: 0.12, release: 0.35, vib: 9 });
        v.tone(t + at * beat, { type: 'triangle', f: freq(m), dur: len * beat * 0.92, peak: 0.012, attack: 0.15, release: 0.3, filter: 2500 });
        v.hiss(t + at * beat, { dur: 0.12, peak: 0.006, f: freq(m) * 2, q: 3 }); // breath
        at += len;
      });
    }
  }
}

// The Fantasy Town: a tavern tune in 3/4. I, IV, bVII and V in a bright mixolydian.
class Bard extends Mood {
  constructor(v) {
    super(v, { bars: 32, rest: [4, 8], firstRest: [0, 2] });
    this.barDur = (60 / 116) * 3;
    this.newPiece();
  }

  newPiece() {
    this.root = pick([62, 67, 60]);
    this.prog = pick([[0, 0, 3, 0, 0, 6, 4, 0], [0, 3, 0, 4, 0, 3, 6, 0], [0, 6, 3, 0, 0, 6, 4, 0]]);
    const phrase = () => { // 4 bars of melody: rhythms in beats, pitches as a walk on the scale
      let d = pick([7, 9, 11]);
      const out = [];
      for (let b = 0; b < 4; b++) {
        const rhythm = b === 3 ? pick([[2, 1], [3]]) : pick([[1, 1, 1], [2, 1], [1, 2], [0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1], [1.5, 0.5, 1]]);
        out.push(rhythm.map((len) => { const note = [d, len]; d = Math.max(4, Math.min(14, d + pick([-2, -1, -1, 1, 1, 2, 0]))); return note; }));
      }
      return out;
    };
    const a = phrase();
    const b = phrase();
    this.tune = [...a, ...a, ...b, ...a]; // AABA: sixteen bars, played twice
  }

  play(t, n) {
    const { v, root } = this;
    const beat = this.barDur / 3;
    const chord = this.prog[n % 8];
    const end = n === this.bars - 1;
    // The drone: the home note and its fifth, like a hurdy-gurdy, a bar at a time (overlapping).
    for (const m of [root - 24, root - 17]) v.tone(t, { type: 'sawtooth', f: freq(m), dur: this.barDur, peak: 0.009, attack: 0.25, release: 0.35, filter: 700 });
    // Lute: the bass on one, the chord on two and three.
    const tones = [0, 2, 4].map((k) => degree(root, MIXOLYDIAN, chord + k));
    v.pluck(t, tones[0] - 12, { peak: 0.07, decay: 0.9, bright: 1800, type: 'sawtooth' });
    if (!end) for (const k of [1, 2]) for (const m of [tones[1], tones[2]]) v.pluck(t + k * beat + Math.random() * 0.01, m, { peak: 0.035, decay: 0.45, bright: 2600, type: 'sawtooth', pan: 0.2 });
    // Frame drum: a low thump on one, taps after; a jingle now and then.
    v.tone(t, { type: 'sine', f: 110, f1: 55, dur: 0.18, peak: 0.12, release: 0.1 });
    if (!end) for (const k of [1, 2]) v.hiss(t + k * beat, { dur: 0.05, peak: 0.025, f: 1800, q: 1.5, pan: -0.3 });
    if (!end && Math.random() < 0.35) v.hiss(t + 2.5 * beat, { dur: 0.12, peak: 0.02, type: 'highpass', f: 7000, pan: -0.3 });
    // The recorder: the tune (it sits out the first two bars).
    if (n < 2) return;
    let at = 0;
    for (const [d, len] of this.tune[(n - 2) % this.tune.length]) {
      const m = degree(root, MIXOLYDIAN, d) + 12;
      v.tone(t + at * beat, { type: 'triangle', f: freq(m), dur: len * beat * 0.85, peak: 0.04, attack: 0.03, release: 0.12, vib: 6, filter: 3200 });
      v.tone(t + at * beat, { type: 'sine', f: freq(m) * 2, dur: len * beat * 0.85, peak: 0.008, attack: 0.03, release: 0.1 });
      at += len;
    }
  }
}

// Caves: no beat at all. Drones that beat against each other, bells somewhere off in the dark, a rumble.
class Creepy extends Mood {
  constructor(v) {
    super(v, { bars: 18, rest: [3, 7], firstRest: [0, 2] });
    this.barDur = 4;
    this.newPiece();
  }

  newPiece() {
    this.root = pick([36, 38, 40, 35]);
  }

  play(t, n) {
    const { v, root } = this;
    const fade = n >= this.bars - 4 ? (this.bars - n) / 5 : Math.min(1, (n + 1) / 3);
    if (n % 4 === 0) { // a long drone every four bars: two nearly-equal notes (they beat slowly) and a tritone, very quiet
      const dur = this.barDur * 4.2;
      v.tone(t, { type: 'sawtooth', f: freq(root), dur, peak: 0.02 * fade, attack: 3, release: 3, filter: 260 });
      v.tone(t, { type: 'sawtooth', f: freq(root) * 1.006, dur, peak: 0.018 * fade, attack: 3.5, release: 3, filter: 240 });
      v.tone(t + 2, { type: 'triangle', f: freq(root + pick([6, 13, 11])), dur: dur - 2, peak: 0.008 * fade, attack: 4, release: 3, filter: 600 });
    }
    if (Math.random() < 0.55) { // a bell, far off
      const m = root + 36 + pick([1, 6, 11, 13, 18, 0]);
      const at = t + Math.random() * this.barDur;
      v.tone(at, { type: 'sine', f: freq(m), dur: 0.01, peak: 0.022 * fade, attack: 0.005, release: 3.5, pan: Math.random() * 1.6 - 0.8 });
      v.tone(at, { type: 'sine', f: freq(m) * 2.76, dur: 0.01, peak: 0.006 * fade, attack: 0.005, release: 1.2, pan: Math.random() * 1.6 - 0.8 }); // (an inharmonic overtone)
    }
    if (Math.random() < 0.15) v.hiss(t + Math.random() * 2, { dur: 3, peak: 0.025 * fade, f: 160, f1: 700, q: 4, attack: 1.5 }); // a swell, like wind in a tunnel
    if (Math.random() < 0.08) for (const k of [0, 0.32]) v.tone(t + 1 + k, { type: 'sine', f: 62, f1: 40, dur: 0.15, peak: 0.08 * fade, release: 0.2 }); // a heartbeat
  }
}

// The Neon City: four on the floor, 126 bpm, a minor key, built up and broken down in sections.
class Techno extends Mood {
  constructor(v) {
    super(v, { bars: 64, rest: [2, 4], firstRest: [0, 1] });
    this.barDur = (60 / 126) * 4;
    this.newPiece();
  }

  newPiece() {
    this.root = pick([45, 43, 41, 46]);
    this.prog = pick([[0, 0, 5, 6], [0, 3, 5, 6], [0, 5, 3, 4], [0, 6, 5, 6]]);
    this.bass = Array.from({ length: 16 }, (_, i) => (i % 4 === 2 ? true : i % 4 === 0 ? Math.random() < 0.25 : Math.random() < 0.45));
    this.octaves = Array.from({ length: 16 }, () => (Math.random() < 0.2 ? 12 : 0));
    this.arp = pick([[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3], [2, 1, 0, 1]]);
  }

  play(t, n) {
    const { v, root } = this;
    const s = this.barDur / 16;
    const chord = this.prog[Math.floor(n / 4) % 4];
    const tones = [0, 2, 4, 7].map((k) => degree(root, AEOLIAN, chord + k));
    const breakdown = n >= 32 && n < 40;
    const kick = !breakdown;
    const bass = (n >= 8 && n < 60) && !breakdown;
    const arp = n >= 16 && n < 60;
    const clap = (n >= 16 && n < 32) || (n >= 40 && n < 60);
    for (let i = 0; i < 16; i++) {
      const at = t + i * s;
      if (kick && i % 4 === 0) v.tone(at, { type: 'sine', f: 150, f1: 45, dur: 0.14, peak: 0.28, release: 0.12 });
      if (i % 4 === 2) v.hiss(at, { dur: 0.12, peak: breakdown ? 0.015 : 0.035, type: 'highpass', f: 7500 }); // open hat on the offbeat
      else if (!breakdown || i % 2) v.hiss(at, { dur: 0.03, peak: i % 2 ? 0.012 : 0.02, type: 'highpass', f: 9000, pan: 0.25 }); // closed hats
      if (clap && (i === 4 || i === 12)) v.hiss(at, { dur: 0.1, peak: 0.06, f: 1500, q: 0.8 });
      if (bass && this.bass[i]) v.tone(at, { type: 'sawtooth', f: freq(tones[0] - 12 + this.octaves[i]), dur: s * 0.8, peak: 0.07, release: 0.06, filter: 900, filterEnd: 220, q: 6 });
      if (arp) {
        const sweep = breakdown ? 700 : 900 + 2400 * ((n % 16) / 16); // the filter opens over each 16 bars
        v.tone(at, { type: 'square', f: freq(tones[this.arp[i % 4]] + 24), dur: s * 0.5, peak: 0.018, release: 0.08, filter: sweep, q: 5, pan: (i % 2 ? 0.3 : -0.3) });
      }
    }
    if (breakdown || n >= 56) for (const m of tones.slice(0, 3)) v.tone(t, { type: 'sawtooth', f: freq(m), dur: this.barDur, peak: 0.012, attack: 1, release: 1, filter: 1400, detune: 8 }); // a pad over the breakdown
  }
}

export const MOODS = { pastoral: Pastoral, bard: Bard, creepy: Creepy, techno: Techno };
/** Each mood's level, so they come out about as loud as each other. */
const LEVEL = { pastoral: 1.2, bard: 1, creepy: 1.8, techno: 0.38 };

export class Music {
  /** `sound`: the SoundSystem (audio.js); music goes into its interface bus, so the main volume applies. */
  constructor(sound) {
    this.sound = sound;
    this.volume = 0.6;
    this.want = null; // the mood we should be in
    this.cur = null; // { name, mood, gain, voice }
    this.nextBar = 0;
    this.timer = null;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.out) this.out.gain.value = this.volume * 0.9;
  }

  /** 'pastoral', 'bard', 'creepy', 'techno' or null (silence). Call as often as you like: it only acts on a change. */
  setMood(name) {
    this.want = MOODS[name] ? name : null;
    this._start();
  }

  _start() {
    const ctx = this.sound.ctx;
    if (this.timer || !ctx) return;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume * 0.9;
    // A big soft room for everything (techno sends less of itself there).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 3.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.wet.connect(this.reverb).connect(this.out);
    this.out.connect(this.sound.uiBus);
    this.noise = noiseBuffer(ctx);
    this.timer = setInterval(() => this._schedule(), 100);
  }

  _schedule() {
    const ctx = this.sound.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if ((this.cur?.name || null) !== this.want) this._switch(now);
    if (!this.cur || this.volume === 0) return;
    if (this.nextBar < now - 0.5) this.nextBar = now + 0.1; // (the audio was suspended for a while)
    while (this.nextBar < now + 0.6) {
      this.cur.mood.bar(this.nextBar);
      this.nextBar += this.cur.mood.barDur;
    }
  }

  /** Fades the old mood out (what it already scheduled plays on, quietly) and starts the new one. */
  _switch(now) {
    const ctx = this.sound.ctx;
    if (this.cur) {
      const old = this.cur.gain;
      old.gain.setTargetAtTime(0, now, 1.2);
      setTimeout(() => old.disconnect(), 9000);
    }
    this.cur = null;
    if (!this.want) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(LEVEL[this.want], now + 0.3, 1.2);
    gain.connect(this.out);
    const send = ctx.createGain();
    send.gain.value = this.want === 'techno' ? 0.25 : 1;
    gain.connect(send).connect(this.wet);
    const voice = new Voice(ctx, gain, this.noise);
    this.cur = { name: this.want, gain, mood: new MOODS[this.want](voice) };
    this.nextBar = now + 0.4;
  }
}

/** A reverb's impulse: stereo noise dying away over `seconds`. */
function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return buf;
}

function noiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
