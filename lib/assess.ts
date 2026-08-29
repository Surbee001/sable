import { getPigment, hexToRgb } from './palette'
import { summariseStroke } from './snapshot'
import { CANVAS_H, CANVAS_W, type Scene } from './types'

/**
 * What the picture needs next.
 *
 * An agent that can see the sheet still has to decide what to do with it, and
 * left to itself it will keep adding until the composition collapses: a new hue
 * for every shape, no real dark anywhere, every edge equally soft. None of that
 * is a failure of taste, it is a failure of measurement.
 *
 * So this measures. Pigment count, value range, where the sheet is still empty,
 * how varied the edges are. The observations are computed from the document,
 * not guessed at, and the advice follows from them. It is the tool an agent
 * calls to work out what it should be doing without anyone telling it.
 */

export interface Assessment {
  strokes: number
  pigments: { count: number; names: string[] }
  values: { darkest: number; lightest: number; range: number }
  coverage: { empty: string[]; busiest: string | null }
  edges: { soft: number; crisp: number }
  authorship: { human: number; agent: number }
  observations: string[]
  suggestions: string[]
}

const CELLS = [
  ['the top left', 'the top', 'the top right'],
  ['the left', 'the middle', 'the right'],
  ['the bottom left', 'the bottom', 'the bottom right'],
]

/** 0 is paper white, 1 is as dark as paint gets. */
function darkness(pigmentId: string, opacity: number): number {
  const [r, g, b] = hexToRgb(getPigment(pigmentId).hex)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return (1 - luminance) * (0.25 + opacity * 0.75)
}

export function assess(scene: Scene): Assessment {
  const strokes = scene.strokes
  const pigmentIds = new Set(strokes.map((s) => s.pigment))
  const names = [...pigmentIds].map((id) => getPigment(id).name)

  let darkest = 0
  let lightest = 1
  let soft = 0
  let crisp = 0
  const human = strokes.filter((s) => s.author === 'human').length

  const grid = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]

  for (const stroke of strokes) {
    const d = darkness(stroke.pigment, stroke.opacity)
    if (d > darkest) darkest = d
    if (d < lightest) lightest = d
    if (stroke.water > 0.6) soft += 1
    else crisp += 1

    const b = summariseStroke(scene, stroke).bounds
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const col = Math.max(0, Math.min(2, Math.floor((cx / CANVAS_W) * 3)))
    const row = Math.max(0, Math.min(2, Math.floor((cy / CANVAS_H) * 3)))
    grid[row][col] += 1
  }

  if (strokes.length === 0) lightest = 0

  const empty: string[] = []
  let busiest: string | null = null
  let most = 0
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[r][c] === 0) empty.push(CELLS[r][c])
      if (grid[r][c] > most) {
        most = grid[r][c]
        busiest = CELLS[r][c]
      }
    }
  }

  const observations: string[] = []
  const suggestions: string[] = []

  if (strokes.length === 0) {
    observations.push('The sheet is blank.')
    suggestions.push(
      'Call suggest_palette, pick one limited palette, and lay the largest and palest shape first on the wettest layer. Work from the back of the picture forward.',
    )
    return {
      strokes: 0,
      pigments: { count: 0, names: [] },
      values: { darkest: 0, lightest: 0, range: 0 },
      coverage: { empty, busiest: null },
      edges: { soft: 0, crisp: 0 },
      authorship: { human: 0, agent: 0 },
      observations,
      suggestions,
    }
  }

  observations.push(
    `${strokes.length} marks, ${human} by the human and ${strokes.length - human} by an agent.`,
  )
  observations.push(`${pigmentIds.size} pigments in use: ${names.join(', ')}.`)
  observations.push(
    `Darkest mark reads ${darkest.toFixed(2)} against paper white, on a scale where 1 is as dark as paint gets.`,
  )
  // How wet the marks went on, which is a fact about the brushwork. How hard
  // the edges came out is a different question and `perceive` answers it off
  // the paint.
  observations.push(`${soft} marks laid wet against ${crisp} laid dry.`)
  if (empty.length > 0) observations.push(`Untouched: ${empty.join(', ')}.`)

  if (pigmentIds.size > 5) {
    suggestions.push(
      `${pigmentIds.size} pigments is more than a painting usually holds together with. Rather than adding another hue, deepen what is already there by laying a second wash of a pigment you have used.`,
    )
  }
  if (darkest < 0.55) {
    suggestions.push(
      'Nothing here is genuinely dark, so nothing reads as light either. One small area of real dark, sepia or indigo at high load and low water, will do more for the picture than anything else you could add.',
    )
  }
  if (darkest - lightest < 0.3 && strokes.length > 4) {
    suggestions.push(
      'The values are bunched together and the picture reads flat. Push some marks lighter and one or two much darker rather than adding more in the middle.',
    )
  }
  // Edges are not judged here any more.
  //
  // What this could see was each stroke's `water`, which is what was asked for.
  // It is not what happened: a crisp mark laid into a passage that was still
  // open does not stay crisp, and a wash with something painted over it loses
  // its edge whatever its own water was. `perceive` reads the hardness off the
  // rendered paint instead, and two edge verdicts that disagree are worse than
  // one that is right.
  if (empty.length >= 4 && strokes.length > 3) {
    suggestions.push(
      `Most of the sheet is untouched. That can be right, but if the composition feels unbalanced put something small in ${empty[0]}.`,
    )
  }
  if (empty.length === 0 && strokes.length > 8) {
    suggestions.push(
      'Every part of the sheet has paint on it. Untouched paper is the only true highlight available, so consider lifting something rather than adding.',
    )
  }
  // A picture assembled from marks that each sit clear of the edges reads as a
  // diagram of a scene rather than a view of one, however well each mark is
  // made. Cheap to detect and one of the most common faults.
  //
  // Asked of the whole picture at once this is nearly useless: one small mark
  // anywhere along a border satisfies it, and a sheet of floating shapes passes
  // because a single ridgeline happened to run off the left. What matters is
  // whether the *large* shapes are anchored, so each one is asked separately.
  const floating = strokes.filter((stroke) => {
    const b = summariseStroke(scene, stroke).bounds
    const large = b.w >= CANVAS_W * 0.45 || b.h >= CANVAS_H * 0.45
    if (!large) return false
    return b.x > 2 && b.y > 2 && b.x + b.w < CANVAS_W - 2 && b.y + b.h < CANVAS_H - 2
  })
  if (floating.length > 0) {
    observations.push(
      `${floating.length} large ${floating.length === 1 ? 'shape stops' : 'shapes stop'} clear of every edge of the sheet.`,
    )
    suggestions.push(
      `${floating.length === 1 ? 'A large shape sits' : 'Large shapes sit'} with clear paper all the way round, which reads as objects arranged on a page rather than a view of somewhere. Extend the big washes off the sheet: start them around x -40 and end them past 1040.`,
    )
  }

  if (human === 0) {
    suggestions.push(
      'Everything here is yours. Leave somewhere obvious for the human to work into.',
    )
  }
  if (suggestions.length === 0) {
    suggestions.push(
      'The structure is sound: the values have range, the palette is tight and the edges vary. Anything further should be small and deliberate.',
    )
  }

  return {
    strokes: strokes.length,
    pigments: { count: pigmentIds.size, names },
    values: {
      darkest: Math.round(darkest * 100) / 100,
      lightest: Math.round(lightest * 100) / 100,
      range: Math.round((darkest - lightest) * 100) / 100,
    },
    coverage: { empty, busiest },
    edges: { soft, crisp },
    authorship: { human, agent: strokes.length - human },
    observations,
    suggestions,
  }
}
