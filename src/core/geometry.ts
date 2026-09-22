// Polyline operations on flat [x0, y0, x1, y1, ...] arrays.

export type Pts = Float64Array;

export function length(p: Pts): number {
  let d = 0;
  for (let i = 2; i < p.length; i += 2) d += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return d;
}

/**
 * Adjust stroke ends: positive values extend along the end tangent (overshoot),
 * negative values trim (stopping short). Trims never remove more than 35% of the stroke.
 */
export function adjustEnds(p: Pts, start: number, end: number): Pts {
  const n = p.length / 2;
  if (n < 2) return p;
  const maxTrim = length(p) * 0.35;
  // Trim: find the (fractional) first and last kept positions.
  const [i0, x0, y0] = cut(p, 0, 1, start < 0 ? Math.min(-start, maxTrim) : 0);
  const [i1, x1, y1] = cut(p, n - 1, -1, end < 0 ? Math.min(-end, maxTrim) : 0);
  if (i1 < i0) return p; // degenerate; leave as is
  const extS = start > 0 ? Math.ceil(start / EXT_STEP) : 0;
  const extE = end > 0 ? Math.ceil(end / EXT_STEP) : 0;
  const out = new Float64Array((extS + (i1 - i0 + 1) + 2 + extE) * 2);
  let k = 0;
  if (extS) {
    const [tx, ty] = tangent(p, 0, 1);
    for (let j = extS; j >= 1; j--) {
      out[k++] = p[0] - tx * start * (j / extS);
      out[k++] = p[1] - ty * start * (j / extS);
    }
  }
  out[k++] = x0;
  out[k++] = y0;
  for (let i = i0; i <= i1; i++) {
    out[k++] = p[i * 2];
    out[k++] = p[i * 2 + 1];
  }
  out[k++] = x1;
  out[k++] = y1;
  if (extE) {
    const [tx, ty] = tangent(p, n - 1, -1);
    for (let j = 1; j <= extE; j++) {
      out[k++] = p[(n - 1) * 2] - tx * end * (j / extE);
      out[k++] = p[(n - 1) * 2 + 1] - ty * end * (j / extE);
    }
  }
  return out.subarray(0, k);
}

const EXT_STEP = 0.07;

/**
 * Walk from index `from` in direction `dir` for distance d. Returns the index of the first
 * whole point beyond the cut, and the interpolated cut point.
 */
function cut(p: Pts, from: number, dir: number, d: number): [number, number, number] {
  let i = from;
  const n = p.length / 2;
  while (d > 0) {
    const j = i + dir;
    if (j < 0 || j >= n) break;
    const seg = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]);
    if (seg > d) {
      const t = d / seg;
      return [j, p[i * 2] + (p[j * 2] - p[i * 2]) * t, p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * t];
    }
    d -= seg;
    i = j;
  }
  return [i + dir, p[i * 2], p[i * 2 + 1]];
}

/** Unit direction pointing into the stroke from endpoint i (looking a few points in). */
function tangent(p: Pts, i: number, dir: number): [number, number] {
  const n = p.length / 2;
  const j = Math.max(0, Math.min(n - 1, i + dir * 3));
  const dx = p[j * 2] - p[i * 2], dy = p[j * 2 + 1] - p[i * 2 + 1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/** Unit normals (left of travel direction) at each point. */
export function normals(p: Pts): Float64Array {
  const n = p.length / 2;
  const out = new Float64Array(p.length);
  let lx = 0, ly = 1;
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let tx = p[i1 * 2] - p[i0 * 2], ty = p[i1 * 2 + 1] - p[i0 * 2 + 1];
    const len = Math.hypot(tx, ty);
    if (len > 1e-9) {
      tx /= len;
      ty /= len;
      lx = -ty;
      ly = tx;
    }
    out[i * 2] = lx;
    out[i * 2 + 1] = ly;
  }
  return out;
}

/**
 * Closed outline around a centerline with per-point widths, with round caps.
 * Fill with the nonzero rule: every piece of the band winds the same way, so overlaps stay filled.
 */
export function outline(p: Pts, w: Float64Array): Float64Array {
  const n = p.length / 2;
  const nm = normals(p);
  const CAP = 6;
  const out = new Float64Array((n * 2 + CAP * 2 - 2) * 2);
  let k = 0;
  const push = (x: number, y: number) => {
    out[k++] = x;
    out[k++] = y;
  };
  for (let i = 0; i < n; i++) push(p[i * 2] + nm[i * 2] * w[i], p[i * 2 + 1] + nm[i * 2 + 1] * w[i]);
  cap(n - 1, 1);
  for (let i = n - 1; i >= 0; i--) push(p[i * 2] - nm[i * 2] * w[i], p[i * 2 + 1] - nm[i * 2 + 1] * w[i]);
  cap(0, -1);
  return out.subarray(0, k);

  // Half circle from the left side to the right side, bulging forward (dir 1) or backward (-1).
  function cap(i: number, dir: number) {
    const nx = nm[i * 2] * dir, ny = nm[i * 2 + 1] * dir;
    const tx = ny, ty = -nx; // forward tangent
    for (let j = 1; j < CAP; j++) {
      const a = (Math.PI * j) / CAP;
      const c = Math.cos(a), s = Math.sin(a);
      push(p[i * 2] + (nx * c + tx * s) * w[i], p[i * 2 + 1] + (ny * c + ty * s) * w[i]);
    }
  }
}

/** Polygon approximating a circle, for dots. */
export function circle(x: number, y: number, r: number): Float64Array {
  const N = 10;
  const out = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    out[i * 2] = x + Math.cos(a) * r;
    out[i * 2 + 1] = y + Math.sin(a) * r;
  }
  return out;
}
