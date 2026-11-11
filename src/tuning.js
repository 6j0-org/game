// Every gameplay number is a Server setting. Modules declare theirs here, with today's value as the
// default, and read the live value from `T` when they need it (never a copy taken at load time).
// The game fills `T` from its saved settings and changes it when someone moves a slider; the browser
// mirrors the server's. settings.js turns TUNABLES into the Server settings panel. No imports, no DOM.

/** Live values: setting key -> number (or boolean). */
export const T = {};
/** Every setting: key -> { group, name, desc, def, min, max, step, unit, type? }. */
export const TUNABLES = {};

/** A slider range that suits a default: 0 to about 5× it, in steps a tenth of its first digit. */
function autoRange(def) {
  if (typeof def === 'boolean') return { type: 'bool' };
  const mag = def > 0 ? 10 ** (Math.floor(Math.log10(def)) - 1) : 0.01;
  const step = Math.max(mag, 0.001);
  return { min: 0, max: Math.max(Math.round((def * 5) / step) * step, step * 20), step };
}

/**
 * Registers settings for a group: `defs` is { key: [default, name, desc?, extra?] }, where extra can set
 * min, max, step, unit. Values are readable straight away as T[key].
 */
export function tune(group, defs) {
  for (const [key, [def, name, desc = '', extra = {}]] of Object.entries(defs)) {
    TUNABLES[key] = { group, name, desc, def, unit: '', ...autoRange(def), ...extra };
    if (!(key in T)) T[key] = def;
  }
}

/**
 * Makes `obj[field]` a live setting: registers it (default: its current value) and turns the field into
 * a getter for T[key], so code reading obj[field] always sees the current setting.
 */
export function bindTunable(obj, field, group, key, name, desc = '', extra = {}) {
  tune(group, { [key]: [obj[field], name, desc, extra] });
  Object.defineProperty(obj, field, { get: () => T[key], enumerable: true, configurable: true });
}

/** Replaces the live values (keeps the same object, so every module sees the change). */
export function setTuning(values) {
  Object.assign(T, values);
}
