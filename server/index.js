#!/usr/bin/env node
// Game multiplayer server: serves the game's files and runs one shared world over WebSockets.
// No npm packages needed.
//
//   node server/index.js                       # http://localhost:8000, reachable on your network
//   PORT=9000 DATA_DIR=./saves node server/index.js
//
// Environment: PORT (8000), HOST (0.0.0.0 = every network interface), DATA_DIR (./data),
// TLS_CERT and TLS_KEY (paths to a certificate and key: serve https://, which browsers require
// before they let players use their microphone for voice chat).

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptWebSocket } from './ws.js';
import { Game } from '../src/game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const TICK = 0.05; // 20 simulation steps per second
const MAX_BACKLOG = 2 * 1024 * 1024; // skip snapshots for a client this far behind

// ---------- saves: one JSON file of key/value pairs, written atomically ----------
class FileStore {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.dirty = false;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Couldn't read ${file} (${err.message}); starting a new world.`);
    }
  }

  get(k) {
    return Object.hasOwn(this.data, k) ? this.data[k] : null;
  }

  set(k, v) {
    this.data[k] = v;
    this.dirty = true;
  }

  delete(k) {
    delete this.data[k];
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }
}

const store = new FileStore(path.join(DATA_DIR, 'world.json'));
const players = new FileStore(path.join(DATA_DIR, 'players.json'));
const game = new Game({
  store,
  multiplayer: true,
  loadPlayer: (token) => players.get(token),
  savePlayer: (uid, data) => { if (data === null) players.delete(uid); else players.set(uid, data); },
});

// ---------- static files: only index.html and src/*.js ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function serveFile(req, res) {
  const url = new URL(req.url, 'http://x');
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  const allowed = file === path.join(ROOT, 'index.html')
    || (file.startsWith(path.join(ROOT, 'src') + path.sep) && file.endsWith('.js'));
  if (!allowed || req.method !== 'GET') {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-store' }).end(body);
  });
}

const TLS = process.env.TLS_CERT && process.env.TLS_KEY
  ? { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }
  : null;
const server = TLS ? https.createServer(TLS, serveFile) : http.createServer(serveFile);
const SCHEME = TLS ? 'https' : 'http';

// ---------- players connect at /ws ----------
// Each message object is serialised once, however many players it goes to.
const json = new WeakMap();
const encode = (msg) => {
  let s = json.get(msg);
  if (!s) json.set(msg, (s = JSON.stringify(msg)));
  return s;
};

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    return;
  }
  const ws = acceptWebSocket(req, socket);
  if (!ws) return;
  let id = null;
  let uid = null; // logged in as (before choosing a character)
  let asked = 0;
  const send = (msg) => {
    if (!ws.open) return;
    if (msg.type === 'snap' && ws.backlog > MAX_BACKLOG) return; // slow connection: skip a frame
    ws.send(encode(msg));
    if (msg.type === 'kicked') ws.close();
  };
  ws.onmessage = (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (id === null) {
      // Before joining (accounts.js): make a Player, recover one with an Admin's code, or log in.
      if (msg.type === 'create' || msg.type === 'recover') {
        if ((asked += 1) > 20) return ws.close(1008); // (nobody needs this many tries on one connection)
        const reply = game.account(msg);
        if (reply.type === 'created') console.log(`* ${msg.type === 'create' ? 'new Player' : 'recovered'}: ${reply.name}`);
        return send(reply);
      }
      if (msg.type === 'hello') { // log in: then pick (or make) a character
        const denied = game.authenticate(msg.uid, msg.key);
        if (denied) return send({ type: 'denied', reason: denied, login: true });
        uid = msg.uid;
        return send(game.characterList(uid));
      }
      if (!uid) return ws.close(1008);
      if (msg.type === 'createChar') return send(game.createCharacter(uid, msg));
      if (msg.type === 'deleteChar') return send(game.deleteCharacter(uid, String(msg.id)));
      if (msg.type !== 'play') return ws.close(1008);
      if (game.authenticate(uid, msg.key)) return ws.close(1008); // (banned since logging in)
      id = game.join(uid, String(msg.id), send);
      if (id === null) return send({ type: 'denied', reason: 'No such character' });
      console.log(`+ ${game.players.get(id)?.name} joined (${game.players.size} online)`);
      return undefined;
    }
    game.message(id, msg);
    return undefined;
  };
  ws.onclose = () => {
    if (id === null || !game.players.has(id)) return;
    const name = game.players.get(id).name;
    game.leave(id);
    console.log(`- ${name} left (${game.players.size} online)`);
  };
});

// ---------- run ----------
setInterval(() => game.tick(TICK), TICK * 1000);
setInterval(() => {
  game.save();
  store.flush();
  players.flush();
}, 10_000);

function shutdown() {
  console.log('Saving and shutting down…');
  game.save();
  store.flush();
  players.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Game server: world seed ${game.seed}, saves in ${DATA_DIR}`);
  console.log(`  This computer: ${SCHEME}://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`  Your network:  ${SCHEME}://${a.address}:${PORT}`);
    }
  }
  if (!TLS) console.log('  (Voice chat: microphones need https except on localhost. Set TLS_CERT and TLS_KEY; see the README.)');
});
