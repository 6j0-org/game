// Signing in on the title screen (the browser half of accounts.js). The key for your Player on this world is
// kept in this browser (per server address; single player has its own), so after creating a Player you're
// signed in automatically every time. Without one, the title screen shows Create Player and Recover Player
// (with a code from the server's Admin) instead of the Play buttons.

import * as THREE from 'three';
import { buildAvatar } from './avatars.js';
import { STATS } from './stats.js';
import { SKINS, SKIN_NAMES, HAIRSTYLES, HAIR_COLORS, BROWS, HEADS, SHIRT_COLORS, PANTS_COLORS, defaultLook, tallScale } from './characters.js';

const keyFor = (link) => `game:player-key:${link.mode === 'single' ? 'single' : location.host}`;

function loadKey(store, link) {
  try {
    const k = JSON.parse(store.get(keyFor(link)) || 'null');
    return k && typeof k.uid === 'string' && typeof k.key === 'string' ? k : null;
  } catch { return null; }
}

/**
 * Signs in over `link` (net.js openLink), asking on the title screen if it has to. Resolves with the
 * Connection once you've joined.
 */
export async function signIn({ store, link, status }) {
  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };
  const titleButtons = document.querySelector('.title-buttons');
  const nameRow = document.getElementById('player-name-row');
  titleButtons.hidden = true;
  nameRow.hidden = true;
  let saved = loadKey(store, link);
  let chars = null;
  if (saved) {
    say('Signing in…');
    const r = await link.login(saved.uid, saved.key);
    if (r.characters) chars = r.characters;
    else say(r.error, true);
  }
  if (!chars) { // no Player in this browser (or it was refused): Create Player / Recover Player
    saved = await createOrRecover({ store, link, say, hadOne: !!saved });
    const r = await link.login(saved.uid, saved.key);
    if (!r.characters) { say(r.error, true); return new Promise(() => {}); }
    chars = r.characters;
  }
  const conn = await chooseCharacter({ link, say, chars, store });
  titleButtons.hidden = false;
  nameRow.hidden = false;
  document.getElementById('switch-row').hidden = false;
  document.getElementById('switch-char').onclick = () => { sessionStorage.setItem('game:pick', '1'); location.reload(); };
  return conn;
}

/** The title screen's Create Player / Recover Player. Resolves with { uid, key } once there's a Player. */
function createOrRecover({ store, link, say, hadOne }) {
  const panel = document.getElementById('account');
  const screen = document.getElementById('overlay');
  panel.hidden = false;
  screen.classList.add('size-small'); // Create Player is a small screen (index.html: screen sizes)
  if (!hadOne) say(link.mode === 'single' ? 'Single player: create a Player to start.' : 'Welcome! Create a Player to join this world.');
  const newEl = document.getElementById('account-new');
  const recoverEl = document.getElementById('account-recover');
  const nameIn = document.getElementById('account-name');
  const codeIn = document.getElementById('account-code');
  const show = (recover) => { newEl.hidden = recover; recoverEl.hidden = !recover; (recover ? codeIn : nameIn).focus(); };
  document.getElementById('account-recover-open').onclick = () => show(true);
  document.getElementById('account-back').onclick = () => show(false);
  show(false);
  return new Promise((resolve) => {
    let busy = false;
    const finish = (reply) => {
      busy = false;
      if (reply.type !== 'created') { say(reply.reason, true); return; }
      store.set(keyFor(link), JSON.stringify({ uid: reply.uid, key: reply.key })); // signed in from now on
      panel.hidden = true;
      screen.classList.remove('size-small');
      say(`Hello, ${reply.name}!`);
      resolve({ uid: reply.uid, key: reply.key });
    };
    const create = async () => {
      if (busy) return;
      const name = nameIn.value.trim();
      if (!name) { say('Type a name for your Player first.', true); nameIn.focus(); return; }
      busy = true;
      finish(await link.request({ type: 'create', name }));
    };
    const recover = async () => {
      if (busy) return;
      if (!codeIn.value.trim()) { say('Type the recovery code the Admin gave you.', true); codeIn.focus(); return; }
      busy = true;
      finish(await link.request({ type: 'recover', code: codeIn.value }));
    };
    document.getElementById('account-create').onclick = create;
    document.getElementById('account-recover-go').onclick = recover;
    nameIn.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') create(); };
    codeIn.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') recover(); };
  });
}

