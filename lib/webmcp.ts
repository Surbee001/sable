import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill'
import { ensureModelContext } from './fallback-context'
import { isValidPath, scalePath } from './geometry'
import { PIGMENTS, SCHEMES, findScheme, getPigment, resolvePigment } from './palette'
import { assess } from './assess'
import { SUBJECTS, findSubject } from './subjects'
import { describeScene, narrateScene, snapshotRegion, snapshotScene, summariseStroke } from './snapshot'
import { studio, type PaintInput, type StrokePatch } from './store'
import { BRUSHES, CANVAS_H, CANVAS_W, PAPERS, type BrushKind, type PaperKind } from './types'

/* ------------------------------------------------------------------ *
 * Result helpers
 * ------------------------------------------------------------------ */

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

interface ToolResult {
  content: ContentBlock[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

function say(text: string, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured }
}

function show(
  text: string,
  image: string,
  structured?: Record<string, unknown>,
): ToolResult {
  const content: ContentBlock[] = [{ type: 'text', text }]
  if (image) content.push({ type: 'image', data: image, mimeType: 'image/jpeg' })
  return { content, structuredContent: structured }
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/* ------------------------------------------------------------------ *
 * Shared schema fragments
 * ------------------------------------------------------------------ */

const BRUSH_NAMES = Object.keys(BRUSHES) as BrushKind[]
const PAPER_NAMES = Object.keys(PAPERS) as PaperKind[]

const STROKE_PROPS = {
  path: {
    type: 'string',
    description:
      'SVG path data in sheet coordinates, e.g. "M 420 300 C 470 210 560 210 610 300 Z". ' +
      'The full SVG grammar works: M L H V C S Q T A Z, absolute or relative.',
  },
  fill: {
    type: 'boolean',
    description:
      'false (default) treats the path as a centreline the brush travels along. ' +
      'true treats it as a closed region flooded with a wash. Petals and leaves are fills; stems are not.',
  },
  brush: {
    type: 'string',
    enum: BRUSH_NAMES,
    description: BRUSH_NAMES.map((k) => `${k}: ${BRUSHES[k].hint}`).join(' '),
  },
  pigment: {
    type: 'string',
    description:
      'Pigment id or name, e.g. "ultramarine", "Quinacridone Rose", "burnt-sienna". ' +
      'Call list_palette for the full set and their behaviour.',
  },
  water: {
    type: 'number',
    minimum: 0,
    maximum: 1,
    description:
      'How wet the brush is. 0.15 holds a crisp edge; 0.5 is a normal wash; ' +
      '0.85 spreads softly and can bloom into a cauliflower.',
  },
  pressure: {
    type: 'number',
    minimum: 0,
    maximum: 1,
    description: 'Brush pressure, scales the width of the mark. Default 0.7.',
  },
  opacity: {
    type: 'number',
    minimum: 0,
    maximum: 1,
    description:
      'Pigment load. 0.2 is a pale tint, 1.0 is full strength straight from the pan. ' +
      'Watercolour builds up, so start lower than you think.',
  },
  layer: {
    type: 'string',
    description:
      'Layer name or id to paint on. Lower layers sit underneath. Omit to use the layer the human has active.',
  },
  note: {
    type: 'string',
    description:
      'One short line on what this mark is for. It shows in the studio log next to the stroke, ' +
      'so the human can follow your reasoning. Write it for them, not for yourself.',
  },
} as const

/* ------------------------------------------------------------------ *
 * Input coercion
 *
 * Agents will hand over "0.7" and "Ultramarine Blue" and 70 for a 0..1 field.
 * Being forgiving here costs a few lines and saves a retry round-trip.
 * ------------------------------------------------------------------ */

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return fallback
  // Tolerate 0-100 where 0-1 was asked for.
  return n > 1 && n <= 100 ? n / 100 : n
}

function optNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return undefined
  return n > 1 && n <= 100 ? n / 100 : n
}

function brushOf(v: unknown): BrushKind | undefined {
  if (typeof v !== 'string') return undefined
  const q = v.trim().toLowerCase()
  return (BRUSH_NAMES as string[]).includes(q) ? (q as BrushKind) : undefined
}

interface RawStroke {
  path?: unknown
  fill?: unknown
  brush?: unknown
  pigment?: unknown
  water?: unknown
  pressure?: unknown
  opacity?: unknown
  layer?: unknown
  note?: unknown
}

/** Turn one loosely-typed stroke request into a validated PaintInput. */
function toPaintInput(raw: RawStroke, index: number): PaintInput | string {
  const path = typeof raw.path === 'string' ? raw.path.trim() : ''
  if (!path) return `stroke ${index + 1}: "path" is required and must be SVG path data.`
  if (!isValidPath(path)) {
    return `stroke ${index + 1}: "${path.slice(0, 60)}" is not valid SVG path data. It must start with M.`
  }

  let pigment: string | undefined
  if (raw.pigment !== undefined && raw.pigment !== null && raw.pigment !== '') {
    const found = resolvePigment(String(raw.pigment))
    if (!found) {
      return `stroke ${index + 1}: no pigment matches "${String(raw.pigment)}". Call list_palette to see what is on the palette.`
    }
    pigment = found.id
  }

  return {
    path,
    fill: raw.fill === true || raw.fill === 'true',
    kind: brushOf(raw.brush),
    pigment,
    water: optNum(raw.water),
    pressure: optNum(raw.pressure),
    opacity: optNum(raw.opacity),
    layerId: typeof raw.layer === 'string' && raw.layer ? raw.layer : undefined,
    note: typeof raw.note === 'string' ? raw.note : undefined,
  }
}

/* ------------------------------------------------------------------ *
 * The tool surface
 * ------------------------------------------------------------------ */

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
  execute: (input: never) => Promise<ToolResult> | ToolResult
}

