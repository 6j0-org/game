// Block IDs, texture tiles, and per-block flags. No Three.js dependency.
import { T, tune, TUNABLES } from './tuning.js';

/** Block ids are 16-bit (chunks are Uint16Arrays): flag tables are this long. */
export const MAX_BLOCK_IDS = 1024;
export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const LOG = 5;
export const LEAVES = 6;
export const PLANKS = 7;
export const GLASS = 8;
export const BRICK = 9;
export const WATER = 10;
export const PRINTER = 11;
export const WHEAT = 12;
export const LAVA_LAMP = 13;
// Shaped blocks come in variants, one id per orientation/state (the world stores one byte per block).
export const STAIRS_PLANKS = 14; // ..17: facing north, east, south, west
export const STAIRS_STONE = 18; // ..21
export const SLAB_PLANKS = 22;
export const SLAB_STONE = 23;
export const DOOR = 24; // ..39: DOOR + facing * 4 + open * 2 + top
export const COLD_WALLET = 40;
export const BED = 41; // ..44: a bed's head (pillow) half, facing north, east, south, west (the pillow end is the far side)
export const FENCE = 45; // joins up with neighbouring fences and solid blocks (see shapeBoxes)
export const TRAPDOOR = 46; // ..53: TRAPDOOR + facing * 2 + open
export const LADDER = 54; // ..57: the wall it hangs on is north, east, south, west
// Biome blocks
export const SNOW_GRASS = 58;
export const SANDSTONE = 59;
export const CACTUS = 60;
export const SPRUCE_LOG = 61;
export const SPRUCE_LEAVES = 62;
export const JUNGLE_LOG = 63;
export const JUNGLE_LEAVES = 64;
export const MUD = 65;
export const ICE = 66;
export const CONCRETE = 67;
export const ASPHALT = 68;
export const WINDOW = 69;
export const RUBBLE = 70;
export const BRIMSTONE = 71;
export const LAVA = 72; // a fluid: you swim in it, and it burns
export const WALLPAPER = 73;
export const CARPET = 74;
export const CEILING_TILE = 75;
export const FLUORESCENT = 76; // glows, and lights its surroundings
export const BALLS = 77; // ball-pit balls: a fluid you wade and swim through
export const FOAM = 78;
export const BED_FOOT = 79; // ..82: a bed's foot half; the head is one block further in its facing
// Fantasy town
export const COBBLE = 83;
export const PLASTER = 84;
export const SHINGLES = 85;
export const SHOP_COUNTER = 86; // ..90: one per shop, in SHOP_ORDER (blacksmith, healer, tavern, fletcher, wizard); right-click to buy
export const SHOP_ORDER = ['blacksmith', 'healer', 'tavern', 'fletcher', 'wizard'];
export const isShopCounter = (id) => id >= SHOP_COUNTER && id < SHOP_COUNTER + SHOP_ORDER.length;
/** Which shop a counter block belongs to ('blacksmith', ...), or null. */
export const shopOfBlock = (id) => (isShopCounter(id) ? SHOP_ORDER[id - SHOP_COUNTER] : null);
// Gardening (garden.js). The whole state of a garden lives in its block ids, so it's saved with the world.
export const SOIL = 91; // ..106: tilled dirt, SOIL + wet * 8 + weeds
// weeds: 0 none; 1-4 weed levels 0-3 (4, fully grown, halves a ripe plant's harvest); 5-7 also level 3 (from older saves)
export const CROP = 107; // ..150: CROP + crop * 4 + stage (0 is the seed you plant, 3 is ripe)
// The first 11 crops are ids 107-150; later ones are CROP2 + (crop - 11) * 4 + stage (ids from 256 up).
export const CROPS = ['garlic', 'thyme', 'okra', 'artichoke', 'cabbage', 'carrot', 'onion', 'potato', 'pinto', 'pea', 'soy', 'chives', 'corn', 'jalapeno', 'garbanzo', 'olive'];
export const CROP_NAMES = ['Garlic', 'Thyme', 'Okra', 'Artichoke', 'Cabbage', 'Carrot', 'Onion', 'Potato', 'Pinto Bean', 'Pea', 'Soybean', 'Chives', 'Corn', 'Jalapeño', 'Garbanzo Bean', 'Olive'];
// Pottery (pottery.js): clay to dig, three workstations, and the pieces you make. A piece is one id per
// object, clay and glaze (POTTERY + (object * 3 + clay) * 4 + glaze; glaze 0 is plain fired clay), and
// luminaries have a lit twin (LUMINARY_LIT + clay * 4 + glaze) that glows and lights the room.
export const WHITE_CLAY = 151;
export const BROWN_CLAY = 152;
export const RED_CLAY = 153;
export const CLAY_BLOCKS = [WHITE_CLAY, BROWN_CLAY, RED_CLAY];
export const POTTERY_WHEEL = 154;
export const KILN = 155;
export const GLAZING_TABLE = 156;
export const POTTERY = 157; // ..216
export const LUMINARY_LIT = 217; // ..228
/** A thin layer of snow that Icebolts and Blizzards leave on top of blocks. It melts (game.js `_snow`), you walk through it, and you can build over it. */
export const SNOW_LAYER = 229;
export const POT_OBJECTS = ['mug', 'vase', 'plate', 'bowl', 'luminary'];
export const POT_NAMES = ['Mug', 'Vase', 'Plate', 'Bowl', 'Luminary'];
export const CLAYS = ['white', 'brown', 'red'];
export const CLAY_NAMES = ['White Clay', 'Brown Clay', 'Red Clay'];
export const GLAZES = ['none', 'cobalt', 'jade', 'amber'];
export const GLAZE_NAMES = ['', 'Cobalt Stripes', 'Jade Speckle', 'Amber Zigzag'];
export const isPottery = (id) => id >= POTTERY && id < LUMINARY_LIT + 12;
export const isLuminary = (id) => (id >= POTTERY + 48 && id < POTTERY + 60) || (id >= LUMINARY_LIT && id < LUMINARY_LIT + 12);
export const isLitLuminary = (id) => id >= LUMINARY_LIT && id < LUMINARY_LIT + 12;
/** The block id of a piece: object, clay and glaze are indices into POT_OBJECTS, CLAYS and GLAZES. */
export const potteryId = (obj, clay, glaze = 0, lit = false) =>
  (lit && obj === 4 ? LUMINARY_LIT + clay * 4 + glaze : POTTERY + (obj * 3 + clay) * 4 + glaze);
