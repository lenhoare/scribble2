import { randomHand, render } from '../src/index';
const h = randomHand(9);
const long = 'The quick brown fox jumps over the lazy dog. Sphinx of black quartz, judge my vow. Pack my box.';
for (let i = 0; i < 200; i++) render(h, long);
const t = performance.now();
for (let i = 0; i < 1000; i++) render(h, long + i);
console.log(((performance.now() - t) / 1000).toFixed(3), 'ms');
let pts = 0; for (const p of render(h, long).polygons) pts += p.length / 2; console.log(pts, 'outline points');
