// Server voice, the game's side: everyone in a multiplayer game is in one voice channel. The audio goes
// browser to browser (voice.js, a WebRTC mesh: one connection per pair of players); the game only keeps
// the member list and relays set-up signals between members. No Three.js, no DOM.
//
// Messages from a player ({ type: 'voice', op, ... }):
//   join                  ready (the browser has asked for its microphone): add me
//   signal { to, signal } WebRTC set-up for another member: { kind: offer|answer|ice, ... }
// Messages to players ({ type: 'voice', op, ... }):
//   room { members:[{id,name}] }  everyone in voice, in join order (each pair connects once: the later joiner offers)
//   signal { from, signal }       set-up data from another member

import { tune } from './tuning.js';

// How far voices carry for players you've set to "nearby only" (the V menu). Each listener picks who's
// nearby-only; these say what "nearby" means, the same for everyone.
tune('World', {
  voiceNear: [4, 'Voice: full volume within', 'Players set to "nearby only" in the voice menu (V) are at full volume this close', { unit: ' blocks', min: 0, max: 64, step: 1 }],
  voiceRange: [32, 'Voice: silent beyond', 'Players set to "nearby only" fade out with distance and can\'t be heard past this', { unit: ' blocks', min: 1, max: 256, step: 1 }],
  voiceWhisper: [25, 'Voice: whisper reach', 'How far a whisper (hold Z) carries for "nearby only" listeners, compared with talking', { unit: '%', min: 5, max: 100, step: 5 }],
  voiceShout: [250, 'Voice: shout reach', 'How far a shout (hold X) carries for "nearby only" listeners, compared with talking', { unit: '%', min: 100, max: 1000, step: 25 }],
});

const SIGNAL_KINDS = ['offer', 'answer', 'ice'];
const SIGNAL_MAX = 20000; // bytes per set-up message

export class VoiceRoom {
  /**
   * @param {(id:number, msg:object) => void} send
   * @param {(id:number) => string|null} nameOf  null if that player isn't online
   */
  constructor(send, nameOf) {
    this.send = send;
    this.nameOf = nameOf;
    this.members = []; // player ids, in join order
  }

  handle(from, msg) {
    if (msg.op === 'join') {
      if (!this.members.includes(from)) this.members.push(from);
      this.update();
      return;
    }
    if (msg.op === 'signal') {
      const s = msg.signal;
      if (!this.members.includes(from) || !this.members.includes(msg.to) || msg.to === from) return;
      if (!s || !SIGNAL_KINDS.includes(s.kind) || JSON.stringify(s).length > SIGNAL_MAX) return;
      this.send(msg.to, { type: 'voice', op: 'signal', from, signal: s });
    }
  }

  /** A player left the game. */
  drop(id) {
    if (!this.members.includes(id)) return;
    this.members = this.members.filter((m) => m !== id);
    this.update();
  }

  /** Tell everyone who's in voice (after joins, leaves and renames). */
  update() {
    this.members = this.members.filter((id) => this.nameOf(id) != null);
    const msg = { type: 'voice', op: 'room', members: this.members.map((id) => ({ id, name: this.nameOf(id) })) };
    for (const m of this.members) this.send(m, msg);
  }
}
