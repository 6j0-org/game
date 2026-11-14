// What's in a world's sky: its suns, moons and (sometimes) a ring. Rolled from the seed when a world is first
// loaded, saved as `game:sky`, sent in `welcome` and as `sky` when /sun, /moon or /ring change it; sky.js draws
// it. Purely how the sky looks: daylight still follows the one day cycle (daycycle.js). No Three.js, no DOM.
//
// { suns: [{ color, size, at: [along, across] }], moons: [{ color, size, phase, tilt }], ring: { color, size, width, tilt } | null }
// Colours are 0xRRGGBB numbers; `size` is 1 for the classic sun or moon. A sun's `at` nudges it off the main
// sun's path (radians), so several suns travel together as one cluster. A moon's `phase` (0-1) is where it is
// in its orbit compared with straight opposite the sun, `tilt` how far north or south of the sun's path it runs.

export const MAX_SUNS = 6;
export const MAX_MOONS = 8;
export const SIZE_RANGE = [0.2, 5];
export const RING_RANGE = [0.3, 3];

/** Colours you can name in /sun, /moon and /ring (or use #rrggbb). */
export const SKY_COLORS = {
  white: 0xf4f6ff, yellow: 0xfff4c2, gold: 0xffd66b, orange: 0xffa04a, red: 0xff5a3a, pink: 0xff9ad0, purple: 0xb488ff,
  blue: 0x8ab8ff, cyan: 0x8af0ff, green: 0x9aff9a, grey: 0xb9c3d3, gray: 0xb9c3d3, silver: 0xe4ebf5, rust: 0xc8784a,
  brown: 0xa07850, cream: 0xf2e6c4, ice: 0xd8f4ff, black: 0x30303a, sand: 0xd8c8a8, tan: 0xc8a07a, sky: 0xa8c8e8, peach: 0xe8b8a0,
};
const SUN_COLORS = [0xfff4c2, 0xfff4c2, 0xfff4c2, 0xf4f6ff, 0xffd66b, 0xffa04a, 0xff5a3a, 0x8ab8ff];
const MOON_COLORS = [0xe4ebf5, 0xe4ebf5, 0xb9c3d3, 0xd8f4ff, 0xc8784a, 0xf2e6c4, 0xb488ff, 0x9aff9a, 0xff9ad0];
const RING_COLORS = [0xd8c8a8, 0xe4ebf5, 0xc8a07a, 0xb9c3d3, 0xa8c8e8, 0xe8b8a0];

/** A little seeded random number generator (the same sky for the same seed). */
function rng(seed) {
  let h = (Math.imul((seed | 0) ^ 0x5bd1e995, 2654435761) >>> 0) || 1;
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const round = (v, n = 100) => Math.round(v * n) / n;

export function rollSun(r, i) {
  return { color: pick(r, SUN_COLORS), size: round(0.6 + r() * 0.9), at: i ? [round((r() - 0.5) * 0.5), round((r() - 0.5) * 0.3)] : [0, 0] };
}
export function rollMoon(r, i) {
  return { color: pick(r, MOON_COLORS), size: round(0.35 + r() * 1.1), phase: i ? round(r()) : 0, tilt: i ? round((r() - 0.5) * 0.8) : 0 };
}
export function rollRing(r) {
  return { color: pick(r, RING_COLORS), size: round(0.6 + r() * 1.6), width: round(0.2 + r() * 0.6), tilt: round(0.3 + r() * 0.9) };
}

/** A new world's sky, from its seed: usually one sun (sometimes two or three), up to four moons, and a ring now and then. */
export function rollSky(seed) {
  const r = rng(seed);
  const s = r();
  const suns = s < 0.7 ? 1 : s < 0.92 ? 2 : 3;
  const m = r();
  const moons = m < 0.1 ? 0 : m < 0.6 ? 1 : m < 0.85 ? 2 : m < 0.95 ? 3 : 4;
  return {
    suns: Array.from({ length: suns }, (_, i) => rollSun(r, i)),
    moons: Array.from({ length: moons }, (_, i) => rollMoon(r, i)),
    ring: r() < 0.3 ? rollRing(r) : null,
  };
}

const num = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
const color = (v, fallback) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : fallback);

/** A sky that's safe to use and send (from a save, or from anyone): anything wrong is fixed or dropped. */
export function cleanSky(sky, seed = 0) {
  if (!sky || typeof sky !== 'object') return rollSky(seed);
  const list = (v) => (Array.isArray(v) ? v.filter((o) => o && typeof o === 'object') : []);
  return {
    suns: list(sky.suns).slice(0, MAX_SUNS).map((o) => ({
      color: color(o.color, 0xfff4c2), size: num(o.size, ...SIZE_RANGE, 1),
      at: [num(o.at?.[0], -1, 1, 0), num(o.at?.[1], -1, 1, 0)],
    })),
    moons: list(sky.moons).slice(0, MAX_MOONS).map((o) => ({
      color: color(o.color, 0xe4ebf5), size: num(o.size, ...SIZE_RANGE, 1), phase: num(o.phase, 0, 1, 0), tilt: num(o.tilt, -1, 1, 0),
    })),
    ring: sky.ring && typeof sky.ring === 'object' ? {
      color: color(sky.ring.color, 0xd8c8a8), size: num(sky.ring.size, ...RING_RANGE, 1),
      width: num(sky.ring.width, 0.05, 1, 0.4), tilt: num(sky.ring.tilt, 0, 1.5, 0.6),
    } : null,
  };
}

