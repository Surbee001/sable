import type { Author, BrushKind, Scene, Stroke } from './types'

/**
 * The study on the sheet when you arrive.
 *
 * A blank rectangle is a bad first impression and, worse, it hides everything
 * this project is arguing. Landing on a finished painting whose every mark can
 * be clicked, taken apart and changed makes the point before a word is read.
 * The mixed authorship is real: these are the strokes as a session actually
 * produced them, agent and human interleaved.
 */

interface SeedStroke {
  path: string
  layer: 'bg' | 'mid' | 'top'
  pigment: string
  water: number
  opacity: number
  pressure?: number
  kind?: BrushKind
  fill?: boolean
  author?: Author
  note?: string
}

const STROKES: SeedStroke[] = [
  // The ground, wet into wet. These run past the edges of the sheet on purpose:
  // a background wash with a visible boundary reads as a shape sitting behind
  // the flower rather than as air around it.
  { path: 'M -60 -60 C 300 -80 700 -70 1060 -60 C 1080 240 1070 500 1060 760 C 700 780 300 775 -60 760 C -80 500 -70 240 -60 -60 Z',
    layer: 'bg', pigment: 'naples-yellow', water: 0.95, opacity: 0.14, fill: true,
    author: 'agent', note: 'warm ground so the flower has air around it' },
  { path: 'M 420 -140 C 900 -120 1140 40 1160 380 C 1170 620 1120 800 1040 820 C 1010 460 860 160 460 -20 Z',
    layer: 'bg', pigment: 'cerulean', water: 0.98, opacity: 0.12, fill: true,
    author: 'agent', note: 'cool light falling in from the top right' },
  { path: 'M 300 560 C 460 600 620 600 760 566 C 700 660 460 672 300 620 Z',
    layer: 'bg', pigment: 'cobalt', water: 0.95, opacity: 0.13, fill: true,
    author: 'agent', note: 'the shadow the flower casts on the ground' },

  // The flower. Five petals, deliberately uneven.
  { path: 'M 470 330 C 396 236 372 132 452 96 C 534 62 586 148 552 244 C 530 300 496 320 470 330 Z',
    layer: 'mid', pigment: 'peach', water: 0.72, opacity: 0.62, fill: true,
    author: 'agent', note: 'top petal, wettest so it bleeds into the ground' },
  { path: 'M 492 336 C 604 262 736 250 772 330 C 802 404 706 464 596 424 C 540 402 510 362 492 336 Z',
    layer: 'mid', pigment: 'peach', water: 0.68, opacity: 0.66, fill: true, author: 'agent' },
  { path: 'M 494 358 C 578 448 606 566 522 604 C 442 640 388 560 428 476 C 452 424 476 382 494 358 Z',
    layer: 'mid', pigment: 'peach', water: 0.7, opacity: 0.6, fill: true, author: 'agent' },
  { path: 'M 452 350 C 344 402 224 396 202 330 C 180 262 268 218 366 262 C 414 284 436 326 452 350 Z',
    layer: 'mid', pigment: 'peach', water: 0.74, opacity: 0.58, fill: true, author: 'agent' },
  { path: 'M 456 322 C 372 268 314 172 366 118 C 420 62 490 116 490 200 C 490 258 470 300 456 322 Z',
    layer: 'mid', pigment: 'quinacridone-rose', water: 0.88, opacity: 0.34, fill: true,
    author: 'human', note: 'pushed this one back, cooler and much wetter' },

  // The throat, which carries the darkest note in the picture.
  { path: 'M 474 344 m -58 0 a 58 48 0 1 0 116 0 a 58 48 0 1 0 -116 0 Z',
    layer: 'mid', pigment: 'alizarin-crimson', water: 0.88, opacity: 0.5, fill: true,
    author: 'agent', note: 'crimson allowed to bleed out of the throat' },
  { path: 'M 474 344 m -24 0 a 24 20 0 1 0 48 0 a 24 20 0 1 0 -48 0 Z',
    layer: 'top', pigment: 'alizarin-crimson', water: 0.3, opacity: 0.95, fill: true, author: 'agent' },
  { path: 'M 474 344 m -9 0 a 9 8 0 1 0 18 0 a 9 8 0 1 0 -18 0 Z',
    layer: 'top', pigment: 'sepia', water: 0.15, opacity: 1, fill: true,
    author: 'human', note: 'a real dark, so everything else reads as light' },

  // Staminal column.
  { path: 'M 474 344 C 546 288 626 226 682 182',
    layer: 'top', pigment: 'cadmium-yellow', water: 0.22, opacity: 0.9, pressure: 0.75,
    kind: 'liner', author: 'agent', note: 'staminal column' },
  { path: 'M 682 182 m -10 0 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 Z',
    layer: 'top', pigment: 'cadmium-yellow', water: 0.2, opacity: 1, fill: true, author: 'agent' },
  { path: 'M 626 226 l 30 -14 M 648 208 l 26 -20 M 600 250 l 26 -22 M 578 268 l 22 -26',
    layer: 'top', pigment: 'cadmium-red', water: 0.2, opacity: 0.9, pressure: 0.42,
    kind: 'liner', author: 'agent' },

  // Stem and leaves.
  { path: 'M 506 588 C 524 640 538 682 536 700',
    layer: 'mid', pigment: 'olive-green', water: 0.4, opacity: 0.7, pressure: 0.3,
    kind: 'liner', author: 'agent' },
  { path: 'M 534 646 C 620 596 726 600 772 656 C 706 706 600 704 534 646 Z',
    layer: 'mid', pigment: 'sap-green', water: 0.6, opacity: 0.6, fill: true, author: 'agent' },
  { path: 'M 506 640 C 424 604 328 616 288 668 C 360 708 452 696 506 640 Z',
    layer: 'mid', pigment: 'viridian', water: 0.66, opacity: 0.52, fill: true,
    author: 'agent', note: 'viridian granulates, so the mottle is the paper showing through' },
  { path: 'M 540 648 C 616 626 700 630 760 652',
    layer: 'top', pigment: 'sepia', water: 0.24, opacity: 0.55, pressure: 0.34,
    kind: 'liner', author: 'human' },
  { path: 'M 502 644 C 430 626 350 636 296 664',
    layer: 'top', pigment: 'sepia', water: 0.24, opacity: 0.5, pressure: 0.32,
    kind: 'liner', author: 'human' },

  // One broad, very wet shadow rather than several small dark notes. Small
  // accents at this scale read as extra petals, not as form.
  { path: 'M 380 300 C 470 250 560 270 600 360 C 620 450 540 520 440 490 C 360 460 340 360 380 300 Z',
    layer: 'mid', pigment: 'quinacridone-rose', water: 0.95, opacity: 0.16, fill: true,
    author: 'human', note: 'wet shadow through the middle so the flower turns' },
]

export function seedScene(): Scene {
  const strokes: Stroke[] = STROKES.map((s, i) => ({
    id: `seed_${i.toString(36)}`,
    layerId: s.layer,
    kind: s.kind ?? 'round',
    path: s.path,
    pigment: s.pigment,
    water: s.water,
    pressure: s.pressure ?? 0.7,
    opacity: s.opacity,
    fill: s.fill ?? false,
    seed: 10007 + i * 7919,
    author: s.author ?? 'agent',
    createdAt: i,
    note: s.note,
  }))

  return {
    title: 'Peach hibiscus, wet-in-wet',
    paper: 'cold-press',
    layers: [
      { id: 'bg', name: 'Ground', visible: true, wetness: 0.65, opacity: 1 },
      { id: 'mid', name: 'Body', visible: true, wetness: 0.28, opacity: 1 },
      { id: 'top', name: 'Detail', visible: true, wetness: 0, opacity: 1 },
    ],
    strokes,
  }
}
