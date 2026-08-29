/**
 * How particular things are painted.
 *
 * Principles do not survive contact with a blank sheet. Told to keep a limited
 * palette and vary its edges, an agent asked for a mountain still writes a
 * triangle, because the gap is not knowledge of watercolour in general but of
 * how this subject in particular is built: how many washes, in what order, at
 * what strength, and what the silhouette actually does.
 *
 * So these are worked recipes rather than advice. Each one is the sequence a
 * painter would use, with real numbers and a real path to start from. The
 * coordinates assume the whole sheet; an agent painting something smaller
 * scales them and moves them, which is a far easier problem than inventing the
 * structure.
 */

export interface SubjectRecipe {
  id: string
  name: string
  also: string[]
  /** The one thing that most often goes wrong. */
  trap: string
  passes: Array<{ what: string; how: string; path?: string }>
}

export const SUBJECTS: SubjectRecipe[] = [
  {
    id: 'mountain',
    name: 'Mountains and hills',
    also: ['hill', 'hills', 'range', 'peak', 'ridge', 'landscape', 'valley'],
    trap:
      'A triangle. Real ridgelines are a run of uneven shoulders with the summit off centre, ' +
      'and they always leave the sheet at both sides rather than sitting on it.',
    passes: [
      {
        what: 'The furthest range',
        how:
          'Palest and coolest, load 0.15 to 0.2, water above 0.9, on the wettest layer. ' +
          'Distance is made by weakness, not by size. Granulating blues, cerulean or cobalt.',
        path:
          'M -40 330 C 110 262 230 296 372 244 C 512 194 630 262 792 226 ' +
          'C 910 198 986 236 1040 222 L 1040 400 L -40 406 Z',
      },
      {
        what: 'The middle range',
        how:
          'Overlapping the first and lower, load 0.25 to 0.3, a little warmer. Its top edge ' +
          'must cross the one behind at an angle, never run parallel to it.',
        path:
          'M -40 392 C 160 344 372 392 596 352 C 780 320 916 356 1040 340 L 1040 470 L -40 476 Z',
      },
      {
        what: 'The nearest land',
        how:
          'Strongest and warmest, load 0.35 to 0.45, water under 0.6 so it holds an edge. ' +
          'Runs off the bottom of the sheet. Three ranges at three strengths is the whole ' +
          'illusion of depth.',
        path: 'M -40 520 C 240 480 560 512 1040 470 L 1040 740 L -40 740 Z',
      },
      {
        what: 'One dark',
        how:
          'A small stand of trees or a cleft, sepia or indigo at load 0.8 and water 0.25, ' +
          'on the near land and well off centre. Small. It sets the scale of everything.',
      },
    ],
  },

  {
    id: 'flower',
    name: 'A flower',
    also: ['flowers', 'petal', 'petals', 'rose', 'poppy', 'bloom', 'blossom', 'peony'],
    trap:
      'Petals as separate even ovals arranged like a fan, all the same size, none touching. ' +
      'Petals overlap, differ in size, turn away, and some are half hidden behind others.',
    passes: [
      {
        what: 'The whole head, wet',
        how:
          'One pale wash for the entire flower before any petal exists, load 0.2, water 0.9. ' +
          'Everything after is painted into this, which is what fuses the petals into one form ' +
          'instead of a bouquet of separate shapes.',
        path: 'M 500 300 C 620 300 700 380 690 470 C 660 560 540 590 460 550 C 380 500 380 360 500 300 Z',
      },
      {
        what: 'Petals, three or five',
        how:
          'Odd numbers. Vary the size by half again between the largest and smallest. Let each ' +
          'one overlap its neighbour rather than meeting it. Load 0.4 to 0.6, water 0.7 so they ' +
          'bleed together at the joins. One petal should be foreshortened, much narrower.',
        path: 'M 480 330 C 560 300 640 340 650 410 C 620 470 520 470 470 410 C 450 370 460 344 480 330 Z',
      },
      {
        what: 'The throat',
        how:
          'A small dark centre, alizarin or quinacridone at load 0.6 and water 0.85, so it ' +
          'bleeds outward into the petals. Off centre. This is where the eye goes.',
      },
      {
        what: 'Stem and one leaf',
        how:
          'Liner brush, water 0.3, one confident curve that leans. A leaf is not a symmetrical ' +
          'almond: it has a spine off centre and one side wider than the other.',
      },
    ],
  },

  {
    id: 'tree',
    name: 'A tree',
    also: ['trees', 'pine', 'branch', 'branches', 'foliage', 'wood', 'forest'],
    trap:
      'A brown stick with a green circle on top. Foliage is several separate clumps with sky ' +
      'showing between them, and the trunk is barely visible through it.',
    passes: [
      {
        what: 'The mass of foliage',
        how:
          'Two or three overlapping soft clumps, not one. Load 0.3, water 0.8. Leave real gaps ' +
          'between them for the sky. The silhouette should be lopsided.',
        path: 'M 380 300 C 300 250 330 170 430 176 C 500 130 610 160 620 240 C 690 290 640 380 540 372 C 460 400 390 360 380 300 Z',
      },
      {
        what: 'The trunk',
        how:
          'Sepia or raw umber, water 0.3, load 0.7. It leans. It tapers. It disappears behind ' +
          'the foliage and reappears. Never a straight vertical.',
        path: 'M 512 660 C 496 560 528 470 502 384 C 486 330 470 296 452 250',
      },
      {
        what: 'Branches',
        how:
          'Liner, thin, three at most, reaching out and drooping at the ends. They come off the ' +
          'trunk at different heights and different angles.',
      },
      {
        what: 'The darks inside',
        how:
          'Indigo over the green at load 0.6, only underneath the clumps where they shade each ' +
          'other. This is what turns a flat blob into a volume.',
      },
    ],
  },

  {
    id: 'water',
    name: 'Water',
    also: ['sea', 'river', 'lake', 'ocean', 'estuary', 'reflection', 'pond'],
    trap:
      'Filling it in. Water is mostly bare paper. Every mark on it must be horizontal, or it ' +
      'stops reading as a level surface.',
    passes: [
      {
        what: 'The plane',
        how:
          'One very pale wash, load 0.15, water 0.95, running off both sides. Leave broad bands ' +
          'of untouched paper through it. Those are the light and they cannot be added later.',
        path: 'M -40 450 C 300 440 700 462 1040 442 L 1040 600 C 700 616 300 596 -40 610 Z',
      },
      {
        what: 'Reflections',
        how:
          'Directly beneath whatever stands in the water, the same colour, weaker, softened, ' +
          'and stretched vertically. Water 0.85 so the bottom of the reflection dissolves.',
      },
      {
        what: 'A few ripples',
        how:
          'Three or four flat horizontal lines at most, broken, never touching each other, ' +
          'wider apart as they come towards you. Liner, water 0.3, load 0.45.',
      },
    ],
  },

  {
    id: 'sky',
    name: 'Sky and clouds',
    also: ['clouds', 'cloud', 'sunset', 'dusk', 'dawn', 'sun', 'moon'],
    trap:
      'Painting the clouds. You paint the blue and leave the clouds as bare paper, which is the ' +
      'oldest rule in watercolour and the one most often broken.',
    passes: [
      {
        what: 'The blue',
        how:
          'One wash across the whole top, running off all three edges, water 0.95, load 0.2. ' +
          'Leave irregular islands of bare paper for cloud. Stronger at the top, fading down.',
        path:
          'M -40 -40 L 1040 -40 L 1040 300 C 880 340 760 250 600 290 ' +
          'C 460 324 320 260 160 300 C 60 324 0 300 -40 320 Z',
      },
      {
        what: 'Cloud shadow',
        how:
          'Only underneath the bare shapes, a grey violet at load 0.25, water 0.8, with a soft ' +
          'top edge and a softer bottom. Never outline a cloud.',
      },
      {
        what: 'A sun, if you want one',
        how:
          'Do not draw a circle. Leave a round patch of bare paper as you lay the blue, or put ' +
          'one very dilute warm wash where the light is, load under 0.25, and let its edge ' +
          'dissolve on at least one side.',
      },
    ],
  },

  {
    id: 'field',
    name: 'Fields and grass',
    also: ['grass', 'meadow', 'field', 'hedge', 'crop', 'ground'],
    trap:
      'Uniform green everywhere. A field is several bands of different greens, and grass is a ' +
      'handful of flicks at the near edge, not texture over the whole thing.',
    passes: [
      {
        what: 'The plane',
        how:
          'Two or three bands of different green, warmer and stronger as they come forward, ' +
          'each running off both sides. Their boundaries should not be parallel.',
        path: 'M -40 520 C 300 496 700 528 1040 500 L 1040 620 C 700 640 300 616 -40 636 Z',
      },
      {
        what: 'Tufts, at the front only',
        how:
          'Liner, water 0.25, quick upward flicks. Five or six, uneven heights, clustered rather ' +
          'than spaced. Only in the nearest few inches of the picture.',
      },
    ],
  },
]

/** Rough singular, enough to make plurals and possessives land. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1)
  return word
}

/**
 * Match on any word in the request, not the whole phrase.
 *
 * An agent asks for "a field of poppies at dusk", not "flower". Comparing the
 * whole string against a keyword finds nothing, so the request is broken into
 * words, each reduced to a rough singular, and the first that names a subject
 * wins. Earlier words win over later ones, which puts the emphasis where the
 * sentence does.
 */
export function findSubject(query: string): SubjectRecipe | null {
  if (!query) return null
  const q = query.trim().toLowerCase()

  const exact =
    SUBJECTS.find((s) => s.id === q) ??
    SUBJECTS.find((s) => s.also.includes(q)) ??
    SUBJECTS.find((s) => s.name.toLowerCase() === q)
  if (exact) return exact

  const words = q.split(/[^a-z]+/).filter(Boolean).map(stem)
  for (const word of words) {
    const hit = SUBJECTS.find(
      (s) => stem(s.id) === word || s.also.some((a) => stem(a) === word),
    )
    if (hit) return hit
  }

  return SUBJECTS.find((s) => s.name.toLowerCase().includes(q)) ?? null
}
