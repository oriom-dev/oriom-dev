// Deterministic noise. Everything in the world is derived from these, so a chunk
// can be regenerated anywhere, any time, with no stored data.

/** 32-bit integer hash of (x, z, seed) -> [0, 1). */
export function hash(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D gradient noise in [-1, 1]. */
export function noise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const g = (ix: number, iz: number, dx: number, dz: number) => {
    const a = hash(ix, iz, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dz;
  };
  const u = fade(fx), v = fade(fz);
  const a = g(x0, z0, fx, fz), b = g(x0 + 1, z0, fx - 1, fz);
  const c = g(x0, z0 + 1, fx, fz - 1), d = g(x0 + 1, z0 + 1, fx - 1, fz - 1);
  return 1.414 * (a + u * (b - a) + v * (c - a + u * (d - c - b + a)));
}

/** Fractal sum of octaves, roughly in [-1, 1]. */
export function fbm(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, z * f, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