/** What a pottery block is: { obj, clay, glaze, lit } (indices), or null. */
export function potteryInfo(id) {
  if (isLitLuminary(id)) return { obj: 4, clay: Math.floor((id - LUMINARY_LIT) / 4), glaze: (id - LUMINARY_LIT) % 4, lit: true };
  if (!isPottery(id)) return null;
  const v = id - POTTERY;
  return { obj: Math.floor(v / 12), clay: Math.floor(v / 4) % 3, glaze: v % 4, lit: false };
}
/** A piece's name: "Red Clay Vase (Bisque)" (fired, unglazed), "White Clay Mug (Cobalt Stripes)". */
export function potteryName(id) {
  const p = potteryInfo(id);
  return `${CLAY_NAMES[p.clay]} ${POT_NAMES[p.obj]} (${p.glaze ? GLAZE_NAMES[p.glaze] : 'Bisque'})`;
}

export const isSoil = (id) => id >= SOIL && id < SOIL + 16;
export const soilInfo = (id) => ({ wet: id - SOIL >= 8, weeds: (id - SOIL) % 8 });
export const soilId = (wet, weeds) => SOIL + (wet ? 8 : 0) + Math.max(0, Math.min(7, weeds));
/** The weed level you see (0-3), or -1 for no weeds. */
export const weedLevel = (weeds) => (weeds <= 0 ? -1 : Math.min(3, weeds - 1));
const FIRST_CROPS = 11; // (the crops that fit in ids 107-150)
export const CROP2 = 256; // ..: the rest of the crops
export const isCrop = (id) => (id >= CROP && id < CROP + FIRST_CROPS * 4) || (id >= CROP2 && id < CROP2 + (CROPS.length - FIRST_CROPS) * 4);
export const cropInfo = (id) => (id >= CROP2 ? { crop: FIRST_CROPS + Math.floor((id - CROP2) / 4), stage: (id - CROP2) % 4 } : { crop: Math.floor((id - CROP) / 4), stage: (id - CROP) % 4 });
export const cropId = (crop, stage) => (crop < FIRST_CROPS ? CROP + crop * 4 + stage : CROP2 + (crop - FIRST_CROPS) * 4 + stage);
/** Every crop block id (every crop, every stage). */
export const CROP_IDS = CROPS.flatMap((c, i) => [0, 1, 2, 3].map((st) => cropId(i, st)));
// Kitchen blocks (cooking.js): right-click to cook (the range and campfire) or press olives; the sink is water for washing dishes.
export const RANGE = 276;
export const CAMPFIRE = 277;
export const SINK = 278;
export const OLIVE_PRESS = 279;

