// (hand, text, options) → outline polygons in px. Pure and deterministic.
import { adjustEnds, circle, length, normals, outline, type Pts } from './geometry';
import { resolve, type Hand, type Resolved } from './profile';
import { hash, noise1, rng, type Rng } from './rand';
import { JOIN_RULES, type JoinRules } from '../data/join-rules';
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
      const letters: Letter[] = [];
      for (const ch of word) {
        const m = mess * (1 + P.fatigue * Math.min(travelled / 60, 2));
        const l = drawChar(hand, P, ch, hash(seed, 'i', word, letters.length, occ), m, x, lineY, tiltTan);
        letters.push(l);
        x += l.adv;
        travelled += l.adv;
      }
      joinLetters(hand, P, letters, lineY);
      for (const l of letters) for (const st of l.strokes) if (!st.into) polys.push(finishStroke(st, P));
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

/** A centerline in layout units, before tremor and ink. */
interface Stroke {
  pts: number[];
  /** Mess multiplier and size of the letter it started in; drive tremor and pen width. */
  m: number;
  scale: number;
  key: number;
  /** Set when this stroke has been appended to another (cursive join). */
  into?: Stroke;
}

interface Letter {
  ch: string;
  /** Left edge (layout units) and advance. */
  x: number;
  adv: number;
  strokes: Stroke[];
  /** Stroke the pen leaves the letter on (at its end) and enters on (at its start). */
  exit?: Stroke;
  entry?: Stroke;
}

function drawChar(
  hand: Hand, P: Resolved, ch: string, key: number, m: number,
  ox: number, oy: number, tiltTan: number,
): Letter {
  const g = glyph(hand.skeleton, ch);
  const q = quirk(hand, ch);
  const qScale = 1 + q.scale * P.charScale; // not scaled by mess: it's part of the hand's layout
  const letter: Letter = { ch, x: ox, adv: advance(hand, P, ch, qScale), strokes: [] };
  if (!g) return letter;
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
    const p = new Array<number>(src.length);
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
      x += y * shear + ox;
      p[i] = x;
      p[i + 1] = y + oy + x * tiltTan;
    }
    letter.strokes.push({ pts: p, m, scale, key: hash(key, s) });
  }
  if (/\p{L}/u.test(ch)) pickEntryExit(letter, ox, oy);
  return letter;
}

/** Strokes this small (i dots, full stops) never carry a join. */
const DOT = 0.2;

/**
 * Choose where the pen enters and leaves a letter: the exit is the rightmost stroke end and the
 * entry the leftmost stroke start. Skeleton stroke direction isn't reliable (Allure draws some
 * letters backwards), so strokes are reversed where needed.
 */
function pickEntryExit(l: Letter, ox: number, oy: number) {
  const big = l.strokes.filter((s) => extent(s.pts) >= DOT);
  if (!big.length) return;
  // Prefer longer strokes on near-ties, so a t's stem wins over its crossbar. On ties in x,
  // exits prefer the lower end (a stem's foot) and entries the higher (a stem's top).
  const bonus = (s: Stroke) => 0.03 * Math.min(pathLen(s.pts), 3);
  let best = -Infinity;
  for (const s of big) {
    const n = s.pts.length;
    for (const [x, y, atEnd] of [[s.pts[n - 2], s.pts[n - 1], true], [s.pts[0], s.pts[1], false]] as const) {
      const score = x + bonus(s) - 0.05 * (y - oy);
      if (score > best) {
        best = score;
        l.exit = s;
        if (!atEnd) s.pts = reversed(s.pts);
      }
    }
  }
  best = -Infinity;
  for (const s of big) {
    const n = s.pts.length;
    const ends: (readonly [number, number, boolean])[] = [[s.pts[0], s.pts[1], true]];
    if (s !== l.exit) ends.push([s.pts[n - 2], s.pts[n - 1], false]);
    for (const [x, y, atStart] of ends) {
      const score = -x + bonus(s) + 0.05 * (y - oy);
      if (score > best) {
        best = score;
        l.entry = s;
        if (!atStart) s.pts = reversed(s.pts);
      }
    }
  }
  // Entries far to the right of a letter (or exits far left) would draw a line through it.
  const e = l.entry!.pts, x = l.exit!.pts;
  if (e[0] - ox > l.adv * 0.7) l.entry = undefined;
  if (x[x.length - 2] - ox < l.adv * 0.3) l.exit = undefined;
}

/**
 * Cursive joins: connect a letter's exit to the next letter's entry with a smooth curve, merging
 * them into one continuous stroke. Whether a pair joins is a habit of the hand: fixed per letter
 * pair, so this person always joins "th" but maybe never "os".
 */
