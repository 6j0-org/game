// The `/` console's commands. The game runs them (it's the authority) and replies with console lines.
// No Three.js, no DOM.
//
//   /help                      what you can type
//   /teleport <where>          you, to <where>          (alias /tp)
//   /teleport <player> <where> someone else
//   /give [player] <item> [count]     any item, by name or short id (/give healing potion 3)
//   /summon [player] <mob> [count]    creatures, a few blocks in front of you (or them)
//   /msg <player> <text>              a private message (alias /tell, /w); plain text in the console goes to everyone
//   /skip                             skip ahead a quarter day (single player)
// <where>: x z (on the ground) or x y z (~ means "where you are", ~5 "5 more than that"), a player's
// name, `spawn` (the world spawn), `bed` (your bed), or `town` (the nearest Fantasy Town market).

import { T, tune } from './tuning.js';
import { findItem, giveDefault, giveItem, itemName } from './items.js';
import { MOB_TYPES } from './mobs.js';
import { BESTIARY } from './bestiary.js';
import { SOLID } from './blocks.js';
import { ULTIMATES } from './ultimates.js';

tune('World', {
  teleport: [true, 'Teleporting', 'Anyone can use /teleport: to coordinates, a player, the spawn, their bed or the nearest town'],
  cheats: [true, 'Cheat commands', 'Anyone can use /give (any item) and /summon (any creature)'],
});

export const COMMANDS = {
  help: { usage: '/help', desc: 'Lists the commands' },
  teleport: { usage: '/teleport [player] <x [y] z | player | spawn | bed | town>', desc: 'Moves you (or someone) there. ~ means where you are: /tp ~ ~20 ~', aliases: ['tp'] },
  give: { usage: '/give [player] <item> [count]', desc: 'Gives you (or someone) an item, by name or short id: /give healing potion 3, /give arrows 100, /give zcash 50' },
  summon: { usage: '/summon [player] <mob> [count]', desc: 'Summons creatures in front of you (or someone): /summon zombie 5, /summon knife penguin' },
  msg: { usage: '/msg <player> <text>', desc: 'A private message to one player (anything typed without a / goes to everyone)', aliases: ['tell', 'w'] },
  skip: { usage: '/skip', desc: 'Skips ahead a quarter of a day (single player)' },
  ultimate: { usage: '/ultimate [name]', desc: 'Lets any ultimate go right now, whatever your class (for testing): /ultimate silverware cyclone. With no name, lists them all', aliases: ['ult'] },
  land: { usage: '/land [allow|deny place|break|modify] | /land release', desc: 'Your land (multiplayer): who owns the chunk you\'re in; let others place, break or modify (use doors and garden tools) there, or not; or give it up', aliases: ['lease'] },
};
const MAX_GIVE = 9999;
const MAX_SUMMON = 20;

/** A mob type from what someone typed: its type id or Bestiary name (any case and spacing), or the only one it starts. */
export function findMob(text) {
  const c = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const q = c(text);
  if (!q) return { matches: [] };
  const all = Object.keys(MOB_TYPES).map((type) => ({ type, name: BESTIARY.find((b) => b.type === type)?.name ?? type }));
  const exact = all.find((m) => c(m.type) === q || c(m.name) === q);
  if (exact) return { mob: exact };
  const starts = all.filter((m) => c(m.type).startsWith(q) || c(m.name).startsWith(q));
  return starts.length === 1 ? { mob: starts[0] } : { matches: starts };
}
/** What to type for each mob (for Tab completion): type ids, and Bestiary names run together. */
/** What to type for each ultimate (Tab completion): keys, and names run together. */
export const ULT_WORDS = [...new Set(Object.entries(ULTIMATES).flatMap(([k, u]) => [k, u.name.toLowerCase().replace(/[^a-z0-9]/g, '')]))];
export const MOB_WORDS = [...new Set([...Object.keys(MOB_TYPES), ...BESTIARY.map((b) => b.name.toLowerCase().replace(/[^a-z0-9]/g, ''))])];
/** Words that can stand in for a place. */
export const PLACES = ['spawn', 'bed', 'town'];

const LIMIT = 1e6; // how far from the middle of the world you can go