// Tile indices into the horizontal texture atlas (see textures.js).
export const TILE = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG_SIDE: 5,
  LOG_TOP: 6,
  LEAVES: 7,
  PLANKS: 8,
  GLASS: 9,
  BRICK: 10,
  WATER: 11,
  PRINTER_SIDE: 12,
  PRINTER_TOP: 13,
  WHEAT: 14,
  DOOR_LOW: 15,
  DOOR_HIGH: 16,
  COLD_SIDE: 17,
  COLD_TOP: 18,
  BED_TOP: 19,
  BED_SIDE: 20,
  PILLOW: 21,
  TRAPDOOR: 22,
  LADDER: 23,
  SNOW_TOP: 24, SNOW_SIDE: 25, SANDSTONE_TOP: 26, SANDSTONE_SIDE: 27, CACTUS_TOP: 28, CACTUS_SIDE: 29,
  SPRUCE_LOG_SIDE: 30, SPRUCE_LOG_TOP: 31, SPRUCE_LEAVES: 32, JUNGLE_LOG_SIDE: 33, JUNGLE_LOG_TOP: 34, JUNGLE_LEAVES: 35,
  MUD: 36, ICE: 37, CONCRETE: 38, ASPHALT: 39, WINDOW: 40, RUBBLE: 41, BRIMSTONE: 42, LAVA: 43,
  WALLPAPER: 44, CARPET: 45, CEILING_TILE: 46, FLUORESCENT: 47, BALLS: 48, FOAM: 49,
  COBBLE: 50, PLASTER: 51, SHINGLES: 52, COUNTER_TOP: 53, COUNTER_SMITH: 54, COUNTER_HEALER: 55, COUNTER_TAVERN: 56, COUNTER_FLETCHER: 57, COUNTER_WIZARD: 58,
  SOIL_TOP: 59, // ..68: tilled dirt's top, SOIL_TOP + wet * 5 + (weed level + 1)
  CROP: 69, // ..112: one per crop and stage, like the block ids (the first 11 crops)
  CLAY: 113, // ..115: white, brown, red
  WHEEL_TOP: 116, WHEEL_SIDE: 117, KILN_TOP: 118, KILN_SIDE: 119, GLAZE_TOP: 120, GLAZE_SIDE: 121,
  POTTERY: 122, // ..133: fired clay, POTTERY + clay * 4 + glaze
  CROP2: 134, // ..153: the later crops
  RANGE_TOP: 154, RANGE_SIDE: 155, CAMPFIRE: 156, SINK_TOP: 157, SINK_SIDE: 158, PRESS_TOP: 159, PRESS_SIDE: 160,
};
export const TILE_COUNT = 161;
/** A crop's tile at a stage. */
export const cropTile = (crop, stage) => (crop < 11 ? TILE.CROP + crop * 4 + stage : TILE.CROP2 + (crop - 11) * 4 + stage);

const same = (name, t) => ({ name, top: t, side: t, bottom: t });