/** Tools that are always available, whatever state the studio is in. */
function coreTools(): ToolDef[] {
  return [
    {
      name: 'look_at_canvas',
      description:
        'Look at the painting. Returns an image of the sheet as it currently stands, plus a written summary. ' +
        'Call this before your first mark to see what the human has already done, and again after every pass. ' +
        'Pair it with assess_painting, which measures what you are looking at. ' +
        'watercolour behaves differently from how it reads in code, and you cannot judge a wash you have not seen.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          width: {
            type: 'number',
            description: 'Width of the returned image in pixels, 240 to 1400. Default 760.',
          },
        },
      },
      execute: (input: { width?: unknown }) => {
        const scene = studio.getScene()
        const width = Math.max(240, Math.min(1400, num(input?.width, 760) > 1 ? Number(input?.width) || 760 : 760))
        const image = snapshotScene(scene, { width })
        return show(narrateScene(scene), image, {
          canvas: { width: CANVAS_W, height: CANVAS_H },
        })
      },
    },

    {
      name: 'inspect_region',
      description:
        'Look closely at one rectangle of the sheet, enlarged. Use it to judge an edge, a join between two washes, ' +
        'or a passage the human has asked you about, when the whole-sheet view is too small to tell.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Left edge of the region, 0 to 1000.' },
          y: { type: 'number', description: 'Top edge of the region, 0 to 700.' },
          width: { type: 'number', description: 'Width of the region in sheet units.' },
          height: { type: 'number', description: 'Height of the region in sheet units.' },
        },
        required: ['x', 'y', 'width', 'height'],
      },
      execute: (input: { x: number; y: number; width: number; height: number }) => {
        const scene = studio.getScene()
        const region = {
          x: Number(input.x),
          y: Number(input.y),
          w: Number(input.width),
          h: Number(input.height),
        }
        if (!Number.isFinite(region.w) || !Number.isFinite(region.h) || region.w <= 0 || region.h <= 0) {
          return fail('width and height must be positive numbers in sheet units.')
        }
        const inside = describeScene(scene).strokes.filter((s) => {
          const b = s.bounds
          return (
            b.x < region.x + region.w &&
            b.x + b.w > region.x &&
            b.y < region.y + region.h &&
            b.y + b.h > region.y
          )
        })
        const image = snapshotRegion(scene, region)
        return show(
          `Region ${Math.round(region.x)},${Math.round(region.y)} ${Math.round(region.w)}×${Math.round(region.h)}. ` +
            `${inside.length} stroke${inside.length === 1 ? '' : 's'} touch it.`,
          image,
          { region, strokes: inside },
        )
      },
    },

    {
      name: 'read_painting',
      description:
        'Read the painting as structured data: every stroke with its id, pigment, water, brush, layer, bounding box ' +
        'and exact path, in paint order. This is how you find the id of a mark you want to revise. ' +
        'Prefer look_at_canvas to judge how it looks, and this to decide what to change.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          author: {
            type: 'string',
            enum: ['human', 'agent', 'any'],
            description: 'Only return strokes painted by this author. Default "any".',
          },
        },
      },
      execute: (input: { author?: string }) => {
        const described = describeScene(studio.getScene())
        const filter = input?.author
        const strokes =
          filter === 'human' || filter === 'agent'
            ? described.strokes.filter((s) => s.author === filter)
            : described.strokes
        return say(
          `${strokes.length} stroke${strokes.length === 1 ? '' : 's'} on "${described.title}".`,
          { ...described, strokes },
        )
      },
    },

    {
      name: 'assess_painting',
      description:
        'Work out what the picture needs next. Call this before every pass, including your ' +
        'first, and again after you have painted.\n\n' +
        'It measures the sheet rather than describing it: how many pigments are in play, ' +
        'whether there is a genuine dark anywhere, how far the values actually spread, which ' +
        'ninths of the sheet are still untouched, and how the soft edges balance against the ' +
        'crisp ones. Then it tells you what follows from those numbers.\n\n' +
        'This exists because the failure mode of painting without measuring is always the ' +
        'same: a new hue for every shape, nothing properly dark, every edge equally soft, and ' +
        'a picture that goes flat. Those are not lapses of taste, they are lapses of ' +
        'measurement, and they are all visible in the document.',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const scene = studio.getScene()
        const report = assess(scene)
        const text = [
          report.observations.join(' '),
          '',
          report.suggestions.length === 1 ? 'What it needs:' : 'What it needs, in order:',
          ...report.suggestions.map((line, i) => `${i + 1}. ${line}`),
        ].join('\n')
        return show(text, snapshotScene(scene, { width: 760 }), report as unknown as Record<string, unknown>)
      },
    },

    {
      name: 'paint',
      description:
        'Paint one or more watercolour marks. This is the main way to put paint on the sheet.\n\n' +
        `THE SHEET is ${CANVAS_W} wide by ${CANVAS_H} tall, square units, origin top-left.\n\n` +
        'TWO KINDS OF MARK, and choosing right matters more than anything else here:\n' +
        '  fill: false (default) treats the path as a centreline the brush travels along. Stems, branches, ' +
        'contours, calligraphic lines.\n' +
        '  fill: true treats the path as a closed region flooded with a wash. Petals, leaves, skies, water, ' +
        'anything with area. A petal is a filled shape, not an outlined one. This is the single most ' +
        'common mistake: outlining a form instead of flooding it.\n\n' +
        'HOW THE PAINT BEHAVES, because the renderer really simulates it:\n' +
        '  • Work light to dark. Layers multiply, so you can always deepen a passage and never lighten one.\n' +
        '  • Water spreads and softens. Above about 0.65 a wash blooms into a pale cauliflower.\n' +
        '  • Granulating pigments (ultramarine, cerulean, burnt sienna) mottle into the paper. ' +
        'Staining ones (phthalo blue, quinacridone rose) stay smooth and hold a hard edge.\n' +
        '  • Painting on a wet layer bleeds outward. The lowest layer is the wettest.\n' +
        '  • Leave paper white. Untouched sheet is the only true highlight you get.\n\n' +
        'HOW A PAINTING IS BUILT. Not one call, but four or five, in this order:\n' +
        '  1. The ground. Two or three enormous, almost colourless washes on the wettest ' +
        'layer, water above 0.9 and load under 0.2. They set the light for everything after.\n' +
        '  2. The big shapes. Land, water, the mass of a tree. Still wet, still pale, still ' +
        'few. Most of the picture should be decided by now.\n' +
        '  3. The middle. Stronger, smaller, on a drier layer. This is where the subject ' +
        'actually appears.\n' +
        '  4. The dark. One small area at load 0.8 or above and water under 0.35. Only one. ' +
        'It is what makes everything else read as light.\n' +
        '  5. The marks. A handful of thin lines at most: a mast, a stem, a bird. Stop early.\n\n' +
        'RUN THE BIG SHAPES OFF THE EDGE OF THE SHEET. A wash for a sky or a field should ' +
        'start at x -40 and end at 1040, not at 0 and 1000. A large shape that floats with ' +
        'clear paper all the way round it reads as a sticker; the same shape running off ' +
        'three edges reads as a place. This is the single most common way a picture built ' +
        'from good marks still comes out looking assembled.\n\n' +
        'If you are painting a recognisable thing, call how_to_paint for it first. It gives ' +
        'the pass sequence and a path to start from for that subject specifically.\n\n' +
        'WHAT SEPARATES A PAINTING FROM A DIAGRAM. Read this before a first pass:\n' +
        '  • Use three or four pigments for the whole picture, not twelve. Call suggest_palette ' +
        'and stay inside what it gives you. Nothing makes an image read as generated faster ' +
        'than every shape being a different hue.\n' +
        '  • Build a value structure: most of the picture in a middle tone, a little of it very ' +
        'light (bare paper), and one small area genuinely dark. Without a real dark nothing ' +
        'else reads as light.\n' +
        '  • Vary your edges. A form that is soft on the shadow side and crisp where the light ' +
        'catches it looks three-dimensional; one that is uniformly crisp looks cut out of paper.\n' +
        '  • Big shapes first, on a wet lower layer, then fewer and smaller marks on top. ' +
        'Detail everywhere is the same as detail nowhere.\n' +
        '  • Let shapes overlap and run together. Marks that each sit in their own space read ' +
        'as clip art; a petal that bleeds into the one behind it reads as paint.\n' +
        '  • Avoid symmetry and even spacing. Odd numbers, uneven gaps, one element larger ' +
        'and closer than the rest.\n' +
        '  • Do not draw a circle for a sun or a rectangle for a sky. A perfect primitive is ' +
        'the one shape watercolour cannot make. Give every silhouette an uneven contour and ' +
        'let opposite sides differ.\n\n' +
        'Pass several strokes at once. A whole passage in one call lands as one undoable action, ' +
        'and reads to the human as one deliberate move rather than a twitchy stream.',
      inputSchema: {
        type: 'object',
        properties: {
          strokes: {
            type: 'array',
            description: 'The marks to lay down, painted in the order given.',
            items: {
              type: 'object',
              properties: STROKE_PROPS,
              required: ['path'],
            },
          },
          summary: {
            type: 'string',
            description:
              'One short line naming what this pass is, e.g. "laid in the sky and the far hills". ' +
              'Shown to the human in the studio log.',
          },
        },
        required: ['strokes'],
      },
      execute: (input: { strokes?: RawStroke[]; summary?: string }) => {
        const list = Array.isArray(input?.strokes) ? input.strokes : []
        if (list.length === 0) {
          return fail('Pass at least one stroke. Each needs a "path" of SVG path data.')
        }
        if (list.length > 120) {
          return fail(`${list.length} strokes in one call is too many; 120 is the limit. Build the painting up in passes.`)
        }

        const inputs: PaintInput[] = []
        for (let i = 0; i < list.length; i++) {
          const result = toPaintInput(list[i] ?? {}, i)
          if (typeof result === 'string') return fail(result)
          inputs.push(result)
        }

        const made = studio.paintMany(
          inputs,
          'agent',
          input?.summary || `${inputs.length} stroke${inputs.length === 1 ? '' : 's'}`,
        )
        const scene = studio.getScene()
        return show(
          `Painted ${made.length} mark${made.length === 1 ? '' : 's'}. ` +
            `Ids: ${made.map((s) => s.id).join(', ')}. Here is the sheet now, so check it before painting more.`,
          snapshotScene(scene, { width: 760 }),
          { painted: made.map((s) => summariseStroke(scene, s)) },
        )
      },
    },

    {
      name: 'revise_stroke',
      description:
        'Change marks that are already on the sheet, keeping them the same marks. This is the ' +
        'part a prompt-only image model cannot do: a stroke stays an object, so its pigment, ' +
        'water, pressure, brush or even its path can be changed afterwards without repainting ' +
        'anything around it. Changing the colour of something already painted is this tool ' +
        'with a pigment. Pass one id or many; get ids from find_strokes or read_painting.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A stroke id. Use this or "ids".' },
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Several stroke ids, to change them all the same way in one action.',
          },
          path: { type: 'string', description: 'Replacement SVG path data. Omit to keep the existing shape.' },
          fill: STROKE_PROPS.fill,
          brush: STROKE_PROPS.brush,
          pigment: STROKE_PROPS.pigment,
          water: STROKE_PROPS.water,
          pressure: STROKE_PROPS.pressure,
          opacity: STROKE_PROPS.opacity,
          layer: STROKE_PROPS.layer,
          note: STROKE_PROPS.note,
        },
      },
      execute: (input: RawStroke & { id?: string; ids?: string[] }) => {
        const wanted = [
          ...(typeof input?.id === 'string' ? [input.id] : []),
          ...(Array.isArray(input?.ids) ? input.ids.filter((i) => typeof i === 'string') : []),
        ]
        if (wanted.length === 0) return fail('Pass an id, or a list of ids.')
        const targets = wanted.filter((i) => studio.getStroke(i))
        if (targets.length === 0) {
          return fail(`None of those ids are on the sheet. Call find_strokes or read_painting.`)
        }
        const existing = studio.getStroke(targets[0])!

        const patch: StrokePatch = {}
        if (typeof input.path === 'string' && input.path.trim()) {
          if (!isValidPath(input.path)) return fail(`"${input.path.slice(0, 60)}" is not valid SVG path data.`)
          patch.path = input.path.trim()
        }
        if (input.fill !== undefined) patch.fill = input.fill === true || input.fill === 'true'
        const kind = brushOf(input.brush)
        if (kind) patch.kind = kind
        if (input.pigment !== undefined && input.pigment !== '') {
          const found = resolvePigment(String(input.pigment))
          if (!found) return fail(`No pigment matches "${String(input.pigment)}".`)
          patch.pigment = found.id
        }
        const water = optNum(input.water)
        if (water !== undefined) patch.water = water
        const pressure = optNum(input.pressure)
        if (pressure !== undefined) patch.pressure = pressure
        const opacity = optNum(input.opacity)
        if (opacity !== undefined) patch.opacity = opacity
        if (typeof input.layer === 'string' && input.layer) {
          const layer = studio.resolveLayer(input.layer)
          if (!layer) return fail(`No layer called "${input.layer}".`)
          patch.layerId = layer.id
        }
        if (typeof input.note === 'string') patch.note = input.note

        if (Object.keys(patch).length === 0) {
          return fail('Nothing to change. Pass at least one property besides id.')
        }

        const revised = studio.updateMany(targets, patch, 'agent')
        const scene = studio.getScene()
        return show(
          `Revised ${revised.length} mark${revised.length === 1 ? '' : 's'}: ` +
            `${Object.keys(patch).join(', ')} changed.`,
          snapshotScene(scene, { width: 760 }),
          { strokes: revised.map((r) => summariseStroke(scene, r)) },
        )
      },
    },

    {
      name: 'transform_strokes',
      description:
        'Move and resize marks that are already on the sheet, without repainting them. ' +
        'Scaling happens about the centre of the marks being transformed, so "make that flower ' +
        'smaller and push it into the corner" is one call, and the brushwork survives it.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Stroke ids to transform, from read_painting.',
          },
          dx: { type: 'number', description: 'Horizontal shift in sheet units. Positive moves right.' },
          dy: { type: 'number', description: 'Vertical shift in sheet units. Positive moves down.' },
          scale: {
            type: 'number',
            minimum: 0.05,
            maximum: 8,
            description: 'Size multiplier about the centre of the selection. 1 leaves the size alone.',
          },
        },
        required: ['ids'],
      },
      execute: (input: { ids?: string[]; dx?: number; dy?: number; scale?: number }) => {
        const ids = Array.isArray(input?.ids) ? input.ids.filter((i) => typeof i === 'string') : []
        if (ids.length === 0) return fail('Pass at least one stroke id.')

        const scale = Number(input?.scale)
        const dx = Number(input?.dx) || 0
        const dy = Number(input?.dy) || 0
        const done: string[] = []

        if (Number.isFinite(scale) && scale > 0 && scale !== 1) {
          const factor = Math.max(0.05, Math.min(8, scale))
          const scene = studio.getScene()
          const targets = scene.strokes.filter((s) => ids.includes(s.id))
          if (targets.length === 0) return fail('None of those ids are on the sheet.')

          // Scale about the centre of everything being transformed, so a group
          // keeps its arrangement instead of each mark shrinking in place.
          const boxes = targets.map((s) => summariseStroke(scene, s).bounds)
          const left = Math.min(...boxes.map((b) => b.x))
          const top = Math.min(...boxes.map((b) => b.y))
          const right = Math.max(...boxes.map((b) => b.x + b.w))
          const bottom = Math.max(...boxes.map((b) => b.y + b.h))
          const originX = (left + right) / 2
          const originY = (top + bottom) / 2

          for (const stroke of targets) {
            studio.update(
              stroke.id,
              { path: scalePath(stroke.path, factor, originX, originY) },
              'agent',
              `Resized ${stroke.id} by ${factor.toFixed(2)}×`,
            )
          }
          done.push(`resized by ${factor.toFixed(2)}×`)
        }

        if (dx !== 0 || dy !== 0) {
          const moved = studio.move(ids, dx, dy, 'agent')
          if (moved === 0 && done.length === 0) return fail('None of those ids are on the sheet.')
          done.push(`moved by ${Math.round(dx)}, ${Math.round(dy)}`)
        }

        if (done.length === 0) return fail('Pass a non-zero dx/dy, or a scale other than 1.')

        return show(
          `${ids.length} stroke${ids.length === 1 ? '' : 's'} ${done.join(' and ')}.`,
          snapshotScene(studio.getScene(), { width: 760 }),
        )
      },
    },

    {
      name: 'lift_strokes',
      description:
        'Remove marks from the sheet by id. Called "lifting" because that is what taking paint back off ' +
        'wet paper is called. The human can undo it.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Stroke ids to remove.' },
        },
        required: ['ids'],
      },
      execute: (input: { ids?: string[] }) => {
        const ids = Array.isArray(input?.ids) ? input.ids.filter((i) => typeof i === 'string') : []
        if (ids.length === 0) return fail('Pass at least one stroke id.')
        const gone = studio.erase(ids, 'agent')
        if (gone === 0) return fail('None of those ids are on the sheet.')
        return show(
          `Lifted ${gone} stroke${gone === 1 ? '' : 's'}.`,
          snapshotScene(studio.getScene(), { width: 760 }),
        )
      },
    },


    {
      name: 'undo',
      description:
        'Step the whole studio back one action, including the human\'s. One shared history: ' +
        'if a mark is wrong, this takes it back off. Always available; it will tell you if ' +
        'there is nothing left to undo.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'number',
            description: 'How many actions to step back. Default 1.',
          },
        },
      },
      execute: (input: { steps?: number }) => {
        const want = Math.max(1, Math.min(40, Math.round(Number(input?.steps) || 1)))
        let done = 0
        while (done < want && studio.undo('agent')) done += 1
        if (done === 0) return say('Nothing left to undo.')
        return show(
          `Stepped back ${done} action${done === 1 ? '' : 's'}.`,
          snapshotScene(studio.getScene(), { width: 760 }),
        )
      },
    },

    {
      name: 'redo',
      description: 'Step the studio forward again after an undo.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: { type: 'number', description: 'How many actions to step forward. Default 1.' },
        },
      },
      execute: (input: { steps?: number }) => {
        const want = Math.max(1, Math.min(40, Math.round(Number(input?.steps) || 1)))
        let done = 0
        while (done < want && studio.redo('agent')) done += 1
        if (done === 0) return say('Nothing to redo.')
        return show(
          `Stepped forward ${done} action${done === 1 ? '' : 's'}.`,
          snapshotScene(studio.getScene(), { width: 760 }),
        )
      },
    },

    {
      name: 'clear_sheet',
      description:
        'Take every mark off the sheet. The human can undo it, but ask first if there is work ' +
        'on there that is not yours.',
      inputSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            description: 'Must be true. A guard against wiping somebody else\'s painting.',
          },
        },
        required: ['confirm'],
      },
      execute: (input: { confirm?: unknown }) => {
        if (input?.confirm !== true) return fail('Set confirm: true to clear the sheet.')
        const had = studio.getScene().strokes.length
        if (had === 0) return say('The sheet is already empty.')
        studio.clear('agent')
        return say(`Cleared ${had} mark${had === 1 ? '' : 's'}. The human can undo this.`)
      },
    },

    {
      name: 'find_strokes',
      description:
        'Find marks without reading the whole painting. Filter by pigment, author, brush, ' +
        'whether it is a wash, a word in its note, or a rectangle of the sheet it overlaps. ' +
        'This is how you get from "the sun" to an id you can act on: the sun is the big ' +
        'cadmium red wash in the upper right, so filter by pigment and region and you have it.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          pigment: { type: 'string', description: 'Pigment id or name.' },
          author: { type: 'string', enum: ['human', 'agent'], description: 'Who painted it.' },
          brush: { type: 'string', enum: BRUSH_NAMES },
          fill: { type: 'boolean', description: 'true for washes, false for strokes.' },
          note: { type: 'string', description: 'A word appearing in the mark\'s note.' },
          layer: { type: 'string', description: 'Layer name or id.' },
          region: {
            type: 'object',
            description: 'Only marks overlapping this rectangle of the sheet.',
            properties: {
              x: { type: 'number' }, y: { type: 'number' },
              width: { type: 'number' }, height: { type: 'number' },
            },
          },
          largest: {
            type: 'boolean',
            description: 'Sort biggest first, which is usually what "the sun" or "the sky" means.',
          },
        },
      },
      execute: (input: {
        pigment?: string; author?: string; brush?: string; fill?: unknown
        note?: string; layer?: string; largest?: unknown
        region?: { x?: number; y?: number; width?: number; height?: number }
      }) => {
        const scene = studio.getScene()
        let found = describeScene(scene).strokes

        if (input?.pigment) {
          const p = resolvePigment(String(input.pigment))
          if (!p) return fail(`No pigment matches "${String(input.pigment)}".`)
          found = found.filter((s) => s.pigment === p.name)
        }
        if (input?.author === 'human' || input?.author === 'agent') {
          found = found.filter((s) => s.author === input.author)
        }
        if (typeof input?.brush === 'string') found = found.filter((s) => s.brush === input.brush)
        if (input?.fill !== undefined) {
          const want = input.fill === true || input.fill === 'true'
          found = found.filter((s) => s.fill === want)
        }
        if (typeof input?.note === 'string' && input.note.trim()) {
          const q = input.note.trim().toLowerCase()
          found = found.filter((s) => (s.note ?? '').toLowerCase().includes(q))
        }
        if (typeof input?.layer === 'string' && input.layer) {
          const layer = studio.resolveLayer(input.layer)
          if (!layer) return fail(`No layer called "${input.layer}".`)
          found = found.filter((s) => s.layer === layer.name)
        }
        const r = input?.region
        if (r && [r.x, r.y, r.width, r.height].every((n) => Number.isFinite(Number(n)))) {
          const x = Number(r.x), y = Number(r.y), w = Number(r.width), h = Number(r.height)
          found = found.filter(
            (s) =>
              s.bounds.x < x + w && s.bounds.x + s.bounds.w > x &&
              s.bounds.y < y + h && s.bounds.y + s.bounds.h > y,
          )
        }
        if (input?.largest === true || input?.largest === 'true') {
          found = found.slice().sort((a, b) => b.bounds.w * b.bounds.h - a.bounds.w * a.bounds.h)
        }

        return say(
          found.length === 0
            ? 'Nothing on the sheet matches that.'
            : `${found.length} mark${found.length === 1 ? '' : 's'}: ${found.map((s) => s.id).join(', ')}.`,
          { strokes: found },
        )
      },
    },

    {
      name: 'select_strokes',
      description:
        'Select marks in the studio, which puts a highlight round them on the human\'s screen ' +
        'and switches them into select mode. Use it to point: if you are about to change ' +
        'something, or you are asking which of two they meant, selecting it is quicker and ' +
        'clearer than describing where it is. Pass an empty list to deselect.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Stroke ids to select.' },
        },
        required: ['ids'],
      },
      execute: (input: { ids?: string[] }) => {
        const ids = Array.isArray(input?.ids) ? input.ids.filter((i) => typeof i === 'string') : []
        const real = ids.filter((id) => studio.getStroke(id))
        if (ids.length > 0 && real.length === 0) return fail('None of those ids are on the sheet.')
        if (real.length > 0) studio.setMode('select')
        studio.select(real)
        return show(
          real.length === 0
            ? 'Deselected.'
            : `Selected ${real.length} mark${real.length === 1 ? '' : 's'} on the human\'s screen.`,
          snapshotScene(studio.getScene(), { width: 760 }),
        )
      },
    },

    {
      name: 'set_brush',
      description:
        'Load the brush the human is holding, and set what mode they are in. Use it to hand ' +
        'them something ready to go: "here, try this" is a loaded mop of dilute cerulean, not ' +
        'a paragraph telling them which sliders to move. It changes nothing already on the ' +
        'sheet.',
      inputSchema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['paint', 'select'],
            description: 'paint puts them on the brush, select lets them pick marks up.',
          },
          brush: STROKE_PROPS.brush,
          pigment: STROKE_PROPS.pigment,
          water: STROKE_PROPS.water,
          pressure: STROKE_PROPS.pressure,
          opacity: STROKE_PROPS.opacity,
          fill: STROKE_PROPS.fill,
          layer: STROKE_PROPS.layer,
        },
      },
      execute: (input: RawStroke & { mode?: string }) => {
        const changed: string[] = []
        if (input?.mode === 'paint' || input?.mode === 'select') {
          studio.setMode(input.mode)
          changed.push(`mode ${input.mode}`)
        }
        const patch: Record<string, unknown> = {}
        const kind = brushOf(input?.brush)
        if (kind) { patch.kind = kind; changed.push(BRUSHES[kind].label.toLowerCase()) }
        if (input?.pigment !== undefined && input.pigment !== '') {
          const found = resolvePigment(String(input.pigment))
          if (!found) return fail(`No pigment matches "${String(input.pigment)}".`)
          patch.pigment = found.id
          changed.push(found.name)
        }
        for (const key of ['water', 'pressure', 'opacity'] as const) {
          const v = optNum((input as Record<string, unknown>)[key])
          if (v !== undefined) { patch[key] = v; changed.push(`${key} ${v}`) }
        }
        if (input?.fill !== undefined) {
          patch.fill = input.fill === true || input.fill === 'true'
          changed.push(patch.fill ? 'wash' : 'stroke')
        }
        if (typeof input?.layer === 'string' && input.layer) {
          const layer = studio.resolveLayer(input.layer)
          if (!layer) return fail(`No layer called "${input.layer}".`)
          studio.setActiveLayer(layer.id)
          changed.push(`layer ${layer.name}`)
        }
        if (Object.keys(patch).length > 0) studio.setBrush(patch as never)
        if (changed.length === 0) return fail('Nothing to set. Pass a mode, a brush or a load.')
        return say(`Brush loaded: ${changed.join(', ')}.`)
      },
    },

    {
      name: 'list_palette',
      description:
        'The pigments on the palette, the brushes in the jar, and the papers in the drawer, with how each behaves. ' +
        'Worth reading once before you plan a painting: granulation and staining change what a passage can do.',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        say('Palette, brushes and papers.', {
          pigments: PIGMENTS.map((p) => ({
            id: p.id,
            name: p.name,
            family: p.family,
            granulation: p.granulation,
            staining: p.staining,
            density: p.density,
          })),
          brushes: BRUSH_NAMES.map((k) => ({ id: k, ...BRUSHES[k] })),
          papers: PAPER_NAMES.map((k) => ({ id: k, ...PAPERS[k] })),
        }),
    },

    {
      name: 'how_to_paint',
      description:
        'How a particular thing is actually painted: how many washes, in what order, at what ' +
        'strength, what the silhouette does, and the mistake that subject invites.\n\n' +
        'Call this before painting any recognisable subject. General principles do not survive ' +
        'a blank sheet: told to keep a limited palette and vary its edges, anyone still paints ' +
        'a mountain as a triangle and a flower as a fan of even ovals, because the missing ' +
        'thing is not watercolour in general but how that subject in particular is built. ' +
        'Each answer is a worked sequence with real numbers and a path to start from, sized to ' +
        'the whole sheet, so scale and move them to fit what you are making.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description:
              'What you are painting: mountain, flower, tree, water, sky, field. Plain words ' +
              'work, so "a range of hills" or "poppies" both land. Omit to list everything.',
          },
        },
      },
      execute: (input: { subject?: string }) => {
        const describe = (r: (typeof SUBJECTS)[number]) => ({
          id: r.id,
          name: r.name,
          watchOutFor: r.trap,
          passes: r.passes,
        })
        const found = typeof input?.subject === 'string' ? findSubject(input.subject) : null
        if (!found) {
          return say(
            `Worked recipes for: ${SUBJECTS.map((r) => r.name).join(', ')}. ` +
              'Ask for one by name. For anything not listed, the nearest one is usually a good ' +
              'skeleton: almost everything is built back to front, palest first, with one dark ' +
              'kept until last.',
            { subjects: SUBJECTS.map(describe) },
          )
        }
        const lines = [
          `${found.name}.`,
          `Watch out for: ${found.trap}`,
          '',
          ...found.passes.flatMap((pass, i) => [
            `${i + 1}. ${pass.what}. ${pass.how}`,
            ...(pass.path ? [`   A path to start from: ${pass.path}`] : []),
          ]),
        ]
        return say(lines.join('\n'), { subject: describe(found) })
      },
    },

    {
      name: 'suggest_palette',
      description:
        'A limited palette to paint the whole picture from, with a role for each pigment. ' +
        'Worth calling before your first mark. Painters work from three or four pigments and mix ' +
        'everything else by overlaying them, which is what makes a picture hold together; ' +
        'reaching for a new hue every time a new shape appears is the single clearest signature ' +
        'of a machine-made image. Pass a mood or a subject and you get the closest scheme, or ' +
        'pass nothing to see them all.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          mood: {
            type: 'string',
            description:
              'A mood or subject, e.g. "sunlit", "grey day", "botanical", "after dark", "autumn". ' +
              'Omit to list every scheme.',
          },
        },
      },
      execute: (input: { mood?: string }) => {
        const describe = (scheme: (typeof SCHEMES)[number]) => ({
          id: scheme.id,
          name: scheme.name,
          mood: scheme.mood,
          note: scheme.note,
          pigments: scheme.roles.map((r) => ({
            role: r.role,
            id: r.pigment,
            name: getPigment(r.pigment).name,
            granulation: getPigment(r.pigment).granulation,
            staining: getPigment(r.pigment).staining,
          })),
        })

        const picked = typeof input?.mood === 'string' ? findScheme(input.mood) : null
        if (picked) {
          return say(
            `${picked.name}: ${picked.mood}. ${picked.note} ` +
              'Use the dominant across most of the picture, the secondary for the next largest ' +
              'areas, the accent sparingly, and the dark in one small place only.',
            { scheme: describe(picked) },
          )
        }
        return say(
          `${SCHEMES.length} limited palettes. Pick one and paint the whole study from it.`,
          { schemes: SCHEMES.map(describe) },
        )
      },
    },

    {
      name: 'manage_layers',
      description:
        'Add a layer, or change one. Layers stack bottom to top and each has a wetness: painting onto a wet ' +
        'layer makes the mark bleed and soften, which is how you get an atmospheric background. ' +
        'Keep the wet ground underneath and the crisp detail on top.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'update'],
            description: '"add" creates a new layer on top; "update" changes an existing one.',
          },
          layer: { type: 'string', description: 'Layer name or id. Required for "update".' },
          name: { type: 'string', description: 'Name for the layer.' },
          wetness: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '0 is bone dry and holds crisp edges; 1 is a soaked sheet everything bleeds into.',
          },
          visible: { type: 'boolean', description: 'Hide or show the layer.' },
        },
        required: ['action'],
      },
      execute: (input: { action?: string; layer?: string; name?: string; wetness?: unknown; visible?: unknown }) => {
        if (input?.action === 'add') {
          const layer = studio.addLayer(String(input.name ?? ''), num(input.wetness, 0.2), 'agent')
          return say(`Added layer "${layer.name}" (id ${layer.id}).`, { layer })
        }
        const target = studio.resolveLayer(input?.layer)
        if (!target) return fail(`No layer called "${String(input?.layer)}". Call read_painting to list them.`)
        const patch: Record<string, unknown> = {}
        if (typeof input.name === 'string' && input.name) patch.name = input.name
        const wetness = optNum(input.wetness)
        if (wetness !== undefined) patch.wetness = wetness
        if (input.visible !== undefined) patch.visible = input.visible === true || input.visible === 'true'
        const next = studio.updateLayer(target.id, patch, 'agent')
        return say(`Updated layer "${next?.name}".`, { layer: next })
      },
    },

    {
      name: 'set_sheet',
      description:
        'Change the paper or retitle the study. Paper is not cosmetic: rough paper has deep tooth that makes ' +
        'granulating pigments mottle dramatically, hot press is smooth and keeps botanical detail crisp, ' +
        'and toned paper gives you a mid-value ground to work light against dark on.',
      inputSchema: {
        type: 'object',
        properties: {
          paper: {
            type: 'string',
            enum: PAPER_NAMES,
            description: PAPER_NAMES.map((k) => `${k}: ${PAPERS[k].hint}`).join(' '),
          },
          title: { type: 'string', description: 'A title for the study.' },
        },
      },
      execute: (input: { paper?: string; title?: string }) => {
        let changed = false
        if (typeof input?.paper === 'string' && (PAPER_NAMES as string[]).includes(input.paper)) {
          studio.setPaper(input.paper as PaperKind, 'agent')
          changed = true
        }
        if (typeof input?.title === 'string' && input.title.trim()) {
          studio.setTitle(input.title.trim(), 'agent')
          changed = true
        }
        if (!changed) return fail('Pass a paper from the enum, or a title.')
        return show('Sheet updated.', snapshotScene(studio.getScene(), { width: 760 }))
      },
    },
  ]
}