/** The command a word names ('tp' -> 'teleport'), or null. */
export function commandOf(word) {
  const w = word.toLowerCase();
  for (const [name, def] of Object.entries(COMMANDS)) if (name === w || def.aliases?.includes(w)) return name;
  return null;
}

/** A coordinate: a number, or ~ / ~n relative to `base`. NaN if it isn't one. */
export function parseCoord(text, base) {
  if (text.startsWith('~')) {
    const rest = text.slice(1);
    return base + (rest ? Number(rest) : 0);
  }
  return text.trim() === '' ? NaN : Number(text);
}
const isCoord = (text) => /^~-?\d*\.?\d*$/.test(text) || (text.trim() !== '' && Number.isFinite(Number(text)));

/** The player whose name is `name` (exactly, ignoring case, or the only one it starts), or null. */
function findPlayer(game, name) {
  const n = name.toLowerCase();
  const all = [...game.players.values()];
  return all.find((o) => o.name.toLowerCase() === n) || (all.filter((o) => o.name.toLowerCase().startsWith(n)).length === 1
    ? all.find((o) => o.name.toLowerCase().startsWith(n)) : null);
}

/**
 * Runs one console line for player entry `e`. Returns reply lines: [{ text, error? }].
 * Teleports go through `game._teleport(entry, pos, note)`.
 */