/**
 * Picks a character: your last one straight away (unless you asked to switch), otherwise the list (Play,
 * Delete, New character). Resolves with the Connection once you've joined.
 */
function chooseCharacter({ link, say, chars }) {
  const pickEl = document.getElementById('charpick');
  const listEl = document.getElementById('charpick-list');
  const switching = sessionStorage.getItem('game:pick') === '1';
  sessionStorage.removeItem('game:pick');
  return new Promise((resolve) => {
    const play = async (id) => {
      say('Joining…');
      const r = await link.play(id);
      if (!r.conn) { say(r.error, true); return; }
      pickEl.hidden = true;
      resolve(r.conn);
    };
    const render = (c) => {
      chars = c;
      listEl.replaceChildren(...c.list.map((ch) => {
        const row = document.createElement('div');
        row.className = `char-row${ch.id === c.last ? ' last' : ''}`;
        const label = document.createElement('div');
        label.innerHTML = '<b></b><small></small>';
        label.querySelector('b').textContent = ch.name;
        label.querySelector('small').textContent = `Level ${ch.level}`;
        const acts = document.createElement('div');
        acts.className = 'acts';
        const playBtn = document.createElement('button');
        playBtn.textContent = 'Play';
        playBtn.className = 'primary';
        playBtn.onclick = () => play(ch.id);
        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.onclick = async () => {
          if (!confirm(`Delete ${ch.name} and everything they have? This can't be undone.`)) return;
          const reply = await link.request({ type: 'deleteChar', id: ch.id });
          if (reply.type === 'characters') render(reply);
        };
        acts.append(playBtn, del);
        row.append(label, acts);
        return row;
      }));
      document.getElementById('charpick-new').hidden = c.list.length >= c.max;
    };
    const create = () => openCreator({ link, chars, onMade: (reply) => { render(reply); play(reply.made); } });
    document.getElementById('charpick-new').onclick = create;
    render(chars);
    if (!chars.list.length) { say('Make your first character.'); pickEl.hidden = false; create(); return; }
    if (!switching && chars.last && chars.list.some((ch) => ch.id === chars.last)) { play(chars.last); return; }
    say('Pick a character, or make a new one.');
    pickEl.hidden = false;
  });
}

