import type { PaintInput } from './store'
import type { Author, BrushKind, PaperKind } from './types'

/**
 * A duet: one painting, painted in turns.
 *
 * The argument this project makes is that a person and an agent can work on the
 * same picture. A blank sheet does not demonstrate that, because nothing forces
 * either of them to depend on the other. A score does. Twelve passes, alternating,
 * where the human's grass has to sit on the bank the agent laid down and the
 * agent's pine foliage has to hang off branches the human drew.
 *
 * The agent's passes are described, not dictated. `duet_status` hands it the
 * brief for its turn and it paints with the ordinary tools; the reference
 * strokes here are only used when nobody is connected, so the studio can still
 * show what it means.
 */

export interface DuetStep {
  id: string
  by: Author
  title: string
  /** One line for the human, on the panel. */
  short: string
  /** The full brief, handed to the agent when the turn is its own. */
  hint: string
  /** For a human pass, one guide per stroke, traced in order. */
  guides?: string[]
  /** Brush the human's hand is loaded with for this pass. */
  loadout?: {
    kind: BrushKind
    pigment: string
    water: number
    pressure: number
    opacity: number
    fill: boolean
    layer: string
  }
  /** For an agent pass: what it paints if no agent is connected to do it. */
  reference?: PaintInput[]
}

export interface DuetScore {
  id: string
  title: string
  subtitle: string
  paper: PaperKind
  steps: DuetStep[]
}

