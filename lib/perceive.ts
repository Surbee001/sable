import { CANVAS_H, CANVAS_W, type Scene } from './types'
import { renderScene } from './watercolor'

/**
 * Seeing the picture rather than looking at it.
 *
 * `snapshotScene` hands back a photograph of the sheet, which sounds like the
 * whole problem solved and is not. A photograph is what the picture looks like.
 * It is not what is wrong with it. Shown one, an agent reports what it painted,
 * because the marks are all still legible in it and each one still looks like
 * the thing it was meant to be. The faults that actually sink a painting,
 * every value bunched in the middle, no real dark anywhere, the weight of the
 * thing sitting somewhere nobody chose, are invisible at full detail. They are
 * precisely the faults detail hides.
 *
 * Painters have one move for this and have had it for centuries: squint. Throw
 * away the detail, throw away the colour, collapse what is left into three or
 * four flat tones, and look at the shapes that remain. If the picture holds up
 * as four grey masses it will hold up finished, and if it does not, no amount
 * of good brushwork will save it.
 *
 * That is a blur and a posterize. It is the cheapest thing in this file and by
 * a distance the most useful, because it turns the one question that decides
 * whether a painting works into something an agent can be shown rather than
 * told.
 *
 * The rest is measurement of the same kind: where the weight actually sits
 * versus where it was meant to, how hard the edges really are, and where the
 * eye is going to go whether or not that was the plan. All of it read off the
 * rendered pixels, so it describes the painting that exists rather than the
 * one that was requested.
 */

/* ------------------------------------------------------------------ *
 * Value bands
 *
 * Fixed rather than stretched to the picture's own range. A study whose darkest
 * passage is a mid grey has no dark in it, and normalising would report it as
 * having a full range, which is the exact error being looked for.
 * ------------------------------------------------------------------ */

export const BANDS = [
  { id: 'paper', label: 'bare paper', upTo: 0.10 },
  { id: 'light', label: 'light', upTo: 0.30 },
  { id: 'mid', label: 'middle', upTo: 0.58 },
  { id: 'dark', label: 'dark', upTo: 1.01 },
] as const

/** The grey each band is drawn as in the squint image. */
const BAND_GREY = [242, 196, 132, 54]

function bandOf(darkness: number): number {
  for (let i = 0; i < BANDS.length; i++) if (darkness <= BANDS[i].upTo) return i
  return BANDS.length - 1
}

const PLACES = [
  ['the top left', 'the top', 'the top right'],
  ['the left', 'the middle', 'the right'],
  ['the bottom left', 'the bottom', 'the bottom right'],
]

function placeOf(x: number, y: number): string {
  const col = Math.max(0, Math.min(2, Math.floor((x / CANVAS_W) * 3)))
  const row = Math.max(0, Math.min(2, Math.floor((y / CANVAS_H) * 3)))
  return PLACES[row][col]
}

/* ------------------------------------------------------------------ *
 * Reading the pixels
 * ------------------------------------------------------------------ */

/** Working resolution. Small on purpose: this is about masses. */
const W = 250
const H = Math.round((W * CANVAS_H) / CANVAS_W)

function luminanceField(scene: Scene): Float32Array {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is unavailable in this browser')
  renderScene(ctx, scene, W, H)

  const { data } = ctx.getImageData(0, 0, W, H)
  const out = new Float32Array(W * H)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Darkness, not brightness: the number a painter thinks in.
    out[p] = 1 - (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
  }
  return out
}

/** Separable box blur. Two passes is close enough to a gaussian to squint with. */
function blur(src: Float32Array, radius: number): Float32Array {
  let field = src
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0
        let n = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k
          if (xx < 0 || xx >= W) continue
          sum += field[y * W + xx]
          n++
        }
        tmp[y * W + x] = sum / n
      }
    }
    const out = new Float32Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0
        let n = 0
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k
          if (yy < 0 || yy >= H) continue
          sum += tmp[yy * W + x]
          n++
        }
        out[y * W + x] = sum / n
      }
    }
    field = out
  }
  return field
}

/* ------------------------------------------------------------------ *
 * The squint
 * ------------------------------------------------------------------ */

