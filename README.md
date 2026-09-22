# scribble

Procedural, deterministic handwriting. A **hand** is a ~35-character code; the same hand + text
renders identically everywhere. See [SPEC.md](SPEC.md) for the design and v1 lessons.

```ts
import { randomHand, encodeHand, decodeHand, render, toSVG } from './src';

const hand = randomHand(42);          // or decodeHand('s1…')
const code = encodeHand(hand);        // save per person / per app
const svg = toSVG(render(hand, 'Hello there', { size: 24, mess: 1 }));
```

```sh
npm run dev               # playground (sliders, hand codes, gallery of random hands)
npm test                  # determinism, stability, perf
npm run bench             # render timing
npm run preview -- "text" out.html   # static sheet of hands
npm run build:skeletons   # regenerate src/data/skeletons.json from fonts/
```
