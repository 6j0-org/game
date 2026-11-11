// Crafting (R): by hand, anywhere, instantly. Trees give logs and (from leaves, sometimes) sticks; grass gives
// plant fiber (sometimes); stone is knapped into tool heads; fiber twists into cord; and a stick, a stone
// head and cord make a stone tool. game.js `_craft` runs the `craft` message. No Three.js, no DOM.

import { tune } from './tuning.js';
import { STONE, LOG, PLANKS, SPRUCE_LOG, JUNGLE_LOG } from './blocks.js';
import { TOOLS, MATERIALS, itemName, blockKind } from './items.js';

tune('Crafting', {
  stickChance: [0.25, 'Stick chance', 'Chance breaking leaves drops a stick', { max: 1, step: 0.05 }],
  fiberChance: [0.3, 'Fiber chance', 'Chance breaking grass drops plant fiber', { max: 1, step: 0.05 }],
});

/**
 * Every recipe: `out` (a material, a tool, or 'block:<id>') × `n`, from `needs`: { materials, blocks } (kind or
 * block id -> how many). `group` is the recipe book's heading.
 */
export const CRAFTS = [
  { out: 'cord', n: 1, needs: { materials: { fiber: 3 } }, group: 'Basics' },
  { out: blockKind(PLANKS), n: 4, needs: { blocks: { [LOG]: 1 } }, group: 'Basics' },
  { out: blockKind(PLANKS), n: 4, needs: { blocks: { [SPRUCE_LOG]: 1 } }, group: 'Basics', id: 'planks-spruce' },
  { out: blockKind(PLANKS), n: 4, needs: { blocks: { [JUNGLE_LOG]: 1 } }, group: 'Basics', id: 'planks-jungle' },
  { out: 'stick', n: 2, needs: { blocks: { [PLANKS]: 1 } }, group: 'Basics' },
  { out: 'axehead', n: 1, needs: { blocks: { [STONE]: 1 } }, group: 'Stone heads' },
  { out: 'pickhead', n: 1, needs: { blocks: { [STONE]: 1 } }, group: 'Stone heads' },
  { out: 'shovelhead', n: 1, needs: { blocks: { [STONE]: 1 } }, group: 'Stone heads' },
  { out: 'blade', n: 1, needs: { blocks: { [STONE]: 1 } }, group: 'Stone heads' },
  { out: 'stoneaxe', n: 1, needs: { materials: { stick: 1, axehead: 1, cord: 1 } }, group: 'Stone tools' },
  { out: 'stonepick', n: 1, needs: { materials: { stick: 1, pickhead: 1, cord: 1 } }, group: 'Stone tools' },
  { out: 'stoneshovel', n: 1, needs: { materials: { stick: 1, shovelhead: 1, cord: 1 } }, group: 'Stone tools' },
  { out: 'stoneknife', n: 1, needs: { materials: { stick: 1, blade: 1, cord: 1 } }, group: 'Stone tools' },
  { out: 'stonespear', n: 1, needs: { materials: { stick: 2, blade: 1, cord: 1 } }, group: 'Stone tools' },
];
for (const c of CRAFTS) c.id ??= c.out; // (how the client names a recipe)
export const craftById = (id) => CRAFTS.find((c) => c.id === id) ?? null;

const count = (player, inv, k) => (player.buildy ? Infinity : player[inv]?.[k] || 0);
/** Has the player got everything for recipe `c`? */
export const canCraft = (player, c) => Object.entries(c.needs).every(([inv, list]) => Object.entries(list).every(([k, n]) => count(player, inv, k) >= n));
/** "3 Plant Fiber", "1 Stick, 1 Stone Axe Head, 1 Cord", "1 Stone" */
export const craftNeedsText = (c) => Object.entries(c.needs).flatMap(([inv, list]) => Object.entries(list).map(([k, n]) => `${n} ${inv === 'blocks' ? itemName(blockKind(Number(k))) : MATERIALS[k]?.name ?? k}`)).join(', ');
/** What a recipe makes, by name. */
export const craftName = (c) => `${c.n > 1 ? `${c.n} ` : ''}${itemName(c.out)}`;
/** Puts what a recipe makes into the player's inventory. */
export function grantCraft(player, c) {
  if (c.out.startsWith('block:')) { const id = Number(c.out.slice(6)); player.blocks[id] = (player.blocks[id] || 0) + c.n; }
  else if (c.out in MATERIALS) player.materials[c.out] = (player.materials[c.out] || 0) + c.n;
  else if (c.out in TOOLS) player.tools[c.out] = (player.tools[c.out] || 0) + c.n;
}
