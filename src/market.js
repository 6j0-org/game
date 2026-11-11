// The ZEC/USD exchange rate: things are priced in dollars, paid for in Zcash at whatever the rate
// is right now, and the rate is wild. A random walk in log space (about ±8% a second), loosely pulled
// back towards $30, with the odd crash or pump of 30-80% in one go. No Three.js, no DOM.
import { T, tune, bindTunable } from './tuning.js';

// Server settings (tuning.js): read the live values as T.key.
tune('Economy', {
  baseRate: [30, 'Zcash base rate', 'USD per ZEC the market drifts back towards', { unit: '$', min: 1 }],
  rateSwing: [0.08, 'Zcash swing size', 'Typical swing per second (times Zcash volatility)'],
  ratePull: [0.02, 'Zcash pull to base', 'How strongly the rate drifts back towards the base rate'],
  rateShock: [0.012, 'Zcash crash/pump chance', 'Chance per second of a 30-80% crash or pump'],
  minRate: [1, 'Zcash minimum rate', 'The rate never goes below this', { unit: '$', min: 0.1 }],
  maxRate: [600, 'Zcash maximum rate', 'The rate never goes above this', { unit: '$', min: 10 }],
});


const gaussian = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

/** The rate after `dt` seconds (call about once a second). `wild` scales the swings and shocks (a server setting). */
export function nextRate(rate, dt, rand = Math.random, wild = 1) {
  let lr = Math.log(rate);
  lr += (Math.log(T.baseRate) - lr) * T.ratePull * dt + gaussian(rand) * T.rateSwing * wild * Math.sqrt(dt);
  if (rand() < T.rateShock * wild * dt) lr += (rand() < 0.5 ? -1 : 1) * (0.3 + rand() * 0.5) * Math.min(1, wild); // crash or pump
  return Math.min(T.maxRate, Math.max(T.minRate, Math.exp(lr)));
}

/** ZEC needed for a dollar price at this rate, rounded up to the cent of a ZEC. */
export const zecFor = (usd, rate) => Math.ceil((usd / rate) * 100) / 100;

export const round2 = (v) => Math.round(v * 100) / 100;

export const usd = (v) => `$${v.toFixed(2)}`;