export const BLOCKS = [];
BLOCKS[AIR] = { name: 'Air' };
BLOCKS[GRASS] = { name: 'Grass', top: TILE.GRASS_TOP, side: TILE.GRASS_SIDE, bottom: TILE.DIRT };
BLOCKS[DIRT] = same('Dirt', TILE.DIRT);
BLOCKS[STONE] = same('Stone', TILE.STONE);
BLOCKS[SAND] = same('Sand', TILE.SAND);
BLOCKS[LOG] = { name: 'Log', top: TILE.LOG_TOP, side: TILE.LOG_SIDE, bottom: TILE.LOG_TOP };
BLOCKS[LEAVES] = same('Leaves', TILE.LEAVES);
BLOCKS[PLANKS] = same('Planks', TILE.PLANKS);
BLOCKS[GLASS] = same('Glass', TILE.GLASS);
BLOCKS[BRICK] = same('Brick', TILE.BRICK);
BLOCKS[WATER] = same('Water', TILE.WATER);
BLOCKS[PRINTER] = { name: '3D Printer', top: TILE.PRINTER_TOP, side: TILE.PRINTER_SIDE, bottom: TILE.PRINTER_SIDE };
BLOCKS[WHEAT] = same('Wheat', TILE.WHEAT);
BLOCKS[LAVA_LAMP] = same('Lava Lamp', TILE.GLASS);
for (let f = 0; f < 8; f++) BLOCKS[(f < 4 ? BED : BED_FOOT - 4) + f] = { name: 'Bed', top: TILE.BED_TOP, side: TILE.BED_SIDE, bottom: TILE.BED_SIDE };
BLOCKS[FENCE] = same('Fence', TILE.PLANKS);
BLOCKS[SNOW_GRASS] = { name: 'Snowy Grass', top: TILE.SNOW_TOP, side: TILE.SNOW_SIDE, bottom: TILE.DIRT };
BLOCKS[SANDSTONE] = { name: 'Sandstone', top: TILE.SANDSTONE_TOP, side: TILE.SANDSTONE_SIDE, bottom: TILE.SANDSTONE_TOP };
BLOCKS[CACTUS] = { name: 'Cactus', top: TILE.CACTUS_TOP, side: TILE.CACTUS_SIDE, bottom: TILE.CACTUS_TOP };
BLOCKS[SPRUCE_LOG] = { name: 'Spruce Log', top: TILE.SPRUCE_LOG_TOP, side: TILE.SPRUCE_LOG_SIDE, bottom: TILE.SPRUCE_LOG_TOP };
BLOCKS[SPRUCE_LEAVES] = same('Spruce Needles', TILE.SPRUCE_LEAVES);
BLOCKS[JUNGLE_LOG] = { name: 'Jungle Log', top: TILE.JUNGLE_LOG_TOP, side: TILE.JUNGLE_LOG_SIDE, bottom: TILE.JUNGLE_LOG_TOP };
BLOCKS[JUNGLE_LEAVES] = same('Jungle Leaves', TILE.JUNGLE_LEAVES);
BLOCKS[MUD] = same('Mud', TILE.MUD);
BLOCKS[ICE] = same('Ice', TILE.ICE);
BLOCKS[CONCRETE] = same('Concrete', TILE.CONCRETE);
BLOCKS[ASPHALT] = { name: 'Asphalt', top: TILE.ASPHALT, side: TILE.CONCRETE, bottom: TILE.CONCRETE };
BLOCKS[WINDOW] = same('Window', TILE.WINDOW);
BLOCKS[RUBBLE] = same('Rubble', TILE.RUBBLE);
BLOCKS[BRIMSTONE] = same('Brimstone', TILE.BRIMSTONE);
BLOCKS[LAVA] = same('Lava', TILE.LAVA);
BLOCKS[WALLPAPER] = same('Yellow Wallpaper', TILE.WALLPAPER);
BLOCKS[CARPET] = { name: 'Damp Carpet', top: TILE.CARPET, side: TILE.WALLPAPER, bottom: TILE.CONCRETE };
BLOCKS[CEILING_TILE] = same('Ceiling Tile', TILE.CEILING_TILE);
BLOCKS[FLUORESCENT] = same('Fluorescent Light', TILE.FLUORESCENT);
BLOCKS[BALLS] = same('Ball Pit Balls', TILE.BALLS);
BLOCKS[FOAM] = same('Soft-play Foam', TILE.FOAM);
BLOCKS[COBBLE] = same('Cobblestone', TILE.COBBLE);
BLOCKS[PLASTER] = same('Plaster', TILE.PLASTER);
BLOCKS[SHINGLES] = same('Roof Shingles', TILE.SHINGLES);
for (let v = 0; v < 16; v++) {
  const { wet, weeds } = { wet: v >= 8, weeds: v % 8 };
  BLOCKS[SOIL + v] = { name: wet ? 'Watered Tilled Dirt' : 'Tilled Dirt', top: TILE.SOIL_TOP + (wet ? 5 : 0) + weedLevel(weeds) + 1, side: TILE.DIRT, bottom: TILE.DIRT };
}
CROPS.forEach((c, i) => {
  for (let st = 0; st < 4; st++) BLOCKS[cropId(i, st)] = same(st === 0 ? `${CROP_NAMES[i]} Seeds` : CROP_NAMES[i], cropTile(i, st));
});
['Blacksmith', 'Healer', 'Tavern', 'Fletcher', 'Wizard'].forEach((name, i) => {
  BLOCKS[SHOP_COUNTER + i] = { name: `${name}'s Counter`, top: TILE.COUNTER_TOP, side: TILE.COUNTER_SMITH + i, bottom: TILE.COUNTER_TOP };
});
for (let v = 0; v < 8; v++) BLOCKS[TRAPDOOR + v] = same('Trapdoor', TILE.TRAPDOOR);
CLAY_BLOCKS.forEach((id, c) => { BLOCKS[id] = same(CLAY_NAMES[c], TILE.CLAY + c); });
BLOCKS[SNOW_LAYER] = same('Snow', TILE.SNOW_TOP);
BLOCKS[RANGE] = { name: 'Range', top: TILE.RANGE_TOP, side: TILE.RANGE_SIDE, bottom: TILE.RANGE_SIDE };
BLOCKS[CAMPFIRE] = same('Campfire', TILE.CAMPFIRE);
BLOCKS[SINK] = { name: 'Sink', top: TILE.SINK_TOP, side: TILE.SINK_SIDE, bottom: TILE.SINK_SIDE };
BLOCKS[OLIVE_PRESS] = { name: 'Olive Press', top: TILE.PRESS_TOP, side: TILE.PRESS_SIDE, bottom: TILE.PRESS_SIDE };
BLOCKS[POTTERY_WHEEL] = { name: 'Pottery Wheel', top: TILE.WHEEL_TOP, side: TILE.WHEEL_SIDE, bottom: TILE.WHEEL_SIDE };
BLOCKS[KILN] = { name: 'Kiln', top: TILE.KILN_TOP, side: TILE.KILN_SIDE, bottom: TILE.KILN_TOP };
BLOCKS[GLAZING_TABLE] = { name: 'Glazing Table', top: TILE.GLAZE_TOP, side: TILE.GLAZE_SIDE, bottom: TILE.GLAZE_SIDE };
for (let o = 0; o < 5; o++) for (let c = 0; c < 3; c++) for (let g = 0; g < 4; g++) {
  for (const lit of o === 4 ? [false, true] : [false]) {
    const id = potteryId(o, c, g, lit);
    BLOCKS[id] = { ...same('', TILE.POTTERY + c * 4 + g) };
    BLOCKS[id].name = potteryName(id);
  }
}
for (let f = 0; f < 4; f++) BLOCKS[LADDER + f] = same('Ladder', TILE.LADDER);
BLOCKS[COLD_WALLET] = { name: 'Cold Wallet', top: TILE.COLD_TOP, side: TILE.COLD_SIDE, bottom: TILE.COLD_TOP };
for (let f = 0; f < 4; f++) {
  BLOCKS[STAIRS_PLANKS + f] = same('Plank Stairs', TILE.PLANKS);
  BLOCKS[STAIRS_STONE + f] = same('Stone Stairs', TILE.STONE);
}
BLOCKS[SLAB_PLANKS] = same('Plank Slab', TILE.PLANKS);
BLOCKS[SLAB_STONE] = same('Stone Slab', TILE.STONE);
for (let v = 0; v < 16; v++) BLOCKS[DOOR + v] = same('Door', v & 1 ? TILE.DOOR_HIGH : TILE.DOOR_LOW);