export interface ValueRead {
  /** Share of the sheet in each band, 0..1, in the order of BANDS. */
  distribution: Array<{ band: string; share: number }>
  /** The darkest band that occupies a meaningful area. */
  deepest: string
  /** True when something on the sheet is genuinely dark, not merely mid. */
  hasDark: boolean
  /** True when enough paper is left untouched to read as light. */
  hasLight: boolean
  /** Largest single band, which is the picture's dominant tone. */
  dominant: string
  observations: string[]
}

function readValues(field: Float32Array): ValueRead {
  const counts = new Array(BANDS.length).fill(0)
  for (let i = 0; i < field.length; i++) counts[bandOf(field[i])]++

  const total = field.length
  const distribution = BANDS.map((b, i) => ({
    band: b.label,
    share: Math.round((counts[i] / total) * 1000) / 1000,
  }))

  const darkShare = counts[3] / total
  const paperShare = counts[0] / total
  /**
   * Half a per cent of the sheet is enough to count as having a dark.
   *
   * Deliberately tiny, because a dark accent is supposed to be tiny, which is
   * what makes it an accent rather than a passage, and a stand of trees at the
   * right scale in a landscape covers about one per cent. An earlier threshold
   * of just over one per cent rejected a correct dark and told the painter to
   * add the one they had just added, which is the most damaging thing a tool
   * like this can do: it is wrong in the direction of ruining the picture.
   */
  const hasDark = darkShare >= 0.005
  const hasLight = paperShare >= 0.06

  let dominantIndex = 0
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[dominantIndex]) dominantIndex = i
  let deepestIndex = 0
  for (let i = BANDS.length - 1; i >= 0; i--) {
    if (counts[i] / total >= 0.005) { deepestIndex = i; break }
  }

  const observations: string[] = []
  observations.push(
    `Value structure: ${distribution.map((d) => `${Math.round(d.share * 100)}% ${d.band}`).join(', ')}.`,
  )

  if (!hasDark) {
    observations.push(
      'Nothing on this sheet is genuinely dark. The deepest passage is only a middle tone, ' +
        'so nothing else can read as light and the picture will look grey however good the drawing is. ' +
        'One small dark, sepia or indigo at load above 0.8 and water under 0.3, fixes more here than anything else.',
    )
  } else if (darkShare > 0.25) {
    observations.push(
      `A quarter of the sheet is dark. Darks work by being scarce; at ${Math.round(darkShare * 100)}% ` +
        'they stop being an accent and become the ground.',
    )
  }

  if (!hasLight) {
    observations.push(
      'Almost no bare paper is left. Untouched sheet is the only true light watercolour has, ' +
        'and it cannot be put back once it is covered.',
    )
  }

  if (counts[2] / total > 0.55) {
    observations.push(
      'Over half the sheet sits in one middle tone. Push some of it lighter and a little of it much darker; ' +
        'a picture is built from three values, not one.',
    )
  }

  return {
    distribution,
    deepest: BANDS[deepestIndex].label,
    hasDark,
    hasLight,
    dominant: BANDS[dominantIndex].label,
    observations,
  }
}

/* ------------------------------------------------------------------ *
 * Weight, edges, and where the eye goes
 * ------------------------------------------------------------------ */

export interface WeightRead {
  /** Darkness-weighted centre of the picture, in sheet units. */
  x: number
  y: number
  where: string
  /** How far off the middle of the sheet it sits, 0 centred, 1 at a corner. */
  offCentre: number
  /** Share of the visual weight in each vertical third, left to right. */
  columns: number[]
  /** And in each horizontal third, top to bottom. */
  rows: number[]
  observations: string[]
}