function joinLetters(hand: Hand, P: Resolved, letters: Letter[], baseline: number) {
  const rules = JOIN_RULES[hand.skeleton];
  for (let i = 1; i < letters.length; i++) {
    const a = letters[i - 1], b = letters[i];
    if (!a.exit || !b.entry) continue;
    if (rules && !allowed(rules, a.ch, b.ch)) continue;
    if (rng(hash(hand.seed, 'j', a.ch, b.ch)).next() >= P.joins) continue;
    const X = root(a.exit), Y = b.entry;
    const xp = X.pts;
    const overTop = b.entry.pts[0] - b.x > b.adv * 0.4;
    // Print letters drawn up from the foot of a stem (n, r, m, p) are entered at the stem's top.
    const stem = !overTop && !!rules && risesAsStem(Y.pts);
    const yp = overTop || stem ? fromTop(Y.pts) : Y.pts;
    const ex = xp[xp.length - 2], ey = xp[xp.length - 1], sx = yp[0], sy = yp[1];
    const dist = Math.hypot(sx - ex, sy - ey);
    // Too far, or going backwards, or leaving from an ascender/descender tip: lift the pen.
    if (dist > 1.2 || sx < ex - 0.4) continue;
    if (Math.abs(ey - baseline - 0.5) > 0.9 || Math.abs(sy - baseline - 0.5) > 0.9) continue;
    // Climbing to an ascender top (c→k) turns the letter into something else (a→k).
    // A join table has already vetted its pairs.
    if (!rules && sy - ey > 0.8) continue;
    // Where a letter's own direction fights the join (a's bowl starts top-right heading left),
    // arrive or leave along the chord instead, giving a sharp turn like a real pen's retrace.
    const cx = (sx - ex) / (dist || 1), cy = (sy - ey) / (dist || 1);
    let [tex, tey] = endTangent(xp, true);
    let [tsx, tsy] = endTangent(yp, false);
    // Leaving the foot of a downstroke (i, n, h) the pen curls right before rising, rather than
    // snapping straight back up.
    if (tex * cx + tey * cy < 0.2) {
      const hx = 1 + cx * 0.5, hy = cy * 0.5, hl = Math.hypot(hx, hy);
      [tex, tey] = [hx / hl, hy / hl];
    }
    // Letters entered from the right (a, c, d, g, o, q): arrive moving right along the top of the
    // bowl, then the stroke doubles back over it, the way cursive goes "over the top".
    if (overTop) [tsx, tsy] = [-tsx, -tsy];
    else if (tsx * cx + tsy * cy < 0.2) [tsx, tsy] = [cx, cy];
    const k = dist * 0.4;
    const c1x = ex + tex * k, c1y = ey + tey * k, c2x = sx - tsx * k, c2y = sy - tsy * k;
    const n = Math.max(1, Math.ceil(dist / 0.07));
    for (let j = 1; j < n; j++) {
      const t = j / n, u = 1 - t;
      const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      xp.push(w0 * ex + w1 * c1x + w2 * c2x + w3 * sx, w0 * ey + w1 * c1y + w2 * c2y + w3 * sy);
    }
    for (let j = 0; j < yp.length; j++) xp.push(yp[j]);
    Y.into = X;
  }
}

/**
 * Start a stroke from its highest point in the first 40% of its length instead: for a bowl that
 * starts part-way up its right side, that's the top of the bowl. The pen runs back down the head
 * to the original start and then along the stroke as normal, so the retrace overlaps itself and
 * the bowl stays closed.
 */
function fromTop(p: number[]): number[] {
  const limit = pathLen(p) * 0.4;
  let best = 0, d = 0;
  for (let i = 2; i < p.length && d < limit; i += 2) {
    d += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    if (p[i + 1] > p[best + 1]) best = i;
  }
  if (p[best + 1] - p[1] <= 0.05) return p;
  return [...reversed(p.slice(0, best + 2)), ...p.slice(2)];
}

function allowed(r: JoinRules, a: string, b: string): boolean {
  const pair = a + b;
  if (r.always?.includes(pair)) return true;
  if (r.never?.includes(pair)) return false;
  return r.from.includes(a) && r.to.includes(b);
}

/** Does the stroke start by going up a near-vertical stem? */
function risesAsStem(p: number[]): boolean {
  // Follow the stroke while it keeps climbing, then check it climbed far and steeply (a slanted
  // stem drifts sideways, so allow some).
  let i = 2;
  while (i < p.length && p[i + 1] >= p[i - 1] - 0.02) i += 2;
  const rise = p[i - 1] - p[1];
  return rise > 0.5 && Math.abs(p[i - 2] - p[0]) < 0.6 * rise;
}

function root(s: Stroke): Stroke {
  while (s.into) s = s.into;
  return s;
}

/** Direction of travel at the end (atEnd) or start of a stroke, averaged over ~0.15 x-heights. */
function endTangent(p: number[], atEnd: boolean): [number, number] {
  const n = p.length / 2;
  let i0: number, i1: number;
  if (atEnd) {
    i1 = n - 1;
    i0 = i1;
    while (i0 > 0 && Math.hypot(p[i1 * 2] - p[i0 * 2], p[i1 * 2 + 1] - p[i0 * 2 + 1]) < 0.15) i0--;
  } else {
    i0 = 0;
    i1 = 0;
    while (i1 < n - 1 && Math.hypot(p[i1 * 2] - p[i0 * 2], p[i1 * 2 + 1] - p[i0 * 2 + 1]) < 0.15) i1++;
  }
  const dx = p[i1 * 2] - p[i0 * 2], dy = p[i1 * 2 + 1] - p[i0 * 2 + 1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

function extent(p: number[]): number {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  return Math.hypot(x1 - x0, y1 - y0);
}

function pathLen(p: number[]): number {
  let d = 0;
  for (let i = 2; i < p.length; i += 2) d += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return d;
}

function reversed(p: number[]): number[] {
  const out = new Array<number>(p.length);
  for (let i = 0; i < p.length; i += 2) {
    out[p.length - 2 - i] = p[i];
    out[p.length - 1 - i] = p[i + 1];
  }
  return out;
}

/** Overshoot at the free ends, tremor, then the pen. */
function finishStroke(st: Stroke, P: Resolved): Float64Array {
  const r = rng(st.key);
  let p: Pts = new Float64Array(st.pts);
  p = adjustEnds(p, r.bell() * P.overshoot * st.m, r.bell() * P.overshoot * st.m);
  p = tremor(p, P, r, st.m);
  return ink(p, P, r, st.scale);
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