export function runCommand(game, e, line) {
  const all = String(line).trim().replace(/^\//, '').split(/\s+/).filter(Boolean);
  const words = all.slice(0, 8);
  if (!words.length) return [];
  const cmd = commandOf(words[0]);
  const args = words.slice(1);
  if (!cmd) return [{ text: `Unknown command /${words[0]}. Type /help for the list.`, error: true }];
  if (cmd === 'help') return Object.values(COMMANDS).map((c) => ({ text: `${c.usage}  ${c.desc}` }));
  if (cmd === 'give' || cmd === 'summon') return giveOrSummon(game, e, cmd, args);
  if (cmd === 'ultimate') { // (a cheat: game.js `_ult` with a forced ultimate)
    if (!game.settings.cheats) return [{ text: 'Cheat commands are off on this server (Settings > Server: Cheat commands).', error: true }];
    const c = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
    const q = c(args.join(' '));
    const all = Object.entries(ULTIMATES);
    if (!q) return [{ text: 'Ultimates (/ultimate <name>):' }, ...all.map(([k, u]) => ({ text: `${u.name} (${k}): ${u.desc}` }))];
    const hits = all.filter(([k, u]) => c(k) === q || c(u.name) === q);
    const found = hits.length ? hits : all.filter(([k, u]) => c(k).startsWith(q) || c(u.name).startsWith(q));
    if (found.length !== 1) return [{ text: found.length ? `Which one? ${found.map(([, u]) => u.name).join(', ')}` : `No ultimate called "${args.join(' ')}". Type /ultimate for the list.`, error: true }];
    game._ult(e, found[0][0]);
    return [{ text: `⚡ ${found[0][1].name.replace(/!$/, '')}!` }];
  }
  if (cmd === 'land') { // (game.js `_land` answers on the console itself)
    const [op, action] = [args[0]?.toLowerCase(), args[1]?.toLowerCase()];
    if (!op || op === 'info') game._land(e, { op: 'info' });
    else if (op === 'release' || op === 'unclaim') game._land(e, { op: 'release' });
    else if ((op === 'allow' || op === 'deny') && ['place', 'break', 'modify'].includes(action)) game._land(e, { op: 'allow', action, on: op === 'allow' });
    else return [{ text: 'Usage: /land, /land allow place, /land deny break, /land allow modify, /land release', error: true }];
    return [];
  }
  if (cmd === 'skip') {
    if (game.multiplayer) return [{ text: 'Skipping time only works in single player (everyone shares the clock).', error: true }];
    const before = game.time;
    game.time = (game.time + 0.25) % 1;
    if (game.time < before) game._newDay(); // (past sunrise: the garden's morning)
    return [{ text: 'Skipped ahead a quarter of a day' }];
  }
  if (cmd === 'msg') {
    if (!game.multiplayer) return [{ text: "You're playing single player: there's no one to message.", error: true }];
    if (all.length < 3) return [{ text: `Usage: ${COMMANDS.msg.usage}`, error: true }];
    const o = findPlayer(game, all[1]);
    if (!o) return [{ text: `Nobody called "${all[1]}" is here.`, error: true }];
    if (o === e) return [{ text: "That's you.", error: true }];
    const text = String(line).trim().replace(/^\/?\S+\s+\S+\s+/, '');
    game._text(e, { to: o.id, text });
    return [{ text: `→ ${o.name}: ${text}`, chat: true }];
  }

  // /teleport
  const usage = [{ text: `Usage: ${COMMANDS.teleport.usage}`, error: true }];
  if (!T.teleport) return [{ text: 'Teleporting is turned off (Server settings: World).', error: true }];
  if (!args.length) return usage;
  // Is the first word someone to move (with a destination after it)?
  let who = e;
  let dest = args;
  if (args.length >= 2 && !isCoord(args[0])) {
    const o = findPlayer(game, args[0]);
    if (!o) return [{ text: `Nobody called "${args[0]}" is here.`, error: true }];
    who = o;
    dest = args.slice(1);
  }
  if (who.p.dead) return [{ text: `${who === e ? "You're" : `${who.name} is`} dead: wait for the respawn.`, error: true }];

  const me = e.p.pos;
  let pos = null;
  let where = '';
  if (dest.length === 1) {
    const word = dest[0].toLowerCase();
    if (word === 'spawn') {
      pos = game.world.findSpawn();
      where = 'the world spawn';
    } else if (word === 'bed') {
      const b = who.p.bed;
      if (!b) return [{ text: `${who === e ? 'You have' : `${who.name} has`} no bed.`, error: true }];
      pos = { x: b.x + 0.5, y: b.y + 0.5625, z: b.z + 0.5 };
      where = who === e ? 'your bed' : `${who.name}'s bed`;
    } else if (word === 'town') {
      const m = game.world.findMarket(who.p.pos.x, who.p.pos.z);
      if (!m) return [{ text: 'No Fantasy Town market within 30,000 blocks.', error: true }];
      pos = { x: m.x, y: game.world.surfaceAt(Math.floor(m.x), Math.floor(m.z)), z: m.z };
      where = 'the nearest town market';
    } else {
      const o = findPlayer(game, dest[0]);
      if (!o) return [{ text: `Nobody called "${dest[0]}" is here.`, error: true }];
      if (o === who) return [{ text: 'Already there.', error: true }];
      pos = { ...o.p.pos };
      where = o.name;
    }
  } else if ((dest.length === 2 || dest.length === 3) && dest.every(isCoord)) {
    const x = parseCoord(dest[0], me.x);
    const z = parseCoord(dest[dest.length - 1], me.z);
    if (![x, z].every(Number.isFinite) || Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return [{ text: `Coordinates have to be numbers within ${LIMIT.toLocaleString('en')} of the middle.`, error: true }];
    // A bare x z lands on the ground; whole numbers mean the middle of that block.
    const mid = (v, t) => (t.startsWith('~') ? v : Number.isInteger(v) ? v + 0.5 : v);
    const y = dest.length === 3 ? parseCoord(dest[1], me.y) : game.world.surfaceAt(Math.floor(x), Math.floor(z));
    if (!Number.isFinite(y)) return usage;
    pos = { x: mid(x, dest[0]), y: Math.max(1, Math.min(200, y)), z: mid(z, dest[dest.length - 1]) };
  } else return usage;

  const at = `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
  const to = where ? `${where} ${at}` : at;
  game._teleport(who, pos, who === e ? null : `${e.name} teleported you to ${to}`);
  return [{ text: who === e ? `Teleported to ${to}` : `Teleported ${who.name} to ${to}` }];
}

/**
 * /give and /summon share a shape: [player] <thing, maybe several words> [count]. The first word is
 * a player only if what follows it is still a thing (so items named like a player still work).
 */
function giveOrSummon(game, e, cmd, args) {
  const usage = [{ text: `Usage: ${COMMANDS[cmd].usage}`, error: true }];
  if (!T.cheats) return [{ text: 'Cheat commands are turned off (Server settings: World).', error: true }];
  if (!args.length) return usage;
  const find = cmd === 'give' ? (t) => findItem(t) : (t) => findMob(t);
  const found = (r) => r.item || r.mob;
  let words = [...args];
  let count = null;
  if (words.length > 1 && /^\d+(\.\d+)?$/.test(words[words.length - 1])) count = Number(words.pop());
  let who = e;
  if (words.length > 1) {
    const o = findPlayer(game, words[0]);
    if (o && found(find(words.slice(1).join(' '))) && !found(find(words.join(' ')))) {
      who = o;
      words = words.slice(1);
    }
  }
  const r = find(words.join(' '));
  if (!found(r)) {
    const what = cmd === 'give' ? 'item' : 'creature';
    if (!r.matches.length) return [{ text: `No ${what} called "${words.join(' ')}". Tab completes names.`, error: true }];
    return [{ text: `Which one? ${r.matches.slice(0, 12).map((m) => m.name).join(', ')}${r.matches.length > 12 ? '…' : ''}`, error: true }];
  }
  if (who.p.dead) return [{ text: `${who === e ? "You're" : `${who.name} is`} dead: wait for the respawn.`, error: true }];

  if (cmd === 'give') {
    const { kind, name } = r.item;
    const n = kind === 'zcash' ? Math.round((count ?? 1) * 100) / 100 : Math.floor(count ?? giveDefault(kind));
    if (!(n > 0) || n > MAX_GIVE) return [{ text: `The count has to be from 1 to ${MAX_GIVE}.`, error: true }];
    giveItem(who.p, kind, n);
    game._sendYou(who);
    const what = kind === 'zcash' ? `${n.toFixed(2)} ZEC` : `${n} × ${name || itemName(kind)}`;
    if (who !== e) who.send({ type: 'msg', kind: 'delivery', text: `${e.name} gave you ${what}` });
    return [{ text: who === e ? `Gave you ${what}` : `Gave ${who.name} ${what}` }];
  }

  // /summon: spread out a few blocks in front of them, each on a free spot.
  const n = Math.floor(count ?? 1);
  if (!(n > 0) || n > MAX_SUMMON) return [{ text: `The count has to be from 1 to ${MAX_SUMMON}.`, error: true }];
  const { type, name } = r.mob;
  const p = who.p.pos;
  const yaw = who.yaw || 0;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const def = MOB_TYPES[type];
  let made = 0;
  for (let i = 0; i < n * 4 && made < n; i++) {
    const ring = 3 + Math.floor(i / 6);
    const a = (i % 6) / 6 * 2 - 1; // fan out sideways
    const x = p.x + fx * ring - fz * a * ring * 0.8 + (game.rand() - 0.5);
    const z = p.z + fz * ring + fx * a * ring * 0.8 + (game.rand() - 0.5);
    const y = standY(game.world, Math.floor(x), Math.floor(p.y), Math.floor(z));
    if (y === null) continue;
    // Seed Oils come as big as fits (they split when killed).
    let m = null;
    for (let size = type === 'seedoil' ? T.seedOilMaxSize : 1; size >= 1 && !m; size--) {
      m = game.mobs.spawn(type, x, def.flies ? y + 2 : y, z, size);
      if (m.collides()) { game.mobs.list.pop(); m = null; }
    }
    if (!m) continue;
    if (def.flies) { m.yaw = yaw; m.cruise = def.cruise[0]; }
    made++;
  }
  if (!made) return [{ text: `No room for a ${name} there.`, error: true }];
  const what = `${made} ${name}${made > 1 ? 's' : ''}`;
  if (who !== e) who.send({ type: 'msg', kind: 'deny', text: `${e.name} summoned ${what} next to you` });
  return [{ text: who === e ? `Summoned ${what}` : `Summoned ${what} next to ${who.name}` }];
}

/** A height to stand at in column (x, z) near y: up out of anything solid, then down onto the ground. Null if none close by. */
function standY(world, x, y, z) {
  const solid = (yy) => SOLID[world.getBlock(x, yy, z)];
  let yy = y;
  for (let up = 0; up < 6 && (solid(yy) || solid(yy + 1)); up++) yy++;
  if (solid(yy) || solid(yy + 1)) return null;
  for (let down = 0; down < 12 && !solid(yy - 1) && yy > 1; down++) yy--;
  return yy;
}