/* ------------------------------------------------------------------ *
 * Contextual tools
 *
 * The point of the dynamic half of WebMCP: the tool list is not a fixed manifest
 * but a live description of what is possible right now. When the human selects a
 * stroke, a tool for revising *that* stroke appears, and its description names
 * the thing they picked. When there is nothing to undo, there is no undo tool.
 * The agent never has to guess at the state of the app, because the state of the
 * app is the shape of its toolbox.
 * ------------------------------------------------------------------ */

function contextualTools(): ToolDef[] {
  const tools: ToolDef[] = []
  const { ui, scene, canUndo, canRedo } = studio.getSnapshot()
  const selected = ui.selection
    .map((id) => studio.getStroke(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  if (selected.length > 0) {
    const described = selected.map((s) => summariseStroke(scene, s))
    const subject =
      selected.length === 1
        ? `a ${described[0].fill ? 'wash' : 'stroke'} in ${described[0].pigment} on layer "${described[0].layer}"` +
          ` (${described[0].brush} brush, water ${described[0].water}, around ${described[0].bounds.x},${described[0].bounds.y})`
        : `${selected.length} strokes`

    tools.push({
      name: 'describe_selection',
      description:
        `The human has selected ${subject}. This returns its full detail and a close-up image of it. ` +
        'When they say "this one" or "that petal", this is what they mean.',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const bounds = described.reduce(
          (acc, s) => ({
            x: Math.min(acc.x, s.bounds.x),
            y: Math.min(acc.y, s.bounds.y),
            r: Math.max(acc.r, s.bounds.x + s.bounds.w),
            b: Math.max(acc.b, s.bounds.y + s.bounds.h),
          }),
          { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity },
        )
        const pad = 40
        const region = {
          x: bounds.x - pad,
          y: bounds.y - pad,
          w: bounds.r - bounds.x + pad * 2,
          h: bounds.b - bounds.y + pad * 2,
        }
        return show(
          `The human has ${subject} selected.`,
          snapshotRegion(studio.getScene(), region),
          { selection: described },
        )
      },
    })

    tools.push({
      name: 'revise_selection',
      description:
        `Revise exactly what the human currently has selected, which is ${subject}. ` +
        'Use this instead of revise_stroke when they say "make this wetter", "warm this up", ' +
        '"push that back". You do not need to look up an id, because they have already pointed at it.',
      inputSchema: {
        type: 'object',
        properties: {
          brush: STROKE_PROPS.brush,
          pigment: STROKE_PROPS.pigment,
          water: STROKE_PROPS.water,
          pressure: STROKE_PROPS.pressure,
          opacity: STROKE_PROPS.opacity,
          fill: STROKE_PROPS.fill,
          layer: STROKE_PROPS.layer,
          note: STROKE_PROPS.note,
        },
      },
      execute: (input: RawStroke) => {
        const patch: StrokePatch = {}
        const kind = brushOf(input?.brush)
        if (kind) patch.kind = kind
        if (input?.pigment !== undefined && input.pigment !== '') {
          const found = resolvePigment(String(input.pigment))
          if (!found) return fail(`No pigment matches "${String(input.pigment)}".`)
          patch.pigment = found.id
        }
        const water = optNum(input?.water)
        if (water !== undefined) patch.water = water
        const pressure = optNum(input?.pressure)
        if (pressure !== undefined) patch.pressure = pressure
        const opacity = optNum(input?.opacity)
        if (opacity !== undefined) patch.opacity = opacity
        if (input?.fill !== undefined) patch.fill = input.fill === true || input.fill === 'true'
        if (typeof input?.layer === 'string' && input.layer) {
          const layer = studio.resolveLayer(input.layer)
          if (!layer) return fail(`No layer called "${input.layer}".`)
          patch.layerId = layer.id
        }
        if (typeof input?.note === 'string') patch.note = input.note

        if (Object.keys(patch).length === 0) {
          return fail('Nothing to change. Pass at least one property.')
        }

        const ids = selected.map((s) => s.id)
        studio.updateMany(ids, patch, 'agent', `Revised the human's selection`)
        return show(
          `Revised the selection (${ids.length} stroke${ids.length === 1 ? '' : 's'}).`,
          snapshotScene(studio.getScene(), { width: 760 }),
        )
      },
    })
  }

  /* ---------------- the duet ---------------- */

  const duet = studio.getDuet()
  if (duet) {
    const step = duet.score.steps[duet.index] ?? null
    const finished = duet.index >= duet.score.steps.length

    tools.push({
      name: 'duet_status',
      description:
        `"${duet.score.title}" is being painted in turns, ${duet.score.steps.length} passes ` +
        'alternating between the human and you. This returns the whole score, which pass is ' +
        'current, whose turn it is, and the brief for that pass, with an image of the sheet. ' +
        'Call it before you paint anything: your passes are built on marks the human just made, ' +
        `and where they actually put them is not where the score imagined they would.`,
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const scene = studio.getScene()
        const lines = finished
          ? [`"${duet.score.title}" is finished. All ${duet.score.steps.length} passes are done.`]
          : [
              `"${duet.score.title}", pass ${duet.index + 1} of ${duet.score.steps.length}.`,
              step?.by === 'agent'
                ? `It is your turn: ${step.title}.`
                : `It is the human's turn: ${step?.title}. Wait for them.`,
              step ? step.hint : '',
            ]
        return show(lines.filter(Boolean).join('\n\n'), snapshotScene(scene, { width: 760 }), {
          title: duet.score.title,
          pass: duet.index + 1,
          of: duet.score.steps.length,
          turn: finished ? 'done' : step?.by,
          current: step
            ? {
                id: step.id,
                title: step.title,
                brief: step.hint,
                by: step.by,
                // Where the human is being asked to draw, so you can see what
                // is about to appear and where your own pass will have to sit.
                guides: step.guides ?? undefined,
                traced: step.by === 'human' ? duet.traced : undefined,
              }
            : null,
          score: duet.score.steps.map((st, i) => ({
            title: st.title,
            by: st.by,
            state: i < duet.index ? 'done' : i === duet.index ? 'current' : 'waiting',
          })),
        })
      },
    })

    if (step && step.by === 'agent') {
      tools.push({
        name: 'duet_complete_turn',
        description:
          `Hand the brush back. Your current pass is "${step.title}". ${step.hint}\n\n` +
          'Paint it with the ordinary paint tool first, looking at the sheet before and after, ' +
          'then call this to end your turn and pass to the human. Do not call it before you ' +
          'have actually painted anything.',
        inputSchema: {
          type: 'object',
          properties: {
            note: {
              type: 'string',
              description: 'One line for the human on what you did and why.',
            },
          },
        },
        execute: (input: { note?: string }) => {
          const finishedStep = step
          const next = studio.advanceDuet()
          if (typeof input?.note === 'string' && input.note.trim()) {
            studio.noteFromAgent(input.note.trim())
          }
          return show(
            `Done with "${finishedStep.title}". ` +
              (next
                ? next.by === 'human'
                  ? `Over to the human for "${next.title}".`
                  : `Your turn again: ${next.title}.`
                : 'That was the last pass. The painting is finished.'),
            snapshotScene(studio.getScene(), { width: 760 }),
          )
        },
      })
    }
  }

  return tools
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

/**
 * A key describing the *shape* of the contextual surface.
 *
 * Re-registering on every store change would abort and rebuild the toolbox on
 * every brushstroke, which is both wasteful and noisy for a connected agent.
 * Re-registering only when this key changes means `toolchange` fires exactly
 * when the set of available tools genuinely differs.
 */
function surfaceKey(): string {
  const { ui, scene, canUndo, canRedo } = studio.getSnapshot()
  const selection = ui.selection.slice().sort().join(',')
  return [
    selection,
    scene.strokes.length > 0 ? 'has' : 'empty',
    canUndo ? 'u' : '-',
    canRedo ? 'r' : '-',
    // Each pass of a duet carries its own brief inside the tool description.
    studio.getDuet() ? `duet:${studio.getDuet()?.index}` : '-',
  ].join('|')
}

/**
 * How the tools registered on this page can actually be reached.
 *
 * The distinction matters more than it looks. Registering a tool and being
 * connectable are separate things: the polyfill installs `document.modelContext`
 * and nothing else. It carries no transport at all, so in `local` the whole
 * toolbox is real, wired to the store, and unreachable by anything outside the
 * page. Reporting that as a connection is the one thing the panel must not do.
 *
 * - `native`  the browser implements WebMCP itself, and its agent can see the tools
 * - `bridge`  an extension supplied the context and relays to an outside client
 * - `local`   our polyfill, in-page only, no agent can connect
 * - `none`    no `document.modelContext` at all, not even the polyfill took
 */
export type SurfaceTransport = 'native' | 'bridge' | 'local' | 'none'

/** The slice of `ModelContext` this file actually uses. */
type ModelContextLike = NonNullable<Document['modelContext']>

function existing(): ModelContextLike | null {
  if (typeof document === 'undefined') return null
  return 'modelContext' in document && document.modelContext ? document.modelContext : null
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * MCP-B runtimes add a non-standard `listTools()` to the context they inject;
 * a browser's own implementation has only the spec surface. Guessing wrong
 * still lands on a reachable transport, so the worst case is the wrong label
 * on a working connection, never a false one.
 */
function classify(context: ModelContextLike): SurfaceTransport {
  const extras = context as { listTools?: unknown }
  return typeof extras.listTools === 'function' ? 'bridge' : 'native'
}

export interface SurfaceStatus {
  supported: boolean
  transport: SurfaceTransport
  /** Whether an agent outside the page can actually call these tools. */
  reachable: boolean
  toolNames: string[]
  /** The tool the agent is inside at this moment, if any. */
  activeTool: string | null
  /** Tools called in the last few seconds, most recent first. */
  recentTools: string[]
  callCount: number
  /** Calls that changed the painting, as opposed to only looking at it. */
  mutationCount: number
  /** When the last call of any kind came in. */
  lastCallAt: number
  error?: string
}

type StatusListener = (status: SurfaceStatus) => void

class ToolSurface {
  private core: AbortController | null = null
  private contextual: AbortController | null = null
  private key = ''
  private mounted = false
  private transport: SurfaceTransport = 'none'
  private listeners = new Set<StatusListener>()
  private names: string[] = []
  private active: string | null = null
  private recent: string[] = []
  private calls = 0
  private mutations = 0
  private lastCallAt = 0
  private cooldown: ReturnType<typeof setTimeout> | null = null
  private hold: ReturnType<typeof setTimeout> | null = null
  private error?: string
  private pending: Promise<void> = Promise.resolve()
  private syncQueued = false
  /** The context our tools are currently registered into. */
  private context: ModelContextLike | null = null
  private watching = false

  onStatus(fn: StatusListener): () => void {
    this.listeners.add(fn)
    fn(this.status())
    return () => this.listeners.delete(fn)
  }

  status(): SurfaceStatus {
    return {
      supported: this.mounted,
      transport: this.transport,
      reachable: this.transport === 'native' || this.transport === 'bridge',
      toolNames: this.names,
      activeTool: this.active,
      recentTools: this.recent,
      callCount: this.calls,
      mutationCount: this.mutations,
      lastCallAt: this.lastCallAt,
      error: this.error,
    }
  }

  /**
   * Wrap a tool so the studio can show what the agent is doing while it does
   * it. An agent working through a page is otherwise completely silent until
   * the moment its changes land, which makes it look like nothing is happening
   * and then like everything happened at once.
   */
  private observed(tool: ToolDef): ToolDef {
    /**
     * Reading the sheet takes a couple of milliseconds, which is less time than
     * it takes to paint a frame. Without a floor on how briefly the indicator
     * can show, the fast tools would fire invisibly and only the slow ones
     * would ever appear to run, which reads as the agent using a fraction of
     * what it actually uses.
     */
    const MIN_VISIBLE = 420

    return {
      ...tool,
      execute: async (input: never) => {
        if (this.hold) {
          clearTimeout(this.hold)
          this.hold = null
        }
        const startedAt = Date.now()
        this.active = tool.name
        this.calls += 1
        this.lastCallAt = startedAt
        // Looking at the sheet is not the same as working on it, and the
        // difference decides whether the studio waits for a live agent or
        // assumes nothing is listening.
        if (!tool.annotations?.readOnlyHint) this.mutations += 1
        this.emit()

        const settle = () => {
          // Another call may have taken over while this one was winding down.
          if (this.active === tool.name) this.active = null
          this.recent = [tool.name, ...this.recent.filter((n) => n !== tool.name)].slice(0, 6)
          this.emit()
          if (this.cooldown) clearTimeout(this.cooldown)
          this.cooldown = setTimeout(() => {
            this.recent = []
            this.emit()
          }, 3200)
        }

        try {
          return await tool.execute(input)
        } finally {
          const elapsed = Date.now() - startedAt
          if (elapsed >= MIN_VISIBLE) settle()
          else this.hold = setTimeout(settle, MIN_VISIBLE - elapsed)
        }
      },
    }
  }

  private emit(): void {
    const s = this.status()
    for (const fn of this.listeners) fn(s)
  }

  /**
   * How long to wait for somebody else's context before installing ours.
   *
   * Bridges are late. An extension relaying to a desktop client, or a host
   * browser wiring up its own agent, generally injects `document.modelContext`
   * after the page has loaded. Installing the polyfill the instant we find the
   * property missing wins that race and then loses the point of it: our tools
   * end up registered into a context with no transport behind it, the real
   * bridge arrives to find the property taken, and the page truthfully reports
   * that nothing is connected while an agent sits there with no tools.
   */
  private static GRACE_MS = 1400

  async mount(): Promise<void> {
    if (this.mounted) return
    if (typeof document === 'undefined') return
    this.mounted = true

    if (!existing()) await wait(ToolSurface.GRACE_MS)

    const provided = existing()
    if (!provided) {
      try {
        initializeWebMCPPolyfill()
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      }
      // The polyfill does not always take. In at least one agent browser it
      // installed nothing and left the page reporting that a studio full of
      // working tools had none, which is a silly way to fail. Our own context
      // is small and always available, so there is no reason to be at the
      // mercy of that.
      if (!existing()) {
        const own = ensureModelContext()
        if (own.error) this.error = own.error
      }
    }

    const context = existing()
    if (!context) {
      this.transport = 'none'
      this.error ??= 'Could not install document.modelContext on this page.'
      this.emit()
      this.watch()
      return
    }

    await this.adopt(context, provided ? classify(context) : 'local')
    this.watch()

    // Keep the toolbox in step with the studio.
    studio.subscribe(() => {
      this.scheduleSync()
    })
    this.emit()
  }

  /** Register the whole toolbox into a context, whichever one turned up. */
  private async adopt(context: ModelContextLike, transport: SurfaceTransport): Promise<void> {
    this.context = context
    this.transport = transport
    this.key = ''
    await this.registerCore()
    this.key = surfaceKey()
    await this.rebuildContextual()
    this.emit()
  }

  /**
   * Watch for somebody better turning up.
   *
   * Even with the grace period a bridge can attach late, and when it does the
   * tools have to move across to it. Cheap to check and the alternative is an
   * agent staring at an empty toolbox.
   */
  private watch(): void {
    if (this.watching) return
    this.watching = true
    const startedAt = Date.now()
    const tick = async () => {
      const live = existing()
      if (live && live !== this.context) {
        await this.adopt(live, classify(live))
      } else if (!this.context && live) {
        await this.adopt(live, classify(live))
      }
      // Attentive for the first minute, then just occasionally.
      setTimeout(tick, Date.now() - startedAt < 60000 ? 1000 : 8000)
    }
    setTimeout(tick, 1000)
  }

  private async registerCore(): Promise<void> {
    const context = this.context
    if (!context) return
    this.core?.abort()
    this.core = new AbortController()
    for (const tool of coreTools()) {
      try {
        await context.registerTool(this.observed(tool) as never, { signal: this.core.signal })
      } catch (err) {
        this.error = `Could not register ${tool.name}: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    this.refreshNames()
  }

  /**
   * Queue a rebuild of the state-dependent half of the toolbox.
   *
   * Deferred to a fresh task on purpose. Some of these tools change the very
   * state that decides whether they exist. `undo` flips whether there is
   * anything left to undo, `clear_sheet` empties the sheet it needs in order to
   * be offered. Rebuilding synchronously inside the store notification would
   * abort the registration of the tool that is still running, and the browser
   * fails the in-flight call. Letting the call settle first costs a tick and
   * makes self-modifying tools safe.
   */
  private scheduleSync(): void {
    const next = surfaceKey()
    if (next === this.key && this.contextual) return
    this.key = next
    if (this.syncQueued) return
    this.syncQueued = true
    setTimeout(() => {
      this.syncQueued = false
      void this.rebuildContextual()
    }, 0)
  }

  private rebuildContextual(): Promise<void> {
    // Serialise: registrations are async, and two overlapping rebuilds would
    // race on the tool names.
    this.pending = this.pending.then(async () => {
      const context = this.context
      if (!context) return
      this.contextual?.abort()
      this.contextual = new AbortController()
      for (const tool of contextualTools()) {
        try {
          await context.registerTool(this.observed(tool) as never, {
            signal: this.contextual.signal,
          })
        } catch {
          // A tool name colliding with a still-unwinding abort is not fatal.
        }
      }
      this.refreshNames()
      this.emit()
    })
    return this.pending
  }

  private refreshNames(): void {
    this.names = [...coreTools(), ...contextualTools()].map((t) => t.name)
  }
}

export const toolSurface = new ToolSurface()
