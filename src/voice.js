// Server voice, the browser's side. In multiplayer everyone is in one voice channel from the moment they
// join (the game keeps the member list: voiceroom.js). Audio goes straight from browser to browser with
// WebRTC, one connection per pair of players (a "mesh"), with no outside servers, so it works between
// players on the same network.
//
// Each voice you hear goes: WebRTC stream -> pitch shifter (shrunk players sound higher, enlarged ones
// lower) -> wall muffling -> volume (your setting for that player, times distance if you've set them to
// "nearby only") -> speakers. Players you've set to "nearby only" are also *in the world*: their voice
// comes from where they stand (3D panning, HRTF with the headphones option), walls between you muffle it,
// and it echoes like the space you're in (acoustics.js). Everyone else sounds like a call: flat, clear,
// from nowhere. Speakers can whisper or shout, which shrinks or stretches how far they carry for
// nearby-only listeners. The V menu (main.js) changes the settings; they're remembered here, by name.
//
// Browsers only let a page use the microphone on https:// or http://localhost. Without it you can still
// hear everyone; you just can't talk.

import { T } from './tuning.js';
import { Acoustics, muffle } from './acoustics.js';

export const micAvailable = () => !!navigator.mediaDevices?.getUserMedia;
const PREFS_KEY = 'game:voice';
const UPDATE_EVERY = 0.1; // seconds between volume/pitch updates (AudioParams are set, never scheduled)
/** How a body's size changes its voice: smaller is higher. Gentler than real physics, and capped at an octave each way. */
export const voicePitch = (scale) => Math.min(2, Math.max(0.5, (scale || 1) ** -0.5));
/** Volume for a "nearby only" voice at `dist` blocks: full within voiceNear, fading to silence at voiceRange. */
/** How far a whispering or shouting voice carries, compared with talking (server settings). */
export const voiceReach = (mode) => (mode === 'whisper' ? T.voiceWhisper / 100 : mode === 'shout' ? T.voiceShout / 100 : 1);
export function nearbyVolume(dist, near = T.voiceNear, range = T.voiceRange) {
  if (dist <= near) return 1;
  if (dist >= range) return 0;
  const t = (range - dist) / Math.max(0.001, range - near);
  return t * t; // fades quickly at first, then trails off
}

export class Voice {
  /**
   * @param {object} o
   * @param {(msg:object) => void} o.send   a { op, ... } voice message to the game
   * @param {number} o.myId
   * @param {{get(k:string):string|null, set(k:string,v:string):void}} o.store
   * @param {(text:string) => void} o.note  something worth telling the player ("Sam joined voice")
   */
  constructor({ send, myId, store, note }) {
    Object.assign(this, { send, myId, store, note });
    this.peers = new Map(); // player id -> { pc, pendingIce, connected, el, src, shift, lp, gain, panner, analyser, level, ratio, near }
    this.members = []; // everyone else in voice: [{ id, name }] in join order
    this.joined = false;
    this.mic = null;
    this.micState = 'asking'; // asking | on | unavailable (no https) | denied
    this.ctx = null;
    this.workletReady = Promise.resolve(false);
    this.updateT = 0;
    this.hrtf = false; // HRTF panning for nearby voices (the "3D sound for headphones" option)
    this.occlusion = null; // (from, to) => how much wall is between (main.js sets it)
    this.acoustics = null; // the space you're in, for nearby voices
    this.prefs = { master: 1, micOn: true, players: {} };
    try { Object.assign(this.prefs, JSON.parse(store.get(PREFS_KEY)) || {}); } catch { /* defaults */ }
  }

  // ---------- settings (the V menu) ----------

  /** Your settings for a player: { vol (0-2), near (heard only nearby) }. */
  prefFor(name) {
    return { vol: 1, near: false, ...this.prefs.players[name] };
  }

  setPlayer(name, changes) {
    this.prefs.players[name] = { ...this.prefFor(name), ...changes };
    this._save();
    this.updateT = 0;
  }

  setMaster(v) {
    this.prefs.master = v;
    this._save();
    this.updateT = 0;
  }

  setMic(on) {
    this.prefs.micOn = on;
    for (const t of this.mic?.getTracks() || []) t.enabled = on;
    this._save();
  }

  _save() {
    this.store.set(PREFS_KEY, JSON.stringify(this.prefs));
  }

  // ---------- joining ----------

