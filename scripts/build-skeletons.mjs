// Convert single-stroke SVG fonts into normalized stroke skeletons.
// Output units: baseline = 0, x-height = 1, y up. Coordinates rounded to 3 decimals.
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const FONTS = [
  ['elfin', 'EMSElfin.svg'],
  ['readability', 'EMSReadability.svg'],
  ['felix', 'EMSFelix.svg'],
  ['script', 'HersheyScript1.svg'],
  ['allure', 'EMSAllure.svg'],
];

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function parsePath(d) {
  const strokes = [];
  let cur = null;
  for (const m of d.matchAll(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/g)) {
    if (m[1] === 'M' || !cur) { cur = []; strokes.push(cur); }
    cur.push(+m[2], +m[3]);
  }
  return strokes.filter((s) => s.length >= 4);
}

const out = {};
for (const [id, file] of FONTS) {
  const svg = fs.readFileSync(path.join(root, 'fonts', file), 'utf8');
  const defAdv = +(svg.match(/<font[^>]*horiz-adv-x="([\d.]+)"/) || [0, 500])[1];
  const raw = {};
  for (const m of svg.matchAll(/<glyph([^>]*?)\/>/g)) {
    const a = m[1];
    const u = a.match(/unicode="([^"]*)"/);
    if (!u) continue;
    const ch = decode(u[1]);
    if ([...ch].length !== 1) continue;
    const adv = a.match(/horiz-adv-x="([\d.]+)"/);
    const d = a.match(/\sd="([^"]*)"/);
    raw[ch] = { adv: adv ? +adv[1] : defAdv, strokes: d ? parsePath(d[1]) : [] };
  }
  // Measure baseline and x-height from flat-topped/bottomed lowercase letters.
  const ys = (chs, fn) => [...chs].filter((c) => raw[c]).map((c) => fn(raw[c].strokes.flatMap((s) => s.filter((_, i) => i % 2))));
  const base = median(ys('xzvwmnu', (v) => Math.min(...v)));
  const top = median(ys('xzvwmnu', (v) => Math.max(...v)));
  // Scripts have tall ascenders relative to x-height; shrink them so every skeleton reads at a
  // similar size (ascender ≈ 1.6 x-heights of a typical print hand).
  const asc = median(ys('bdhkl', (v) => Math.max(...v)));
  const k = Math.min(1 / (top - base), 1.6 / (asc - base));
  const glyphs = {};
  for (const [ch, g] of Object.entries(raw)) {
    glyphs[ch] = {
      a: r3(g.adv * k),
      s: g.strokes.map((s) => s.map((v, i) => r3(i % 2 ? (v - base) * k : v * k))),
    };
  }
  out[id] = { glyphs };
  console.log(id, 'baseline', base, 'xheight', top - base, Object.keys(glyphs).length, 'glyphs');
}

function median(a) { a = [...a].sort((x, y) => x - y); return a[a.length >> 1]; }
function r3(v) { return Math.round(v * 1000) / 1000; }

fs.writeFileSync(path.join(root, 'src/data/skeletons.json'), JSON.stringify(out));