// ---------- shaped blocks ----------
// Boxes in block-local coordinates [x0, y0, z0, x1, y1, z1], defined facing north (-Z) and rotated.
const rotate = ([x0, y0, z0, x1, y1, z1], f) => {
  const pts = [[x0, z0], [x1, z1]].map(([x, z]) => [[x, z], [1 - z, x], [1 - x, 1 - z], [z, 1 - x]][f]);
  return [Math.min(pts[0][0], pts[1][0]), y0, Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), y1, Math.max(pts[0][1], pts[1][1])];
};
const DOOR_T = 3 / 16; // door thickness
/** The boxes a shaped block is made of (null for an ordinary full cube). */
export const SHAPES = [];
for (let f = 0; f < 4; f++) {
  // Stairs climb away from whoever placed them: full bottom half, top half on the far side.
  const stairs = [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 0.5]].map((b) => rotate(b, f));
  SHAPES[STAIRS_PLANKS + f] = stairs;
  SHAPES[STAIRS_STONE + f] = stairs;
  for (let open = 0; open < 2; open++) {
    // Closed: a panel across the far edge. Open: swung against the left-hand edge.
    const panel = open ? [0, 0, 0, DOOR_T, 1, 1] : [0, 0, 0, 1, 1, DOOR_T];
    SHAPES[DOOR + f * 4 + open * 2] = [rotate(panel, f)];
    SHAPES[DOOR + f * 4 + open * 2 + 1] = [rotate(panel, f)];
  }
}
// Beds are two blocks long: a low frame and mattress, with a pillow (its own tile: the 7th number) on the head half.
for (let f = 0; f < 4; f++) {
  SHAPES[BED + f] = [rotate([0, 0, 0, 1, 0.5625, 1], f), [...rotate([0.12, 0.5625, 0.06, 0.88, 0.69, 0.34], f), TILE.PILLOW]];
  SHAPES[BED_FOOT + f] = [rotate([0, 0, 0, 1, 0.5625, 1], f)];
}
// Trapdoors: a hatch lying on the bottom of their space; open, it swings up against the far edge. Ladders: a thin frame against the wall they hang on.
for (let f = 0; f < 4; f++) {
  SHAPES[TRAPDOOR + f * 2] = [[0, 0, 0, 1, 3 / 16, 1]];
  SHAPES[TRAPDOOR + f * 2 + 1] = [rotate([0, 0, 0, 1, 1, 3 / 16], f)];
  SHAPES[LADDER + f] = [rotate([0, 0, 0, 1, 1, 1 / 16], f)];
}
// Fences: a post, plus rails toward each neighbour they join (filled in per spot by shapeBoxes).
SHAPES[FENCE] = [[6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16]];
const FENCE_RAILS = [0, 1, 2, 3].map((f) => [[7 / 16, 6 / 16, 0, 9 / 16, 9 / 16, 6 / 16], [7 / 16, 12 / 16, 0, 9 / 16, 15 / 16, 6 / 16]].map((b) => rotate(b, f)));
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W as [dx, dz]
// Pottery: small pieces standing in the middle of their space.
const POT_SHAPES = [
  [[0.34, 0, 0.34, 0.62, 0.38, 0.62], [0.62, 0.1, 0.45, 0.7, 0.3, 0.51]], // mug, with a handle
  [[0.3, 0, 0.3, 0.7, 0.5, 0.7], [0.37, 0.5, 0.37, 0.63, 0.76, 0.63], [0.33, 0.76, 0.33, 0.67, 0.84, 0.67]], // vase: body, neck, lip
  [[0.12, 0, 0.12, 0.88, 0.06, 0.88]], // plate
  [[0.3, 0, 0.3, 0.7, 0.06, 0.7], [0.2, 0.06, 0.2, 0.8, 0.28, 0.8]], // bowl: foot and body
  [[0.3, 0, 0.3, 0.7, 0.56, 0.7], [0.36, 0.56, 0.36, 0.64, 0.64, 0.64]], // luminary: body and cap
];
for (let id = POTTERY; id < LUMINARY_LIT + 12; id++) SHAPES[id] = POT_SHAPES[potteryInfo(id).obj];
SHAPES[SNOW_LAYER] = [[0, 0, 0, 1, 2 / 16, 1]];
// A campfire: crossed logs (the log tile) under the flames; a sink: a cabinet with a basin and a tap.
SHAPES[CAMPFIRE] = [[0.1, 0, 0.4, 0.9, 0.16, 0.6, TILE.LOG_SIDE], [0.4, 0, 0.1, 0.6, 0.16, 0.9, TILE.LOG_SIDE], [0.22, 0.12, 0.22, 0.78, 0.7, 0.78]];
SHAPES[SINK] = [[0, 0, 0, 1, 0.8, 1], [0, 0.8, 0, 1, 0.9, 0.14], [0, 0.8, 0.86, 1, 0.9, 1], [0, 0.8, 0, 0.14, 0.9, 1], [0.86, 0.8, 0, 1, 0.9, 1], [0.45, 0.9, 0.04, 0.55, 1.1, 0.14, TILE.STONE]];
SHAPES[SLAB_PLANKS] = [[0, 0, 0, 1, 0.5, 1]];
SHAPES[SLAB_STONE] = [[0, 0, 0, 1, 0.5, 1]];
export const isDoor = (id) => id >= DOOR && id < DOOR + 16;
export const isBed = (id) => (id >= BED && id < BED + 4) || (id >= BED_FOOT && id < BED_FOOT + 4);
/** A bed half's facing (0 N, 1 E, 2 S, 3 W) and whether it's the head (pillow) half. */
export const bedInfo = (id) => (id < BED_FOOT ? { facing: id - BED, head: true } : { facing: id - BED_FOOT, head: false });
/** Where the other half of the bed half `id` at (x, z) is, as [x, z]. */
export function bedOther(id, x, z) {
  const { facing, head } = bedInfo(id);
  const [dx, dz] = SIDES[facing];
  return head ? [x - dx, z - dz] : [x + dx, z + dz];
}
export const isTrapdoor = (id) => id >= TRAPDOOR && id < TRAPDOOR + 8;
export const isLadder = (id) => id >= LADDER && id < LADDER + 4;
/** Things you right-click to open and close. */
export const isToggle = (id) => isDoor(id) || isTrapdoor(id) || isLuminary(id);
export const FENCE_HEIGHT = 1.5; // too tall to jump over

