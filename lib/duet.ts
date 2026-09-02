import type { Author, BrushKind, PaperKind } from './types'

/**
 * A duet: one painting, two painters, no queue.
 *
 * This began as a strict alternation. Twelve passes, human, agent, human,
 * agent, and nobody allowed to touch the paper out of turn. It proved the point
 * that the two of them can work on one picture, and it proved it the way a
 * metronome proves you can play music: by removing the thing that makes it
 * worth doing.
 *
 * What was actually wrong with it was the waiting. Half the time on the sheet
 * was spent watching a panel say it was somebody else's turn. Painters sharing
 * a sheet do not do that. They look at what is unpainted, say "I'll take the
 * tail, you do the water", and both start.
 *
 * So a score is now a **board of parts** rather than a queue of passes. Any part
 * with nothing standing in front of it can be taken by either painter at any
 * moment, and the only rule left is the honest one: two brushes must not land on
 * the same part. Taking a part is how you say so, and it is a tool call for the
 * agent and a click for the human, which means the negotiation the two of them
 * have to do is a real negotiation over a shared surface rather than a turn the
 * software hands out.
 *
 * `by` is a suggestion about which painter each part suits, not a rule. A part
 * marked for the agent can be taken by the human and the other way round, and
 * the panel says so.
 */

export interface DuetPart {
  id: string
  /** Who this part suits. A recommendation the panel shows; either may take it. */
  by: Author | 'either'
  title: string
  /** One line for the human, on the panel. */
  short: string
  /** The full brief, handed to whoever takes it. */
  hint: string
  /**
   * Parts that really want to exist first.
   *
   * Not a lock. Foliage hung on branches nobody has drawn is a worse painting,
   * not an error, so this greys the part out and says why rather than refusing.
   */
  after?: string[]
  /** For a hand-painted part, one guide per stroke, traced in any order. */
  guides?: string[]
  /** Brush the human's hand is loaded with when they take this part. */
  loadout?: {
    kind: BrushKind
    pigment: string
    water: number
    pressure: number
    opacity: number
    fill: boolean
    layer: string
  }
}

export interface DuetScore {
  id: string
  title: string
  subtitle: string
  /** Two lines on the panel, before anyone commits to it. */
  blurb: string
  paper: PaperKind
  parts: DuetPart[]
}

/* ------------------------------------------------------------------ *
 * Evening river
 * ------------------------------------------------------------------ */