/** The character creator: name, stats (each from startStat, startPoints to place) and look, with a 3D preview. */
function openCreator({ link, chars, onMade }) {
  const el = document.getElementById('creator');
  const statsEl = document.getElementById('creator-stats');
  const lookEl = document.getElementById('creator-look');
  const pointsEl = document.getElementById('creator-points');
  const status = document.getElementById('creator-status');
  const nameIn = document.getElementById('creator-name');
  const base = chars.startStat ?? 5;
  const points = chars.startPoints ?? 15;
  const stats = Object.fromEntries(Object.keys(STATS).map((k) => [k, base]));
  const look = defaultLook(Math.floor(Math.random() * 100));
  const left = () => points - Object.values(stats).reduce((a, v) => a + v - base, 0);
  // The preview: the real model, turning slowly.
  const canvas = document.getElementById('creator-preview');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(220, 300, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 220 / 300, 0.1, 50);
  camera.position.set(0, 1.2, 5);
  camera.lookAt(0, 1.05, 0);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  let model = null;
  const rebuild = () => {
    if (model) scene.remove(model.root);
    model = buildAvatar(0, material, look);
    model.phone.visible = false; // (only out when you're on it)
    model.root.scale.setScalar(tallScale(stats));
    scene.add(model.root);
  };
  let spin = 0;
  let running = true;
  const frame = () => {
    if (!running) return;
    spin += 0.01;
    if (model) model.root.rotation.y = Math.PI + Math.sin(spin) * 0.8;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  const drawStats = () => {
    pointsEl.textContent = `(${left()} of ${points} points left${left() ? ': unspent ones become attribute points' : ''})`;
    statsEl.replaceChildren(...Object.entries(STATS).map(([k, def]) => {
      const row = document.createElement('div');
      row.className = 'cstat';
      row.innerHTML = `<div><span></span><small></small></div><button type="button">−</button><b></b><button type="button">+</button>`;
      row.querySelector('span').textContent = def.name;
      row.querySelector('small').textContent = def.effect ? def.effect : 'no effect yet';
      row.querySelector('b').textContent = String(stats[k]);
      const [minus, plus] = row.querySelectorAll('button');
      minus.disabled = stats[k] <= base;
      plus.disabled = left() <= 0;
      minus.onclick = () => { stats[k]--; drawStats(); if (k === 'tallness') rebuild(); };
      plus.onclick = () => { stats[k]++; drawStats(); if (k === 'tallness') rebuild(); };
      return row;
    }));
  };
  const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
  const drawLook = () => {
    const row = (label, items) => { const r = document.createElement('div'); r.className = 'clook'; const s = document.createElement('span'); s.textContent = label; r.append(s, ...items); return r; };
    const choice = (text, on, pick, colour = null) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (colour !== null) { b.className = `sw${on ? ' on' : ''}`; b.style.background = hex(colour); b.title = text; } else { b.textContent = text; if (on) b.className = 'on'; }
      b.onclick = () => { pick(); drawLook(); rebuild(); };
      return b;
    };
    const colourInput = (key) => { const i = document.createElement('input'); i.type = 'color'; i.value = hex(look[key]); i.oninput = () => { look[key] = parseInt(i.value.slice(1), 16); rebuild(); }; return i; };
    lookEl.replaceChildren(
      row('Head', Object.entries(HEADS).map(([k, n]) => choice(n, look.head === k, () => { look.head = k; }))),
      row('Skin', SKINS.map((c, i) => choice(`Fitzpatrick type ${SKIN_NAMES[i]}`, look.skin === i, () => { look.skin = i; }, c))),
      row('Hair', Object.entries(HAIRSTYLES).map(([k, n]) => choice(n, look.hair === k, () => { look.hair = k; }))),
      row('Hair colour', HAIR_COLORS.map((c) => choice('', look.hairColor === c, () => { look.hairColor = c; }, c))),
      row('Brows', Object.entries(BROWS).map(([k, n]) => choice(n, look.brows === k, () => { look.brows = k; }))),
      row('Shirt', [...SHIRT_COLORS.map((c) => choice('', look.shirt === c, () => { look.shirt = c; }, c)), colourInput('shirt')]),
      row('Trousers', [...PANTS_COLORS.map((c) => choice('', look.pants === c, () => { look.pants = c; }, c)), colourInput('pants')]),
    );
  };
  nameIn.value = '';
  nameIn.onkeydown = (e) => e.stopPropagation();
  status.textContent = '';
  drawStats();
  drawLook();
  rebuild();
  el.hidden = false;
  frame();
  nameIn.focus();
  const close = () => { running = false; renderer.dispose(); el.hidden = true; };
  document.getElementById('creator-cancel').onclick = () => { if (chars.list.length) close(); };
  document.getElementById('creator-make').onclick = async () => {
    const name = nameIn.value.trim();
    if (!name) { status.textContent = 'Give your character a name.'; nameIn.focus(); return; }
    const reply = await link.request({ type: 'createChar', name, look, stats });
    if (reply.type !== 'characters') { status.textContent = reply.reason; return; }
    close();
    onMade(reply);
  };
}
