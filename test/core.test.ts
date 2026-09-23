import { describe, expect, it } from 'vitest';
import { decodeHand, encodeHand, randomHand, render, toSVG } from '../src/index';

const text = 'Sphinx of black quartz, judge my vow.';

describe('hand profiles', () => {
  it('round-trips through the string code', () => {
    for (let i = 0; i < 20; i++) {
      const h = randomHand(i);
      const code = encodeHand(h);
      expect(code).toMatch(/^s1[A-Za-z0-9_-]+$/);
      const back = decodeHand(code);
      expect(back.seed).toBe(h.seed);
      expect(back.skeleton).toBe(h.skeleton);
      expect(encodeHand(back)).toBe(code);
    }
  });

  it('decodes codes shorter than the current param list using defaults', () => {
    const code = encodeHand(randomHand(3));
    expect(() => decodeHand(code.slice(0, 12))).not.toThrow();
  });
});

describe('render', () => {
  it('is deterministic', () => {
    const h = randomHand(42);
    expect(toSVG(render(h, text))).toBe(toSVG(render(decodeHand(encodeHand(h)), text)));
  });

  it('different hands produce different output', () => {
    expect(toSVG(render(randomHand(1), text))).not.toBe(toSVG(render(randomHand(2), text)));
  });

  it('editing one word leaves the other words untouched, in place', () => {
    const h = randomHand(7);
    const a = render(h, 'alpha beta gamma');
    const b = render(h, 'alpha BETA gamma');
    // The first word's strokes are identical, pixel for pixel: no shift from the taller capitals
    // in the edited word. (Joins can merge letters, so count its strokes on their own.)
    const n = render(h, 'alpha').polygons.length;
    const first = (r: typeof a) => r.polygons.slice(0, n).map((p) => Array.from(p).join());
    expect(first(b)).toEqual(first(a));
    expect(b.baseline).toBe(a.baseline);
  });

  it('joins cursive letters into fewer strokes, and only within words', () => {
    const h = randomHand(7);
    h.skeleton = 'script';
    h.params.joins = 1;
    const joined = render(h, 'minimum').polygons.length;
    h.params.joins = 0;
    const apart = render(h, 'minimum').polygons.length;
    expect(joined).toBeLessThan(apart);
    h.params.joins = 1;
    expect(render(h, 'a a').polygons.length).toBe(2 * render(h, 'a').polygons.length);
  });

  it('keeps the frame height fixed whatever letters are typed', () => {
    const h = randomHand(7);
    const heights = ['a', 'l', 'g', 'Tall', 'jumpy'].map((t) => render(h, t).height);
    expect(new Set(heights).size).toBe(1);
  });

  it('repeated words are not identical', () => {
    const h = randomHand(7);
    const r = render(h, 'the the', { padding: 0 });
    const n = r.polygons.length / 2;
    const shape = (p: Float32Array) => Array.from(p, (v, i) => v - p[i % 2]).map((v) => v.toFixed(2)).join();
    expect(shape(r.polygons[0])).not.toBe(shape(r.polygons[n]));
  });

  it('renders ~100 characters in well under 5ms', () => {
    const h = randomHand(9);
    const long = 'The quick brown fox jumps over the lazy dog. Sphinx of black quartz, judge my vow. Pack my box.';
    for (let i = 0; i < 20; i++) render(h, long); // warm up
    const t = performance.now();
    const N = 100;
    for (let i = 0; i < N; i++) render(h, long + i);
    const ms = (performance.now() - t) / N;
    console.log(`render ${long.length} chars: ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(5);
  });
});