/** A colour from what someone typed: a name from SKY_COLORS, or #rgb / #rrggbb. null if it's neither. */
export function parseColor(text) {
  const t = String(text || '').toLowerCase().trim();
  if (t in SKY_COLORS) return SKY_COLORS[t];
  const m = t.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return parseInt(h, 16);
}
/** A colour's name if it has one, else #rrggbb. */
export function colorName(c) {
  const named = Object.entries(SKY_COLORS).find(([, v]) => v === c);
  return named ? named[0] : `#${c.toString(16).padStart(6, '0')}`;
}

/** One line per sun, moon and the ring, for the console. */
export function describeSky(sky, what) {
  const lines = [];
  if (what === 'sun') {
    lines.push(sky.suns.length ? `${sky.suns.length} sun${sky.suns.length > 1 ? 's' : ''}:` : 'No suns (the days are still light).');
    sky.suns.forEach((s, i) => lines.push(`  ${i + 1}: ${colorName(s.color)}, size ${s.size}`));
  } else if (what === 'moon') {
    lines.push(sky.moons.length ? `${sky.moons.length} moon${sky.moons.length > 1 ? 's' : ''}:` : 'No moons.');
    sky.moons.forEach((m, i) => lines.push(`  ${i + 1}: ${colorName(m.color)}, size ${m.size}`));
  } else {
    lines.push(sky.ring ? `A ${colorName(sky.ring.color)} ring, size ${sky.ring.size}, width ${sky.ring.width}, tilt ${sky.ring.tilt}` : 'No ring.');
  }
  return lines;
}

/**
 * Runs /sun, /moon or /ring (`what`) with `args` on a copy of `sky`. Returns { sky (the new one, or null if
 * nothing changed), lines: [{ text, error? }] }. `rand` rolls new ones.
 *   /sun                     what's there now
 *   /sun <n>                 that many (new ones are random; extras go)
 *   /sun [i] color <c>       all of them, or number i: a colour name or #rrggbb
 *   /sun [i] size <x>        1 is the usual size
 *   /sun random              roll them all again
 *   /ring on|off|random, /ring color <c>, /ring size <x>, /ring width <0-1>, /ring tilt <0-1.5>
 */
export function editSky(sky, what, args, rand = Math.random) {
  const out = cleanSky(JSON.parse(JSON.stringify(sky)));
  const fail = (text) => ({ sky: null, lines: [{ text, error: true }] });
  const done = () => ({ sky: out, lines: describeSky(out, what).map((text) => ({ text })) });
  const a = args.map((s) => s.toLowerCase());
  if (!a.length) return { sky: null, lines: describeSky(out, what).map((text) => ({ text })) };
  const r = () => rand();

  if (what === 'ring') {
    const usage = 'Usage: /ring on | off | random | color <c> | size <0.3-3> | width <0-1> | tilt <0-1.5>';
    if (a[0] === 'off' || a[0] === 'none' || a[0] === '0') { out.ring = null; return done(); }
    if (a[0] === 'on') { out.ring = out.ring || rollRing(r); return done(); }
    if (a[0] === 'random') { out.ring = rollRing(r); return done(); }
    if (!['color', 'colour', 'size', 'width', 'tilt'].includes(a[0]) || a.length < 2) return fail(usage);
    out.ring = out.ring || rollRing(r);
    if (a[0] === 'color' || a[0] === 'colour') {
      const c = parseColor(a[1]);
      if (c === null) return fail(`"${args[1]}" isn't a colour: try ${Object.keys(SKY_COLORS).slice(0, 8).join(', ')} or #ffaa33`);
      out.ring.color = c;
    } else {
      const v = Number(a[1]);
      if (!Number.isFinite(v)) return fail(usage);
      out.ring[a[0]] = v;
    }
    return { sky: cleanSky(out), lines: describeSky(cleanSky(out), what).map((text) => ({ text })) };
  }

  const key = what === 'sun' ? 'suns' : 'moons';
  const max = what === 'sun' ? MAX_SUNS : MAX_MOONS;
  const roll = what === 'sun' ? rollSun : rollMoon;
  const usage = `Usage: /${what} | /${what} <count 0-${max}> | /${what} [number] color <c> | /${what} [number] size <x> | /${what} random`;
  if (a[0] === 'random') {
    const n = what === 'sun' ? Math.max(1, out.suns.length) : out.moons.length || 1;
    out[key] = Array.from({ length: n }, (_, i) => roll(r, i));
    return done();
  }
  if (a.length === 1 || (a[0] === 'count' && a.length === 2)) {
    const n = Number(a[a.length - 1]);
    if (!Number.isInteger(n) || n < 0 || n > max) return fail(usage);
    while (out[key].length > n) out[key].pop();
    while (out[key].length < n) out[key].push(roll(r, out[key].length));
    return done();
  }
  let which = null; // (all of them)
  let rest = a;
  if (/^\d+$/.test(a[0])) {
    which = Number(a[0]) - 1;
    if (!out[key][which]) return fail(`There ${out[key].length === 1 ? 'is' : 'are'} only ${out[key].length} ${what}${out[key].length === 1 ? '' : 's'}.`);
    rest = a.slice(1);
  }
  if (rest.length < 2) return fail(usage);
  const targets = which === null ? out[key] : [out[key][which]];
  if (!targets.length) return fail(`There are no ${what}s: /${what} 1 adds one.`);
  if (rest[0] === 'color' || rest[0] === 'colour') {
    const c = parseColor(rest[1]);
    if (c === null) return fail(`"${rest[1]}" isn't a colour: try ${Object.keys(SKY_COLORS).slice(0, 8).join(', ')} or #ffaa33`);
    for (const t of targets) t.color = c;
  } else if (rest[0] === 'size') {
    const v = Number(rest[1]);
    if (!Number.isFinite(v)) return fail(usage);
    for (const t of targets) t.size = v;
  } else return fail(usage);
  const clean = cleanSky(out);
  return { sky: clean, lines: describeSky(clean, what).map((text) => ({ text })) };
}
