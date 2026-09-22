// Render a sheet of hands to preview.html (and optionally a PNG via headless Chrome).
import fs from 'node:fs';
import { defaultHand, randomHand, render, SKELETONS, toSVG, encodeHand } from '../src/index';

const text = process.argv[2] || 'Sphinx of black quartz, judge my vow.\nThe quick brown fox jumps over the lazy dog, again and again.';
const out = process.argv[3] ?? 'preview.html';
const rows: string[] = [];
for (const sk of SKELETONS) {
  const h = defaultHand(7, sk);
  rows.push(`<div class=l>${sk} default · mess 0 / 0.5 / 1</div>` + [0, 0.5, 1].map((mess) => toSVG(render(h, text, { size: 14, mess }))).join(''));
}
for (let i = 1; i <= 6; i++) {
  const h = randomHand(i);
  rows.push(`<div class=l>random ${i} · ${h.skeleton} · ${encodeHand(h)}</div>` + toSVG(render(h, text, { size: 14 })));
}
fs.writeFileSync(out, `<html><body style="background:#fdf9e8;font:11px sans-serif;margin:8px">
<style>.l{color:#999;margin-top:6px}svg{display:block}</style>${rows.join('\n')}</body></html>`);
