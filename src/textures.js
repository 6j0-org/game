// Procedurally painted 16x16 pixel tiles in one horizontal atlas canvas,
// plus isometric block icons drawn from that atlas.

import { TILE, TILE_COUNT, BLOCKS, CROPS, cropTile } from './blocks.js';
import { mulberry32 } from './noise.js';

const S = 16;

export function createAtlasCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = S * TILE_COUNT;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, S);
  const rand = mulberry32(20261106);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

  const px = (tile, x, y, rgb, k = 1, a = 255) => {
    const i = (y * canvas.width + tile * S + x) * 4;
    img.data[i] = clamp(rgb[0] * k);
    img.data[i + 1] = clamp(rgb[1] * k);
    img.data[i + 2] = clamp(rgb[2] * k);
    img.data[i + 3] = a;
  };
  const jitter = (v) => 1 + (rand() - 0.5) * 2 * v;
  const paint = (tile, fn) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x, y);
  };

  const C = {
    grass: [104, 172, 76],
    dirt: [134, 92, 62],
    stone: [132, 138, 148],
    sand: [226, 208, 152],
    bark: [104, 72, 44],
    ringLight: [184, 146, 92],
    ringDark: [150, 112, 68],
    leaves: [58, 136, 64],
    planks: [188, 142, 86],
    glass: [214, 238, 250],
    brick: [170, 84, 62],
    mortar: [206, 198, 184],
    water: [54, 108, 214],
  };

  paint(TILE.GRASS_TOP, (x, y) => px(TILE.GRASS_TOP, x, y, C.grass, jitter(0.16)));
  paint(TILE.DIRT, (x, y) => px(TILE.DIRT, x, y, C.dirt, jitter(0.18)));
  paint(TILE.GRASS_SIDE, (x, y) => {
    const grassy = y < 3 || (y === 3 && rand() < 0.55) || (y === 4 && rand() < 0.15);
    px(TILE.GRASS_SIDE, x, y, grassy ? C.grass : C.dirt, jitter(grassy ? 0.14 : 0.18));
  });
  paint(TILE.STONE, (x, y) => px(TILE.STONE, x, y, C.stone, jitter(0.08) * (rand() < 0.1 ? 0.78 : 1)));
  paint(TILE.SAND, (x, y) => px(TILE.SAND, x, y, C.sand, jitter(0.06)));
  paint(TILE.LOG_SIDE, (x, y) => px(TILE.LOG_SIDE, x, y, C.bark, jitter(0.1) * (x % 4 === 0 ? 0.72 : 1)));
  paint(TILE.LOG_TOP, (x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const col = d > 6.5 ? C.bark : Math.floor(d) % 2 ? C.ringDark : C.ringLight;
    px(TILE.LOG_TOP, x, y, col, jitter(0.06));
  });
  paint(TILE.LEAVES, (x, y) => px(TILE.LEAVES, x, y, C.leaves, jitter(0.25), rand() < 0.18 ? 0 : 255));
  paint(TILE.PLANKS, (x, y) => {
    const row = y >> 2;
    const seam = y % 4 === 3 || x === (row % 2 ? 3 : 11);
    px(TILE.PLANKS, x, y, C.planks, jitter(0.07) * (seam ? 0.7 : 1));
  });
  paint(TILE.GLASS, (x, y) => {
    const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
    const glint = (x + y === 6 || x + y === 7) && x > 1 && y > 1;
    if (edge) px(TILE.GLASS, x, y, C.glass, jitter(0.04));
    else if (glint) px(TILE.GLASS, x, y, [255, 255, 255]);
    else px(TILE.GLASS, x, y, C.glass, 1, 0);
  });
  paint(TILE.BRICK, (x, y) => {
    const offset = (y >> 2) % 2 ? 4 : 0;
    const mortar = y % 4 === 3 || (x + offset) % 8 === 7;
    px(TILE.BRICK, x, y, mortar ? C.mortar : C.brick, jitter(mortar ? 0.04 : 0.12));
  });
  paint(TILE.WATER, (x, y) => px(TILE.WATER, x, y, C.water, jitter(0.08)));
  // 3D printer: dark frame, light enclosure, orange nozzle over a half-printed cyan part.
  paint(TILE.PRINTER_SIDE, (x, y) => {
    const frame = x < 2 || x > 13 || y < 2 || y > 13;
    let col = frame ? [58, 61, 68] : [201, 204, 210];
    if (!frame && y === 4) col = [90, 94, 102]; // gantry rail
    if (x >= 7 && x <= 8 && y >= 4 && y <= 6) col = [255, 138, 61]; // nozzle
    if (y >= 9 && y <= 12 && x >= 5 && x <= 10 && !(y === 9 && (x === 5 || x === 10))) col = [64, 196, 214]; // the print
    if (!frame && y === 13) col = [40, 42, 46]; // bed
    if (x === 12 && y === 12) col = [120, 230, 120]; // status light
    px(TILE.PRINTER_SIDE, x, y, col, jitter(0.03));
  });
  // Wheat: golden stalks with plump heads on a transparent background (drawn as a crossed plant).
  paint(TILE.WHEAT, (x, y) => {
    const stalks = [1, 4, 7, 10, 13];
    const sway = (s) => s + (y < 6 ? (s % 2 ? 1 : 0) : 0);
    const onStalk = stalks.some((s) => x === sway(s));
    const head = stalks.some((s) => Math.abs(x - sway(s)) <= 1 && y >= 1 && y <= 6 && (x === sway(s) || y % 2 === 0));
    if (head) px(TILE.WHEAT, x, y, [222, 176, 72], jitter(0.12));
    else if (onStalk && y > 6) px(TILE.WHEAT, x, y, [176, 150, 62], jitter(0.1));
    else px(TILE.WHEAT, x, y, [0, 0, 0], 1, 0);
  });
  // Doors: planks in a darker frame; the top half has a little window, the bottom a handle.
  const doorPaint = (tile, top) => paint(tile, (x, y) => {
    const frame = x === 0 || x === 15 || (top ? y === 0 : y === 15);
    const window = top && x >= 4 && x <= 11 && y >= 3 && y <= 10;
    const mullion = window && (x === 7 || x === 8 || y === 6 || y === 7);
    const handle = !top && x >= 11 && x <= 12 && y >= 1 && y <= 2;
    let col = C.planks;
    if (frame) col = [120, 86, 48];
    if (window) col = mullion ? [120, 86, 48] : [168, 210, 230];
    if (handle) col = [60, 60, 66];
    const groove = !window && (x === 5 || x === 10);
    px(tile, x, y, col, jitter(window ? 0.03 : 0.06) * (groove ? 0.82 : 1));
  });
  doorPaint(TILE.DOOR_LOW, false);
  doorPaint(TILE.DOOR_HIGH, true);
  // Cold wallet: a frosty steel strongbox with a small screen, two buttons and frost in the corners.
  paint(TILE.COLD_SIDE, (x, y) => {
    const frame = x === 0 || x === 15 || y === 0 || y === 15;
    let col = frame ? [70, 86, 104] : [150, 172, 192];
    if (x >= 3 && x <= 12 && y >= 3 && y <= 7) col = (x === 3 || x === 12 || y === 3 || y === 7) ? [40, 48, 58] : [90, 220, 235]; // screen
    if (x >= 5 && x <= 10 && y === 5) col = [30, 120, 140]; // digits
    if ((x === 5 || x === 10) && y >= 10 && y <= 11) col = [40, 48, 58]; // buttons
    if (x >= 6 && x <= 9 && y === 13) col = [40, 48, 58]; // port
    const frost = (x + y < 4) || (15 - x + y < 4) || (x + 15 - y < 4) || (30 - x - y < 4);
    if (frost && !frame) col = [225, 240, 250];
    px(TILE.COLD_SIDE, x, y, col, jitter(0.04));
  });
  paint(TILE.COLD_TOP, (x, y) => {
    const frame = x === 0 || x === 15 || y === 0 || y === 15;
    const flake = (x === 7 || x === 8) && y >= 4 && y <= 11 || (y === 7 || y === 8) && x >= 4 && x <= 11 || (Math.abs(x - 7.5) === Math.abs(y - 7.5) && x >= 5 && x <= 10);
    px(TILE.COLD_TOP, x, y, frame ? [70, 86, 104] : flake ? [235, 245, 252] : [160, 182, 200], jitter(0.04));
  });
  // Bed: a patchwork quilt on top; a wooden frame under a quilt edge on the sides; a plain pillow.
  paint(TILE.BED_TOP, (x, y) => {
    const patch = ((x >> 2) + (y >> 2)) % 3;
    const col = [[196, 70, 82], [232, 196, 120], [70, 122, 168]][patch];
    const seam = x % 4 === 0 || y % 4 === 0;
    px(TILE.BED_TOP, x, y, seam ? [240, 232, 214] : col, jitter(0.06));
  });
  paint(TILE.BED_SIDE, (x, y) => {
    const quilt = y < 9;
    const col = quilt ? (((x >> 2) % 3 === 0) ? [196, 70, 82] : ((x >> 2) % 3 === 1) ? [232, 196, 120] : [70, 122, 168]) : (y === 9 || y === 15 ? [104, 72, 40] : C.planks);
    px(TILE.BED_SIDE, x, y, col, jitter(quilt ? 0.06 : 0.08));
  });
  paint(TILE.PILLOW, (x, y) => px(TILE.PILLOW, x, y, (x + y) % 7 === 0 ? [222, 222, 232] : [244, 244, 250], jitter(0.03)));
  // Trapdoor: a planked hatch with iron straps and a ring pull.
  paint(TILE.TRAPDOOR, (x, y) => {
    const frame = x === 0 || x === 15 || y === 0 || y === 15;
    const strap = (y === 3 || y === 12) && x >= 1 && x <= 9;
    const ring = Math.abs(Math.hypot(x - 12, y - 7.5) - 1.6) < 0.7;
    let col = frame ? [104, 72, 40] : C.planks;
    if (strap || ring) col = [70, 72, 78];
    px(TILE.TRAPDOOR, x, y, col, jitter(0.07) * (!frame && x % 4 === 0 ? 0.85 : 1));
  });
  // Ladder: two rails and rungs, transparent in between.
  paint(TILE.LADDER, (x, y) => {
    const rail = x === 2 || x === 3 || x === 12 || x === 13;
    const rung = (y % 4 === 1 || y % 4 === 2) && x > 3 && x < 12;
    if (rail || rung) px(TILE.LADDER, x, y, rail ? [120, 86, 48] : [168, 124, 76], jitter(0.08));
    else px(TILE.LADDER, x, y, [0, 0, 0], 1, 0);
  });
  // ---------- biome blocks ----------
  const T = TILE;
  paint(T.SNOW_TOP, (x, y) => px(T.SNOW_TOP, x, y, [238, 244, 250], jitter(0.04) * (rand() < 0.06 ? 0.92 : 1)));
  paint(T.SNOW_SIDE, (x, y) => {
    const snowy = y < 3 || (y === 3 && rand() < 0.6) || (y === 4 && rand() < 0.2);
    px(T.SNOW_SIDE, x, y, snowy ? [238, 244, 250] : C.dirt, jitter(snowy ? 0.04 : 0.18));
  });
  paint(T.SANDSTONE_TOP, (x, y) => px(T.SANDSTONE_TOP, x, y, [222, 196, 132], jitter(0.05)));
  paint(T.SANDSTONE_SIDE, (x, y) => px(T.SANDSTONE_SIDE, x, y, [214, 186, 122], jitter(0.04) * (y % 5 === 4 ? 0.82 : 1)));
  paint(T.CACTUS_TOP, (x, y) => {
    const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) > 5.5;
    px(T.CACTUS_TOP, x, y, ring ? [64, 128, 56] : [118, 176, 88], jitter(0.06));
  });
  paint(T.CACTUS_SIDE, (x, y) => {
    const rib = x % 4 === 1;
    const spine = x % 4 === 3 && y % 4 === 1;
    px(T.CACTUS_SIDE, x, y, spine ? [236, 230, 196] : rib ? [56, 120, 52] : [82, 150, 70], jitter(0.06));
  });
  paint(T.SPRUCE_LOG_SIDE, (x, y) => px(T.SPRUCE_LOG_SIDE, x, y, [74, 52, 34], jitter(0.1) * (x % 3 === 0 ? 0.75 : 1)));
  paint(T.SPRUCE_LOG_TOP, (x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    px(T.SPRUCE_LOG_TOP, x, y, d > 6.5 ? [74, 52, 34] : Math.floor(d) % 2 ? [128, 96, 60] : [156, 120, 78], jitter(0.06));
  });
  paint(T.SPRUCE_LEAVES, (x, y) => px(T.SPRUCE_LEAVES, x, y, [38, 92, 62], jitter(0.22), rand() < 0.14 ? 0 : 255));
  paint(T.JUNGLE_LOG_SIDE, (x, y) => px(T.JUNGLE_LOG_SIDE, x, y, (y + (x >> 2)) % 6 === 0 ? [104, 92, 52] : [124, 104, 60], jitter(0.08)));
  paint(T.JUNGLE_LOG_TOP, (x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    px(T.JUNGLE_LOG_TOP, x, y, d > 6.5 ? [124, 104, 60] : Math.floor(d) % 2 ? [176, 128, 84] : [198, 150, 100], jitter(0.06));
  });
  paint(T.JUNGLE_LEAVES, (x, y) => px(T.JUNGLE_LEAVES, x, y, rand() < 0.1 ? [96, 172, 60] : [40, 140, 48], jitter(0.2), rand() < 0.12 ? 0 : 255));
  paint(T.MUD, (x, y) => px(T.MUD, x, y, [84, 64, 48], jitter(0.14) * (rand() < 0.08 ? 1.25 : 1)));
  paint(T.ICE, (x, y) => {
    const crack = (x * 3 + y * 5) % 17 === 0 || (x === y + 3);
    px(T.ICE, x, y, crack ? [228, 244, 255] : [160, 204, 240], jitter(0.04));
  });
  paint(T.CONCRETE, (x, y) => px(T.CONCRETE, x, y, [168, 170, 172], jitter(0.06) * (rand() < 0.05 ? 0.85 : 1)));
  paint(T.ASPHALT, (x, y) => px(T.ASPHALT, x, y, [58, 60, 64], jitter(0.12)));
  paint(T.WINDOW, (x, y) => {
    const frame = x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || x === 8;
    const glint = (x + y === 5 || x + y === 6) && x < 7;
    if (frame) px(T.WINDOW, x, y, [92, 96, 104], jitter(0.04));
    else px(T.WINDOW, x, y, glint ? [236, 246, 255] : [120, 170, 210], 1, glint ? 255 : 150);
  });
  paint(T.RUBBLE, (x, y) => {
    const chunk = ((x >> 2) * 7 + (y >> 2) * 3) % 4;
    px(T.RUBBLE, x, y, [[150, 150, 148], [120, 118, 112], [176, 172, 160], [96, 94, 90]][chunk], jitter(0.1) * (x % 4 === 0 || y % 4 === 0 ? 0.7 : 1));
  });
  paint(T.BRIMSTONE, (x, y) => px(T.BRIMSTONE, x, y, rand() < 0.1 ? [170, 54, 30] : [110, 30, 26], jitter(0.16)));
  paint(T.LAVA, (x, y) => {
    const swirl = Math.sin(x * 0.8 + y * 0.5) + Math.sin(y * 0.9 - x * 0.3);
    px(T.LAVA, x, y, swirl > 0.8 ? [255, 214, 92] : swirl > -0.2 ? [255, 140, 34] : [214, 70, 20], jitter(0.06));
  });
  paint(T.WALLPAPER, (x, y) => {
    const stripe = x % 4 === 0;
    const motif = (x % 4 === 2) && (y % 6 === 2);
    px(T.WALLPAPER, x, y, motif ? [176, 156, 74] : stripe ? [204, 186, 96] : [222, 206, 118], jitter(0.04));
  });
  paint(T.CARPET, (x, y) => px(T.CARPET, x, y, rand() < 0.06 ? [150, 134, 88] : [186, 170, 112], jitter(0.08)));
  paint(T.CEILING_TILE, (x, y) => {
    const grid = x === 0 || y === 0;
    const pit = rand() < 0.12;
    px(T.CEILING_TILE, x, y, grid ? [170, 168, 150] : [224, 220, 200], jitter(0.03) * (pit ? 0.9 : 1));
  });
  paint(T.FLUORESCENT, (x, y) => {
    const frame = x === 0 || y === 0 || x === 15 || y === 15;
    const tube = (x >= 3 && x <= 5) || (x >= 10 && x <= 12);
    px(T.FLUORESCENT, x, y, frame ? [190, 188, 170] : tube ? [255, 255, 236] : [236, 236, 214], 1);
  });
  paint(T.BALLS, (x, y) => {
    // Overlapping round balls in bright primaries.
    const cols = [[232, 60, 60], [58, 132, 232], [250, 206, 50], [70, 190, 90], [236, 110, 200]];
    const bx = Math.floor(x / 5);
    const by = Math.floor(y / 5);
    const cx = bx * 5 + 2.5;
    const cy = by * 5 + 2.5;
    const inBall = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 2.6;
    const col = cols[(bx * 3 + by * 2) % cols.length];
    const shine = inBall && x + 0.5 - cx < -0.8 && y + 0.5 - cy < -0.8;
    px(T.BALLS, x, y, inBall ? (shine ? [255, 255, 255] : col) : [60, 40, 70], jitter(0.05));
  });
  paint(T.FOAM, (x, y) => {
    const cols = [[226, 64, 64], [56, 120, 220], [250, 200, 48], [64, 176, 88]];
    const seam = x % 8 === 0 || y % 8 === 0;
    px(T.FOAM, x, y, seam ? [240, 240, 236] : cols[((x >> 3) + (y >> 3) * 2) % 4], jitter(0.04));
  });
  paint(TILE.PRINTER_TOP, (x, y) => {
    const frame = x < 1 || x > 14 || y < 1 || y > 14;
    const grid = x % 4 === 0 || y % 4 === 0;
    const col = frame ? [58, 61, 68] : grid ? [70, 74, 80] : [96, 100, 108];
    px(TILE.PRINTER_TOP, x, y, (x === 2 && y === 2) ? [255, 138, 61] : col, jitter(0.03));
  });

  // ---------- fantasy town ----------
  paint(TILE.COBBLE, (x, y) => { // rounded stones in mortar, offset every other row
    const row = Math.floor(y / 4);
    const cx = (x + (row % 2) * 3) % 6;
    const seam = y % 4 === 3 || cx === 5;
    const shade = 0.85 + ((row * 7 + Math.floor((x + (row % 2) * 3) / 6) * 3) % 5) * 0.06;
    px(TILE.COBBLE, x, y, seam ? [92, 88, 82] : [150, 146, 138], seam ? jitter(0.06) : shade * jitter(0.07));
  });
  paint(TILE.PLASTER, (x, y) => px(TILE.PLASTER, x, y, [232, 222, 196], jitter(0.035) * (rand() < 0.04 ? 0.9 : 1)));
  paint(TILE.SHINGLES, (x, y) => { // overlapping slate-red shingles
    const row = Math.floor(y / 4);
    const edge = y % 4 === 3 || (x + row * 2) % 5 === 0;
    px(TILE.SHINGLES, x, y, [156, 62, 48], (edge ? 0.68 : 1) * jitter(0.07) * (1 - (y % 4) * 0.04));
  });
  const counterWood = [122, 84, 50];
  paint(TILE.COUNTER_TOP, (x, y) => px(TILE.COUNTER_TOP, x, y, counterWood, jitter(0.06) * (y % 4 === 0 ? 0.8 : 1.05)));
  // Counter fronts: a wooden panel with the shop's sign painted in the middle.
  const SIGNS = {
    [TILE.COUNTER_SMITH]: [[[70, 72, 78], 4, 6, 9, 2], [[70, 72, 78], 6, 8, 4, 2], [[70, 72, 78], 5, 10, 6, 1], [[70, 72, 78], 3, 6, 2, 1], [[255, 140, 50], 11, 4, 1, 1]], // anvil and a spark
    [TILE.COUNTER_HEALER]: [[[200, 230, 240], 7, 3, 2, 2], [[200, 230, 240], 5, 5, 6, 6], [[220, 40, 60], 6, 7, 4, 3], [[255, 120, 140], 7, 7, 1, 1]], // a red potion
    [TILE.COUNTER_TAVERN]: [[[214, 170, 70], 4, 5, 6, 7], [[246, 240, 220], 4, 4, 6, 2], [[150, 110, 50], 10, 6, 2, 4], [[150, 110, 50], 4, 11, 6, 1]], // a frothy tankard
    [TILE.COUNTER_FLETCHER]: [[[90, 60, 30], 4, 3, 1, 10], [[90, 60, 30], 5, 2, 1, 1], [[90, 60, 30], 5, 13, 1, 1], [[230, 230, 220], 6, 3, 1, 10], [[180, 180, 190], 6, 7, 6, 1], [[220, 60, 50], 11, 6, 1, 3]], // a bow and arrow
    [TILE.COUNTER_WIZARD]: [[[255, 220, 90], 7, 3, 2, 10], [[255, 220, 90], 3, 7, 10, 2], [[255, 220, 90], 5, 5, 6, 6], [[180, 120, 255], 7, 7, 2, 2]], // a golden star
  };
  for (const [tile, rects] of Object.entries(SIGNS)) {
    const t = Number(tile);
    paint(t, (x, y) => {
      const frame = x === 0 || x === 15 || y === 0 || y === 15;
      const panel = x >= 2 && x <= 13 && y >= 2 && y <= 13;
      px(t, x, y, frame ? [84, 56, 32] : panel ? [70, 48, 30] : counterWood, jitter(0.05));
    });
    for (const [col, rx, ry, w, h] of rects) for (let y = ry; y < ry + h; y++) for (let x = rx; x < rx + w; x++) px(t, x, y, col, jitter(0.04));
  }

  // ---------- gardening ----------
  // Tilled dirt: furrowed rows, darker when watered, with weeds coming up (levels 0-3) between the rows.
  for (let wet = 0; wet < 2; wet++) {
    for (let w = -1; w <= 3; w++) {
      const t = TILE.SOIL_TOP + wet * 5 + w + 1;
      const base = wet ? [82, 56, 40] : [122, 86, 58];
      paint(t, (x, y) => {
        const ridge = y % 4 === 0 || y % 4 === 1; // raised rows and the furrows between them
        px(t, x, y, base, (ridge ? 1.12 : 0.82) * jitter(0.1) * (wet && rand() < 0.08 ? 0.8 : 1));
      });
      if (w < 0) continue;
      const n = [5, 10, 18, 30][w]; // weed tufts, more and bigger with each level
      for (let i = 0; i < n; i++) {
        const cx = Math.floor(rand() * 16);
        const cy = Math.floor(rand() * 16);
        const size = w >= 2 && rand() < 0.5 ? 2 : 1;
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
          if (cx + dx < 16 && cy + dy < 16) px(t, cx + dx, cy + dy, w === 3 && rand() < 0.2 ? [200, 190, 60] : [70, 140, 50], jitter(0.18));
        }
      }
    }
  }
  // Crops: four stages each (sprout, young, growing, ripe), drawn on transparent tiles as crossed plants.
  const CROP_STYLE = {
    garlic: { leaf: [96, 150, 70], kind: 'bulb', fruit: [236, 230, 210] },
    thyme: { leaf: [96, 128, 84], kind: 'bush', fruit: [170, 120, 200] },
    okra: { leaf: [70, 140, 60], kind: 'tall', fruit: [120, 180, 70], flower: [240, 220, 110] },
    artichoke: { leaf: [118, 150, 120], kind: 'spiky', fruit: [110, 140, 90], tint: [140, 90, 140] },
    cabbage: { leaf: [96, 160, 90], kind: 'head', fruit: [176, 214, 150] },
    carrot: { leaf: [80, 160, 60], kind: 'fern', fruit: [236, 130, 40] },
    onion: { leaf: [100, 160, 120], kind: 'bulb', fruit: [170, 70, 90] },
    potato: { leaf: [74, 136, 60], kind: 'bush', fruit: [240, 240, 230], centre: [240, 200, 60] },
    pinto: { leaf: [86, 150, 70], kind: 'vine', fruit: [214, 186, 140], speck: [150, 90, 60] },
    pea: { leaf: [100, 176, 80], kind: 'vine', fruit: [130, 200, 90] },
    soy: { leaf: [96, 140, 70], kind: 'bush', fruit: [176, 170, 100] },
    chives: { leaf: [70, 150, 70], kind: 'fern', fruit: [190, 130, 210] }, // (ripe: purple flower tops)
    corn: { leaf: [96, 160, 70], kind: 'tall', fruit: [240, 206, 70], flower: [220, 200, 140] },
    jalapeno: { leaf: [64, 130, 56], kind: 'bush', fruit: [52, 120, 40], centre: [200, 60, 40] },
    garbanzo: { leaf: [110, 150, 80], kind: 'vine', fruit: [222, 196, 130] },
    olive: { leaf: [120, 140, 100], kind: 'bush', fruit: [70, 90, 40], centre: [80, 50, 80] },
  };
  CROPS.forEach((key, ci) => {
    const st = CROP_STYLE[key];
    for (let stage = 0; stage < 4; stage++) {
      const t = cropTile(ci, stage);
      paint(t, (x, y) => px(t, x, y, [0, 0, 0], 1, 0)); // transparent
      const set = (x, y, col, j = 0.12) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) px(t, x, y, col, jitter(j)); };
      const top = 15 - [3, 6, 10, 14][stage]; // how tall it is
      const leaf = st.leaf;
      if (stage === 0) { // a sprout: two little leaves
        set(7, 15, leaf); set(7, 14, leaf); set(6, 13, leaf); set(8, 13, leaf); set(5, 12, leaf); set(9, 12, leaf);
        continue;
      }
      switch (st.kind) {
        case 'bulb': // tall thin leaves; ripe: a bulb at the base
          for (const [x0, lean] of [[5, -1], [7, 0], [8, 0], [10, 1]]) {
            for (let y = 15; y >= top; y--) set(x0 + (y < top + 4 ? lean : 0), y, leaf);
          }
          if (stage === 3) for (let y = 12; y <= 15; y++) for (let x = 5; x <= 10; x++) if (Math.hypot(x - 7.5, y - 13.5) < 2.8) set(x, y, st.fruit);
          break;
        case 'bush': // a mound of small leaves; ripe: flowers or pods dotted over it
          for (let y = top; y <= 15; y++) {
            const half = Math.round(((y - top + 1) / (16 - top)) * 6) + 1;
            for (let x = 8 - half; x <= 7 + half; x++) if (rand() < 0.75) set(x, y, leaf, 0.2);
          }
          if (stage === 3) for (let i = 0; i < 9; i++) {
            const x = 3 + Math.floor(rand() * 10); const y = top + Math.floor(rand() * (14 - top));
            set(x, y, st.fruit, 0.08); if (st.centre && rand() < 0.5) set(x, y, st.centre, 0.05);
          }
          break;
        case 'tall': // one stem with broad leaves; ripe: pods pointing up and a flower
          for (let y = top; y <= 15; y++) set(7, y, [90, 130, 60]);
          for (let y = top + 2; y <= 14; y += 3) { const s = (y % 2) ? 1 : -1; for (let i = 1; i <= 4; i++) { set(7 + s * i, y - (i > 2 ? 1 : 0), leaf); set(7 + s * i, y + 1 - (i > 2 ? 1 : 0), leaf); } }
          if (stage === 3) { for (const x of [5, 9]) for (let y = top + 1; y <= top + 4; y++) set(x, y, st.fruit); set(7, top - 1, st.flower); set(6, top, st.flower); set(8, top, st.flower); }
          break;
        case 'spiky': // a rosette of jagged leaves; ripe: a fat bud on top
          for (let i = 0; i < 7; i++) {
            const a = -Math.PI * (0.1 + 0.8 * (i / 6));
            for (let r = 0; r < 8 * (16 - top) / 14; r++) set(Math.round(7.5 + Math.cos(a) * r), Math.round(15 + Math.sin(a) * r), leaf, 0.15);
          }
          if (stage === 3) for (let y = top; y <= top + 4; y++) for (let x = 5; x <= 10; x++) if (Math.hypot(x - 7.5, y - (top + 2)) < 2.8) set(x, y, (x + y) % 3 ? st.fruit : st.tint);
          break;
        case 'head': // round leaves low down; ripe: a big pale head in the middle
          for (let y = Math.max(top, 8); y <= 15; y++) for (let x = 1; x <= 14; x++) if (Math.hypot(x - 7.5, (y - 15) * 1.4) < (16 - top) * 0.55 && rand() < 0.85) set(x, y, leaf, 0.15);
          if (stage === 3) for (let y = 8; y <= 15; y++) for (let x = 3; x <= 12; x++) if (Math.hypot(x - 7.5, y - 12) < 4.2) set(x, y, Math.hypot(x - 7.5, y - 12) > 3.4 ? leaf : st.fruit, 0.08);
          break;
        case 'fern': // feathery fronds; ripe: the orange top of the root shows
          for (const x0 of [4, 6, 8, 10]) for (let y = 15; y >= top; y--) { set(x0 + ((y - top) % 3 === 0 ? 1 : 0), y, leaf); if (y % 2 === 0) set(x0 - 1, y, leaf); }
          if (stage === 3) for (let x = 5; x <= 10; x++) { set(x, 15, st.fruit); if (x > 5 && x < 10) set(x, 14, st.fruit); }
          break;
        case 'vine': // climbs a little stake; ripe: pods hanging off it
          if (stage >= 2) for (let y = top; y <= 15; y++) set(8, y, [140, 104, 64], 0.06);
          for (let y = top; y <= 15; y++) { const s = (y % 4 < 2) ? -1 : 1; set(8 + s, y, leaf); if (y % 3 === 0) { set(8 + s * 2, y, leaf); set(8 + s * 3, y - 1, leaf); } }
          if (stage === 3) for (const [x, y0] of [[5, top + 3], [11, top + 5], [6, top + 8], [10, top + 10]]) {
            for (let y = y0; y < y0 + 4 && y <= 15; y++) set(x, y, st.speck && (y % 2) ? st.speck : st.fruit, 0.06);
          }
          break;
        default:
      }
    }
  });

  // ---------- the kitchen (cooking.js) ----------
  paint(TILE.RANGE_TOP, (x, y) => { // four burners on dark enamel
    const burner = [[4, 4], [11, 4], [4, 11], [11, 11]].some(([cx, cy]) => { const d = Math.hypot(x - cx, y - cy); return d < 3 && d > 1.4; });
    px(TILE.RANGE_TOP, x, y, burner ? [40, 40, 44] : (x === 0 || y === 0 || x === 15 || y === 15) ? [150, 154, 160] : [210, 210, 206], jitter(0.03));
  });
  paint(TILE.RANGE_SIDE, (x, y) => { // knobs along the top, an oven door with a window and a handle
    const knob = y === 2 && x % 4 === 2;
    const door = x >= 2 && x <= 13 && y >= 5 && y <= 14;
    const win = x >= 4 && x <= 11 && y >= 8 && y <= 12;
    const handle = y === 6 && x >= 4 && x <= 11;
    px(TILE.RANGE_SIDE, x, y, knob ? [30, 30, 30] : handle ? [170, 174, 180] : win ? [40, 30, 24] : door ? [196, 196, 192] : [220, 220, 216], jitter(0.03));
  });
  paint(TILE.CAMPFIRE, (x, y) => { // flames: yellow at the heart, orange, then red at the tips (transparent above)
    const h = 15 - y;
    const edge = Math.abs(x - 7.5) + (h > 6 ? (h - 6) * 0.9 : 0) + Math.sin(x * 1.7) * 1.2;
    if (edge > 6.5) { px(TILE.CAMPFIRE, x, y, [0, 0, 0], 1, 0); return; }
    px(TILE.CAMPFIRE, x, y, edge < 2.5 && h < 9 ? [255, 236, 120] : edge < 4.5 ? [255, 150, 40] : [220, 70, 30], jitter(0.06));
  });
  paint(TILE.SINK_TOP, (x, y) => { // a steel basin with a drain
    const rim = x < 2 || x > 13 || y < 2 || y > 13;
    const drain = Math.hypot(x - 7.5, y - 7.5) < 1.3;
    px(TILE.SINK_TOP, x, y, drain ? [40, 44, 48] : rim ? [196, 200, 206] : [150, 160, 170], jitter(0.04));
  });
  paint(TILE.SINK_SIDE, (x, y) => { // a white cabinet with two doors
    const seam = x === 7 || x === 8 || x === 0 || x === 15 || y === 15;
    const knob = (x === 5 || x === 10) && y === 6;
    px(TILE.SINK_SIDE, x, y, knob ? [120, 120, 120] : seam ? [180, 176, 166] : [236, 232, 222], jitter(0.03));
  });
  paint(TILE.PRESS_TOP, (x, y) => { // a wooden tub full of olives, a screw in the middle
    const d = Math.hypot(x - 7.5, y - 7.5);
    px(TILE.PRESS_TOP, x, y, d < 1.6 ? [90, 90, 96] : d < 6.5 ? ((x * 3 + y * 5) % 4 ? [80, 96, 46] : [60, 40, 60]) : [130, 92, 56], jitter(0.06));
  });
  paint(TILE.PRESS_SIDE, (x, y) => { // staves and iron hoops
    const hoop = y === 3 || y === 12;
    px(TILE.PRESS_SIDE, x, y, hoop ? [70, 70, 76] : x % 4 === 0 ? [110, 76, 46] : [140, 100, 60], jitter(0.06));
  });

  // ---------- pottery ----------
  // Raw clay: smooth and a little damp-looking. Fired pieces: the same clays, warmer, with a glaze pattern.
  const CLAY_COL = [[226, 222, 210], [146, 100, 66], [176, 86, 58]];
  CLAY_COL.forEach((col, c) => paint(TILE.CLAY + c, (x, y) => px(TILE.CLAY + c, x, y, col, jitter(0.05) * (rand() < 0.06 ? 0.9 : 1) * (1 - ((x * 3 + y * 5) % 7 === 0 ? 0.05 : 0)))));
  const FIRED = [[240, 234, 222], [160, 106, 66], [196, 98, 64]];
  const GLAZE_COL = [null, [44, 84, 196], [56, 168, 112], [236, 156, 40]];
  for (let c = 0; c < 3; c++) {
    for (let g = 0; g < 4; g++) {
      const t = TILE.POTTERY + c * 4 + g;
      paint(t, (x, y) => {
        let col = FIRED[c];
        let k = jitter(g ? 0.025 : 0.06); // glazed pieces are glossier (less grain)
        if (g === 1 && (y % 6 === 1 || y % 6 === 2)) col = GLAZE_COL[1]; // bands all the way round
        if (g === 1 && y % 6 === 3) col = [120, 150, 220];
        if (g === 2 && ((x * 7 + y * 13) % 11 === 0 || (x * 5 + y * 3) % 17 === 0)) col = GLAZE_COL[2]; // speckles
        if (g === 3) { const zig = 4 + Math.abs(((x % 8) - 4)); if (y % 8 === zig % 8 || y % 8 === (zig + 1) % 8) col = GLAZE_COL[3]; } // a zigzag
        if (g && (x + y) % 9 === 0 && y % 4 === 0) k *= 1.12; // a glint
        px(t, x, y, col, k);
      });
    }
  }
  const wood = [150, 108, 66];
  paint(TILE.WHEEL_TOP, (x, y) => { // a wooden frame round a grey spinning wheel, a lump of clay in the middle
    const d = Math.hypot(x - 7.5, y - 7.5);
    const col = d < 2.2 ? [176, 120, 82] : d < 6.4 ? ((Math.floor(d * 2) % 3) ? [128, 130, 136] : [104, 106, 112]) : wood;
    px(TILE.WHEEL_TOP, x, y, col, jitter(0.05));
  });
  paint(TILE.WHEEL_SIDE, (x, y) => { // a wooden stand with the kick wheel showing through the middle
    const frame = x < 2 || x > 13 || y < 2 || y > 13;
    const kick = y >= 10 && y <= 12 && x >= 3 && x <= 12;
    px(TILE.WHEEL_SIDE, x, y, kick ? [92, 92, 98] : frame ? wood : [70, 48, 30], jitter(0.06) * (!frame && !kick && x % 3 === 0 ? 0.85 : 1));
  });
  paint(TILE.KILN_SIDE, (x, y) => { // firebrick, with a glowing arched door
    const row = Math.floor(y / 3);
    const mortar = y % 3 === 2 || (x + (row % 2) * 3) % 6 === 5;
    const door = x >= 4 && x <= 11 && y >= 6 && y <= 13 && Math.hypot(x - 7.5, Math.max(0, 8 - y)) < 4.2;
    const fire = door && y >= 9;
    px(TILE.KILN_SIDE, x, y, fire ? (rand() < 0.5 ? [255, 150, 40] : [230, 90, 30]) : door ? [40, 28, 24] : mortar ? [120, 104, 92] : [184, 116, 78], jitter(0.06));
  });
  paint(TILE.KILN_TOP, (x, y) => { // firebrick round a chimney hole
    const hole = Math.hypot(x - 7.5, y - 7.5) < 3;
    const mortar = y % 3 === 2 || (x + (Math.floor(y / 3) % 2) * 3) % 6 === 5;
    px(TILE.KILN_TOP, x, y, hole ? [30, 24, 22] : mortar ? [120, 104, 92] : [176, 110, 74], jitter(0.06));
  });
  paint(TILE.GLAZE_TOP, (x, y) => { // a worn table with three pots of glaze and a brush
    let col = (y % 4 === 0) ? [136, 98, 60] : wood;
    for (const [cx, cy, g] of [[4, 4, 1], [11, 4, 2], [5, 11, 3]]) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < 2.6) col = d < 1.8 ? GLAZE_COL[g] : [210, 206, 196];
    }
    if (x - y === 1 && x >= 9 && x <= 14) col = [90, 60, 36]; // the brush handle
    if (x >= 8 && x <= 9 && y >= 7 && y <= 8) col = GLAZE_COL[1];
    px(TILE.GLAZE_TOP, x, y, col, jitter(0.05));
  });
  paint(TILE.GLAZE_SIDE, (x, y) => { // a tabletop edge on four legs, glaze drips down the front
    const top = y < 3;
    const leg = x < 2 || x > 13;
    const drip = top || (y < 6 && [4, 9, 12].includes(x) && y < 3 + ((x * 3) % 4));
    px(TILE.GLAZE_SIDE, x, y, drip && !top ? GLAZE_COL[1 + (x % 3)] : top || leg ? wood : [38, 30, 26], jitter(0.06));
  });

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Draws an isometric cube icon for a block onto a 48x48 canvas. */
export function drawBlockIcon(atlas, blockId, size = 48) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const k = size / 48;
  const def = BLOCKS[blockId];
  const face = (tile, m, shade) => {
    ctx.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    ctx.drawImage(atlas, tile * S, 0, S, S, 0, 0, S, S);
    if (shade) {
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillRect(0, 0, S, S);
      ctx.globalCompositeOperation = 'source-over';
    }
  };
  face(def.top, [1.25, 0.625, -1.25, 0.625, 24, 4], 0);
  face(def.side, [1.25, 0.625, 0, 1.375, 4, 14], 0.2);
  face(def.side, [1.25, -0.625, 0, 1.375, 24, 24], 0.38);
  return canvas;
}
