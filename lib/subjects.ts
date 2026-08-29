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
  /**
   * How the form is built, before any paint.
   *
   * Added after watching a study go wrong in a way none of the rest of this
   * file could catch. The paint behaved perfectly: soft mass, a bloom in the
   * head, granulation, crisp accents laid on dry paper. Every measurement the
   * studio takes came back good, and the result was a cartoon rabbit. Nothing
   * was wrong with the painting. What was wrong was that there was no drawing
   * underneath it: the body was one egg, and no wash however well behaved can
   * rescue a shape that was never observed.
   *
   * So this is the part that comes first. Not what to paint with, what the
   * thing is actually shaped like: which masses it is built from, how big they
   * are relative to each other, and where they overlap. Every recipe has one
   * now, because the mountains needed it too and were only getting it by
   * accident, buried in prose about the passes.
   */
  drawing: string
  /** The one thing that most often goes wrong. */
  trap: string
  passes: Array<{ what: string; how: string; path?: string }>
}

export const SUBJECTS: SubjectRecipe[] = [
  {
    id: 'mountain',
    name: 'Mountains and hills',
    also: ['hill', 'hills', 'range', 'peak', 'ridge', 'landscape', 'valley'],
    drawing:
      'A run of overlapping wedges, not one silhouette. Three or four masses, each with its ' +
      'own summit, each crossing the one behind it at an angle so their ridgelines never ' +
      'run parallel. The tallest sits off centre, about a third of the way across, and the ' +
      'others are markedly lower, because two peaks the same height read as a pattern. Every range ' +
      'leaves the sheet at both sides; a mountain that ends inside the picture is a hill on ' +
      'a table.',
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
    drawing:
      'One mass for the whole head first, roughly circular but never round: wider than it ' +
      'is tall, with one side fuller than the other. Petals are lobes cut out of that mass, ' +
      'not shapes added to it, so they overlap and hide parts of each other. Odd number, ' +
      'largest nearest the viewer, at least one seen edge on and much narrower than the ' +
      'rest. The centre sits off the middle of the head, because a flower is almost never ' +
      'facing you square on. Stem leaves the head at the back, not the bottom.',
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
    drawing:
      'Three or four foliage masses of different sizes clustered around a line that leans, ' +
      'with real gaps between them for sky. The whole silhouette should be lopsided, ' +
      'heavier on one side and higher on the other. The trunk is a tapering line that ' +
      'passes behind the masses and reappears between them, never a rectangle under a ' +
      'circle. Branches leave it at different heights on different sides and thin as they ' +
      'go.',
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
    drawing:
      'Not a shape, a plane. Everything on it is horizontal, and everything gets closer ' +
      'together and flatter as it goes back. A reflection sits directly under the thing it ' +
      'reflects, the same width, stretched toward the viewer and broken across its length. ' +
      'Bands of untouched paper run through it: those are the light and they have to be ' +
      'planned before the first wash, not rescued afterwards.',
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
    drawing:
      'Cloud is drawn by drawing the blue around it. Think in holes rather than shapes: ' +
      'irregular islands of bare paper with flat-ish bottoms and piled tops, larger and ' +
      'higher overhead, smaller and more crowded toward the horizon, because you are ' +
      'looking along the underside of a layer rather than at a wall. Never evenly spaced, ' +
      'never the same size twice.',
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
    drawing:
      'Bands seen almost edge on, so each is a long shallow shape whose boundaries are not ' +
      'parallel to each other or to the bottom of the sheet. They converge somewhere off ' +
      'the picture. Nearer bands are deeper top to bottom and warmer; far ones compress to ' +
      'a line. Any hedge or track runs across them diagonally rather than straight up the ' +
      'middle.',
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

  {
    id: 'animal',
    name: 'An animal',
    also: [
      'animals', 'creature', 'hare', 'rabbit', 'cat', 'dog', 'fox', 'horse', 'cow', 'sheep',
      'deer', 'mouse', 'bear', 'wolf', 'pet', 'beast', 'wildlife',
    ],
    drawing:
      'Two masses, not one: a large one for the hindquarters and a smaller one for the chest and ' +
      'shoulder, overlapping, with the smaller sitting forward and slightly higher. The head is a ' +
      'third mass again smaller, and it joins the shoulder along a line rather than balancing on ' +
      'top of it, so most of the neck is inside the body. Get the size ratio between those three ' +
      'right and it reads as an animal before a single feature is drawn; get it wrong and no ' +
      'amount of eyes and whiskers will save it. The spine is a curve, and the lowest point of the ' +
      'belly is not the lowest point of the animal. Whatever it is standing on, it is standing IN, ' +
      'so the bottom of the form is interrupted rather than drawn.',
    trap:
      'Painting a face. One oval, an eye, a smile and some whiskers gives you a cartoon every ' +
      'time, however good the paint is. An animal is read from its silhouette and the weight in ' +
      'its body, not its features: the line where the haunch turns away, the dip in front of the ' +
      'shoulder, the way the light stops at the top of the back. Draw those and you can leave the ' +
      'face almost blank. Draw the face and nothing else will rescue it.',
    passes: [
      {
        what: 'The whole animal as one soft mass',
        how:
          'Every part of it in one wash, wet into wet, load 0.2, water 0.9, no edges and no ' +
          'features. Vary the colour inside it while it runs rather than mixing one flat tone: ' +
          'charge a warmer pigment into the chest and a cooler one into the shadow side and let ' +
          'them meet in the water. This single wash is most of the finished picture.',
      },
      {
        what: 'The weight, while it is still open',
        how:
          'One darker wash down the shadow side and under the belly, load 0.4, water 0.75, laid ' +
          'into the first before it closes so there is no boundary. This is what turns a flat ' +
          'shape into a body with a far side. Follow the form: it is narrow over the ribs and ' +
          'widest where the haunch turns.',
      },
      {
        what: 'Wait. Let the sheet close.',
        how:
          'The whole difference between an animal and a stain is that the accents are crisp and ' +
          'the mass is soft. Painting them into a wet sheet loses both. Check what the studio says ' +
          'is still open and do not put the next mark down until it is dry.',
      },
      {
        what: 'Four or five accents, and no more',
        how:
          'Load above 0.8, water under 0.3, small. The eye is one of them and is worth one mark, ' +
          'not three. Spend the rest on anatomy: the line where the haunch meets the flank, the ' +
          'dark under the chin, the tip of an ear, the point where a leg disappears into the ' +
          'ground. Stop while you still want to add more.',
      },
      {
        what: 'Lift one light',
        how:
          'A lift along the top of the back or the front of the chest, where the light falls. ' +
          'One pale passage taken back out of a dark mass does more for the roundness of an ' +
          'animal than any amount of painted shading.',
      },
    ],
  },

  {
    id: 'bird',
    name: 'A bird',
    also: ['birds', 'gull', 'crow', 'sparrow', 'heron', 'duck', 'owl', 'wing', 'wings', 'flock'],
    drawing:
      'A teardrop lying on its side with the blunt end forward, the head a small circle overlapping ' +
      'the blunt end, and the tail a wedge running off the point. The eye sits well forward and ' +
      'high, close to the beak, not in the middle of the head. Perched, the body tilts and the ' +
      'legs come out of the middle of it rather than the back. In flight the wings leave the body ' +
      'at the front third and are not the same shape as each other, because you are always seeing ' +
      'one more edge on than the other. Birds far away are a mark, not a bird: two short strokes ' +
      'that do not meet.',
    trap:
      'The flying M. Distant birds drawn as neat symmetrical ticks read as handwriting scattered ' +
      'across the sky. Make them different sizes, at different angles, unevenly spaced, and most ' +
      'of them barely there.',
    passes: [
      {
        what: 'The body in one wash',
        how:
          'One soft mass, load 0.3, water 0.85, head and body together. A bird is smooth, so this ' +
          'wants to stay a single unbroken passage.',
      },
      {
        what: 'The dark of the wing and back',
        how:
          'Into the wet, load 0.55. It covers the top and the back of the body and stops well ' +
          'before the belly, which stays pale. Most birds are dark above and light below, and ' +
          'that alone reads as a bird.',
      },
      {
        what: 'Beak, eye, legs, once dry',
        how:
          'Liner, width 2 to 4, load 0.9, water 0.2. Three marks. The eye is a dot with one ' +
          'speck of bare paper left in it if you can manage it.',
      },
    ],
  },

  {
    id: 'figure',
    name: 'A person',
    also: ['people', 'figure', 'figures', 'man', 'woman', 'child', 'portrait', 'crowd', 'walker'],
    drawing:
      'Seven and a half heads tall standing, and the halfway point is the hip, not the waist. ' +
      'almost everyone puts it too high and gets a figure with short legs. The shoulders and the ' +
      'hips tilt in opposite directions whenever the weight is on one leg, and that opposition is ' +
      'what makes a figure look alive rather than assembled. In a landscape a person is usually ' +
      'two or three marks total: a dark for the body, a smaller one for the head, and the gap of ' +
      'light between the legs. Put the head at the horizon if they are standing on the same ' +
      'ground you are.',
    trap:
      'Detail on a small figure. At any distance where a figure belongs in a landscape, a face is ' +
      'not visible and painting one makes the figure read as a doll pasted onto the picture. Get ' +
      'the proportion and the tilt right and leave it alone.',
    passes: [
      {
        what: 'The body as one dark',
        how:
          'One mark, load 0.7, water 0.4. Wider at the shoulder than the hip, narrowing down. ' +
          'Leave a notch of bare paper between the legs, because that gap is what makes it walk.',
      },
      {
        what: 'The head',
        how:
          'A separate small mark that touches the body rather than merging with it, no wider than ' +
          'a fifth of the shoulders. This is the single most common proportion error.',
      },
      {
        what: 'One warm note',
        how:
          'A small patch of a different, warmer colour somewhere on the figure at load 0.6. A ' +
          'figure is the only thing in most landscapes allowed a pure colour, and one is enough ' +
          'to make the eye go there.',
      },
    ],
  },

  {
    id: 'building',
    name: 'Buildings',
    also: [
      'building', 'house', 'houses', 'cottage', 'barn', 'roof', 'town', 'village', 'street',
      'church', 'wall', 'ruin', 'architecture',
    ],
    drawing:
      'Boxes seen from a corner, so two faces show and one is always in shadow. Every horizontal ' +
      'on the same wall runs to the same point on the horizon, and the horizon is your eye level: ' +
      'if you can see the top of a wall it is below you. Roofs overhang and cast a dark line under ' +
      'the eaves. A row of buildings should differ in height, width and roof angle, and their ' +
      'ridgelines should never make a straight run, because a terrace drawn as one long box with windows ' +
      'is a wall, not a street.',
    trap:
      'Ruling the edges. A building painted with straight, even, unbroken lines reads as a plan. ' +
      'Real walls sag, render breaks, and half of any edge should be lost into the tone next to ' +
      'it. Keep the verticals honest and let everything else wander.',
    passes: [
      {
        what: 'The whole block, one pale wash',
        how:
          'Every building in the group as a single flat shape, load 0.2, water 0.8, before any of ' +
          'them is a separate building. This keeps a street reading as one mass in the light.',
      },
      {
        what: 'Every shadow side at once',
        how:
          'One tone, load 0.45, water 0.5, on whichever side is away from the light, on every ' +
          'building. One consistent shadow tone does more for a row of houses than any amount of ' +
          'individual detail. Under the eaves, and under anything that sticks out.',
      },
      {
        what: 'The dark holes',
        how:
          'Windows and doorways, load 0.85, water 0.25, once dry. Not all of them and not evenly: ' +
          'three or four properly dark ones and the rest suggested. A window is a hole, so it is ' +
          'darker than the wall around it and has no frame at this distance.',
      },
    ],
  },

  {
    id: 'boat',
    name: 'Boats',
    also: ['boat', 'ship', 'sail', 'sails', 'yacht', 'harbour', 'harbor', 'hull', 'mast', 'fleet'],
    drawing:
      'A hull is a long shallow crescent, higher at both ends than the middle, and it sits IN the ' +
      'water rather than on it, so its waterline is a shape and not a line. Seen at an angle you ' +
      'get one long curve for the near side and a slice of the inside at the far end. Masts are ' +
      'vertical only if the boat is; moored boats lean, and a fleet of them leans at different ' +
      'angles, which is most of what makes a harbour look like a harbour.',
    trap:
      'The banana. Symmetrical, evenly curved, both ends alike, floating on top of the water. Make ' +
      'the bow and the stern different, put the widest part off centre, and cut the bottom of the ' +
      'hull off with its own reflection.',
    passes: [
      {
        what: 'The hull as one dark shape',
        how:
          'One mark, load 0.6, water 0.4, crisp along the top edge and softer where it meets the ' +
          'water. The shape does all the work here, so it is worth getting before anything else.',
      },
      {
        what: 'The reflection, straight away',
        how:
          'Directly beneath, the same width, weaker, stretched down, water 0.85 so its bottom ' +
          'dissolves. Painted while the hull is still open so the two fuse where they meet. That ' +
          'join is what puts the boat in the water instead of on it.',
      },
      {
        what: 'Mast and rigging, once dry',
        how:
          'Liner, width 1 to 2, load 0.9. One confident line, leaning. Rigging is suggested by two ' +
          'or three marks, never drawn completely.',
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
