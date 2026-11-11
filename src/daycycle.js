// Time of day. `time` runs 0 -> 1 over one day: 0 = sunrise (06:00),
// 0.25 = noon, 0.5 = sunset, 0.75 = midnight. No Three.js dependency.


export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** -1 (midnight) .. 1 (noon) */
export const sunHeight = (time) => Math.sin(time * Math.PI * 2);

/** Perceived brightness of the world: 0.28 at night, 1 by day. */
export const daylight = (time) => 0.28 + 0.72 * smoothstep(-0.12, 0.2, sunHeight(time));

/** `daylight` converted to a linear colour multiplier for materials. */
export const lightMultiplier = (light) => Math.pow(light, 2.2);

export function clockString(time) {
  const minutes = Math.floor(((time * 24 + 6) % 24) * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