/**
 * The boxes a shaped block is made of at a spot (null for ordinary cubes). Fences depend on their
 * neighbours; `at(x, y, z)` returns block ids. With `collision`, fences are FENCE_HEIGHT tall.
 */
export function shapeBoxes(id, at, x, y, z, collision = false) {
  if (id !== FENCE) return SHAPES[id] || null;
  const boxes = [...SHAPES[FENCE]];
  SIDES.forEach(([dx, dz], f) => {
    const n = at(x + dx, y, z + dz);
    if (n === FENCE || (SOLID[n] && !SHAPES[n])) boxes.push(...FENCE_RAILS[f]);
  });
  return collision ? boxes.map((b) => [b[0], b[1], b[2], b[3], FENCE_HEIGHT, b[5]]) : boxes;
}
export const doorInfo = (id) => ({ facing: (id - DOOR) >> 2, open: !!((id - DOOR) & 2), top: !!((id - DOOR) & 1) });
export const doorId = (facing, open, top) => DOOR + facing * 4 + (open ? 2 : 0) + (top ? 1 : 0);
/** Placing a block kind while facing `facing` (0 N, 1 E, 2 S, 3 W): the actual block id to put down. */
export function orientedId(id, facing) {
  if (id === STAIRS_PLANKS || id === STAIRS_STONE) return id + facing;
  if (id === DOOR) return doorId(facing, false, false);
  if (id === BED) return BED + facing;
  if (id === TRAPDOOR) return TRAPDOOR + facing * 2;
  return id;
}
/** Which way a yaw faces, as 0 N, 1 E, 2 S, 3 W. */
export function facingOf(yaw) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 2 : 0);
}
/** The family a variant belongs to (its inventory item): all stairs facings are one item, etc. */
export function baseId(id) {
  if (id >= STAIRS_PLANKS && id < STAIRS_PLANKS + 4) return STAIRS_PLANKS;
  if (id >= STAIRS_STONE && id < STAIRS_STONE + 4) return STAIRS_STONE;
  if (isDoor(id)) return DOOR;
  if (isBed(id)) return BED;
  if (isTrapdoor(id)) return TRAPDOOR;
  if (isLadder(id)) return LADDER;
  if (isSoil(id)) return DIRT; // break tilled dirt, get dirt
  if (isCrop(id)) return cropId(cropInfo(id).crop, 0); // any stage gives back its seed
  if (isLitLuminary(id)) return id - LUMINARY_LIT + POTTERY + 48; // a lit luminary is the same luminary
  return id;
}

// Blocks you can see through: faces of neighbours next to these get drawn.
export const SEE_THROUGH = new Uint8Array(MAX_BLOCK_IDS);
for (const id of [AIR, WATER, LEAVES, GLASS, WHEAT, LAVA_LAMP, SPRUCE_LEAVES, JUNGLE_LEAVES, WINDOW, LAVA, BALLS]) SEE_THROUGH[id] = 1;
for (const id of CROP_IDS) SEE_THROUGH[id] = 1;
/** Fluids: you swim in them, can't target or mine them, and can build into them. */
export const FLUID = new Uint8Array(MAX_BLOCK_IDS);
for (const id of [WATER, LAVA, BALLS]) FLUID[id] = 1;
/** Leaves of every kind (drawn with their inner faces, cut faster with a sword). */
export const LEAFY = new Uint8Array(MAX_BLOCK_IDS);
for (const id of [LEAVES, SPRUCE_LEAVES, JUNGLE_LEAVES]) LEAFY[id] = 1;
/** Blocks that glow on their own: drawn at full brightness, day or night. */
export const GLOWS = new Uint8Array(MAX_BLOCK_IDS);
for (const id of [LAVA, FLUORESCENT]) GLOWS[id] = 1;
for (let i = 0; i < 12; i++) GLOWS[LUMINARY_LIT + i] = 1; // a lit luminary
GLOWS[CAMPFIRE] = 1;
for (let id = 0; id < MAX_BLOCK_IDS; id++) if (SHAPES[id]) SEE_THROUGH[id] = 1; // they don't fill their space

