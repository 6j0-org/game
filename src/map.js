// The Tab map: a top-down view of the terrain around you, with everyone's phone marked on it.
// Terrain comes from the world generator (fast), so it shows the land as generated, not every edit.

import { SEA } from './world.js';

const SIZE = 256; // blocks across, centred on you
const REDRAW_AFTER = 16; // re-render the terrain after you move this far

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const COLORS = {
  deep: rgb(0x2f5fb3), shallow: rgb(0x4a86d6), sand: rgb(0xe3d29a), grass: rgb(0x5fa84a),
  forest: rgb(0x2f6b2c), stone: rgb(0x8b8f96),
};

export function playerColor(id) {
  return `hsl(${Math.round((((id * 0.61803) % 1) + 1) % 1 * 360)}, 55%, 50%)`;
}

export class MapView {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.terrain = document.createElement('canvas');
    this.terrain.width = this.terrain.height = SIZE;
    this.centre = null;
  }

  _renderTerrain(cx, cz) {
    const ctx = this.terrain.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    const half = SIZE / 2;
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const x = cx - half + i;
        const z = cz - half + j;
        const h = this.world.heightAt(x, z);
        let c;
        if (h < SEA - 3) c = COLORS.deep;
        else if (h < SEA) c = COLORS.shallow;
        else if (h <= SEA + 1) c = COLORS.sand;
        else if (h > 46) c = COLORS.stone;
        else c = this.world.treeAt(x, z) ? COLORS.forest : COLORS.grass;
        const shade = 0.75 + Math.min(0.4, (h - SEA) / 60); // higher ground is lighter
        const k = (j * SIZE + i) * 4;
        img.data[k] = Math.min(255, c[0] * shade);
        img.data[k + 1] = Math.min(255, c[1] * shade);
        img.data[k + 2] = Math.min(255, c[2] * shade);
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.centre = { x: cx, z: cz };
  }

  /**
   * @param me      { x, z, yaw, name, bed: {x,y,z}|null, quests?: [{ x, z, label, color }] }
   * @param others  [{ id, name, x, z }]
   */
  draw(me, others) {
    const cx = Math.round(me.x);
    const cz = Math.round(me.z);
    if (!this.centre || Math.hypot(cx - this.centre.x, cz - this.centre.z) > REDRAW_AFTER) this._renderTerrain(cx, cz);
    const { ctx, canvas } = this;
    const W = canvas.width;
    const scale = W / SIZE;
    // Map world coordinates to canvas pixels (north = -z is up).
    const toPx = (x, z) => [(x - this.centre.x + SIZE / 2) * scale, (z - this.centre.z + SIZE / 2) * scale];

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, 0, 0, W, W);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';

    for (const p of others) {
      let [px, py] = toPx(p.x, p.z);
      const off = px < 8 || py < 8 || px > W - 8 || py > W - 8;
      px = Math.min(W - 10, Math.max(10, px));
      py = Math.min(W - 10, Math.max(10, py));
      this._phone(px, py, playerColor(p.id));
      const dist = Math.round(Math.hypot(p.x - me.x, p.z - me.z));
      this._label(p.name + (off ? ` · ${dist} m` : ''), px, py - 16);
    }

    // Your bed (where you respawn), pinned to the edge with its distance if it's off the map.
    if (me.bed) {
      let [bx, by] = toPx(me.bed.x + 0.5, me.bed.z + 0.5);
      const off = bx < 10 || by < 10 || bx > W - 10 || by > W - 10;
      bx = Math.min(W - 12, Math.max(12, bx));
      by = Math.min(W - 12, Math.max(12, by));
      this._bed(bx, by);
      const dist = Math.round(Math.hypot(me.bed.x + 0.5 - me.x, me.bed.z + 0.5 - me.z));
      this._label(`Bed${off ? ` · ${dist} m` : ''}`, bx, by + 24);
    }

    // Quest markers (quests.js): lost things, gardens to till, people waiting for you. Pinned to the edge like the bed.
    for (const q of me.quests || []) {
      let [qx, qy] = toPx(q.x, q.z);
      const off = qx < 10 || qy < 10 || qx > W - 10 || qy > W - 10;
      qx = Math.min(W - 12, Math.max(12, qx));
      qy = Math.min(W - 12, Math.max(12, qy));
      this._questMark(qx, qy, q.color);
      const dist = Math.round(Math.hypot(q.x - me.x, q.z - me.z));
      this._label(`${q.label}${off ? ` · ${dist} m` : ''}`, qx, qy + 22);
    }

    // You: an arrow pointing where you face.
    const [mx, my] = toPx(me.x, me.z);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-me.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#ffcf5a';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    this._label('You', mx, my - 16);

    ctx.fillStyle = 'rgba(10,14,26,0.65)';
    ctx.fillRect(W - 34, 8, 26, 26);
    ctx.fillStyle = '#fff';
    ctx.fillText('N', W - 21, 26);
  }

  /** A little bed seen from above: frame, quilt and pillow. */
  _bed(x, y) {
    const { ctx } = this;
    ctx.fillStyle = '#684828';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 8, y - 11, 16, 22, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#c44652';
    ctx.fillRect(x - 6, y - 3, 12, 12);
    ctx.fillStyle = '#e8c478';
    ctx.fillRect(x - 2, y - 3, 4, 12);
    ctx.fillStyle = '#f4f4fa';
    ctx.fillRect(x - 6, y - 9, 12, 5);
  }

  /** A quest marker: a diamond with an exclamation mark. */
  _questMark(x, y, color) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x + 9, y);
    ctx.lineTo(x, y + 10);
    ctx.lineTo(x - 9, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(x - 1, y - 6, 2, 7);
    ctx.fillRect(x - 1, y + 3, 2, 2);
  }

  _phone(x, y, color) {
    const { ctx } = this;
    ctx.fillStyle = '#16181d';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 6, y - 10, 12, 20, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x - 4, y - 7, 8, 12);
  }

  _label(text, x, y) {
    const { ctx } = this;
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(10,14,26,0.7)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 14, w, 18, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
  }
}
