// Biomes: which one each column of the world is in, its ground height, and what grows or stands
// there. Everything is a pure function of the seed, so terrain stays deterministic. No Three.js, no DOM.
//
// Natural biomes come from two slow noise maps, temperature and humidity:
//   cold -> taiga; hot and dry -> desert; hot and wet -> jungle; mild and very wet -> swamp;
//   mild and damp -> forest; otherwise plains.
// Special zones are patches where a third noise map is high. Their ground blends into the
// surroundings over a border, and their buildings only stand in the middle (strength 1).
//
// Generations: `biomeAtV1` is the original map, kept exactly so chunks players built in before the
// change look the same (world.js keeps a list of those "legacy" chunks per world). `biomeAt` is
// the current one: every map is BIOME_SCALE times bigger, and there's a sixth zone, the town.

export const BIOMES = {
  plains: { name: 'Plains', color: '#6fbf57' },
  forest: { name: 'Forest', color: '#2f8a3a' },
  jungle: { name: 'Jungle', color: '#1f9d55' },
  desert: { name: 'Desert', color: '#e2cf8a' },
  taiga: { name: 'Taiga', color: '#d9e6ee' },
  swamp: { name: 'Swamp', color: '#4f6b3a' },
  city: { name: 'Concrete Jungle', color: '#8f949c', special: true, flat: true },
  ruins: { name: 'Abandoned City', color: '#6e6a5e', special: true, flat: true },
  hell: { name: 'Hell', color: '#8a1e12', special: true },
  backrooms: { name: 'The Backrooms', color: '#d8c66a', special: true, flat: true },
  ballpit: { name: 'Ball Pit', color: '#e94f9b', special: true, flat: true }, // (only in frozen chunks now: the third generation has none)
  cyber: { name: 'Neon City', color: '#b23cff', special: true, flat: true }, // the cyberpunk city (third generation)
  town: { name: 'Fantasy Town', color: '#c9a26b', special: true, flat: true },
};

const SPECIALS_V1 = ['city', 'ruins', 'hell', 'backrooms', 'ballpit'];
const SPECIALS_V2 = ['city', 'ruins', 'hell', 'backrooms', 'ballpit', 'town'];
const SPECIALS = ['city', 'ruins', 'hell', 'backrooms', 'cyber', 'town']; // the third generation: the ball pits' band is the cyberpunk city
/** How much bigger biomes are than in the first generation. */
export const BIOME_SCALE = 10;
export const FLAT_LEVEL = 24; // ground level of the flat special zones
export const HELL_LAVA = 21; // lava fills hell up to here

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The natural biome for a temperature and humidity. */
function naturalOf(temp, wet) {
  if (temp < -0.4) return 'taiga';
  if (temp > 0.34) return wet > 0.05 ? 'jungle' : 'desert';
  if (wet > 0.38) return 'swamp';
  if (wet > -0.12) return 'forest';
  return 'plains';
}

/**
 * The biome at a column: { biome, natural, special, s } where `natural` is what it would be without
 * a special zone, `special` the zone (or null) and `s` its strength (0 outside, 1 in the middle).
 * This is the third generation (no Ball Pit); see biomeAtV2 and biomeAtV1 for frozen chunks.
 */
export function biomeAt(noise, x, z) {
  const info = biomeAtV2(noise, x, z);
  if (info.special === 'ballpit') { // (the same bands as the second generation, with the cyberpunk city in the ball pits' place)
    info.special = SPECIALS[4];
    if (info.biome === 'ballpit') info.biome = SPECIALS[4];
  }
  return info;
}

/** The second generation's biome map (with the Ball Pit). Don't change it: chunks frozen on it use it. */
export function biomeAtV2(noise, x, z) {
  const k = BIOME_SCALE;
  const natural = naturalOf(noise(x / (340 * k) + 1000, z / (340 * k) + 1000), noise(x / (300 * k) + 2000, z / (300 * k) + 2000));
  const s = smooth(0.4, 0.52, noise(x / (380 * k) + 3000, z / (380 * k) + 3000));
  let special = null;
  if (s > 0) {
    // Which zone: a slower map, cut into six roughly equal bands.
    const b = noise(x / (900 * k) + 4000, z / (900 * k) + 4000);
    special = SPECIALS_V2[b < -0.51 ? 0 : b < -0.26 ? 1 : b < 0 ? 2 : b < 0.26 ? 3 : b < 0.52 ? 4 : 5];
  }
  return { biome: special && s >= 0.5 ? special : natural, natural, special, s };
}

/** The first generation's biome map (smaller biomes, no town). Don't change it: legacy chunks use it. */
export function biomeAtV1(noise, x, z) {
  const natural = naturalOf(noise(x / 340 + 1000, z / 340 + 1000), noise(x / 300 + 2000, z / 300 + 2000));
  const zone = noise(x / 380 + 3000, z / 380 + 3000);
  const s = smooth(0.4, 0.52, zone);
  let special = null;
  if (s > 0) {
    const k = noise(x / 900 + 4000, z / 900 + 4000);
    special = SPECIALS_V1[k < -0.46 ? 0 : k < -0.15 ? 1 : k < 0.16 ? 2 : k < 0.46 ? 3 : 4];
  }
  return { biome: special && s >= 0.5 ? special : natural, natural, special, s };
}

