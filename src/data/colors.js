// Player colours and colour helpers. Engine-free (shared by the simulation and both renderers).

/** Warcraft III player colors. */
export const TEAM_COLORS = {
  red: 0xff0303,
  blue: 0x0042ff,
  teal: 0x1ce6b9,
  purple: 0x540081,
  yellow: 0xfffc01,
  orange: 0xfe8a0e,
  green: 0x20c000,
  pink: 0xe55bb0,
  gray: 0x959697,
  neutral: 0x3a3a3a,
  kalenden: 0x2b2b2b,
};

/** sRGB channel (0-1) to linear, as three.js does. */
export function srgbToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** Linear channel (0-1) to sRGB, as three.js does. */
export function linearToSrgb(c) {
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
}

/** Blend a hex colour toward white by t, in linear space (three.js `Color.lerp`), as a CSS colour. */
export function lightenHex(hex, t) {
  const out = [16, 8, 0].map((shift) => {
    const lin = srgbToLinear(((hex >> shift) & 255) / 255);
    const v = linearToSrgb(lin + (1 - lin) * t);
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  });
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