// Plants are drawn as two crossed pictures instead of a cube, and you walk through them.
export const PLANT = new Uint8Array(MAX_BLOCK_IDS);
PLANT[WHEAT] = 1;
for (const id of CROP_IDS) PLANT[id] = 1; // crops

// Blocks the player collides with.
export const SOLID = new Uint8Array(MAX_BLOCK_IDS);
for (let id = 1; id < BLOCKS.length; id++) if (id !== WATER && id !== LAVA && id !== BALLS && !PLANT[id] && id !== LAVA_LAMP && !(id >= LADDER && id < LADDER + 4)) SOLID[id] = 1; // ladders: you climb inside them
SOLID[SNOW_LAYER] = 0; // you wade through it
// Open doors still collide (their panel), and so do stairs and slabs: through their SHAPES boxes.

export const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, GLASS, BRICK, PRINTER,
  LAVA_LAMP, DOOR, STAIRS_PLANKS, STAIRS_STONE, SLAB_PLANKS, SLAB_STONE, COLD_WALLET, BED, FENCE, TRAPDOOR, LADDER,
  SNOW_GRASS, SANDSTONE, CACTUS, SPRUCE_LOG, SPRUCE_LEAVES, JUNGLE_LOG, JUNGLE_LEAVES, MUD, ICE, CONCRETE, ASPHALT, WINDOW, RUBBLE,
  BRIMSTONE, WALLPAPER, CARPET, CEILING_TILE, FLUORESCENT, FOAM, COBBLE, PLASTER, SHINGLES,
  ...CROPS.map((c, i) => cropId(i, 0)), // seeds (plant them on tilled dirt)
  WHITE_CLAY, BROWN_CLAY, RED_CLAY, POTTERY_WHEEL, KILN, GLAZING_TABLE, RANGE, CAMPFIRE, SINK, OLIVE_PRESS,
  ...Array.from({ length: 60 }, (_, i) => POTTERY + i)]; // pottery (lit luminaries are the same item)
/** Blocks nobody can break or blow up (shop counters: the town's shops stay open). */
export const UNBREAKABLE = new Uint8Array(MAX_BLOCK_IDS);
for (let i = 0; i < SHOP_ORDER.length; i++) UNBREAKABLE[SHOP_COUNTER + i] = 1;

/** Tools that cut leaves fast (swords of every kind: items.js adds the town's blades). */
export const BLADES = new Set(['sword']);