/** Ground height of a natural biome (before any special zone flattens it). */
export function naturalHeight(noise, x, z, natural, sea) {
  const continent = noise(x / 256, z / 256);
  const hills = noise(x / 64 + 100, z / 64 + 100);
  const detail = noise(x / 16 + 200, z / 16 + 200);
  const ridge = Math.max(0, noise(x / 128 + 500, z / 128 + 500));
  let h = 21 + continent * 9 + hills * 6 + detail * 1.5 + ridge * ridge * 30;
  if (natural === 'swamp') h = sea + (h - sea) * 0.25 + detail * 0.8; // low and soggy: puddles everywhere
  if (natural === 'desert') h = h * 0.85 + 3 + noise(x / 24 + 600, z / 24 + 600) * 2; // dunes
  return h;
}

/** Ground height of hell: rough, low, with lava lakes in the hollows. */
export function hellHeight(noise, x, z) {
  return 18 + noise(x / 40 + 700, z / 40 + 700) * 7 + noise(x / 11 + 800, z / 11 + 800) * 2.5;
}

/** The final ground height of a column, blending special zones into their surroundings. */
export function groundHeight(noise, x, z, info, sea, maxH) {
  let h = naturalHeight(noise, x, z, info.natural, sea);
  if (info.special) {
    const target = info.special === 'hell' ? hellHeight(noise, x, z) : FLAT_LEVEL;
    h = h + (target - h) * info.s;
  }
  return Math.max(2, Math.min(maxH, Math.floor(h)));
}

// ---------- city blocks ----------

export const CITY_CELL = 26; // a block of road + pavement + one building plot
const ROAD = 5;

const mod = (a, n) => ((a % n) + n) % n;

/**
 * What stands at a column of a (possibly ruined) city: { road, pavement, building } where building
 * is null or { x0, z0, x1, z1, height, seed } (the footprint is inclusive, in world coordinates).
 */
export function cityColumn(hash2, seed, x, z, ruined) {
  const lx = mod(x, CITY_CELL);
  const lz = mod(z, CITY_CELL);
  const road = lx < ROAD || lz < ROAD;
  const pavement = !road && (lx === ROAD || lz === ROAD || lx === CITY_CELL - 1 || lz === CITY_CELL - 1);
  if (road || pavement) return { road, pavement, building: null };
  const cx = Math.floor(x / CITY_CELL);
  const cz = Math.floor(z / CITY_CELL);
  const r = (k) => hash2(cx * 7 + k, cz * 13 - k, seed + 77);
  if (r(0) < 0.08) return { road: false, pavement: true, building: null }; // an empty plaza now and then
  const span = CITY_CELL - ROAD - 2; // room for the building
  const w = 10 + Math.floor(r(1) * (span - 9));
  const d = 10 + Math.floor(r(2) * (span - 9));
  const x0 = cx * CITY_CELL + ROAD + 1 + Math.floor(r(3) * (span - w + 1));
  const z0 = cz * CITY_CELL + ROAD + 1 + Math.floor(r(4) * (span - d + 1));
  const height = ruined ? 5 + Math.floor(r(5) * 14) : 12 + Math.floor(r(5) * 36);
  const inside = x >= x0 && x < x0 + w && z >= z0 && z < z0 + d;
  return { road: false, pavement: !inside, building: inside ? { x0, z0, x1: x0 + w - 1, z1: z0 + d - 1, height, seed: r(6) } : null };
}

// ---------- the backrooms ----------

export const ROOM = 7; // maze cell size
export const ROOM_HEIGHT = 4; // walls; the ceiling is one above

/** Is there a wall at this column of the backrooms maze? Cells have walls on some edges, with doorways. */
export function backroomsWall(hash2, seed, x, z) {
  const lx = mod(x, ROOM);
  const lz = mod(z, ROOM);
  if (lx === 0 && lz === 0) return true; // pillars at every corner
  const cx = Math.floor(x / ROOM);
  const cz = Math.floor(z / ROOM);
  const edge = (k) => hash2(cx * 31 + k, cz * 17 + k * 3, seed + 99);
  // A cell's west edge (lx = 0) and north edge (lz = 0): wall or not, and where its gap is.
  if (lx === 0) return edge(1) < 0.55 && Math.abs(lz - (2 + Math.floor(edge(2) * 3))) > 0;
  if (lz === 0) return edge(3) < 0.55 && Math.abs(lx - (2 + Math.floor(edge(4) * 3))) > 0;
  return false;
}

/** The middle of a backrooms cell, where the light panel goes. */
export const backroomsLight = (x, z) => mod(x, ROOM) === 3 && mod(z, ROOM) === 3;
