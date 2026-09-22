import {
  PARAMS, SKELETONS, decodeHand, drawCanvas, encodeHand, randomHand, render,
  resolve, toSVG, type Hand, type ParamKey,
} from '../src/index';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const codeEl = $<HTMLInputElement>('code');
const seedEl = $<HTMLInputElement>('seed');
const skelEl = $<HTMLSelectElement>('skeleton');
const messEl = $<HTMLInputElement>('mess');
const sizeEl = $<HTMLInputElement>('size');
const rendererEl = $<HTMLSelectElement>('renderer');
const textEl = $<HTMLTextAreaElement>('text');
const outEl = $<HTMLDivElement>('out');
const perfEl = $<HTMLDivElement>('perf');
const galleryEl = $<HTMLDivElement>('gallery');

let hand: Hand = loadFromHash() ?? randomHand(Math.floor(Math.random() * 1e6));
let gallerySeed = Math.floor(Math.random() * 1e6);

for (const s of SKELETONS) skelEl.add(new Option(s, s));

// Param sliders, grouped.
const sliders = new Map<ParamKey, { input: HTMLInputElement; out: HTMLOutputElement }>();
{
  const root = $<HTMLDivElement>('params');
  let group = '';
  for (const p of PARAMS) {
    if (p.group !== group) {
      group = p.group;
      root.insertAdjacentHTML('beforeend', `<h2>${group}</h2>`);
    }
    const label = document.createElement('label');
    label.innerHTML = `${p.label} <output></output><input type="range" min="0" max="255" step="1" />`;
    const input = label.querySelector('input')!;
    const out = label.querySelector('output')!;
    input.addEventListener('input', () => {
      hand.params[p.key] = +input.value / 255;
      update();
    });
    input.addEventListener('dblclick', () => {
      hand.params[p.key] = Math.round(p.def * 255) / 255;
      update();
    });
    root.append(label);
    sliders.set(p.key, { input, out });
  }
}

function syncControls() {
  const R = resolve(hand);
  for (const p of PARAMS) {
    const s = sliders.get(p.key)!;
    s.input.value = String(Math.round(hand.params[p.key] * 255));
    s.out.value = fmt(R[p.key]);
  }
  seedEl.value = String(hand.seed);
  skelEl.value = hand.skeleton;
  if (document.activeElement !== codeEl) codeEl.value = encodeHand(hand);
  $<HTMLOutputElement>('messOut').value = (+messEl.value).toFixed(2);
  $<HTMLOutputElement>('sizeOut').value = sizeEl.value;
}

const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2));

function draw() {
  const size = +sizeEl.value;
  // render() pads by 1 x-height on each side; keep the result within the card.
  const opts = { size, mess: +messEl.value, maxWidth: (outEl.clientWidth || 800) - size * 2 };
  const t0 = performance.now();
  const r = render(hand, textEl.value, opts);
  const t1 = performance.now();
  outEl.textContent = '';
  if (rendererEl.value === 'canvas') {
    const dpr = devicePixelRatio || 1;
    const c = document.createElement('canvas');
    c.width = Math.ceil(r.width * dpr);
    c.height = Math.ceil(r.height * dpr);
    c.style.width = r.width + 'px';
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    drawCanvas(ctx, r);
    outEl.append(c);
  } else {
    outEl.innerHTML = toSVG(r);
  }
  const t2 = performance.now();
  // Align the card's ruled lines with the baselines.
  const card = outEl.parentElement!;
  const pitch = size * 3;
  card.style.setProperty('--line', pitch + 'px');
  card.style.setProperty('--line-offset', ((18 + r.baseline) % pitch) + 'px');
  const chars = [...textEl.value].length;
  perfEl.textContent = `${chars} chars · geometry ${(t1 - t0).toFixed(2)} ms · ${rendererEl.value} ${(t2 - t1).toFixed(2)} ms · ${r.polygons.length} strokes`;
}

function drawGallery() {
  galleryEl.textContent = '';
  const text = textEl.value.split('\n')[0].slice(0, 60) || 'Sphinx of black quartz, judge my vow.';
  for (let i = 0; i < 8; i++) {
    const h = randomHand(gallerySeed + i);
    const div = document.createElement('div');
    div.className = 'hand';
    div.innerHTML = `<div class="meta">${h.skeleton}</div>` + toSVG(render(h, text, { size: 13, mess: +messEl.value, maxWidth: 300 }));
    div.onclick = () => {
      hand = h;
      update();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    galleryEl.append(div);
  }
}

let pending = 0;
function update() {
  syncControls();
  history.replaceState(null, '', '#' + encodeHand(hand));
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(draw);
}

function loadFromHash(): Hand | null {
  try {
    return location.hash.length > 3 ? decodeHand(location.hash.slice(1)) : null;
  } catch {
    return null;
  }
}

$('random').onclick = () => {
  hand = randomHand(Math.floor(Math.random() * 1e9));
  update();
};
$('more').onclick = () => {
  gallerySeed += 8;
  drawGallery();
};
$('copy').onclick = () => navigator.clipboard?.writeText(encodeHand(hand));
codeEl.addEventListener('input', () => {
  try {
    hand = decodeHand(codeEl.value.trim());
    codeEl.style.borderColor = '';
    update();
  } catch {
    codeEl.style.borderColor = '#c55';
  }
});
seedEl.addEventListener('input', () => {
  hand = { ...hand, seed: (+seedEl.value >>> 0) };
  update();
});
skelEl.addEventListener('change', () => {
  hand = { ...hand, skeleton: skelEl.value as Hand['skeleton'] };
  update();
});
for (const el of [messEl, sizeEl, rendererEl]) el.addEventListener('input', update);
messEl.addEventListener('change', drawGallery);
textEl.addEventListener('input', update);
textEl.addEventListener('change', drawGallery);
addEventListener('resize', update);
addEventListener('hashchange', () => {
  const h = loadFromHash();
  if (h && encodeHand(h) !== encodeHand(hand)) {
    hand = h;
    update();
  }
});

update();
drawGallery();
