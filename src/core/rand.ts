// Seeded, keyed randomness. Every draw is derived from a hash of its key, never from a
// shared sequential stream, so changing one part of the text can't reshuffle another.

export function hash(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = typeof part === 'number' ? String(part) : part;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0xff; // separator so ('ab','c') != ('a','bc')
    h = Math.imul(h, 0x01000193);
  }
  return mix(h);
}

function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [-1, 1) */
  signed(): number;
  /** Roughly normal, mean 0, clamped to [-1, 1]. */
  bell(): number;
  range(min: number, max: number): number;
}

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    signed: () => next() * 2 - 1,
    bell: () => (next() + next() + next() - 1.5) / 1.5,
    range: (min, max) => min + (max - min) * next(),
  };
}

/** Smooth 1D value noise in [-1, 1], one lattice point per unit of t. */
export function noise1(seed: number): (t: number) => number {
  const at = (i: number) => (mix(seed ^ Math.imul(i, 0x27d4eb2d)) / 4294967296) * 2 - 1;
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const s = f * f * (3 - 2 * f);
    return at(i) * (1 - s) + at(i + 1) * s;
  };
}
