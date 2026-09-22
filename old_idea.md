# `v0` — Handwriting / Text-Feel Playground

## Purpose

Create a **standalone playground** for experimenting with _handwritten-feeling typography_.

This version exists solely to discover:

- how “messy” text should behave,
    
- how distortions evolve across a sentence,
    
- and what combinations feel _human_, not digital.
    

No cards system, no storage, no SRS, no squiggles yet — just expressive text.

---

## Core Idea

- Render one line of text using **per-glyph objects**.
    
- Distort each glyph independently.
    
- Distortions vary **across the text**, driven by multiple **EQ-style curves**.
    
- Curves represent _progress through the text_, not time or animation.
    

This is a **playground**, not a product UI.

---

## Technology

- **Renderer:** PixiJS
    
- **Graphics:** GPU-accelerated 2D
    
- **Text:** Pixi `Text` objects (one per glyph)
    
- **Fonts:** Google Fonts (loaded normally, rendered by Pixi)
    
- **Platform:** Web (desktop first)
    

---

## Visual Layout

Each equaliser is a line graph with y -1,0,1 and x represents distance along the text
Each is set as straight line at 0 to start but each has 10 time points where the y valuse can be dragged up and down between -1 and 1

EQ 1: Jitter 
EQ 2: Rotation
EQ 3: Stretch X 
EQ 4: Stretch Y
EQ 5: Baseline Warp  

- All 5 EQs are **visible at once**
    
- Card updates **live** as curves are edited
    

---

## Text

- Single fixed line (initially hardcoded)
    
- `Sphinx of black quartz, judge my vow, falling mighty duck.`
        

No text editing in v0.

---

## Card Rendering

### Background

- App background: near black (`#050508`)
    
- Card background: luminous yellow (`~#FFF95E`)
    
- Rounded rectangle
    
- Horizontal ruled lines (subtle, warm tone)
    

### Card Container

- One Pixi `Container`
    
- Holds:
    
    - card background (`Graphics`)
        
    - ruled lines (`Graphics`)
        
    - text container (`Container` of glyphs)
        

---

## Glyph Model

Each character is its own object.

`type Glyph = {   char: string;   baseX: number;   baseY: number;   display: PIXI.Text; };`

- Glyphs are created **once**
    
- Their transforms are updated continuously
    

---

## EQ Curves (Core Control Mechanism)

### Structure

- **5 independent EQs**, stacked vertically
    
- Each EQ:
    
    - X-axis: progress through text (`u ∈ [0,1]`)
        
    - Y-axis: value (`v ∈ [-1, +1]`)
        
- Neutral = `0`
    

### Bands

- Fixed number of control points (recommended: **6 or 8**)
    
- Bands evenly spaced along X
    
- Each band draggable **up/down only**
    
- Interpolation between bands: **linear** (v0)
    

---

## Distortion Parameters

Each EQ controls one distortion:

1. **Jitter**
    
2. **Rotation**
    
3. **Stretch X**
    
4. **Stretch Y**
    
5. **Baseline Warp**
    

All EQs are applied **simultaneously**.

---

## Distortion Mapping

For glyph at index `i` of `N`:

`u = i / (N - 1)`

Sample each EQ at `u`:

`vj, vr, vsx, vsy, vb ∈ [-1, +1]`

Apply transforms:

### Jitter

`x += noise() * |vj| * jitterMax y += noise() * |vj| * jitterMax`

### Rotation

`rotation = vr * maxRotationRadians`

### Stretch

`scaleX = 1 + vsx * stretchXMax scaleY = 1 + vsy * stretchYMax`

### Baseline Warp

`y += vb * baselineWarpMax`

Noise is symmetric (`[-1, +1]`) and optionally seeded.

---

## Rendering Loop

On any EQ change:

1. Clear frame
    
2. Draw card background
    
3. Draw ruled lines
    
4. For each glyph:
    
    - Reset to base position
        
    - Sample all EQs
        
    - Apply transforms
        
5. Present frame
    

No animation loop required — render on interaction is enough.

---

## EQ UI Behavior

- Midline (`v = 0`) always visible
    
- Top = `+1`, Bottom = `-1`
    
- Dragging is immediate and live
    
- Double-click band → reset to 0
    
- Optional: per-EQ reset button
    

---

## Fonts

- Loaded via Google Fonts
    
- Initial suggestions:
    
    - Kalam
        
    - Patrick Hand
        
    - Shadows Into Light
        
- Font choice is **part of the experiment**
    

---

## Out of Scope (Explicitly)

Not included in v0:

- Squiggle input
    
- Mess-code generation
    
- Card bending / warping
    
- WebGL shaders
    
- Patina (creases, splodges, stains)
    
- Flip interaction
    
- Multi-line text
    
- Text editing
    
- Persistence / saving
    
- SRS / flashcards
    
- Import / export
    

---

## Definition of Done

v0 is complete when:

- Text is rendered per-glyph via Pixi
    
- All 5 EQs affect glyphs live
    
- Distortions vary smoothly across the text
    
- Neutral curves produce clean text
    
- Extreme curves produce expressive, scribbly results
    
- You enjoy _playing_ with it
