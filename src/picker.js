// The hand picker: press Q (left hand) or E (right hand) to open your inventory as a grid of tiles
// on that side of the screen. Click a tile, or type to filter, with Tab completing names (Tab again
// cycles through matches). Arrow keys move around the grid, Enter picks, Esc cancels.

import { filterItems, tabComplete } from './items.js';

export class Picker {
  /**
   * @param {HTMLElement} root  the #picker element
   * @param {(kind: string) => HTMLCanvasElement} iconFor
   * @param {(hand: string, kind: string, viaKeyboardOrClick: boolean) => void} onPick
   * @param {() => void} onCancel
   */
  constructor(root, iconFor, onPick, onCancel) {
    this.root = root;
    this.iconFor = iconFor;
    this.onPick = onPick;
    this.onCancel = onCancel;
    this.title = root.querySelector('[data-title]');
    this.keyBadge = root.querySelector('kbd');
    this.input = root.querySelector('input');
    this.listEl = root.querySelector('[data-list]');
    this.hint = root.querySelector('[data-hint]');
    this.info = root.querySelector('[data-info]');
    this.items = [];
    this.shown = [];
    this.index = 0;
    this.hand = null;
    this.current = null;
    this.tab = null; // { base, i } while cycling completions with Tab

    this.input.addEventListener('input', () => {
      this.tab = null;
      this._render(0);
    });
    this.input.addEventListener('keydown', (e) => this._onKey(e));
    this.listEl.addEventListener('click', (e) => {
      const tile = e.target.closest('[data-i]');
      if (tile) this._pick(Number(tile.dataset.i));
    });
    this.listEl.addEventListener('mouseover', (e) => {
      const tile = e.target.closest('[data-i]');
      if (tile && Number(tile.dataset.i) !== this.index) this._highlight(Number(tile.dataset.i), false);
    });
    // Clicking the empty half of the screen cancels.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.cancel();
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /**
   * Opens on `hand`'s side with `items` ({ kind, name, category, desc, count }), `current` highlighted. `opts`
   * reuses the same panel for something else (the /give panel): { title, key, hint, placeholder, onPick,
   * onCancel, stay } (`stay`: picking doesn't close it, so you can pick several).
   */
  open(hand, items, current, opts = {}) {
    this.hand = hand;
    this.items = items;
    this.current = current;
    this.tab = null;
    this.opts = opts;
    this.root.hidden = false;
    this.root.dataset.side = hand;
    this.title.textContent = opts.title ?? (hand === 'left' ? 'Left hand' : 'Right hand');
    this.keyBadge.textContent = opts.key ?? (hand === 'left' ? 'Q' : 'E');
    this.hint.textContent = opts.hint ?? `${hand === 'left' ? 'Left' : 'Right'} click uses it · type to search · Tab completes · arrows move · Enter picks · Esc cancels`;
    this.input.placeholder = opts.placeholder ?? 'Search your inventory…';
    this.input.value = '';
    const start = Math.max(0, items.findIndex((i) => i.kind === current));
    this._render(start);
    this.input.focus();
  }

  close() {
    this.root.hidden = true;
    this.input.blur();
  }

  cancel() {
    this.close();
    (this.opts?.onCancel ?? this.onCancel)();
  }

  _onKey(e) {
    const cols = this._columns();
    if (e.key === 'ArrowDown') { e.preventDefault(); this._move(cols); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-cols); }
    else if (e.key === 'ArrowRight' && !this.input.value) { e.preventDefault(); this._move(1); }
    else if (e.key === 'ArrowLeft' && !this.input.value) { e.preventDefault(); this._move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); this._pick(this.index); }
    else if (e.key === 'Escape') { e.preventDefault(); this.cancel(); }
    else if (e.key === 'Tab') { e.preventDefault(); this._complete(e.shiftKey ? -1 : 1); }
  }

  _complete(step) {
    if (!this.tab) {
      const typed = this.input.value;
      const done = tabComplete(this.items, typed);
      if (done && done.length > typed.length) {
        this.input.value = done; // extend to the longest shared prefix (or the full unique name)
        this._render(0);
        return;
      }
      this.tab = { base: typed, i: -1 };
    }
    // Nothing more to extend: cycle through every match for what was typed.
    const matches = filterItems(this.items, this.tab.base);
    if (!matches.length) return;
    this.tab.i = (this.tab.i + step + matches.length) % matches.length;
    const item = matches[this.tab.i];
    this.input.value = item.name;
    this._render(0, this.tab.base);
    this._highlight(this.shown.indexOf(item));
  }

  _render(index, query = this.input.value) {
    this.shown = filterItems(this.items, query);
    this.listEl.replaceChildren(...this.shown.map((item, i) => {
      const tile = document.createElement('div');
      tile.className = 'pick-tile';
      tile.dataset.i = i;
      tile.title = item.name;
      tile.draggable = true; // drag it onto a hotbar (main.js)
      tile.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/x-game-kind', item.kind));
      if (item.kind === this.current) tile.classList.add('current');
      if (item.inOtherHand) tile.classList.add('other-hand');
      const name = document.createElement('span');
      name.className = 'pick-name';
      name.textContent = item.name;
      tile.append(this.iconFor(item.kind), name);
      if (item.count !== Infinity) {
        const count = document.createElement('span');
        count.className = 'pick-count';
        count.textContent = item.count > 999 ? '999+' : String(item.count);
        tile.append(count);
      }
      return tile;
    }));
    if (!this.shown.length) {
      const none = document.createElement('div');
      none.className = 'pick-none';
      none.textContent = 'Nothing matches.';
      this.listEl.append(none);
    }
    this._highlight(Math.min(index, this.shown.length - 1));
  }

  _highlight(i, scroll = true) {
    this.index = Math.max(0, i);
    [...this.listEl.children].forEach((tile, j) => tile.classList.toggle('active', j === this.index));
    if (scroll) this.listEl.children[this.index]?.scrollIntoView({ block: 'nearest' });
    // The highlighted tile's details, below the grid.
    const item = this.shown[this.index];
    this.info.replaceChildren();
    if (!item) return;
    const name = document.createElement('b');
    name.textContent = item.name + (item.kind === this.current ? ' · in hand' : '');
    const desc = document.createElement('small');
    desc.textContent = item.inOtherHand ? `In your ${item.inOtherHand} hand · picking it moves it here` : item.desc;
    this.info.append(name, desc);
  }

  /** Tiles per row, measured from the layout (it reflows with the panel's width). */
  _columns() {
    const tiles = [...this.listEl.children];
    if (tiles.length < 2) return 1;
    const top = tiles[0].offsetTop;
    const n = tiles.findIndex((t) => t.offsetTop !== top);
    return n < 0 ? tiles.length : n;
  }

  _move(step) {
    if (!this.shown.length) return;
    const next = this.index + step;
    if (Math.abs(step) > 1 && (next < 0 || next >= this.shown.length)) return; // up/down stop at the edges
    this._highlight((next + this.shown.length) % this.shown.length);
  }

  _pick(i) {
    const item = this.shown[i];
    if (!item) return;
    if (!this.opts?.stay) this.close();
    (this.opts?.onPick ?? this.onPick)(this.hand, item.kind);
  }
}
