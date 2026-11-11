// Connects the page to a game: the multiplayer server if this page was served by one, otherwise a
// single-player Game running right here in the browser. Both look the same to main.js.
//
// First `openLink()`: a link to the game before you've joined. Use it to make or recover a Player
// (`link.request({ type: 'create', name })`, `{ type: 'recover', code }`: answered with 'created' or
// 'denied'), then `link.login(uid, key)` (answered with your 'characters', or { error }), make or delete
// characters (`link.request({ type: 'createChar', name, look, stats })`, `{ type: 'deleteChar', id }`:
// answered with 'characters' or 'denied'), and `link.play(id)` joins as one, giving the Connection:
//   conn.welcome        the first message (seed, edits, your position and stats)
//   conn.send(msg)      send an action or your position
//   conn.drain(fn)      handle messages received since last frame
//   conn.tick?(dt)      single-player only: advance the local game
//   conn.closed / conn.closeReason

class Connection {
  constructor(mode) {
    this.mode = mode; // 'multiplayer' | 'single'
    this.inbox = [];
    this.welcome = null;
    this.closed = false;
    this.closeReason = '';
  }

  drain(handle) {
    const msgs = this.inbox;
    this.inbox = [];
    for (const m of msgs) handle(m);
  }
}

/** A link to the server, or (if none answers) to a Game made by `makeLocalGame()` in this browser. */
export async function openLink({ makeLocalGame, timeoutMs = 2500 }) {
  const remote = await openRemote(timeoutMs).catch(() => null);
  return remote || openLocal(makeLocalGame());
}

function openRemote(timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!/^https?:$/.test(location.protocol)) return reject(new Error('not served over http'));
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* */ } reject(new Error('timed out')); }, timeoutMs);
    let waiting = null; // the reply we're waiting for: { resolve }
    let conn = null; // after joining
    const link = {
      mode: 'multiplayer',
      request(msg) {
        return new Promise((res) => {
          waiting = { resolve: res };
          ws.send(JSON.stringify(msg));
        });
      },
      async login(uid, key) {
        link.key = key;
        const reply = await link.request({ type: 'hello', uid, key });
        return reply.type === 'characters' ? { characters: reply } : { error: reply.reason || 'Couldn\'t sign in.' };
      },
      async play(id) {
        const c = new Connection('multiplayer');
        c.send = (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
        c.close = () => ws.close();
        conn = c;
        const reply = await link.request({ type: 'play', id, key: link.key });
        if (reply.type !== 'welcome') { conn = null; return { error: reply.reason || 'Couldn\'t join.' }; }
        c.welcome = reply;
        return { conn: c };
      },
    };
    ws.onopen = () => { clearTimeout(timer); resolve(link); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (waiting && (m.type === 'welcome' || m.type === 'denied' || m.type === 'created' || m.type === 'characters')) {
        const w = waiting;
        waiting = null;
        w.resolve(m);
        return;
      }
      if (!conn?.welcome) return;
      if (m.type === 'kicked') conn.closeReason = m.reason;
      conn.inbox.push(m);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('no server')); };
    ws.onclose = () => {
      if (waiting) { waiting.resolve({ type: 'denied', reason: 'Lost connection to the server.' }); waiting = null; }
      if (conn) { conn.closed = true; conn.closeReason ||= 'Lost connection to the server.'; }
    };
    return undefined;
  });
}

function openLocal(game) {
  return {
    mode: 'single',
    game,
    uid: null,
    async request(msg) {
      if (msg.type === 'createChar') return game.createCharacter(this.uid, msg);
      if (msg.type === 'deleteChar') return game.deleteCharacter(this.uid, String(msg.id));
      return game.account(msg);
    },
    async login(uid, key) {
      const denied = game.authenticate(uid, key);
      if (denied) return { error: denied };
      this.uid = uid;
      return { characters: game.characterList(uid) };
    },
    async play(charId) {
      const conn = new Connection('single');
      conn.game = game;
      const id = game.join(this.uid, charId, (m) => {
        if (!conn.welcome && m.type === 'welcome') conn.welcome = m;
        else conn.inbox.push(m);
      });
      conn.send = (msg) => game.message(id, msg);
      conn.tick = (dt) => game.tick(dt);
      conn.save = () => game.save();
      if (id === null) return { error: 'No such character' };
      conn.close = () => game.leave(id);
      return { conn };
    },
  };
}
