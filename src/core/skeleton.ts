// Skeleton glyphs: single-stroke letterforms. Units: baseline 0, x-height 1, y up.
import data from '../data/skeletons.json';
import type { SkeletonId } from './profile';

export interface Glyph {
  adv: number;
  /** Each stroke is a flat [x0, y0, x1, y1, ...] list, densified so it can bend smoothly. */
  strokes: Float64Array[];
}

const STEP = 0.07;
const raw = data as Record<string, { glyphs: Record<string, { a: number; s: number[][] }> }>;
const cache = new Map<string, Glyph | null>();

/** Skeletons that reuse another's letterforms and differ only in how they join. */
const BASE: Partial<Record<SkeletonId, string>> = { semijoined: 'readability' };
const glyphsOf = (skeleton: SkeletonId) => raw[BASE[skeleton] ?? skeleton].glyphs;

export function glyph(skeleton: SkeletonId, ch: string): Glyph | null {
  const key = skeleton + ch;
  let g = cache.get(key);
  if (g === undefined) {
    const glyphs = glyphsOf(skeleton);
    // Fall back to the unaccented letter (é → e), then '?'.
    const src = glyphs[ch] ?? glyphs[ch.normalize('NFD')[0]] ?? glyphs['?'];
    g = src ? { adv: src.a, strokes: src.s.map(densify) } : null;
    cache.set(key, g);
  }
  return g;
}

/** Subdivide segments so no piece is longer than STEP, keeping original vertices. */
function densify(s: number[]): Float64Array {
  const out: number[] = [s[0], s[1]];
  for (let i = 2; i < s.length; i += 2) {
    const x0 = s[i - 2], y0 = s[i - 1], x1 = s[i], y1 = s[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / STEP));
    for (let k = 1; k <= n; k++) out.push(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
  }
  return new Float64Array(out);
}

const extentCache = new Map<SkeletonId, { top: number; bottom: number }>();

/** Highest and lowest points across the letters and digits of a skeleton. */
export function extents(skeleton: SkeletonId): { top: number; bottom: number } {
  let e = extentCache.get(skeleton);
  if (!e) {
    e = { top: 1, bottom: 0 };
    for (const ch of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      for (const s of glyphsOf(skeleton)[ch]?.s ?? []) {
        for (let i = 1; i < s.length; i += 2) {
          if (s[i] > e.top) e.top = s[i];
          if (s[i] < e.bottom) e.bottom = s[i];
        }
      }
    }
    extentCache.set(skeleton, e);
  }
  return e;
}
