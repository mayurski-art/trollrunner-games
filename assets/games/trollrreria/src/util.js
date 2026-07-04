/* Trollrreria — utilities: seeded RNG, value noise, math helpers, RLE + base64. */

export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* Fast deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Deterministic hash of integer coords -> [0,1). Used by noise + texture variants. */
export function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);

/* 1D value noise with cubic-ish smoothing. freq in "lattice points per tile". */
export function noise1(x, seed, freq) {
  const fx = x * freq;
  const x0 = Math.floor(fx);
  const t = smooth(fx - x0);
  return lerp(hash2(x0, 0, seed), hash2(x0 + 1, 0, seed), t);
}

export function octave1(x, seed, freq, octaves, gain = 0.5) {
  let amp = 1, sum = 0, tot = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise1(x, seed + o * 101, freq) * amp;
    tot += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / tot;
}

/* 2D value noise. */
export function noise2(x, y, seed, freq) {
  const fx = x * freq, fy = y * freq;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

export function octave2(x, y, seed, freq, octaves, gain = 0.5) {
  let amp = 1, sum = 0, tot = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x, y, seed + o * 131, freq) * amp;
    tot += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / tot;
}

/* --- Run-length encoding for Uint16Array (world layers) --------------------
   Output: Uint16Array of [count, value] pairs (count <= 65535).           */
export function rleEncode(arr) {
  const out = [];
  let i = 0;
  const n = arr.length;
  while (i < n) {
    const v = arr[i];
    let run = 1;
    while (i + run < n && arr[i + run] === v && run < 65535) run++;
    out.push(run, v);
    i += run;
  }
  return new Uint16Array(out);
}

export function rleDecode(pairs, outLen) {
  const out = new Uint16Array(outLen);
  let o = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const run = pairs[i], v = pairs[i + 1];
    out.fill(v, o, o + run);
    o += run;
  }
  return out;
}

/* Uint8/Uint16 <-> base64 (chunked to avoid call-stack limits). */
export function bytesToB64(bytes) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function u16ToB64(u16) {
  return bytesToB64(new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength));
}

export function b64ToU16(b64) {
  const bytes = b64ToBytes(b64);
  return new Uint16Array(bytes.buffer, 0, bytes.byteLength >> 1);
}

/* AABB overlap test: boxes {x, y, w, h} in world px. */
export function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/* Format seconds -> "d3 12:40" style clock (24h mapped onto the cycle). */
export function fmtClock(t, dayLen, nightLen) {
  const total = dayLen + nightLen;
  const frac = (t % total) / total;
  const mins = Math.floor(frac * 24 * 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
