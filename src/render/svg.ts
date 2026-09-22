import type { RenderResult } from '../core/render';

export function pathData(r: RenderResult): string {
  let d = '';
  for (const p of r.polygons) {
    d += 'M' + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    for (let i = 2; i < p.length; i += 2) d += 'L' + p[i].toFixed(1) + ' ' + p[i + 1].toFixed(1);
    d += 'Z';
  }
  return d;
}

export function toSVG(r: RenderResult, opts: { color?: string } = {}): string {
  const w = Math.ceil(r.width), h = Math.ceil(r.height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">` +
    `<path fill="${opts.color ?? '#1b2a4a'}" fill-rule="nonzero" d="${pathData(r)}"/></svg>`
  );
}
