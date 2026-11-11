// An AudioWorklet that shifts a voice's pitch without changing its speed (voice.js loads it): the classic
// delay-line shifter. Two read heads sweep through a short delay at `ratio` times real speed, each faded
// in and out with a triangle window half a cycle apart, so their sum stays steady. ratio 2 is an octave
// up (shrunk players), 0.5 an octave down (enlarged ones), 1 untouched. Loaded by URL, so no imports.

const WINDOW = 2048; // samples per sweep (~43 ms): long enough for low voices, short enough not to echo
const SIZE = 4096; // the delay buffer (more than one sweep)

class PitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.buf = new Float32Array(SIZE);
    this.w = 0;
    this.phase = 0;
  }

  _read(delay) {
    let pos = this.w - delay;
    while (pos < 0) pos += SIZE;
    const i = Math.floor(pos);
    const f = pos - i;
    return this.buf[i % SIZE] * (1 - f) + this.buf[(i + 1) % SIZE] * f;
  }

  process(inputs, outputs, params) {
    const input = inputs[0]?.[0];
    const out = outputs[0];
    if (!out?.length) return true;
    const ratio = params.ratio[0];
    const step = (1 - ratio) / WINDOW;
    const n = out[0].length;
    for (let i = 0; i < n; i++) {
      const x = input ? input[i] : 0;
      this.buf[this.w] = x;
      let y = x;
      if (Math.abs(ratio - 1) > 1e-3) {
        this.phase = (this.phase + step + 1) % 1;
        const p2 = (this.phase + 0.5) % 1;
        const g1 = 1 - Math.abs(2 * this.phase - 1);
        y = this._read(this.phase * WINDOW + 1) * g1 + this._read(p2 * WINDOW + 1) * (1 - g1);
      }
      for (const ch of out) ch[i] = y;
      this.w = (this.w + 1) % SIZE;
    }
    return true;
  }
}

registerProcessor('pitch-shift', PitchShift);
