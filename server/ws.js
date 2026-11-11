// A minimal WebSocket server (RFC 6455) on Node's built-in modules, so the game server needs no
// npm packages. Handles text messages, fragmentation, ping/pong and close; that's all the game uses.

import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1024 * 1024; // clients only send small JSON messages

/** Completes the upgrade handshake on an HTTP 'upgrade' request. Returns a Socket, or null. */
export function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new Socket(socket);
}

export class Socket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.open = true;
    this.onmessage = null; // (text) => void
    this.onclose = null; // () => void
    socket.setNoDelay(true);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  /** Bytes queued but not yet sent (used to skip updates for a slow client). */
  get backlog() {
    return this.socket.writableLength;
  }

  send(text) {
    if (this.open) this._frame(0x1, Buffer.from(text, 'utf8'));
  }

  close(code = 1000) {
    if (!this.open) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    try { this._frame(0x8, payload); } catch { /* socket already gone */ }
    this.socket.end();
    this._closed();
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.onclose?.();
  }

  _frame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  _data(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.open && this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      if (!(b1 & 0x80)) return this.close(1002); // clients must mask their frames
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.close(1009);
        len = Number(big);
        offset = 10;
      }
      if (len > MAX_MESSAGE) return this.close(1009);
      if (this.buffer.length < offset + 4 + len) return; // wait for the rest
      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = this.buffer.subarray(offset + 4 + len);
      this._message(fin, opcode, payload);
    }
  }

  _message(fin, opcode, payload) {
    if (opcode === 0x8) return this.close(); // close
    if (opcode === 0x9) return this._frame(0xa, payload); // ping -> pong
    if (opcode === 0xa) return undefined; // pong
    if (opcode === 0x1 || opcode === 0x2) {
      this.fragments = [payload];
      this.textMessage = opcode === 0x1;
    } else if (opcode === 0x0) {
      this.fragments.push(payload);
    } else {
      return this.close(1002);
    }
    if (!fin) return undefined;
    const data = Buffer.concat(this.fragments);
    this.fragments = [];
    if (data.length > MAX_MESSAGE) return this.close(1009);
    if (this.textMessage) this.onmessage?.(data.toString('utf8'));
    return undefined;
  }
}
