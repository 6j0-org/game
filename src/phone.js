// The phone: it's CONSUME, the shop you order from (a drone delivers). Chat is the console (T), and its
// messages land in the message log; the map is Tab; talking is server voice (voice.js, Settings > Voice).

/** Tiny DOM builder: h('div', { class: 'x', onclick }, 'text', child). Text is never parsed as HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c != null && c !== false));
  return el;
}

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class PhoneApps {
  /**
   * @param {object} o
   * @param {HTMLElement} o.appEl     where the screen is drawn (on top of the swirls)
   * @param {() => void} o.putAway
   * @param {{view: import('./tileshop.js').TileShop, orders: () => Array<{kind:string,t:number}>, wallet: () => string, name: (kind:string) => string, fee: number, minutes: number}} o.shop
   */
  constructor(o) {
    Object.assign(this, o);
    this.open = false;
  }

  /** Draws the phone (CONSUME) from scratch: when it's taken out. */
  render() {
    if (!this.open) return;
    this.walletEl = h('div', { class: 'shop-wallet' });
    this.ordersEl = h('div', { class: 'shop-orders' });
    this.ordersKey = null;
    const body = h('div', { class: 'phone-shop' },
      h('h3', {}, 'CONSUME'),
      h('div', { class: 'phone-hint' }, `Everything, delivered in ${this.shop.minutes} minutes. ${this.shop.fee}% delivery fee. Double-click or Enter orders.`),
      this.walletEl, this.shop.view.el, this.ordersEl);
    const footer = h('div', { class: 'phone-footer' }, h('span'), h('button', { class: 'put-away', onclick: () => this.putAway() }, 'Put away'));
    this.appEl.replaceChildren(body, footer);
    this._tick();
    this.shop.view.focus();
  }

  /** Every frame: prices, your wallet and deliveries on the way, without losing focus or typing. */
  tick() {
    if (this.open && this.walletEl) this._tick();
  }

  _tick() {
    this.shop.view.refresh();
    const wallet = this.shop.wallet();
    if (this.walletEl.textContent !== wallet) this.walletEl.textContent = wallet;
    const orders = this.shop.orders();
    const key = JSON.stringify(orders);
    if (key === this.ordersKey) return;
    this.ordersKey = key;
    this.ordersEl.replaceChildren(...(orders.length ? [h('b', {}, `On the way (${orders.length})`),
      ...orders.map((o) => h('div', { class: 'shop-order' }, h('span', {}, this.shop.name(o.kind)), h('span', {}, o.drone ? '🚁 flying' : clock(o.t * 1000))))] : []));
  }
}