function readWeight(field: Float32Array): WeightRead {
  let mass = 0
  let sx = 0
  let sy = 0
  const columns = [0, 0, 0]
  const rows = [0, 0, 0]

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = field[y * W + x]
      if (v <= 0.04) continue
      mass += v
      sx += x * v
      sy += y * v
      columns[Math.min(2, Math.floor((x / W) * 3))] += v
      rows[Math.min(2, Math.floor((y / H) * 3))] += v
    }
  }

  const observations: string[] = []
  if (mass < 1) {
    return {
      x: CANVAS_W / 2, y: CANVAS_H / 2, where: 'the middle', offCentre: 0,
      columns: [0, 0, 0], rows: [0, 0, 0],
      observations: ['The sheet is effectively blank.'],
    }
  }

  const cx = (sx / mass / W) * CANVAS_W
  const cy = (sy / mass / H) * CANVAS_H
  const dx = (cx - CANVAS_W / 2) / (CANVAS_W / 2)
  const dy = (cy - CANVAS_H / 2) / (CANVAS_H / 2)
  const offCentre = Math.min(1, Math.hypot(dx, dy))

  const norm = (a: number[]): number[] => {
    const t = a.reduce((s, v) => s + v, 0) || 1
    return a.map((v) => Math.round((v / t) * 100) / 100)
  }

  observations.push(
    `The weight of the picture sits at about (${Math.round(cx)}, ${Math.round(cy)}), in ${placeOf(cx, cy)}.`,
  )

  // Dead centre is the one place a painter almost never wants it.
  if (offCentre < 0.08) {
    observations.push(
      'That is almost exactly the middle of the sheet, which is the most inert place to put it. ' +
        'Shifting the mass off centre, roughly onto a third, gives the composition somewhere to move.',
    )
  }

  const cols = norm(columns)
  if (Math.max(...cols) - Math.min(...cols) < 0.06) {
    observations.push(
      'The weight is spread evenly across all three columns, which reads as wallpaper rather than a view. ' +
        'A picture usually wants one side heavier than the other.',
    )
  }

  return {
    x: Math.round(cx), y: Math.round(cy), where: placeOf(cx, cy),
    offCentre: Math.round(offCentre * 100) / 100,
    columns: cols, rows: norm(rows), observations,
  }
}

export interface EdgeRead {
  /** Share of the picture's edge length that is hard, 0..1. */
  crisp: number
  soft: number
  observations: string[]
}

/**
 * Edge hardness, measured off the pixels.
 *
 * `assess` infers this from each stroke's `water`, which is what was asked for
 * rather than what happened: a crisp mark laid into a wet passage does not stay
 * crisp, and a wash whose neighbour was painted over it loses its edge whatever
 * its own water was. The gradient of the rendered image is the real answer.
 */
function readEdges(sharp: Float32Array): EdgeRead {
  let crisp = 0
  let soft = 0

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx = sharp[y * W + x + 1] - sharp[y * W + x - 1]
      const gy = sharp[(y + 1) * W + x] - sharp[(y - 1) * W + x]
      const g = Math.hypot(gx, gy)
      if (g < 0.02) continue
      if (g > 0.09) crisp++
      else soft++
    }
  }

  const total = crisp + soft
  const observations: string[] = []
  if (total < 40) {
    observations.push('Too little on the sheet to read its edges.')
    return { crisp: 0, soft: 0, observations }
  }

  const crispShare = crisp / total
  observations.push(
    `Edges: ${Math.round(crispShare * 100)}% hard, ${Math.round((1 - crispShare) * 100)}% soft, measured off the paint rather than from what was asked for.`,
  )
  if (crispShare > 0.8) {
    observations.push(
      'Almost every edge is hard, which reads as cut paper. Losing an edge somewhere, a shape that ' +
        'dissolves into its neighbour on one side, is what makes the rest look like paint.',
    )
  } else if (crispShare < 0.12) {
    observations.push(
      'Almost nothing holds an edge, so the eye has nowhere to settle. One crisp passage against all ' +
        'that softness will carry the whole picture.',
    )
  }
  return {
    crisp: Math.round(crispShare * 100) / 100,
    soft: Math.round((1 - crispShare) * 100) / 100,
    observations,
  }
}

/**
 * Where the eye goes: the place with the most local contrast.
 *
 * Not where the subject is, and not where the agent thinks the focus is. The
 * eye lands on the strongest value change in the picture whatever is drawn
 * there, so this is the one honest answer to "what is this painting about".
 */
export interface FocusRead {
  x: number
  y: number
  where: string
  strength: number
  observations: string[]
}