// Seconds to break a block by hand, and which tool breaks it 5x faster.
export const HARDNESS = {
  [GRASS]: 0.6, [DIRT]: 0.5, [SAND]: 0.5, [STONE]: 2.5, [BRICK]: 2.5,
  [LOG]: 1.2, [PLANKS]: 1.0, [LEAVES]: 0.25, [GLASS]: 0.3, [PRINTER]: 1.0, [WHEAT]: 0.12, [LAVA_LAMP]: 0.3, [COLD_WALLET]: 2.0,
  [SLAB_PLANKS]: 0.7, [SLAB_STONE]: 1.8,
};
for (let f = 0; f < 4; f++) { HARDNESS[STAIRS_PLANKS + f] = 1.0; HARDNESS[STAIRS_STONE + f] = 2.5; }
for (let v = 0; v < 16; v++) HARDNESS[DOOR + v] = 1.0;
for (let f = 0; f < 4; f++) { HARDNESS[BED + f] = 0.6; HARDNESS[BED_FOOT + f] = 0.6; }
HARDNESS[FENCE] = 1.0;
Object.assign(HARDNESS, {
  [SNOW_GRASS]: 0.6, [SANDSTONE]: 1.6, [CACTUS]: 0.4, [SPRUCE_LOG]: 1.2, [SPRUCE_LEAVES]: 0.25, [JUNGLE_LOG]: 1.2, [JUNGLE_LEAVES]: 0.25,
  [MUD]: 0.5, [ICE]: 0.5, [CONCRETE]: 3.0, [ASPHALT]: 2.5, [WINDOW]: 0.3, [RUBBLE]: 1.5, [BRIMSTONE]: 1.2,
  [WALLPAPER]: 1.0, [CARPET]: 0.5, [CEILING_TILE]: 0.4, [FLUORESCENT]: 0.3, [FOAM]: 0.3,
  [COBBLE]: 2.0, [PLASTER]: 1.2, [SHINGLES]: 0.8,
});
for (let v = 0; v < 16; v++) HARDNESS[SOIL + v] = 0.5;
for (const id of CROP_IDS) HARDNESS[id] = 0.1; // picked by hand in a moment
for (let v = 0; v < 8; v++) HARDNESS[TRAPDOOR + v] = 0.8;
for (let f = 0; f < 4; f++) HARDNESS[LADDER + f] = 0.4;
Object.assign(HARDNESS, { [WHITE_CLAY]: 0.5, [BROWN_CLAY]: 0.5, [RED_CLAY]: 0.5, [POTTERY_WHEEL]: 1.0, [KILN]: 2.0, [GLAZING_TABLE]: 1.0 });
for (let id = POTTERY; id < LUMINARY_LIT + 12; id++) HARDNESS[id] = 0.15; // pottery: picked up in a moment
HARDNESS[SNOW_LAYER] = 0.1;
Object.assign(HARDNESS, { [RANGE]: 2.0, [CAMPFIRE]: 0.6, [SINK]: 1.5, [OLIVE_PRESS]: 1.2 });
export const MINE_TOOL = {
  [GRASS]: 'shovel', [DIRT]: 'shovel', [SAND]: 'shovel', [STONE]: 'pick', [BRICK]: 'pick', [LOG]: 'axe', [PLANKS]: 'axe',
  [SLAB_PLANKS]: 'axe', [SLAB_STONE]: 'pick', [COLD_WALLET]: 'pick',
};
for (let f = 0; f < 4; f++) { MINE_TOOL[STAIRS_PLANKS + f] = 'axe'; MINE_TOOL[STAIRS_STONE + f] = 'pick'; }
for (let v = 0; v < 16; v++) MINE_TOOL[DOOR + v] = 'axe';
for (let f = 0; f < 4; f++) { MINE_TOOL[BED + f] = 'axe'; MINE_TOOL[BED_FOOT + f] = 'axe'; }
MINE_TOOL[FENCE] = 'axe';
Object.assign(MINE_TOOL, {
  [SNOW_GRASS]: 'shovel', [MUD]: 'shovel', [SANDSTONE]: 'pick', [CONCRETE]: 'pick', [ASPHALT]: 'pick', [RUBBLE]: 'pick', [BRIMSTONE]: 'pick',
  [ICE]: 'pick', [SPRUCE_LOG]: 'axe', [JUNGLE_LOG]: 'axe', [CACTUS]: 'axe', [WALLPAPER]: 'axe',
  [COBBLE]: 'pick', [PLASTER]: 'pick', [SHINGLES]: 'axe',
});
for (let v = 0; v < 8; v++) MINE_TOOL[TRAPDOOR + v] = 'axe';
for (let f = 0; f < 4; f++) MINE_TOOL[LADDER + f] = 'axe';
for (let v = 0; v < 16; v++) MINE_TOOL[SOIL + v] = 'shovel';
Object.assign(MINE_TOOL, { [RANGE]: 'pick', [SINK]: 'pick', [OLIVE_PRESS]: 'axe', [CAMPFIRE]: 'axe', [SNOW_LAYER]: 'shovel', [WHITE_CLAY]: 'shovel', [BROWN_CLAY]: 'shovel', [RED_CLAY]: 'shovel', [POTTERY_WHEEL]: 'axe', [KILN]: 'pick', [GLAZING_TABLE]: 'axe' });

/** Crafted stone tools (crafting.js): they mine like the tool they're named after, only slower. */
export const STONE_TOOLS = { stoneaxe: 'axe', stonepick: 'pick', stoneshovel: 'shovel' };
/** Is `tool` the right tool for block `id` (the tool itself, or its stone version)? */
export const rightTool = (id, tool) => !!MINE_TOOL[id] && (MINE_TOOL[id] === tool || MINE_TOOL[id] === STONE_TOOLS[tool]);

/** Seconds to break block `id` while holding `tool` ('hand' or a tool name). */
export function breakTime(id, tool) {
  if (UNBREAKABLE[id]) return Infinity;
  let speed = 1;
  if (rightTool(id, tool)) speed = STONE_TOOLS[tool] ? T.stoneToolSpeed : T.toolSpeed;
  if (LEAFY[id] && BLADES.has(tool)) speed = T.swordLeafSpeed;
  return (HARDNESS[id] ?? 1) / speed;
}


// ---------- Server settings: how long every block takes to break ----------
tune('Blocks', {
  toolSpeed: [5, 'Right tool speed-up', 'How much faster the right tool breaks a block', { unit: '×', min: 1 }],
  stoneToolSpeed: [2.5, 'Stone tool speed-up', 'How much faster a crafted stone axe, pick or shovel breaks the blocks it\'s for', { unit: '×', min: 1 }],
  swordLeafSpeed: [3, 'Sword on leaves speed-up', 'How much faster a sword cuts leaves', { unit: '×', min: 1 }],
});
for (const id of Object.keys(HARDNESS).map(Number)) {
  const base = baseId(id);
  const key = isPottery(id) ? 'hardness_pottery' : `hardness_${base}`; // (one setting for every piece of pottery)
  const name = isPottery(id) ? 'Pottery' : BLOCKS[base]?.name ?? 'Block';
  if (!(key in TUNABLES)) tune('Blocks', { [key]: [HARDNESS[base] ?? HARDNESS[id], `${name} break time`, 'Seconds to break it by hand', { unit: ' s' }] });
  Object.defineProperty(HARDNESS, id, { get: () => T[key], enumerable: true, configurable: true });
}
