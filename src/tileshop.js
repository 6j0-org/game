// A shop as a grid of tiles, in the same style as the Q/E hand picker: used by the 3D Printer and by
// CONSUME on the phone. Type to filter, arrows move, click a tile to select it, and Enter or the
// button buys the selected item. Prices change all the time (the ZEC rate), so `refresh()` updates
// the labels in place without rebuilding the grid.

import { filterItems } from './items.js';

export class TileShop {
  /**
   * @param {object} o
   * @param {(kind: string) => HTMLCanvasElement} o.iconFor
   * @param {string} o.action   the buy button's label ('Print', 'Order')
   * @param {(kind: string) => {price: string, detail: string, owned: number, canBuy: boolean, why?: string}} o.live  (`why`: the button's label when you can't buy)
   * @param {(kind: string) => void} o.onBuy
   */
  constructor({ iconFor, action, live, onBuy }) {
    Object.assign(this, { iconFor, action, live, onBuy });
    this.items = [];
    this.shown = [];
    this.index = 0;
    this.el = document.createElement('div');
    this.el.className = 'tile-shop';
    this.input = document.createElement('input');
    this.input.placeholder = 'Search…';
    this.input.spellcheck = false;
    this.grid = document.createElement('div');
    this.grid.className = 'tile-grid';
    this.info = document.createElement('div');
    this.info.className = 'tile-info';
    this.infoText = document.createElement('div');
    this.button = document.createElement('button');
    this.button.addEventListener('click', () => this._buy());
    this.info.append(this.infoText, this.button);
    this.el.append(this.input, this.grid, this.info);

    this.input.addEventListener('input', () => this._render(0));
    this.input.addEventListener('keydown', (e) => this._onKey(e));
    this.grid.addEventListener('click', (e) => {
      const tile = e.target.closest('[data-i]');
      if (tile) this._highlight(Number(tile.dataset.i), false);
    });
    this.grid.addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-i]')) this._buy();
    });
  }

  /** `items`: [{ kind, name, category, desc }]. */
  setItems(items) {
    this.items = items;
    this._render(0);
  }

  focus() {
    this.input.focus();
  }

  _onKey(e) {
    if (e.key === 'Escape') { this.input.blur(); return; } // let the menu close
    e.stopPropagation(); // typing here never reaches the game
    const cols = this._columns();
    if (e.key === 'ArrowDown') { e.preventDefault(); this._move(cols); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-cols); }
    else if (e.key === 'ArrowRight' && !this.input.value) { e.preventDefault(); this._move(1); }
    else if (e.key === 'ArrowLeft' && !this.input.value) { e.preventDefault(); this._move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); this._buy(); }
  }

  _render(index) {
    this.shown = filterItems(this.items, this.input.value);
    this.grid.replaceChildren(...this.shown.map((item, i) => {
      const tile = document.createElement('div');
      tile.className = 'pick-tile';
      tile.dataset.i = i;
      tile.title = item.name;
      const name = document.createElement('span');
      name.className = 'pick-name';
      name.textContent = item.name;
      const price = document.createElement('span');
      price.className = 'pick-price';
      const count = document.createElement('span');
      count.className = 'pick-count';
      tile.append(this.iconFor(item.kind), name, price, count);
      return tile;
    }));
    if (!this.shown.length) {
      const none = document.createElement('div');
      none.className = 'pick-none';
      none.textContent = 'Nothing matches.';
      this.grid.append(none);
    }
    this._highlight(Math.min(index, this.shown.length - 1));
  }

  _highlight(i, scroll = true) {
    this.index = Math.max(0, i);
    [...this.grid.children].forEach((tile, j) => tile.classList.toggle('active', j === this.index));
    if (scroll) this.grid.children[this.index]?.scrollIntoView({ block: 'nearest' });
    this.infoKey = null;
    this.refresh();
  }

  /** Update prices, counts and the buy button (call often: the rate moves every second). */
  refresh() {
    this.shown.forEach((item, i) => {
      const tile = this.grid.children[i];
      const l = this.live(item.kind);
      const price = tile.querySelector('.pick-price');
      if (price.textContent !== l.price) price.textContent = l.price;
      const count = tile.querySelector('.pick-count');
      const c = l.owned > 0 ? (l.owned > 999 ? '999+' : String(l.owned)) : '';
      if (count.textContent !== c) { count.textContent = c; count.hidden = !c; }
      tile.classList.toggle('unaffordable', !l.canBuy);
    });
    const item = this.shown[this.index];
    this.info.hidden = !item;
    if (!item) return;
    const l = this.live(item.kind);
    const key = `${item.kind}|${l.detail}`;
    if (key !== this.infoKey) {
      this.infoKey = key;
      const name = document.createElement('b');
      name.textContent = item.name;
      const desc = document.createElement('small');
      desc.textContent = item.desc;
      const detail = document.createElement('small');
      detail.className = 'tile-detail';
      detail.textContent = l.detail;
      this.infoText.replaceChildren(name, desc, detail);
    }
    // Only touch the button when something changed: rewriting its text every frame eats clicks.
    const label = l.canBuy ? this.action : (l.why || 'Can\'t afford');
    if (this.button.textContent !== label) this.button.textContent = label;
    if (this.button.disabled !== !l.canBuy) this.button.disabled = !l.canBuy;
  }

  /** Tiles per row, measured from the layout. */
  _columns() {
    const tiles = [...this.grid.children];
    if (tiles.length < 2) return 1;
    const top = tiles[0].offsetTop;
    const n = tiles.findIndex((t) => t.offsetTop !== top);
    return n < 0 ? tiles.length : n;
  }

  _move(step) {
    if (!this.shown.length) return;
    const next = this.index + step;
    if (Math.abs(step) > 1 && (next < 0 || next >= this.shown.length)) return;
    this._highlight((next + this.shown.length) % this.shown.length);
  }

  _buy() {
    const item = this.shown[this.index];
    if (!item || !this.live(item.kind).canBuy) return;
    this.onBuy(item.kind);
  }
}