export const KAWA: DuetScore = {
  id: 'kawa',
  title: 'Evening river',
  subtitle: 'A landscape in the old manner',
  blurb:
    'Distance made by weakness, not by size. Twelve parts, from a pale sun down to two ' +
    'birds. The foliage has to hang off branches somebody actually drew.',
  paper: 'cold-press',
  parts: [
    {
      id: 'sun',
      by: 'agent',
      title: 'The sun',
      short: 'A big pale sun, low and to the right.',
      hint:
        'A single large sun, low and warm, in the upper right. One flooded disc of dilute ' +
        'vermilion around 720,190 with a radius near 105. Keep the pigment load low, under 0.3: ' +
        'it sits behind everything else in the picture and must not compete with it.',
    },
    {
      id: 'far-hills',
      by: 'agent',
      title: 'The far hills',
      short: 'The distant range, weak and wet.',
      hint:
        'The distant range across the upper third, roughly y 230 to 360, running off both edges ' +
        'of the sheet. Use a granulating blue, cerulean or cobalt, very wet and very pale, ' +
        'under 0.3. Distance is made by keeping it weak, not by making it small.',
    },
    {
      id: 'near-ridge',
      by: 'human',
      title: 'The nearer ridge',
      short: 'One sweep of the flat brush, left to right.',
      after: ['far-hills'],
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
      by: 'agent',
      title: 'The water',
      short: 'The river, flat and almost empty.',
      hint:
        'The river, a flat band from about y 450 down to y 590, edge to edge. Very wet, very ' +
        'pale, cooler than the hills. Leave it almost empty: the paper showing through is the ' +
        'light on the water.',
    },
    {
      id: 'ripples',
      by: 'human',
      title: 'Ripples',
      short: 'Three lines across the water. Keep them broken.',
      after: ['water'],
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
      by: 'agent',
      title: 'The near bank',
      short: 'The near bank, warmer and heavier.',
      hint:
        'The bank in the foreground, from about y 570 to the bottom edge. A warmer, heavier ' +
        'green than anything above it, around 0.4 load. This is the closest thing in the ' +
        'picture, so it carries the most pigment.',
    },
    {
      id: 'grass',
      by: 'human',
      title: 'Grass',
      short: 'Three tufts. Flick upward, uneven.',
      after: ['bank'],
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
      by: 'human',
      title: 'The pine',
      short: 'The trunk, one movement. Let it lean.',
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
      by: 'human',
      title: 'Branches',
      short: 'Three branches. Thin, and drooping at the ends.',
      after: ['trunk'],
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
      by: 'agent',
      title: 'Pine foliage',
      short: 'Needles, hung off the branches that got drawn.',
      after: ['branches'],
      hint:
        'Clusters of needles hanging off the branches on the pine. Call read_painting first and ' +
        'find where those branches actually ended, then hang the foliage on them rather than ' +
        'where you expected them to be. Three or four soft dark clusters, indigo over green, ' +
        'wet enough to bleed together. Not a solid mass: leave gaps for the sky.',
    },
    {
      id: 'rocks',
      by: 'agent',
      title: 'Rocks',
      short: 'Rocks on the waterline, right.',
      after: ['bank'],
      hint:
        'Two or three rocks sitting on the waterline on the right, around x 700 to 930 and ' +
        'y 560 to 610, so they break the join between the river and the bank. Granulating earth ' +
        'pigment, a harder edge than anything else in the picture. Call read_painting first and ' +
        'put them on the line the bank actually landed on.',
    },
    {
      id: 'birds',
      by: 'human',
      title: 'Birds',
      short: 'Two birds. Small and far away.',
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

/* ------------------------------------------------------------------ *
 * The fox
 * ------------------------------------------------------------------ */

export const FOX: DuetScore = {
  id: 'fox',
  title: 'The fox',
  subtitle: 'An animal, built out of one warm mass',
  blurb:
    'A fox sitting in snow. The whole animal arrives as a single flooded shape and every ' +
    'part after it is a decision about where the edges are allowed to go hard.',
  paper: 'cold-press',
  parts: [
    {
      id: 'ground',
      by: 'agent',
      title: 'The ground',
      short: 'A cold pale wash under the animal.',
      hint:
        'The snow the fox is sitting on. One very wet, very pale wash across the bottom of the ' +
        'sheet, from about y 550 down, edge to edge. Cool: cerulean or cobalt under 0.2 load. ' +
        'Snow is not white paint, it is the paper with a cold shadow on it, so almost all of ' +
        'this should be paper.',
    },
    {
      id: 'body',
      by: 'agent',
      title: 'The whole animal',
      short: 'One flooded silhouette. Do not draw the fur.',
      hint:
        'The entire sitting animal, head included, as one flooded silhouette: roughly x 300 to ' +
        '660 and y 190 to 515, muzzle to the left, rump to the right. Burnt sienna, around 0.6 ' +
        'water and 0.5 load. One shape, not fur. Every hair painted separately is the commonest ' +
        'way an animal study dies, and the human is going to draw the head into this wash ' +
        'afterwards, which only works if it is a wash. Charge a little raw umber low down with ' +
        'the charge parameter so the underside cools without an edge appearing.',
    },
    {
      id: 'ears',
      by: 'human',
      title: 'The ears',
      short: 'Two triangles. Big, and not a matching pair.',
      after: ['body'],
      hint:
        'Two ears off the top of the skull, around x 350 to 465 and up to y 145. Big, upright ' +
        'and pointed, and deliberately not a matching pair. Symmetry is what makes a drawn ' +
        'animal look stuffed.',
      guides: [
        'M 366 206 C 352 176 348 154 356 142 C 370 154 386 172 398 190',
        'M 428 200 C 434 170 442 154 454 148 C 458 164 462 184 464 208',
      ],
      loadout: {
        kind: 'round', pigment: 'sepia', water: 0.4, pressure: 0.5,
        opacity: 0.6, fill: false, layer: 'Body',
      },
    },
    {
      id: 'head',
      by: 'human',
      title: 'The head',
      short: 'Draw the muzzle and the jaw into the wet wash.',
      after: ['body'],
      hint:
        'Draw the line of the muzzle over the top of the animal wash, and the jaw underneath ' +
        'it, so the head separates from the mass. Two strokes, both running back from the tip ' +
        'of the nose near 300,286. A fox muzzle is longer and finer than you think it is.',
      guides: [
        'M 300 286 C 322 254 336 222 366 206',
        'M 300 286 C 322 298 348 306 380 312',
      ],
      loadout: {
        kind: 'round', pigment: 'sepia', water: 0.42, pressure: 0.42,
        opacity: 0.5, fill: false, layer: 'Body',
      },
    },
    {
      id: 'tail',
      by: 'agent',
      title: 'The tail',
      short: 'A heavy sweep, curling round to the right.',
      after: ['body'],
      hint:
        'The brush, sweeping out to the right of the rump and curling forward, roughly x 640 to ' +
        '870 and y 400 to 555. Wetter than the body so the two fuse where they meet and there ' +
        'is no seam. A fox tail is nearly as much of the animal as the body is; if it looks too ' +
        'big it is about right.',
    },
    {
      id: 'tail-tip',
      by: 'agent',
      title: 'The white tip',
      short: 'Pigment lifted back off, not white paint.',
      after: ['tail'],
      hint:
        'The white tip at the far end of the tail, near 820,510. There is no white paint in ' +
        'this studio and there is none in watercolour either. Paint a mark with lift set to ' +
        'true over the end of the tail: a thirsty brush pulls the pigment back out and the ' +
        'paper comes through. That is how the highlight is made.',
    },
    {
      id: 'chest',
      by: 'agent',
      title: 'The chest',
      short: 'The pale front, taken back out of the wash.',
      after: ['body'],
      hint:
        'The pale bib down the front of the chest, roughly x 395 to 465 and y 355 to 500. ' +
        'Almost nothing: a lifted mark that lets the paper up through the body wash. The light ' +
        'on an animal is the part you do not paint.',
    },
    {
      id: 'legs',
      by: 'human',
      title: 'The legs',
      short: 'Four dark legs, straight down onto the snow.',
      after: ['body'],
      hint:
        'Four legs coming down out of the body onto the snow, from about y 500 to y 570. Dark, ' +
        'nearly black, and short. A fox has black stockings and they are the darkest thing in ' +
        'the picture, which is what holds the animal onto the ground rather than floating above it.',
      guides: [
        'M 434 500 C 430 526 430 550 434 566',
        'M 482 508 C 480 532 480 554 484 568',
        'M 552 510 C 556 534 558 554 556 568',
        'M 604 502 C 610 528 612 550 610 564',
      ],
      loadout: {
        kind: 'round', pigment: 'sepia', water: 0.22, pressure: 0.44,
        opacity: 0.85, fill: false, layer: 'Detail',
      },
    },
    {
      id: 'face',
      by: 'human',
      title: 'The eye and the nose',
      short: 'Two small dark marks. Nothing more.',
      after: ['head'],
      hint:
        'One eye near 395,245 and one nose at the tip of the muzzle near 292,290. Two marks, ' +
        'small and very dark, and then stop. Everything an animal study has to say about being ' +
        'alive is said by these two and by nothing else on the head, and a third mark takes it back.',
      guides: [
        'M 382 246 C 390 238 402 238 410 245',
        'M 296 280 C 288 284 286 292 292 298',
      ],
      loadout: {
        kind: 'liner', pigment: 'lamp-black', water: 0.16, pressure: 0.4,
        opacity: 0.92, fill: false, layer: 'Detail',
      },
    },
    {
      id: 'whiskers',
      by: 'human',
      title: 'Whiskers',
      short: 'Three flicks off the muzzle. Fast.',
      after: ['face'],
      hint:
        'Three whiskers off the muzzle, going left off the edge of the animal. Move fast and ' +
        'let them taper away to nothing. A whisker drawn slowly is a wire.',
      guides: [
        'M 300 292 C 262 286 232 278 210 268',
        'M 300 298 C 262 302 232 304 208 304',
        'M 302 304 C 266 314 238 324 216 334',
      ],
      loadout: {
        kind: 'liner', pigment: 'sepia', water: 0.18, pressure: 0.22,
        opacity: 0.55, fill: false, layer: 'Detail',
      },
    },
    {
      id: 'shadow',
      by: 'agent',
      title: 'The shadow',
      short: 'A cool shadow cast across the snow.',
      after: ['legs'],
      hint:
        'The shadow the animal casts on the snow, running out from where the legs actually met ' +
        'the ground. Read the painting first and find them. Cool and transparent, cobalt with a ' +
        'little rose charged into it, under 0.25 load. A shadow on snow is blue, never grey, ' +
        'and never brown.',
    },
    {
      id: 'weeds',
      by: 'either',
      title: 'Weeds',
      short: 'A few dry stalks through the snow.',
      after: ['ground'],
      hint:
        'Three or four dead stalks pushing up through the snow behind the animal, around x 760 ' +
        'to 880. Dry, thin, ochre. They exist to say how deep the snow is and to stop the ' +
        'background from being nothing at all.',
      guides: [
        'M 776 578 C 784 534 774 502 760 476',
        'M 812 584 C 824 540 824 508 818 482',
        'M 850 580 C 864 544 870 516 872 494',
      ],
      loadout: {
        kind: 'liner', pigment: 'yellow-ochre', water: 0.2, pressure: 0.28,
        opacity: 0.6, fill: false, layer: 'Detail',
      },
    },
  ],
}

/* ------------------------------------------------------------------ *
 * Deep water
 * ------------------------------------------------------------------ */

export const JELLY: DuetScore = {
  id: 'jelly',
  title: 'Deep water',
  subtitle: 'A jellyfish, where the bleeding is the subject',
  blurb:
    'The animal is painted first, on white paper, and the sea is glazed over the top of it ' +
    'afterwards. That order is the whole picture: depth here is a wash, not a colour.',
  paper: 'hot-press',
  parts: [
    {
      id: 'bell',
      by: 'agent',
      title: 'The bell',
      short: 'The dome, on bare paper. Wet and pale.',
      hint:
        'The dome of the animal on the empty sheet, roughly x 300 to 620 and y 150 to 300. ' +
        'Permanent rose, wet, around 0.3 load, with a little quinacridone charged into the top ' +
        'so it is not one flat colour. Paint it on white paper and keep it light. Everything ' +
        'that happens to this picture afterwards makes it darker, and there is no way back.',
    },
    {
      id: 'rim',
      by: 'human',
      title: 'The rim',
      short: 'Scallop along the bottom of the bell.',
      after: ['bell'],
      hint:
        'The scalloped underside of the bell, left to right in one pass. Let the line rise and ' +
        'fall. This is the one hard edge the animal is allowed, and it is what makes the rest ' +
        'of it read as soft.',
      guides: [
        'M 306 300 C 340 320 372 306 400 292 C 428 306 462 320 490 300 C 518 286 552 318 584 306 C 600 300 610 302 618 300',
      ],
      loadout: {
        kind: 'liner', pigment: 'quinacridone-rose', water: 0.3, pressure: 0.38,
        opacity: 0.55, fill: false, layer: 'Body',
      },
    },
    {
      id: 'veil',
      by: 'human',
      title: 'The oral arms',
      short: 'Three ribbons hanging under the bell.',
      after: ['rim'],
      hint:
        'Three wide frilled ribbons hanging under the bell, down to about y 500. Let them ' +
        'wander and let them cross each other. Straight ones look like rope.',
      guides: [
        'M 388 296 C 384 360 396 424 380 486',
        'M 462 300 C 466 372 456 440 470 508',
        'M 536 296 C 542 358 530 420 546 480',
      ],
      loadout: {
        kind: 'round', pigment: 'permanent-rose', water: 0.66, pressure: 0.4,
        opacity: 0.3, fill: false, layer: 'Body',
      },
    },
    {
      id: 'tentacles',
      by: 'human',
      title: 'Tentacles',
      short: 'Five long threads, right off the bottom edge.',
      after: ['rim'],
      hint:
        'Five threads trailing from the rim down past the bottom edge of the sheet. Long, thin, ' +
        'and each drawn in one movement. Do not stop them inside the picture: something that ' +
        'leaves the frame is what tells you the water carries on past it.',
      guides: [
        'M 322 306 C 300 400 316 500 288 610',
        'M 366 302 C 352 410 372 512 344 640',
        'M 462 304 C 458 420 470 530 452 664',
        'M 556 300 C 566 404 548 508 574 636',
        'M 606 304 C 626 396 610 498 638 604',
      ],
      loadout: {
        kind: 'liner', pigment: 'quinacridone-rose', water: 0.34, pressure: 0.2,
        opacity: 0.4, fill: false, layer: 'Body',
      },
    },
    {
      id: 'far-jelly',
      by: 'agent',
      title: 'One further off',
      short: 'A second animal, much weaker.',
      after: ['bell'],
      hint:
        'A second, smaller jellyfish in the upper right around 830,180, at roughly half the ' +
        'size and half the strength of the first, with two or three soft threads under it. Two ' +
        'of anything at different distances is what turns a flat sheet into a body of water. ' +
        'Keep it under 0.16 load: it is far away, and distance is made by weakness.',
    },
    {
      id: 'sea',
      by: 'agent',
      title: 'The sea',
      short: 'One glaze over everything, deep at the top.',
      after: ['bell'],
      hint:
        'Now flood the entire sheet, edge to edge and past them, straight over the animal you ' +
        'have already painted. Indigo, very wet, around 0.3 load, with the grade parameter: ' +
        'angle 90, fade about 0.6, so it is deep at the top and opens up toward the bottom. ' +
        'This is a glaze, and it is the whole picture. Everything under it is pushed back into ' +
        'the water at once, which is a thing you cannot do by choosing a colour for each shape ' +
        'and is the reason watercolour is painted light to dark.',
    },
    {
      id: 'glow',
      by: 'agent',
      title: 'The glow',
      short: 'Light lifted back out through the glaze.',
      after: ['sea'],
      hint:
        'Lift a soft light out of the top left of the bell, near 400,205, with a mark using ' +
        'lift set to true and a low load. This is the only way anything in this picture gets ' +
        'lighter after the glaze, and it is what stops the animal being a stain and makes it ' +
        'something lit from inside.',
    },
    {
      id: 'floor',
      by: 'agent',
      title: 'The floor',
      short: 'Grit and shingle along the very bottom.',
      after: ['sea'],
      hint:
        'The seabed along the bottom edge, from about y 620 down. A dark granular wash: use the ' +
        'spatter parameter, density around 90 and size around 3, so the brush is loaded and ' +
        'knocked rather than painting each speck. Everything above this is a continuous shape ' +
        'with a continuous edge, and a picture made only of those has a smoothness that no ' +
        'water has. Keep the top of it broken so it is a floor and not a shelf.',
    },
    {
      id: 'current',
      by: 'either',
      title: 'The current',
      short: 'Two long drifts across the deep.',
      after: ['sea'],
      hint:
        'Two very long, very pale horizontal drifts low in the picture, nearly the full width. ' +
        'They are the only horizontals in a painting made entirely of verticals, and without ' +
        'them the whole thing falls downward.',
      guides: [
        'M 40 566 C 300 552 660 574 960 556',
        'M 90 636 C 340 624 690 646 950 630',
      ],
      loadout: {
        kind: 'flat', pigment: 'cobalt', water: 0.78, pressure: 0.36,
        opacity: 0.14, fill: false, layer: 'Detail',
      },
    },
  ],
}

export const SCORES: DuetScore[] = [KAWA, FOX, JELLY]

export function findScore(id: string): DuetScore | undefined {
  const q = id.trim().toLowerCase()
  return (
    SCORES.find((s) => s.id === q) ??
    SCORES.find((s) => s.title.toLowerCase() === q) ??
    SCORES.find((s) => s.title.toLowerCase().includes(q))
  )
}
