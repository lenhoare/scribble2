# Scribble v2 — Procedural Handwriting

## Goal

Fast, deterministic, **distinct and messy** handwriting that:

- is defined by a small, saveable **hand profile** (per person, per app, per character…)
- renders identically everywhere from `(profile, text)`
- is cheap enough to render lots of text live
- works on the web first, with a clean path to native

v0 (`old_idea.md`) was a PixiJS playground distorting font glyphs with EQ curves. v2 replaces
whole-glyph transforms with **pen strokes** deformed from inside.

---

## Lessons from v1 → design rules

| v1 observation | v2 rule |
|---|---|
| Slant felt human | One global slant per hand |
| Mixing forward/back slant in one hand did not; per-letter slant jitter didn't add anything in v2 either | No slant variation |
| Baseline wander felt human but was annoying | No baseline wander. (Optional whole-line tilt only, default 0) |
| Up/down placement worked when subtle and overall | Vertical offset is a **persistent per-character quirk** ("this person's o sits high"), not random per instance |
| Left/right placement didn't work | No horizontal jitter. Spacing is regular (global tracking only) |
| Font glyphs still look like a font | Mess comes from **inside the strokes**: shape warp, tremor, overshoot, pen pressure |
| Pixi per-glyph Text | No Pixi. Pure geometry core + thin renderers |

`mess` (0..1, default 0.83) is a per-use setting that scales all deformation. It maps onto the
raw multiplier range 0–0.6: above 0.6 was too messy. 0 is kept for neat hands and for switching
the mess off to see what it's doing.

---

## Architecture

```
            ┌──────────────────── core (pure TS, no DOM) ────────────────────┐
profile ──► │ skeleton glyphs → layout → per-char quirks → per-instance warp  │ ──► RenderResult
text    ──► │ → tremor → pen model (width/taper/pressure) → outlines          │     (polygons, bbox)
            └─────────────────────────────────────────────────────────────────┘
                                          │
                     ┌────────────────────┼─────────────────────┐
                   SVG path            Canvas2D            (later) WebGL / native / OTF export
```

- **Core** is a pure function. No DOM, no randomness outside seeded PRNG. Portable to Rust/WASM
  later for native (Swift/Kotlin) with the same output.
- **Skeletons**: single-stroke (centerline) fonts, converted at build time into normalized
  stroke data (units: x-height = 1, baseline = 0, y up).
  - Elfin (casual print), Readability (neat print), Felix (italic), Hershey Script (cursive),
    Allure (flowing script), Semi-joined (Readability + a join table). Licenses in `fonts/README.md`.
  - Later: capture a real person's strokes as a custom skeleton.

## Determinism & stability

- PRNG: seeded, hash-based. Every random draw is keyed, never sequential across the text:
  - **per-character quirks** keyed by `(hand seed, char)` → the same every time that char appears
  - **per-instance variation** keyed by `(hand seed, word, index in word, nth occurrence of word)`
    → editing one word doesn't reshuffle the rest of the text; repeated words still differ
- Profile + text + options ⇒ byte-identical geometry.

## Hand profile

Seed + skeleton + ~20 parameters, each stored as a byte (0–255 → mapped range).
Encoded as a short string: `s1` + base64url (≈ 35 chars). Unknown/older versions decode with defaults.

| Group | Param | Meaning |
|---|---|---|
| Shape | `skeleton` | base letterforms |
| | `slant` | global slant (−10°…+30°) |
| | `width` | horizontal squash/stretch |
| | `ascender` | ascender/descender length relative to x-height (0.6–2) |
| Spacing | `tracking` | letter spacing |
| | `wordSpace` | word spacing |
| Quirks (persistent per char) | `charLift` | vertical offset per character |
| | `charScale` | size quirk per character |
| | `charShape` | persistent shape warp per character |
| Instance (every occurrence) | `shapeJitter` | smooth shape warp |
| | `sizeJitter` | size variance |
| Stroke | `tremor` | high-frequency wobble along strokes |
| | `tremorFreq` | wobble frequency |
| | `overshoot` | stroke ends run long / stop short |
| Pen | `pen` | nib width |
| | `pressure` | width variation along a stroke |
| | `taper` | thin start/end of strokes |
| Behaviour | `fatigue` | mess grows with distance written |
| | `tilt` | whole-line tilt (default 0) |
| | `joins` | share of allowed letter pairs joined (cursive 0.9, semi-joined 1, print 0) |

## API (core)

```ts
const hand = decodeHand('s1…') // or randomHand(seed), defaultHand()
const r = render(hand, text, { size: 24, maxWidth: 600, lineHeight: 3, mess: 0.83 })
// r.width, r.height, r.baseline (px), r.polygons: Float32Array[] (x,y pairs, fill nonzero)
toSVG(r, { color: '#1b2a4a' })       // string
drawCanvas(ctx, r, { color })         // Canvas2D
```

`size` = x-height in px. Text: multi-line (`\n`) and word-wrapped to `maxWidth`.

Layout frame is fixed, not fitted to the ink: left edge at x = 0, room above the first baseline
from the skeleton's tallest ascender (scaled by `ascender`), room below the last baseline from its
deepest descender. Typing a tall or deep letter never moves the rest of the text.

## Performance targets

- Current: ~2 ms per ~100 characters on desktop (geometry + outline), ≈20 µs per letter.
  Target ≤ 1 ms: fuse the per-stroke passes (warp/tremor/normals/outline) and reuse buffers.
- Apps should cache `RenderResult` per (hand code, text, options); it is immutable.
- Skeleton densification and per-letter quirk warps are cached.
- Renderers are allocation-light; SVG output is a single `<path>` per render

## Playground (web)

- Text box, several hands side by side, sliders for every profile param, `mess` master slider
- Randomise hand, copy/paste profile string, perf readout

## Cursive joins

- Each letter gets an **exit** (rightmost stroke end) and **entry** (leftmost stroke start).
  Stroke direction in the skeleton data isn't reliable, so strokes are flipped as needed.
- Whether a pair joins is a **habit**: keyed by `(hand seed, letter, next letter)`, joined when
  that pair's draw is below `joins`. Joins only happen within a word, between letters.
- The connector is a cubic curve following each end's direction, merged with both strokes into
  one continuous stroke, so pen pressure and taper flow through and only the free ends taper.
- No join when the gap is too big, it would go backwards, or it would climb to an ascender top
  (c→k would read as a→k).
- Letters entered from their right side (a, c, d, g, o, q) are joined **over the top**: the
  connector arrives at the top of the bowl moving right and the pen retraces back over it.
- Leaving the foot of a downstroke (i, n, h), the connector curls right before rising.
- **Join tables** (`src/data/join-rules.ts`): a skeleton can list which letters join `from`
  and `to`, plus `always` / `never` pair overrides. Used by **Semi-joined** (Readability's
  letterforms, modern semi-joined print: h→i→n, e→r, t→i→r, e→f join; nothing joins into or out
  of o or g; p→h, n→x, a→c, u→a don't). Print letters built up from a stem foot (n, m, r, p)
  are entered at the top of the stem. The table is expected to grow with feedback.
- Plain print skeletons don't join by default: random print joins looked wrong.

## Roadmap

1. **v2.0** core + SVG/Canvas renderers + playground ← now
2. ~~Cursive joins~~ (done, see below); glyph variants per char
3. Ink: opacity/colour variance, pooling at stroke starts, pen-lift gaps
4. Capture: write a pangram on a tablet → custom skeleton in profile
5. Native: Rust core → WASM (web) + Swift/Kotlin bindings; or OTF export with contextual alternates
6. Animation: stroke-order draw-on