export const KAWA: DuetScore = {
  id: 'kawa',
  title: 'Evening river',
  subtitle: 'A landscape in the old manner, painted in turns',
  paper: 'cold-press',
  steps: [
    {
      id: 'sun',
      short: 'A big pale sun, low and to the right.',
      by: 'agent',
      title: 'The sun',
      hint:
        'A single large sun, low and warm, in the upper right. One flooded disc of dilute ' +
        'vermilion around 720,190 with a radius near 105. Keep the pigment load low, under 0.3: ' +
        'it sits behind everything else in the picture and must not compete with it.',
      reference: [
        {
          path: 'M 720 190 m -105 0 a 105 105 0 1 0 210 0 a 105 105 0 1 0 -210 0 Z',
          fill: true, pigment: 'cadmium-red', water: 0.9, opacity: 0.26,
          layerId: 'Ground', note: 'the sun, kept pale so it stays behind everything',
        },
      ],
    },
    {
      id: 'far-hills',
      short: 'The distant range, weak and wet.',
      by: 'agent',
      title: 'The far hills',
      hint:
        'The distant range across the upper third, roughly y 230 to 360, running off both edges ' +
        'of the sheet. Use a granulating blue, cerulean or cobalt, very wet and very pale, ' +
        'under 0.3. Distance is made by keeping it weak, not by making it small.',
      reference: [
        {
          path: 'M -30 350 L 120 252 L 214 302 L 332 216 L 432 292 L 542 240 L 652 312 L 782 246 L 902 302 L 1030 262 L 1030 372 L -30 372 Z',
          fill: true, pigment: 'cerulean', water: 0.92, opacity: 0.26,
          layerId: 'Ground', note: 'the far range, granulating and weak so it stays back',
        },
      ],
    },
    {
      id: 'near-ridge',
      short: 'One sweep of the flat brush, left to right.',
      by: 'human',
      title: 'The nearer ridge',
      hint:
        'Trace the ridge in front of the far hills. One long sweep of the flat brush, left to ' +
        'right, without lifting. It is closer than the range behind it, so it can be a little ' +
        'stronger. Guides stay on the paper: you cannot start a stroke off the edge of a sheet.',
      guides: [
        'M 12 402 C 150 358 262 386 388 348 C 508 312 628 366 764 338 C 882 312 958 348 988 340',
      ],
      loadout: {
        kind: 'flat', pigment: 'ultramarine', water: 0.82, pressure: 0.62,
        opacity: 0.2, fill: false, layer: 'Ground',
      },
    },
    {
      id: 'water',
      short: 'The river, flat and almost empty.',
      by: 'agent',
      title: 'The water',
      hint:
        'The river, a flat band from about y 450 down to y 590, edge to edge. Very wet, very ' +
        'pale, cooler than the hills. Leave it almost empty: the paper showing through is the ' +
        'light on the water.',
      reference: [
        {
          path: 'M -30 452 C 300 442 700 456 1030 444 L 1030 592 C 700 604 300 588 -30 598 Z',
          fill: true, pigment: 'cobalt', water: 0.95, opacity: 0.2,
          layerId: 'Ground', note: 'the river, left almost empty so the paper reads as light',
        },
      ],
    },
    {
      id: 'ripples',
      short: 'Three lines across the water. Keep them broken.',
      by: 'human',
      title: 'Ripples',
      hint:
        'Three horizontal lines across the water, one at a time. Keep them nearly flat and ' +
        'do not join them up. Broken lines read as movement; continuous ones read as a fence.',
      guides: [
        'M 120 482 C 300 476 520 488 760 480',
        'M 210 522 C 390 516 610 526 890 518',
        'M 90 558 C 260 552 470 562 700 554',
      ],
      loadout: {
        kind: 'liner', pigment: 'indigo', water: 0.35, pressure: 0.4,
        opacity: 0.45, fill: false, layer: 'Body',
      },
    },
    {
      id: 'bank',
      short: 'The near bank, warmer and heavier.',
      by: 'agent',
      title: 'The near bank',
      hint:
        'The bank in the foreground, from about y 570 to the bottom edge. A warmer, heavier ' +
        'green than anything above it, around 0.4 load. This is the closest thing in the ' +
        'picture, so it carries the most pigment.',
      reference: [
        {
          path: 'M -30 586 C 220 558 520 574 1030 552 L 1030 730 L -30 730 Z',
          fill: true, pigment: 'olive-green', water: 0.72, opacity: 0.4,
          layerId: 'Body', note: 'the near bank, warmest and heaviest because it is closest',
        },
      ],
    },
    {
      id: 'grass',
      short: 'Three tufts. Flick upward, uneven.',
      by: 'human',
      title: 'Grass',
      hint:
        'Three tufts rising off the bank. Flick upward, quickly. They should not be the same ' +
        'height or evenly spaced.',
      guides: [
        'M 296 672 C 302 640 296 616 288 598',
        'M 322 676 C 332 644 334 618 332 600',
        'M 348 670 C 356 642 362 618 364 604',
      ],
      loadout: {
        kind: 'liner', pigment: 'sap-green', water: 0.28, pressure: 0.45,
        opacity: 0.7, fill: false, layer: 'Detail',
      },
    },
    {
      id: 'trunk',
      short: 'The trunk, one movement. Let it lean.',
      by: 'human',
      title: 'The pine',
      hint:
        'The trunk, from the bank up into the sky. Draw it in one movement and let it lean. ' +
        'This is the strongest dark in the picture so far, and everything else is measured ' +
        'against it.',
      guides: ['M 226 694 C 208 600 234 524 206 436 C 190 384 178 344 162 296'],
      loadout: {
        kind: 'round', pigment: 'sepia', water: 0.3, pressure: 0.5,
        opacity: 0.8, fill: false, layer: 'Body',
      },
    },
    {
      id: 'branches',
      short: 'Three branches. Thin, and drooping at the ends.',
      by: 'human',
      title: 'Branches',
      hint:
        'Three branches off the trunk, reaching left and right. Keep them thin and let them ' +
        'droop at the ends, the way a pine does.',
      guides: [
        'M 208 434 C 162 412 120 398 80 396',
        'M 216 486 C 268 468 310 460 352 460',
        'M 176 336 C 142 322 116 314 92 312',
      ],
      loadout: {
        kind: 'liner', pigment: 'sepia', water: 0.25, pressure: 0.45,
        opacity: 0.75, fill: false, layer: 'Body',
      },
    },
    {
      id: 'foliage',
      short: 'Needles, hung off the branches you drew.',
      by: 'agent',
      title: 'Pine foliage',
      hint:
        'Clusters of needles hanging off the branches the human has just drawn. Call ' +
        'read_painting first and find where those branches actually ended, then hang the ' +
        'foliage on them rather than where you expected them to be. Three or four soft dark ' +
        'clusters, indigo over green, wet enough to bleed together. Not a solid mass: leave ' +
        'gaps for the sky.',
      reference: [
        {
          path: 'M 78 396 C 40 384 22 356 44 344 C 30 322 62 306 92 320 C 110 300 148 310 148 334 C 172 344 166 374 138 380 C 122 402 92 406 78 396 Z',
          fill: true, pigment: 'indigo', water: 0.72, opacity: 0.34,
          layerId: 'Body', note: 'needles hung off the lower left branch, left ragged',
        },
        {
          path: 'M 352 462 C 320 456 306 434 326 424 C 318 404 350 394 372 406 C 392 392 418 406 412 426 C 430 438 420 462 396 464 C 382 478 362 474 352 462 Z',
          fill: true, pigment: 'olive-green', water: 0.74, opacity: 0.32,
          layerId: 'Body', note: 'needles on the right branch',
        },
        {
          path: 'M 92 314 C 62 306 52 282 74 274 C 68 256 96 246 116 258 C 134 244 158 258 152 276 C 168 288 158 310 134 310 C 122 322 102 322 92 314 Z',
          fill: true, pigment: 'indigo', water: 0.7, opacity: 0.28,
          layerId: 'Body',
        },
      ],
    },
    {
      id: 'rocks',
      short: 'Rocks on the waterline, right.',
      by: 'agent',
      title: 'Rocks',
      hint:
        'Two or three rocks sitting on the waterline on the right, around x 700 to 930 and ' +
        'y 560 to 610, so they break the join between the river and the bank. Granulating earth ' +
        'pigment, a harder edge than anything else in the picture. Call read_painting first and ' +
        'put them on the line the bank actually landed on.',
      reference: [
        {
          path: 'M 792 592 C 830 560 888 566 918 594 C 938 614 896 632 840 628 C 804 624 788 610 792 592 Z',
          fill: true, pigment: 'burnt-sienna', water: 0.4, opacity: 0.5,
          layerId: 'Detail', note: 'a hard edge against all that softness',
        },
        {
          path: 'M 706 614 C 736 594 776 598 790 616 C 800 632 768 644 732 640 C 712 636 702 624 706 614 Z',
          fill: true, pigment: 'raw-umber', water: 0.42, opacity: 0.44,
          layerId: 'Detail',
        },
      ],
    },
    {
      id: 'birds',
      short: 'Two birds. Small and far away.',
      by: 'human',
      title: 'Birds',
      hint:
        'Two birds in the empty sky, small and far away. Two quick marks, nothing more. ' +
        'The smaller you make them, the larger the landscape becomes.',
      guides: [
        'M 428 152 C 440 141 452 141 464 150',
        'M 486 172 C 496 163 506 163 516 171',
      ],
      loadout: {
        kind: 'liner', pigment: 'sepia', water: 0.2, pressure: 0.3,
        opacity: 0.6, fill: false, layer: 'Detail',
      },
    },
  ],
}

export const SCORES: DuetScore[] = [KAWA]
