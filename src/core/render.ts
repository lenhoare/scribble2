// (hand, text, options) → outline polygons in px. Pure and deterministic.
import { adjustEnds, circle, length, normals, outline, type Pts } from './geometry';
import { resolve, type Hand, type Resolved } from './profile';
import { hash, noise1, rng, type Rng } from './rand';
import { extents, glyph } from './skeleton';

export interface RenderOptions {
  /** x-height in px. Default 24. */
  size?: number;
  /** Wrap width in px. Default: no wrapping. */
  maxWidth?: number;
  /** Line pitch in x-heights. Default 3. */
  lineHeight?: number;
  /**
   * Messiness, 0..1 (default 0.83). 0 = no deformation (clean skeleton with slant, width and pen),
   * 1 = the messiest that still reads well. Values above 1 extrapolate.
   */
  mess?: number;
  /** Padding around the ink in x-heights. Default 1. */
  padding?: number;
}

export interface RenderResult {
  width: number;
  height: number;
  /** y (px) of the first line's baseline. Later lines follow every lineHeight × size px. */
  baseline: number;
  /** Closed polygons [x0, y0, x1, y1, ...] in px, y down. Fill with the nonzero rule. */
  polygons: Float32Array[];
}

const DEG = Math.PI / 180;
const MESS_MAX = 0.6;
/** Raw multiplier 0.5: the middle of the range that looked most natural. */
export const DEFAULT_MESS = 0.5 / MESS_MAX;

export function render(hand: Hand, text: string, opts: RenderOptions = {}): RenderResult {
  const size = opts.size ?? 24;
  const lineHeight = opts.lineHeight ?? 3;
  // Feedback: above ~0.6 of the raw multiplier is too messy. 0 stays available for neat
  // hands and for switching the mess off to compare.
  const mess = MESS_MAX * (opts.mess ?? DEFAULT_MESS);
  const pad = opts.padding ?? 1;
  const maxWidth = (opts.maxWidth ?? Infinity) / size;
  const P = resolve(hand);
  const seed = hand.seed;

  const polys: Float64Array[] = [];
  const occurrences = new Map<string, number>();
  const tiltTan = Math.tan(P.tilt * DEG);
  const space = (glyph(hand.skeleton, ' ')?.adv ?? 0.6) * P.wordSpace * P.width;
  let travelled = 0; // x-heights written so far, drives fatigue

  let lineY = 0;
  for (const line of text.split('\n')) {
    let x = 0;
    for (const word of line.split(/ +/)) {
      if (!word) continue;
      const w = wordWidth(hand, P, word);
      if (x > 0 && x + w > maxWidth) {
        x = 0;
        lineY -= lineHeight;
      }
      const occ = occurrences.get(word) ?? 0;
      occurrences.set(word, occ + 1);
      const chars = [...word];
      for (let i = 0; i < chars.length; i++) {
        const m = mess * (1 + P.fatigue * Math.min(travelled / 60, 2));
        const adv = drawChar(hand, P, chars[i], hash(seed, 'i', word, i, occ), m, x, lineY, tiltTan, polys);
        x += adv;
        travelled += adv;
      }
      x += space;
    }
    lineY -= lineHeight;
  }
  const lastBaseline = lineY + lineHeight;

  // Fixed frame, so typing a tall or deep letter doesn't move the rest of the text:
  // the left edge is x = 0 and the vertical room comes from the skeleton's tallest ascender and
  // deepest descender, not from the ink. Slack covers lift, size jitter and overshoot.
  const ext = extents(hand.skeleton);
  const SLACK = 0.3;
  const top = 1 + (ext.top - 1) * P.ascender + SLACK;
  const bottom = lastBaseline + ext.bottom * P.ascender - SLACK;
  return toPixels(polys, size, pad, top, bottom);
}

/** Per-character quirks: fixed for a given hand + character, however often it appears. */
interface Quirk {
  lift: number;
  scale: number;
  /** Persistent warp displacement (amplitude 1) at each skeleton point, per stroke. */
  disp: Float64Array[];
}

const quirkCache = new Map<string, Quirk>();

function quirk(hand: Hand, ch: string): Quirk {
  const key = hand.seed + '|' + hand.skeleton + '|' + ch;
  let q = quirkCache.get(key);
  if (!q) {
    if (quirkCache.size > 4096) quirkCache.clear();
    const r = rng(hash(hand.seed, 'q', ch));
    q = { lift: r.signed(), scale: r.bell(), disp: [] };
    const w = warp(r);
    const d = [0, 0];
    for (const src of glyph(hand.skeleton, ch)?.strokes ?? []) {
      const disp = new Float64Array(src.length);
      for (let i = 0; i < src.length; i += 2) {
        d[0] = d[1] = 0;
        w(src[i], src[i + 1], 1, d);
        disp[i] = d[0];
        disp[i + 1] = d[1];
      }
      q.disp.push(disp);
    }
    quirkCache.set(key, q);
  }
  return q;
}

function advance(hand: Hand, P: Resolved, ch: string, scale: number): number {
  const g = glyph(hand.skeleton, ch);
  return g ? g.adv * P.width * scale + P.tracking : 0;
}

function wordWidth(hand: Hand, P: Resolved, word: string): number {
  let w = 0;
  for (const ch of word) w += advance(hand, P, ch, 1 + quirk(hand, ch).scale * P.charScale);
  return w;
}

