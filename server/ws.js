// A minimal WebSocket server (RFC 6455) on Node's built-in modules, so the game server needs no
// npm packages. Handles text messages, fragmentation, ping/pong and close; that's all the game uses.
// Compression (permessage-deflate, RFC 7692) when the browser offers it: our messages are compressed with one
// deflate stream per connection (context kept, so a snapshot can refer back to the last one; zlib runs off the
// main thread, and a queue keeps messages in order); the browser's are compressed one at a time
// (client_no_context_takeover), so each inflates on its own.

import crypto from 'node:crypto';
import zlib from 'node:zlib';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1024 * 1024; // clients only send small JSON messages
const COMPRESS_MIN = 128; // bytes: smaller messages go as they are
const TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]); // what a sync flush ends with (left off on the wire)

/** Completes the upgrade handshake on an HTTP 'upgrade' request. Returns a Socket, or null. */
export function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  const deflate = /(^|,)\s*permessage-deflate\s*(;|,|$)/i.test(req.headers['sec-websocket-extensions'] || '');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    (deflate ? 'Sec-WebSocket-Extensions: permessage-deflate; client_no_context_takeover\r\n' : '') + '\r\n',
  );
  return new Socket(socket, deflate);
}

export class Socket {
  constructor(socket, deflate = false) {
    this.socket = socket;
    this.deflate = deflate;
    this.queue = []; // messages waiting for the compressor: { data, compress }
    this.queued = 0; // their bytes
    this.busy = false;
    if (deflate) {
      this.zip = zlib.createDeflateRaw({ level: 4, windowBits: 15, memLevel: 8 });
      this.zipOut = [];
      this.zip.on('data', (d) => this.zipOut.push(d));
      this.zip.on('error', () => this.close(1011));
    }
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
    return this.socket.writableLength + this.queued;
  }

  send(text) {
    if (!this.open) return;
    const data = Buffer.from(text, 'utf8');
    if (!this.deflate) return this._frame(0x1, data);
    this.queue.push({ data, compress: data.length >= COMPRESS_MIN });
    this.queued += data.length;
    this._pump();
  }

  /** Sends queued messages in order, compressing the bigger ones (one at a time through the shared stream). */
  _pump() {
    while (!this.busy && this.queue.length && this.open) {
      const m = this.queue.shift();
      if (!m.compress) {
        this.queued -= m.data.length;
        this._frame(0x1, m.data);
        continue;
      }
      this.busy = true;
      this.zip.write(m.data);
      this.zip.flush(zlib.constants.Z_SYNC_FLUSH, () => {
        this.busy = false;
        this.queued -= m.data.length;
        let out = Buffer.concat(this.zipOut);
        this.zipOut = [];
        if (out.length >= 4 && out.subarray(-4).equals(TAIL)) out = out.subarray(0, -4);
        if (this.open) this._frame(0x1, out, true);
        this._pump();
      });
    }
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
    this.queue = [];
    this.zip?.close();
    this.onclose?.();
  }

  _frame(opcode, payload, compressed = false) {
    const len = payload.length;
    const b0 = 0x80 | (compressed ? 0x40 : 0) | opcode; // (RSV1: compressed)
    let header;
    if (len < 126) {
      header = Buffer.from([b0, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = b0;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = b0;
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
      if ((b0 & 0x40) && !(this.deflate && (opcode === 0x1 || opcode === 0x2))) return this.close(1002); // (RSV1 only on a compressed message's first frame)
      this._message(fin, opcode, payload, (b0 & 0x40) !== 0);
    }
  }

  _message(fin, opcode, payload, compressed = false) {
    if (opcode === 0x8) return this.close(); // close
    if (opcode === 0x9) return this._frame(0xa, payload); // ping -> pong
    if (opcode === 0xa) return undefined; // pong
    if (opcode === 0x1 || opcode === 0x2) {
      this.fragments = [payload];
      this.textMessage = opcode === 0x1;
      this.compressed = compressed;
    } else if (opcode === 0x0) {
      this.fragments.push(payload);
    } else {
      return this.close(1002);
    }
    if (!fin) return undefined;
    let data = Buffer.concat(this.fragments);
    this.fragments = [];
    if (this.compressed) {
      // (browsers end each message with a sync flush, not a final block: finishFlush lets that count as the end)
      try { data = zlib.inflateRawSync(Buffer.concat([data, TAIL]), { maxOutputLength: MAX_MESSAGE, finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return this.close(1009); }
    }
    if (data.length > MAX_MESSAGE) return this.close(1009);
    if (this.textMessage) this.onmessage?.(data.toString('utf8'));
    return undefined;
  }
}