function readFocus(sharp: Float32Array): FocusRead {
  const cell = 16
  let bestX = 0
  let bestY = 0
  let best = 0

  for (let y0 = 0; y0 < H; y0 += cell / 2) {
    for (let x0 = 0; x0 < W; x0 += cell / 2) {
      let lo = 1
      let hi = 0
      for (let y = y0; y < Math.min(H, y0 + cell); y++) {
        for (let x = x0; x < Math.min(W, x0 + cell); x++) {
          const v = sharp[y * W + x]
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      const contrast = hi - lo
      if (contrast > best) {
        best = contrast
        bestX = x0 + cell / 2
        bestY = y0 + cell / 2
      }
    }
  }

  const x = Math.round((bestX / W) * CANVAS_W)
  const y = Math.round((bestY / H) * CANVAS_H)
  const observations = [
    `The eye goes to about (${x}, ${y}), in ${placeOf(x, y)}: that is the strongest value change on the sheet.`,
  ]
  if (best < 0.25) {
    observations.push(
      'It is a weak focus though: nowhere on this sheet has much contrast, so the eye will wander.',
    )
  }
  return { x, y, where: placeOf(x, y), strength: Math.round(best * 100) / 100, observations }
}

/* ------------------------------------------------------------------ *
 * The whole reading
 * ------------------------------------------------------------------ */

export interface Perception {
  values: ValueRead
  weight: WeightRead
  edges: EdgeRead
  focus: FocusRead
  /** The squint itself, as a base64 JPEG with no data: prefix. */
  image: string
  /** Everything worth saying, in the order it matters. */
  observations: string[]
}

/**
 * Render the value masses back out as an image.
 *
 * Drawn at the working resolution and scaled up with smoothing off, so the
 * bands stay flat and legible instead of being blended back into a gradient by
 * the browser. Flat is the point: this is a notan, not a soft-focus photograph.
 */
function squintImage(bands: Float32Array, width: number): string {
  const small = document.createElement('canvas')
  small.width = W
  small.height = H
  const sctx = small.getContext('2d')
  if (!sctx) throw new Error('2D canvas is unavailable in this browser')

  const img = sctx.createImageData(W, H)
  for (let i = 0; i < bands.length; i++) {
    const grey = BAND_GREY[bandOf(bands[i])]
    img.data[i * 4] = grey
    img.data[i * 4 + 1] = grey
    img.data[i * 4 + 2] = grey
    img.data[i * 4 + 3] = 255
  }
  sctx.putImageData(img, 0, 0)

  const out = document.createElement('canvas')
  out.width = Math.round(width)
  out.height = Math.round((width * CANVAS_H) / CANVAS_W)
  const octx = out.getContext('2d')
  if (!octx) throw new Error('2D canvas is unavailable in this browser')
  octx.imageSmoothingEnabled = false
  octx.drawImage(small, 0, 0, out.width, out.height)
  return out.toDataURL('image/jpeg', 0.86).split(',')[1] ?? ''
}

export function perceive(scene: Scene, imageWidth = 620): Perception {
  const sharp = luminanceField(scene)

  /**
   * Two different squints, because they are wanted for two different things.
   *
   * The picture wants the hard one: detail gone, small marks merged into the
   * masses around them, so what is left is the four shapes the composition
   * actually rests on. The numbers want the soft one, because a dark accent is
   * supposed to be small, which is what makes it an accent, and blurring
   * hard enough to build a good notan smears a correct one out below the
   * threshold that decides whether it exists. That produced the worst possible
   * failure in a tool meant to teach: it told you to add the dark you had just
   * added. A painter squinting at a picture does not lose its darkest note.
   */
  const forNumbers = blur(sharp, 2)
  const squinted = blur(sharp, 5)

  const values = readValues(forNumbers)
  const weight = readWeight(forNumbers)
  const edges = readEdges(sharp)
  const focus = readFocus(sharp)

  return {
    values,
    weight,
    edges,
    focus,
    image: squintImage(squinted, imageWidth),
    observations: [
      ...values.observations,
      ...weight.observations,
      ...focus.observations,
      ...edges.observations,
    ],
  }
}