function drawChar(
  hand: Hand, P: Resolved, ch: string, key: number, m: number,
  ox: number, oy: number, tiltTan: number, polys: Float64Array[],
): number {
  const g = glyph(hand.skeleton, ch);
  const q = quirk(hand, ch);
  const qScale = 1 + q.scale * P.charScale; // not scaled by mess: it's part of the hand's layout
  if (!g) return 0;
  const r = rng(key);

  const scale = qScale * (1 + r.bell() * P.sizeJitter * m);
  // Full strength at the default mess, so the slider reads as the actual offset in x-heights.
  const lift = q.lift * P.charLift * Math.min(m / (MESS_MAX * DEFAULT_MESS), 1.5);
  const iWarp = warp(r);
  const shapeAmp = P.charShape * m;
  const jitAmp = P.shapeJitter * m;

  // One slant for the whole hand: varying it per letter looked wrong in v1 and v2.
  const shear = Math.tan(P.slant * DEG);

  const d = [0, 0];
  for (let s = 0; s < g.strokes.length; s++) {
    const src = g.strokes[s];
    const qd = q.disp[s];
    let p: Pts = new Float64Array(src.length);
    for (let i = 0; i < src.length; i += 2) {
      let x = src[i];
      let y = src[i + 1];
      if (y > 1) y = 1 + (y - 1) * P.ascender;
      else if (y < 0) y *= P.ascender;
      d[0] = qd[i] * shapeAmp;
      d[1] = qd[i + 1] * shapeAmp;
      iWarp(x, y, jitAmp, d);
      x += d[0];
      y += d[1];
      x *= P.width * scale;
      y = y * scale + lift;
      x += y * shear;
      p[i] = x;
      p[i + 1] = y;
    }
    p = adjustEnds(p, r.bell() * P.overshoot * m, r.bell() * P.overshoot * m);
    p = tremor(p, P, r, m);
    for (let i = 0; i < p.length; i += 2) {
      p[i] += ox;
      p[i + 1] += oy + p[i] * tiltTan;
    }
    polys.push(ink(p, P, r, scale));
  }
  return advance(hand, P, ch, qScale);
}

/** Adds the displacement at (x, y), scaled by amp, into out. */
type Warp = (x: number, y: number, amp: number, out: number[]) => void;

/** Smooth random displacement field: a few low-frequency waves in random directions. */
function warp(r: Rng): Warp {
  const waves = [0, 1, 2].map(() => {
    const a = r.next() * Math.PI * 2;
    const d = r.next() * Math.PI * 2;
    return { cx: Math.cos(a), cy: Math.sin(a), f: r.range(0.3, 1.1) * Math.PI * 2, ph: r.next() * 6.283, dx: Math.cos(d), dy: Math.sin(d) };
  });
  return (x, y, amp, out) => {
    if (amp === 0) return;
    for (const w of waves) {
      const v = Math.sin(w.f * (x * w.cx + y * w.cy) + w.ph) * 0.6 * amp;
      out[0] += v * w.dx;
      out[1] += v * w.dy;
    }
  };
}

/** Wobble the stroke sideways with noise running along its length. */
function tremor(p: Pts, P: Resolved, r: Rng, m: number): Pts {
  const amp = P.tremor * m;
  if (amp <= 0) return p;
  const nz = noise1(Math.floor(r.next() * 4294967296));
  const nm = normals(p);
  const out = new Float64Array(p.length);
  let d = 0;
  for (let i = 0; i < p.length; i += 2) {
    if (i) d += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    const v = nz(d * P.tremorFreq) * amp;
    out[i] = p[i] + nm[i] * v;
    out[i + 1] = p[i + 1] + nm[i + 1] * v;
  }
  return out;
}

/** Pen model: width from nib size, pressure noise along the stroke, and tapered ends. */
function ink(p: Pts, P: Resolved, r: Rng, scale: number): Float64Array {
  const half = (P.pen * Math.sqrt(scale)) / 2;
  const total = length(p);
  const n = p.length / 2;
  if (n < 2 || total < 0.03) return circle(p[0], p[1], half * 1.2);
  const nz = noise1(Math.floor(r.next() * 4294967296));
  const taperLen = Math.min(0.1 + P.taper * 0.4, total * 0.45);
  const w = new Float64Array(n);
  let d = 0;
  for (let i = 0; i < n; i++) {
    if (i) d += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    let k = 1 + nz(d * 1.5) * P.pressure * 0.5;
    const e = Math.min(d, total - d) / taperLen;
    if (e < 1) k *= 1 - P.taper * 0.8 * (1 - e * e * (3 - 2 * e));
    w[i] = half * k;
  }
  return outline(p, w);
}

/**
 * Map layout units (y up, first baseline at 0) to px (y down). `top` and `bottom` are the frame's
 * vertical bounds in layout units. Ink can slightly overhang the frame at extreme settings.
 */
function toPixels(polys: Float64Array[], size: number, pad: number, top: number, bottom: number): RenderResult {
  let maxX = 0;
  for (const p of polys) for (let i = 0; i < p.length; i += 2) if (p[i] > maxX) maxX = p[i];
  const polygons = polys.map((p) => {
    const o = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 2) {
      o[i] = (p[i] + pad) * size;
      o[i + 1] = (top - p[i + 1] + pad) * size;
    }
    return o;
  });
  return { width: (maxX + pad * 2) * size, height: (top - bottom + pad * 2) * size, baseline: (top + pad) * size, polygons };
}
