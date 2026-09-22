// A hand profile: seed + skeleton + normalized (0..1) params. Encodes to a short string.
import { hash, rng } from './rand';

export const SKELETONS = ['elfin', 'readability', 'felix', 'script', 'allure'] as const;
export type SkeletonId = (typeof SKELETONS)[number];

interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  /** default, normalized 0..1 */
  def: number;
  group: string;
}

// Order matters: it is the encoding order. Only ever append.
export const PARAMS = [
  { key: 'slant', label: 'Slant (°)', min: -10, max: 30, def: 0.55, group: 'Shape' },
  { key: 'width', label: 'Width', min: 0.7, max: 1.35, def: 0.45, group: 'Shape' },
  { key: 'ascender', label: 'Ascender length', min: 0.6, max: 2, def: 0.29, group: 'Shape' },
  { key: 'tracking', label: 'Letter spacing', min: -0.2, max: 0.4, def: 0.4, group: 'Spacing' },
  { key: 'wordSpace', label: 'Word spacing', min: 0.5, max: 2, def: 0.35, group: 'Spacing' },
  { key: 'charLift', label: 'Per-letter lift', min: 0, max: 0.25, def: 0.5, group: 'Quirks' },
  { key: 'charScale', label: 'Per-letter size', min: 0, max: 0.3, def: 0.5, group: 'Quirks' },
  { key: 'charShape', label: 'Per-letter shape', min: 0, max: 0.6, def: 0.2, group: 'Quirks' },
  { key: 'shapeJitter', label: 'Shape jitter', min: 0, max: 0.24, def: 0.6, group: 'Instance' },
  { key: 'sizeJitter', label: 'Size jitter', min: 0, max: 0.2, def: 0.4, group: 'Instance' },
  { key: 'tremor', label: 'Tremor', min: 0, max: 0.1, def: 0.3, group: 'Stroke' },
  { key: 'tremorFreq', label: 'Tremor frequency', min: 0.5, max: 6, def: 0.4, group: 'Stroke' },
  { key: 'overshoot', label: 'Overshoot', min: 0, max: 0.25, def: 0.5, group: 'Stroke' },
  { key: 'pen', label: 'Pen width', min: 0.03, max: 0.22, def: 0.3, group: 'Pen' },
  { key: 'pressure', label: 'Pressure variation', min: 0, max: 1, def: 0.5, group: 'Pen' },
  { key: 'taper', label: 'Taper', min: 0, max: 1, def: 0.5, group: 'Pen' },
  { key: 'fatigue', label: 'Fatigue', min: 0, max: 1, def: 0.3, group: 'Behaviour' },
  { key: 'tilt', label: 'Line tilt (°)', min: -4, max: 4, def: 0.5, group: 'Behaviour' },
] as const satisfies readonly ParamDef[];

export type ParamKey = (typeof PARAMS)[number]['key'];

export interface Hand {
  seed: number;
  skeleton: SkeletonId;
  /** normalized 0..1 */
  params: Record<ParamKey, number>;
}

export type Resolved = Record<ParamKey, number>;

export function resolve(hand: Hand): Resolved {
  const out = {} as Resolved;
  for (const p of PARAMS) out[p.key] = p.min + (p.max - p.min) * clamp01(hand.params[p.key] ?? p.def);
  return out;
}

export function defaultHand(seed = 1, skeleton: SkeletonId = 'elfin'): Hand {
  const params = {} as Record<ParamKey, number>;
  for (const p of PARAMS) params[p.key] = q8(p.def);
  return { seed: seed >>> 0, skeleton, params };
}

/** A plausible random hand. Stays near sensible defaults but spans a wide range. */
export function randomHand(seed: number): Hand {
  const r = rng(hash('hand', seed));
  const hand = defaultHand(hash('seed', seed), SKELETONS[Math.floor(r.next() * SKELETONS.length)]);
  for (const p of PARAMS) hand.params[p.key] = q8(p.def + r.bell() * 0.45);
  hand.params.tilt = q8(0.5); // v1 lesson: line wander is annoying; keep tilt neutral by default
  return hand;
}

const VERSION = 3; // v2: dropped slantJitter. v3: dropped roundness, ascender range to 2

export function encodeHand(hand: Hand): string {
  const bytes = new Uint8Array(6 + PARAMS.length);
  bytes[0] = VERSION;
  bytes[1] = Math.max(0, SKELETONS.indexOf(hand.skeleton));
  new DataView(bytes.buffer).setUint32(2, hand.seed >>> 0);
  PARAMS.forEach((p, i) => (bytes[6 + i] = Math.round(clamp01(hand.params[p.key]) * 255)));
  return 's1' + toBase64Url(bytes);
}

export function decodeHand(code: string): Hand {
  if (!code.startsWith('s1')) throw new Error('Not a scribble hand code');
  const bytes = fromBase64Url(code.slice(2));
  if (bytes.length < 6 || bytes[0] !== VERSION) throw new Error('Unsupported hand code');
  const hand = defaultHand(new DataView(bytes.buffer).getUint32(2), SKELETONS[bytes[1]] ?? 'elfin');
  PARAMS.forEach((p, i) => {
    if (6 + i < bytes.length) hand.params[p.key] = bytes[6 + i] / 255;
  });
  return hand;
}

/** Snap to the 8-bit grid the string code uses, so a hand always equals its decoded code. */
export function q8(v: number): number {
  return Math.round(clamp01(v) * 255) / 255;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) s += B64[(n >> (18 - 6 * j)) & 63];
  }
  return s;
}

function fromBase64Url(s: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const c of s) {
    const v = B64.indexOf(c);
    if (v < 0) throw new Error('Invalid hand code');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}