  /** Joins server voice: asks for the microphone, then tells the game. Call once, when connected. */
  async start() {
    if (this.joined) return;
    this.joined = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      this.ctx = new AC();
      this.acoustics = new Acoustics(this.ctx);
      this.acoustics.setAmount(this.echo ?? 1);
      this.acoustics.output.connect(this.ctx.destination);
      this.workletReady = this.ctx.audioWorklet
        ? this.ctx.audioWorklet.addModule(new URL('./pitchshift.worklet.js', import.meta.url)).then(() => true, () => false)
        : Promise.resolve(false);
    }
    if (!micAvailable()) this.micState = 'unavailable';
    else {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        this.micState = 'on';
        this.setMic(this.prefs.micOn);
      } catch {
        this.micState = 'denied'; // refused or no microphone: listen-only
      }
    }
    this.send({ op: 'join' });
  }

  /** Browsers start audio only after a click or key press: call this from one. */
  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // ---------- from the game ----------

  async onMessage(m) {
    if (m.op === 'room') return this._room(m.members || []);
    if (m.op === 'signal') return this._signal(m.from, m.signal);
    return undefined;
  }

  async _room(list) {
    const meAt = list.findIndex((p) => p.id === this.myId);
    if (meAt < 0) return;
    const before = new Map(this.members.map((p) => [p.id, p.name]));
    this.members = list.filter((p) => p.id !== this.myId);
    if (this.inRoom) { // (no news about the people who were already there when you joined)
      const joined = this.members.filter((p) => !before.has(p.id));
      const left = [...before].filter(([id]) => !this.members.some((p) => p.id === id));
      if (joined.length) this.note(`🔊 ${joined.map((p) => p.name).join(' and ')} joined voice`);
      if (left.length) this.note(`🔇 ${left.map(([, n]) => n).join(' and ')} left voice`);
    }
    this.inRoom = true;
    for (const id of [...this.peers.keys()]) if (!this.members.some((p) => p.id === id)) this._closePeer(id);
    // Each pair connects once: whoever joined later makes the offer.
    for (const [i, p] of list.entries()) {
      if (i >= meAt || this.peers.has(p.id)) continue;
      const peer = this._peer(p.id);
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      this.send({ op: 'signal', to: p.id, signal: { kind: 'offer', sdp: peer.pc.localDescription.sdp } });
    }
  }

  async _signal(from, s) {
    if (!this.members.some((p) => p.id === from) || !s) return;
    if (s.kind === 'offer') {
      this._closePeer(from); // a fresh offer replaces any old connection
      const peer = this._peer(from);
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      await this._flushIce(peer);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      this.send({ op: 'signal', to: from, signal: { kind: 'answer', sdp: peer.pc.localDescription.sdp } });
      return;
    }
    const peer = this.peers.get(from);
    if (!peer) return;
    if (s.kind === 'answer') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
      await this._flushIce(peer);
    } else if (s.kind === 'ice') {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(s.candidate).catch(() => {});
      else peer.pendingIce.push(s.candidate);
    }
  }

  // ---------- connections and audio ----------

  _peer(id) {
    const pc = new RTCPeerConnection({ iceServers: [] }); // local network only, no outside servers
    const peer = { pc, pendingIce: [], connected: false, el: null, src: null, shift: null, lp: null, gain: null, panner: null, analyser: null, level: 0, ratio: 1, near: null, occludeT: 0 };
    this.peers.set(id, peer);
    if (this.mic) for (const t of this.mic.getTracks()) pc.addTrack(t, this.mic);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ op: 'signal', to: id, signal: { kind: 'ice', candidate: e.candidate.toJSON() } }); };
    pc.ontrack = (e) => this._attach(id, peer, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      peer.connected = pc.connectionState === 'connected';
      if (pc.connectionState === 'failed') {
        const name = this.members.find((p) => p.id === id)?.name || 'someone';
        this._closePeer(id);
        this.note(`Couldn't connect voice to ${name}`);
      }
    };
    return peer;
  }

  async _attach(id, peer, stream) {
    // Chrome only lets a remote WebRTC stream into Web Audio while it's also playing in a media element (muted here).
    peer.el = peer.el || new window.Audio();
    peer.el.muted = true;
    peer.el.srcObject = stream;
    peer.el.play().catch(() => {});
    if (!this.ctx) { // no Web Audio at all: just play it (no per-player volume or pitch)
      peer.el.muted = false;
      return;
    }
    const worklet = await this.workletReady;
    if (this.peers.get(id) !== peer) return;
    this._disconnect(peer);
    peer.src = this.ctx.createMediaStreamSource(stream);
    peer.gain = this.ctx.createGain();
    peer.gain.gain.value = 0; // set properly by the next update()
    peer.analyser = this.ctx.createAnalyser();
    peer.analyser.fftSize = 256;
    peer.shift = worklet ? new AudioWorkletNode(this.ctx, 'pitch-shift', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }) : null;
    peer.lp = this.ctx.createBiquadFilter(); // walls (nearby-only voices)
    peer.lp.type = 'lowpass';
    peer.lp.frequency.value = 20000;
    peer.panner = new PannerNode(this.ctx, { panningModel: this.hrtf ? 'HRTF' : 'equalpower', distanceModel: 'linear', rolloffFactor: 0 }); // direction only: volume is ours
    if (peer.shift) peer.src.connect(peer.shift).connect(peer.lp).connect(peer.gain);
    else peer.src.connect(peer.lp).connect(peer.gain);
    peer.src.connect(peer.analyser); // how loud they're talking (for the speaking light), before your volume
    peer.near = null; // routed by the next update()
    this.updateT = 0;
  }

  _disconnect(peer) {
    for (const n of [peer.src, peer.shift, peer.lp, peer.gain, peer.panner, peer.analyser]) n?.disconnect();
    peer.src = peer.shift = peer.lp = peer.gain = peer.panner = peer.analyser = null;
  }

  /** Nearby-only voices go through a panner into the room; the rest straight to the speakers. */
  _route(peer, near) {
    if (peer.near === near) return;
    peer.near = near;
    peer.gain.disconnect();
    peer.panner.disconnect();
    if (near) peer.gain.connect(peer.panner).connect(this.acoustics.input);
    else peer.gain.connect(this.ctx.destination);
    if (!near) { peer.lp.frequency.value = 20000; peer.muffle = 1; }
  }

  setHrtf(on) {
    this.hrtf = !!on;
    for (const peer of this.peers.values()) if (peer.panner) peer.panner.panningModel = on ? 'HRTF' : 'equalpower';
  }

  /** The "Room echo" setting, for nearby voices too. */
  setEcho(k) {
    this.echo = k;
    this.acoustics?.setAmount(k);
  }

  /** The space you're in (acoustics.js probeSpace), for nearby voices. */
  setSpace(state) {
    this.acoustics?.set(state);
  }

  _closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    this._disconnect(peer);
    if (peer.el) peer.el.srcObject = null;
    this.peers.delete(id);
  }

  async _flushIce(peer) {
    for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  /**
   * Every frame: volumes (your settings, and distance for "nearby only" players), where nearby voices come
   * from and what's in the way, pitch from body size, and who's talking. `players` maps id -> { pos, scale,
   * voice ('whisper'|'shout'|null) }; `ear` is your head and `forward` where you're looking. Throttled.
   */
  update(dt, players, ear, forward) {
    if ((this.updateT -= dt) > 0) return;
    const step = UPDATE_EVERY - this.updateT;
    this.updateT = UPDATE_EVERY;
    const buf = new Uint8Array(128);
    if (this.ctx && ear && forward) {
      const L = this.ctx.listener;
      if (L.positionX) {
        L.positionX.value = ear.x; L.positionY.value = ear.y; L.positionZ.value = ear.z;
        L.forwardX.value = forward.x; L.forwardY.value = forward.y; L.forwardZ.value = forward.z;
      } else {
        L.setPosition(ear.x, ear.y, ear.z);
        L.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
      }
      this.acoustics.tick(step);
    }
    for (const m of this.members) {
      const peer = this.peers.get(m.id);
      if (!peer?.gain) continue;
      const pref = this.prefFor(m.name);
      const p = players.get(m.id);
      const mouth = p ? { x: p.pos.x, y: p.pos.y + 1.5 * (p.scale || 1), z: p.pos.z } : null;
      const dist = mouth && ear ? Math.hypot(mouth.x - ear.x, mouth.y - ear.y, mouth.z - ear.z) : Infinity;
      const near = pref.near && !!mouth;
      this._route(peer, near);
      const reach = voiceReach(p?.voice);
      if (near) {
        peer.panner.positionX.value = mouth.x;
        peer.panner.positionY.value = mouth.y;
        peer.panner.positionZ.value = mouth.z;
        if ((peer.occludeT -= step) <= 0) { // walls in the way, a few times a second
          peer.occludeT = 0.25;
          const mu = this.occlusion && dist < T.voiceRange * reach ? muffle(this.occlusion(ear, mouth)) : null;
          peer.lp.frequency.value = mu ? mu.cutoff : 20000;
          peer.muffle = mu ? mu.gain : 1;
        }
      }
      const vol = this.prefs.master * pref.vol
        * (pref.near ? nearbyVolume(dist, T.voiceNear * reach, T.voiceRange * reach) * (peer.muffle ?? 1) : 1);
      if (Math.abs(peer.gain.gain.value - vol) > 0.001) peer.gain.gain.value = vol;
      const ratio = voicePitch(p?.scale);
      if (peer.shift && Math.abs(peer.ratio - ratio) > 0.001) {
        peer.ratio = ratio;
        peer.shift.parameters.get('ratio').value = ratio;
      }
      peer.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) * (v - 128);
      peer.level = Math.sqrt(sum / buf.length) / 128;
      peer.heard = vol > 0.001; // (for the menu: muted by distance or by you)
    }
  }

  /** Is this player talking (and loud enough to hear, after your settings)? For the menu and the icons over heads. */
  talking(id) {
    const peer = this.peers.get(id);
    return !!peer && (peer.level || 0) > 0.04 && peer.heard !== false;
  }

  /** For the V menu: everyone in voice with their state. */
  roster() {
    return this.members.map((m) => {
      const peer = this.peers.get(m.id);
      return { ...m, connected: !!peer?.connected, talking: this.talking(m.id), heard: peer?.heard !== false };
    });
  }
}
