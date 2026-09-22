import type { RenderResult } from '../core/render';

export function drawCanvas(
  ctx: CanvasRenderingContext2D,
  r: RenderResult,
  opts: { color?: string; x?: number; y?: number } = {},
): void {
  const ox = opts.x ?? 0, oy = opts.y ?? 0;
  ctx.fillStyle = opts.color ?? '#1b2a4a';
  ctx.beginPath();
  for (const p of r.polygons) {
    ctx.moveTo(p[0] + ox, p[1] + oy);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] + ox, p[i + 1] + oy);
    ctx.closePath();
  }
  ctx.fill('nonzero');
}
