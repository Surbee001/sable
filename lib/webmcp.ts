import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill'
import { ensureModelContext } from './fallback-context'
import { boundsOf, isFaceted, isValidPath, relaxPath, samplePath, scalePath } from './geometry'
import { PIGMENTS, SCHEMES, findScheme, getPigment, resolvePigment } from './palette'
import { assess } from './assess'
import { SCORES, findScore, type DuetPart } from './duet'
import { describeOpen, reportOn } from './medium'
import { decodeShare, shareLink } from './persist'
import { wetField } from './wetfield'
import { perceive } from './perceive'
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
      '0.85 floods, spreads well past the path and dries with almost no edge.',
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
  width: {
    type: 'number',
    description:
      'Width of the mark in sheet units, overriding the brush size. A liner is about 7 and a mop ' +
      'about 92, so this is the whole range between them and past both ends. Ignored on a fill.',
  },
  lift: {
    type: 'boolean',
    description:
      'Take pigment off instead of putting it on. The mark is made exactly as any other is, with ' +
      'the same soft edge and the same spread, but it pulls the passage back toward bare paper ' +
      'and can never darken anything. This is how mist is made, how a cloud gets its light side, ' +
      'and how a highlight is recovered from a wash that has closed over it. Nothing else in this ' +
      'studio can make a passage lighter.',
  },
  grade: {
    type: 'object',
    description:
      'Make the wash different at one end from the other. One flat colour across a large area is ' +
      'the clearest sign a wash was computed rather than poured, and a sky is never one colour. ' +
      'Use it on anything big.',
    properties: {
      angle: {
        type: 'number',
        description: 'Which way the change runs, in degrees. 0 points right, 90 points down. Default 90.',
      },
      pigment: {
        type: 'string',
        description:
          'A second pigment to run toward, so the wash is variegated rather than merely graded. ' +
          'Omit to fade the first pigment instead.',
      },
      fade: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'How much weaker the far end is. 0 keeps full strength, 1 fades to nothing.',
      },
    },
  },
  spatter: {
    type: 'object',
    description:
      'Knock pigment off the brush into this shape instead of drawing with it. The path becomes a ' +
      'region to spatter into. This is the only granular thing in the studio: shingle, gravel, the ' +
      'outer leaves of a tree, sparkle on broken water, grit at the front of a landscape. Use it ' +
      'sparingly and near the viewer, because texture reads as close.',
    properties: {
      density: { type: 'number', description: 'Specks per ten thousand square units. 10 is sparse, 40 usual, 150 heavy.' },
      size: { type: 'number', description: 'Average speck radius in sheet units. Default 3.' },
    },
  },
  charge: {
    type: 'array',
    description:
      'Drop a second colour into this wash while it is still flowing. Not the same as painting ' +
      'another mark on top: a charged wash is ONE wash, so the colours meet in the water and there ' +
      'is no boundary anywhere. It is how a sky goes warm in one corner without anything in it ' +
      'looking like a shape, and how a single wash carries two greens. A second mark, however soft, ' +
      'always brings its own edge and its own drying rim.',
    items: {
      type: 'object',
      properties: {
        pigment: { type: 'string', description: 'The pigment being dropped in.' },
        x: { type: 'number', description: 'Where, in sheet units. Should be inside the mark.' },
        y: { type: 'number', description: 'Where, in sheet units.' },
        spread: { type: 'number', description: 'How far it travels, as a fraction of the mark. Default 0.34.' },
        strength: { type: 'number', description: '0 to 1. Default 0.7.' },
      },
      required: ['pigment', 'x', 'y'],
    },
  },
  softToward: {
    type: 'number',
    description:
      'Which way this mark\'s soft side faces, in degrees, 0 right and 90 down. Left out, the ' +
      'seed decides. Worth setting deliberately across a passage: lost and found edges are how a ' +
      'painting says where the light is, and they only say it when neighbouring shapes agree. ' +
      'Point the soft sides away from your light source and the crisp ones toward it.',
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

/** A plain optional number. Sizes and counts are not 0..1, so `optNum` would maul them. */
function optNumRaw(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
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
  width?: unknown
  lift?: unknown
  grade?: unknown
  spatter?: unknown
  charge?: unknown
  softToward?: unknown
  layer?: unknown
  note?: unknown
}

/** Turn one loosely-typed stroke request into a validated PaintInput. */
/**
 * Faults worth mentioning back to whoever painted the mark.
 *
 * Every other piece of advice in this file is measured and fed back: the
 * palette is counted, the values are compared, the coverage is gridded. The
 * shape of a mark was the one thing only ever asked for in prose, in a tool
 * description read once before the first call and not again. Prose does not
 * survive a blank sheet, so this measures instead.
 */
function toPaintInput(
  raw: RawStroke,
  index: number,
  notes: string[],
): PaintInput | string {
  let path = typeof raw.path === 'string' ? raw.path.trim() : ''
  if (!path) return `stroke ${index + 1}: "path" is required and must be SVG path data.`
  if (!isValidPath(path)) {
    return `stroke ${index + 1}: "${path.slice(0, 60)}" is not valid SVG path data. It must start with M.`
  }

  // A hand drawing on the sheet gets its drag fitted to cubics before it is
  // stored. A path written by hand gets the same, and for the same reason.
  if (isFaceted(path)) {
    const relaxed = relaxPath(path)
    if (isValidPath(relaxed)) {
      path = relaxed
      notes.push(
        `stroke ${index + 1} arrived as straight segments and has been re-cut as curves`,
      )
    }
  }

  const fill = raw.fill === true || raw.fill === 'true'

  // A path that closes is a region. Painted as a centreline it comes out as a
  // ribbon following the outline of the thing instead of the thing itself,
  // which is how a range of hills ends up looking like wire.
  if (!fill && /[Zz]\s*$/.test(path)) {
    notes.push(
      `stroke ${index + 1} closes with Z but fill is false, so it was painted as an outline ` +
        'rather than flooded. Petals, hills and skies are fills',
    )
  }

  // Large and clear of every edge. The single most reliable way a picture built
  // from decent marks still reads as objects arranged on paper.
  const bounds = boundsOf(samplePath(path, 8))
  const big = bounds.w >= CANVAS_W * 0.45 || bounds.h >= CANVAS_H * 0.45
  const floats =
    bounds.x > 2 &&
    bounds.y > 2 &&
    bounds.x + bounds.w < CANVAS_W - 2 &&
    bounds.y + bounds.h < CANVAS_H - 2
  if (big && floats) {
    notes.push(
      `stroke ${index + 1} is large but stops clear of every edge, so it will read as a ` +
        'sticker. Big shapes should start past x -40 and end past 1040',
    )
  }

  let pigment: string | undefined
  if (raw.pigment !== undefined && raw.pigment !== null && raw.pigment !== '') {
    const found = resolvePigment(String(raw.pigment))
    if (!found) {
      return `stroke ${index + 1}: no pigment matches "${String(raw.pigment)}". Call list_palette to see what is on the palette.`
    }
    pigment = found.id
  }

  let grade: PaintInput['grade']
  if (raw.grade && typeof raw.grade === 'object') {
    const g = raw.grade as Record<string, unknown>
    let toward: string | undefined
    if (g.pigment !== undefined && g.pigment !== null && g.pigment !== '') {
      const found = resolvePigment(String(g.pigment))
      if (!found) {
        return `stroke ${index + 1}: no pigment matches "${String(g.pigment)}" in grade. Call list_palette.`
      }
      toward = found.id
    }
    grade = {
      angle: typeof g.angle === 'number' ? g.angle : Number(g.angle) || undefined,
      pigment: toward,
      fade: optNum(g.fade),
    }
  }

  const charge: NonNullable<PaintInput['charge']> = []
  if (Array.isArray(raw.charge)) {
    for (const item of raw.charge) {
      if (!item || typeof item !== 'object') continue
      const c = item as Record<string, unknown>
      const found = resolvePigment(String(c.pigment ?? ''))
      if (!found) {
        return `stroke ${index + 1}: no pigment matches "${String(c.pigment)}" in charge. Call list_palette.`
      }
      const x = Number(c.x)
      const y = Number(c.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return `stroke ${index + 1}: a charge needs x and y in sheet units.`
      }
      charge.push({ pigment: found.id, x, y, spread: optNum(c.spread), strength: optNum(c.strength) })
    }
  }

  return {
    path,
    fill,
    kind: brushOf(raw.brush),
    pigment,
    water: optNum(raw.water),
    pressure: optNum(raw.pressure),
    opacity: optNum(raw.opacity),
    // A width is a measurement in sheet units, so the 0-100 tolerance `num`
    // applies elsewhere would quietly turn a 40-unit brush into 0.4 of one.
    width: Number.isFinite(Number(raw.width)) && Number(raw.width) > 0 ? Number(raw.width) : undefined,
    lift: raw.lift === true || raw.lift === 'true',
    grade,
    spatter: raw.spatter && typeof raw.spatter === 'object'
      ? {
          density: optNumRaw((raw.spatter as Record<string, unknown>).density),
          size: optNumRaw((raw.spatter as Record<string, unknown>).size),
        }
      : undefined,
    charge: charge.length > 0 ? charge : undefined,
    softToward: Number.isFinite(Number(raw.softToward)) ? Number(raw.softToward) : undefined,
    layerId: typeof raw.layer === 'string' && raw.layer ? raw.layer : undefined,
    note: typeof raw.note === 'string' ? raw.note : undefined,
  }
}

/* ------------------------------------------------------------------ *
 * The tool surface
 * ------------------------------------------------------------------ */

interface ToolDef {
  name: string
  /**
   * The readable name, which the WebMCP dictionary puts here rather than in the
   * annotations block where MCP keeps it. This is what a client can show a
   * person in place of a snake-case identifier.
   */
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  /**
   * The annotation block.
   *
   * WebMCP's own dictionary defines two of these, and both matter here.
   * `readOnlyHint` is how a client knows which calls it can make freely, and
   * `untrustedContentHint` says that what comes back was written by somebody
   * other than this page: a painting can now arrive from a link, and the notes
   * on its marks are that person's words travelling into a model's context.
   * Marking the tools that read them is the whole reason the hint exists.
   *
   * The MCP-level hints are carried alongside for clients that read them. A
   * browser implementing only the WebMCP dictionary will drop them, which costs
   * nothing and is the right way round: the standard fields are the ones the
   * behaviour depends on.
   */
  annotations?: {
    readOnlyHint?: boolean
    untrustedContentHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  execute: (input: never) => Promise<ToolResult> | ToolResult
}

/**
 * The rest of each tool's annotation block, kept in one table.
 *
 * A name and a paragraph of prose is what a tool needs to be *called* well. It
 * is not what a client needs to *present* one. A title gives a person something
 * readable in a permission dialog instead of a snake-case identifier, and the
 * destructive and idempotent hints tell a client which calls it may retry, and
 * which two of these take a painting away from somebody and had better be
 * confirmed first.
 *
 * It sits here rather than inline because these are properties of the toolbox
 * seen as a whole. Deciding tool by tool which ones are destructive is how a
 * manifest ends up with three of them and a fourth that quietly is not.
 */
const TITLES: Record<string, string> = {
  look_at_canvas: 'Look at the sheet',
  inspect_region: 'Look closely at one passage',
  squint: 'Squint at it',
  read_painting: 'Read every mark',
  assess_painting: 'What the painting needs next',
  paint: 'Paint',
  revise_stroke: 'Revise marks already down',
  transform_strokes: 'Move and resize marks',
  lift_strokes: 'Lift marks off the sheet',
  undo: 'Undo',
  redo: 'Redo',
  clear_sheet: 'Take everything off the sheet',
  find_strokes: 'Find marks',
  select_strokes: "Point at marks on the human's screen",
  set_brush: "Load the human's brush",
  list_palette: 'Pigments, brushes and papers',
  how_to_paint: 'How a particular thing is painted',
  suggest_palette: 'Suggest a limited palette',
  manage_layers: 'Layers',
  set_sheet: 'Paper and title',
  share_painting: 'Link to this painting',
  open_painting: 'Open a shared painting',
  describe_selection: 'The mark the human is pointing at',
  revise_selection: 'Revise what the human selected',
  duet_start: 'Start a duet',
  duet_status: 'The duet board',
  duet_take_part: 'Take a part',
  duet_finish_part: 'Finish a part',
  duet_release_part: 'Put a part back',
}

/**
 * The hints that are true of a tool but tedious to repeat inline.
 *
 * Kept in one table because these are properties of the toolbox seen whole.
 * Deciding tool by tool which ones are destructive is how a manifest ends up
 * with three of them and a fourth that quietly is not.
 *
 * `untrustedContentHint` goes on everything that can read back a note somebody
 * else wrote. Once a painting can arrive from a link, the notes on its marks are
 * a stranger's prose being handed to a model, and the tools that surface them
 * are exactly these.
 */
const HINTS: Record<string, ToolDef['annotations']> = {
  read_painting: { untrustedContentHint: true },
  find_strokes: { untrustedContentHint: true },
  describe_selection: { untrustedContentHint: true },
  assess_painting: { untrustedContentHint: true },
  open_painting: { destructiveHint: true, untrustedContentHint: true },
  transform_strokes: { idempotentHint: true },
  lift_strokes: { destructiveHint: true },
  clear_sheet: { destructiveHint: true },
  select_strokes: { idempotentHint: true },
  set_brush: { idempotentHint: true },
  set_sheet: { idempotentHint: true },
  duet_start: { destructiveHint: true },
  duet_release_part: { idempotentHint: true },
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
      name: 'squint',
      description:
        'Look at the painting the way a painter checks one: detail thrown away, colour thrown away, ' +
        'everything collapsed into four flat tones. You get the value structure as an image you can ' +
        'actually see, plus where the weight of the picture sits, where the eye is going to go, and ' +
        'how hard the edges really are.\n\n' +
        'This is not a worse version of look_at_canvas. It answers a different question, and it is the ' +
        'question that decides whether a painting works. A photograph of the sheet shows you what you ' +
        'painted, and every mark in it still looks like the thing you meant, which is exactly why the ' +
        'faults that sink a picture are invisible in one: values all bunched in the middle, no real dark ' +
        'anywhere, the mass of the thing sitting dead centre. Those only show up once the detail is gone.\n\n' +
        'If a study holds together as four grey shapes it will hold together finished. If it does not, ' +
        'no amount of good brushwork will save it, and the fix is always a value, never a detail.\n\n' +
        'Worth calling after the first two or three passes, and again before you decide you are done. ' +
        'The edge and focus readings are measured off the actual paint rather than from what you asked ' +
        'for, so they account for what the water did after it left the brush.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          width: {
            type: 'number',
            description: 'Width of the returned value study in pixels, 240 to 1000. Default 620.',
          },
        },
      },
      execute: (input: { width?: unknown }) => {
        const scene = studio.getScene()
        if (scene.strokes.length === 0) {
          return say('The sheet is blank, so there is nothing to squint at yet.')
        }
        const width = Math.max(240, Math.min(1000, num(input?.width, 620) > 1 ? Number(input?.width) || 620 : 620))
        const read = perceive(scene, width)
        return show(
          [
            'The painting with its detail and colour thrown away, in four values.',
            'Light greys are your lights, the darkest grey is your dark. Judge the shapes, not the marks.',
            '',
            ...read.observations.map((o) => `• ${o}`),
          ].join('\n'),
          read.image,
          {
            values: read.values,
            weight: read.weight,
            edges: read.edges,
            focus: read.focus,
          },
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
        'It measures the sheet rather than describing it, and it measures two different things. ' +
        'From the document: how many pigments are in play, which ninths are untouched, whether the ' +
        'big shapes are anchored to the edges. From the rendered paint itself: the value structure ' +
        'in four bands, where the weight of the picture actually sits, where the eye will actually ' +
        'go, and how hard the edges actually came out once the water had finished with them. It ' +
        'returns the value study rather than a photograph, because the photograph is the thing that ' +
        'hides these faults. It also tells you which passages are still wet.\n\n' +
        'This exists because the failure mode of painting without measuring is always the ' +
        'same: a new hue for every shape, nothing properly dark, every edge equally soft, and ' +
        'a picture that goes flat. Those are not lapses of taste, they are lapses of ' +
        'measurement, and they are all visible in the document.',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const scene = studio.getScene()
        const report = assess(scene)
        // The document knows what was asked for. The pixels know what happened.
        // Anything measurable off the rendered sheet is measured there instead.
        const seen = scene.strokes.length > 0 ? perceive(scene, 620) : null
        const open = wetField.openPatches()

        const text = [
          report.observations.join(' '),
          ...(seen ? ['', 'Squinting at it:', ...seen.observations.map((o) => `  • ${o}`)] : []),
          '',
          describeOpen(open),
          '',
          report.suggestions.length === 1 ? 'What it needs:' : 'What it needs, in order:',
          ...report.suggestions.map((line, i) => `${i + 1}. ${line}`),
        ].join('\n')

        return show(
          text,
          // The value study rather than the photograph: this tool is for
          // judging, and the photograph is the thing that hides the faults.
          seen ? seen.image : snapshotScene(scene),
          {
            ...report,
            ...(seen ? { values: seen.values, weight: seen.weight, edges: seen.edges, focus: seen.focus } : {}),
            stillOpen: open,
          } as unknown as Record<string, unknown>,
        )
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
        'FOUR MOVES THAT ARE NOT MORE MARKS. Reach for these before adding another shape:\n' +
        '  • RESERVE THE LIGHT. A path with a second closed subpath inside it floods the outer ' +
        'shape and leaves the inner one bare, because the fill rule is even-odd. That is how you ' +
        'get a moon, a sunlit roof, a white sail: not by painting them, but by painting round ' +
        'them. Untouched paper is the only true light here and it cannot be put back later.\n' +
        '  • LIFT. Set lift true and the mark takes pigment off instead of putting it on, with the ' +
        'same soft edge everything else has. Mist, the light side of a cloud, a highlight pulled ' +
        'back out of a wash that has already closed. Nothing else in this studio can lighten.\n' +
        '  • GRADE THE BIG WASHES. A large area of one flat colour is the clearest sign a wash was ' +
        'computed. Pass grade with an angle, and either a second pigment to run toward or a fade. ' +
        'A sky is never one colour; neither is a field.\n' +
        '  • POINT THE SOFT EDGES. softToward says which way a mark dissolves. Decide where the ' +
        'light is, then let every shape in the passage go soft away from it and hold its edge ' +
        'toward it. Agreeing about that across several marks is most of what makes a picture read ' +
        'as lit rather than assembled.\n\n' +
        'AND SIZE THE BRUSH. width sets the mark in sheet units, from a 3-unit hair to a 200-unit ' +
        'sweep, rather than picking whichever of the five brushes is least wrong.\n\n' +
        'THE PAINT ANSWERS BACK, and this is what makes this a medium rather than a drawing ' +
        'surface. Every paint call returns what the paint did that you did not ask for: how far ' +
        'past your path it crept, which side of a wash went soft, what ' +
        'granulated, what fused with what. That is not commentary on the result. It is half of the ' +
        'picture, and it is the half you have to reply to.\n' +
        '  • A soft side is not a mistake to paint out. It is a lost edge you now own, and the move ' +
        'is to build around it.\n' +
        '  • A lost edge is not a failure to be crisp. It is the soft side of a form, and it starts ' +
        'working the moment you put one hard edge near it.\n' +
        '  • A mark that fused with the one beneath it has no boundary any more and never will ' +
        'again. Plan around that rather than trying to recover it.\n' +
        'Painting your next intended shape while ignoring that report is specifying outcomes again, ' +
        'which is the thing this studio exists to be an alternative to.\n\n' +
        'THE SHEET IS WET IN PLACES, AND IT DRIES ON A CLOCK. Every result tells you which passages ' +
        'are still open and roughly how many seconds are left in them. Paint into an open passage and ' +
        'the marks fuse and soften; wait, and the same mark lands with a hard edge instead. This is ' +
        'the one decision watercolour has that no other medium does, so make it on purpose: if you ' +
        'want two shapes to become one atmosphere, paint the second NOW, in this pass or the very ' +
        'next. If you want them to stay separate things, let the paper close first.\n\n' +
        'HOW THE PAINT BEHAVES, because the renderer really simulates it:\n' +
        '  • Work light to dark. Layers multiply, so you can always deepen a passage and never lighten one.\n' +
        '  • Water spreads and softens. Above about 0.65 a wash loses its edge almost entirely.\n' +
        '  • Granulating pigments (ultramarine, cerulean, burnt sienna) mottle into the paper. ' +
        'Staining ones (phthalo blue, quinacridone rose) stay smooth and hold a hard edge.\n' +
        '  • Painting into paper that is still wet bleeds outward and fuses. Both the layer and ' +
        'anything painted there recently count as wet.\n' +
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
        'AND SQUINT. After two or three passes call squint, which throws away the detail and the ' +
        'colour and shows you the picture as four flat tones. Every fault that actually sinks a ' +
        'painting is invisible in a photograph of it and obvious in that. If the value study is one ' +
        'grey mush, nothing you paint on top of it will help and the answer is a dark.\n\n' +
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
        const notes: string[] = []
        for (let i = 0; i < list.length; i++) {
          const result = toPaintInput(list[i] ?? {}, i, notes)
          if (typeof result === 'string') return fail(result)
          inputs.push(result)
        }

        const made = studio.paintMany(
          inputs,
          'agent',
          input?.summary || `${inputs.length} stroke${inputs.length === 1 ? '' : 's'}`,
        )
        const scene = studio.getScene()
        // What the paint did on its own. This is the half of watercolour that
        // is not in the instructions, and the half a painter actually replies
        // to, so it goes above the picture rather than below it.
        const medium = reportOn(scene, made.map((s) => s.id))

        return show(
          [
            `Painted ${made.length} mark${made.length === 1 ? '' : 's'}. ` +
              `Ids: ${made.map((s) => s.id).join(', ')}.`,
            ...(notes.length > 0
              ? ['', 'About how these were written:', ...notes.map((n) => `  • ${n}.`)]
              : []),
            ...(medium.lines.length > 0
              ? [
                  '',
                  'WHAT THE PAINT DID, which is not what you asked for and is the point:',
                  ...medium.lines.map((line) => `  • ${line}`),
                ]
              : []),
            '',
            describeOpen(medium.open),
            '',
            'Here is the sheet. Answer what the paint did rather than starting over: ' +
              'a lost edge wants one crisp mark near it, ' +
              'and a passage that is still open will never be this workable again.',
          ].join('\n'),
          snapshotScene(scene),
          {
            painted: made.map((s) => summariseStroke(scene, s)),
            ...(notes.length > 0 ? { notes } : {}),
            medium: medium.events,
            stillOpen: medium.open,
          },
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
          snapshotScene(scene),
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
          snapshotScene(studio.getScene()),
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
          snapshotScene(studio.getScene()),
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
          snapshotScene(studio.getScene()),
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
          snapshotScene(studio.getScene()),
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
          snapshotScene(studio.getScene()),
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
        'How a particular thing is actually built and then painted: the masses it is made of ' +
        'before any paint, then how many washes, in what order, at what strength, and the mistake ' +
        'that subject invites.\n\n' +
        'The first half matters more than the second. A study can have a perfect value structure, ' +
        'a limited palette, soft mass and crisp accents in the right places, and still come out ' +
        'as a cartoon, because nothing was wrong with the painting and there was no drawing under ' +
        'it. Paint cannot rescue a form that was never observed.\n\n' +
        'Call this before painting any recognisable subject, including ones with no recipe: the ' +
        'general method comes back instead, and it is most of the answer.\n\n' +
        'General principles do not survive ' +
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
              'What you are painting: mountain, flower, tree, water, sky, field, animal, bird, ' +
              'figure, building, boat. Plain words work, so "a range of hills", "poppies" and ' +
              '"a sitting hare" all land. Ask even when nothing obviously matches, because the general ' +
              'method comes back, and it is the part that matters. Omit to list everything.',
          },
        },
      },
      execute: (input: { subject?: string }) => {
        const describe = (r: (typeof SUBJECTS)[number]) => ({
          id: r.id,
          name: r.name,
          howItIsBuilt: r.drawing,
          watchOutFor: r.trap,
          passes: r.passes,
        })
        const found = typeof input?.subject === 'string' ? findSubject(input.subject) : null
        if (!found) {
          /**
           * Nothing matched, so say something useful anyway.
           *
           * This used to return a list of names and the advice that "the nearest
           * one is usually a good skeleton", which is a shrug with a full stop
           * on it. An agent that asks how to paint a thing and is told to guess
           * goes and invents geometry, and inventing geometry is exactly where
           * crude pictures come from. The general method is not much shorter
           * than a recipe and it is far better than nothing.
           */
          return say(
            [
              `No worked recipe for that one. There are recipes for: ${SUBJECTS.map((r) => r.name).join(', ')}.`,
              '',
              'The method underneath all of them, which works for anything:',
              '',
              '1. DRAW IT FIRST, in masses. Almost nothing is one shape. Work out the two or three ' +
                'simple masses it is built from, how big they are relative to each other, and where ' +
                'they overlap. Getting that ratio right is what makes a thing recognisable; no ' +
                'amount of good paint rescues a form that was never observed. Detail comes last ' +
                'and does not fix structure.',
              '2. ONE SOFT MASS. Paint the whole subject as a single pale wash, wet into wet, before ' +
                'any part of it is separate from any other part. Vary the colour inside it with ' +
                'charge rather than mixing one flat tone.',
              '3. THE WEIGHT, WHILE IT IS OPEN. One darker wash on the shadow side, laid in before ' +
                'the first closes so there is no boundary between them. This is what turns a flat ' +
                'shape into something with a far side.',
              '4. WAIT. Let the sheet dry. The whole difference between a subject and a stain is ' +
                'that the mass is soft and the accents are crisp, and you cannot have the second ' +
                'on wet paper.',
              '5. FOUR OR FIVE ACCENTS. Load above 0.8, water under 0.3, small. Spend them on ' +
                'structure, where one form turns behind another or where something meets the ' +
                'ground, and not on features. Stop while you still want to add more.',
              '6. LIFT ONE LIGHT, where the light actually falls.',
              '',
              'Ask for the nearest listed subject too: a hare and a mountain share more than they ' +
                'look like they do, because both are three masses at three strengths.',
            ].join('\n'),
            { subjects: SUBJECTS.map(describe) },
          )
        }
        const lines = [
          `${found.name}.`,
          '',
          `HOW IT IS BUILT, before any paint: ${found.drawing}`,
          '',
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
        return show('Sheet updated.', snapshotScene(studio.getScene()))
      },
    },

    {
      name: 'share_painting',
      description:
        'Turn the painting into a link and hand it to the human to send to somebody. What ' +
        'travels in the link is the document, not a picture of it: every mark arrives as a ' +
        'mark, with its pigment, its water, its brush and its path, so whoever opens it can ' +
        'select any of them and change it, or ask you to. That is the whole difference between ' +
        'sending a painting and sending a photograph of one. Give the human the URL exactly as ' +
        'it comes back.',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const scene = studio.getScene()
        if (scene.strokes.length === 0) return fail('The sheet is blank. There is nothing to send.')
        const { url, over } = await shareLink(scene)
        return say(
          `${url}\n\n${scene.strokes.length} marks travel in that link as editable objects.` +
            (over
              ? ' It is long enough that some chat clients will break it across lines, so tell ' +
                'them to paste the whole thing.'
              : ''),
          { url, strokes: scene.strokes.length },
        )
      },
    },

    {
      name: 'open_painting',
      description:
        'Open a painting somebody sent, from a Sable link or from the token after the #p= in ' +
        'one. Every mark in it becomes a live, editable mark on this sheet, so you can be asked ' +
        'to change something in a picture you did not paint. This replaces what is on the sheet ' +
        'now, so ask first unless the human has just given you the link.',
      inputSchema: {
        type: 'object',
        properties: {
          link: {
            type: 'string',
            description: 'The whole URL, or just the token from after #p=.',
          },
        },
        required: ['link'],
      },
      execute: async (input: { link?: string }) => {
        const raw = String(input?.link ?? '').trim()
        if (!raw) return fail('Pass the link.')
        const token = /[#&]p=([A-Za-z0-9\-_]+)/.exec(raw)?.[1] ?? raw
        const scene = await decodeShare(token)
        if (!scene) return fail('That link does not carry a painting this studio can read.')
        studio.loadScene(scene, 'agent', `Opened "${scene.title}" from a link`)
        return show(
          `Opened "${scene.title}". ${scene.strokes.length} marks, all of them editable. ` +
            'Call assess_painting to see what it needs.',
          snapshotScene(studio.getScene()),
        )
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
          snapshotScene(studio.getScene()),
        )
      },
    })
  }

  /* ---------------- the duet ---------------- */

  const duet = studio.getDuet()

  if (!duet) {
    tools.push({
      name: 'duet_start',
      description:
        'Open a score and paint one with the human. A score is a board of named parts of a ' +
        'single picture, laid out in advance with a brief for each. Nobody takes turns: any ' +
        'free part can be claimed by either of you at any moment, so the two of you have to ' +
        'agree out loud about who is doing what. Available: ' +
        SCORES.map((s) => `"${s.id}" (${s.title}, ${s.parts.length} parts, ${s.subtitle})`).join('; ') +
        '. This tapes down a fresh sheet, so ask before you call it if there is work on the ' +
        'current one.',
      inputSchema: {
        type: 'object',
        properties: {
          score: {
            type: 'string',
            enum: SCORES.map((s) => s.id),
            description: SCORES.map((s) => `${s.id}: ${s.blurb}`).join(' '),
          },
        },
        required: ['score'],
      },
      execute: (input: { score?: string }) => {
        const score = findScore(String(input?.score ?? ''))
        if (!score) {
          return fail(`No score called "${String(input?.score)}". Try ${SCORES.map((s) => s.id).join(', ')}.`)
        }
        studio.startDuet(score)
        return show(
          `"${score.title}" is open, on a fresh sheet. ${score.parts.length} parts, none of them ` +
            'taken. Call duet_status to see the board, then take one and paint it. Tell the ' +
            'human which you have taken so they do not start the same one.',
          snapshotScene(studio.getScene()),
        )
      },
    })
  }

  if (duet) {
    const parts = duet.score.parts
    const done = new Set(duet.done)
    const free = studio.freeParts()
    const mine = parts.filter((p) => duet.held[p.id] === 'agent')
    const finished = done.size >= parts.length

    const stateOf = (p: DuetPart): string => {
      if (done.has(p.id)) return 'painted'
      const holder = duet.held[p.id]
      if (holder === 'agent') return 'you have it'
      if (holder === 'human') return 'the human has it'
      const blocked = studio.blockedBy(p)
      if (blocked.length > 0) return `free, but wants ${blocked.map((b) => b.title).join(' and ')} first`
      return 'free'
    }

    tools.push({
      name: 'duet_status',
      description:
        `"${duet.score.title}" is open: ${parts.length} parts of one picture, shared with the ` +
        'human. There are no turns here. This returns the board, which parts are painted, which ' +
        'the human has in hand, which you have, and which are free, with the brief for each and ' +
        'an image of the sheet. Call it before you take anything and again after the human has ' +
        'painted, because your parts sit on marks they made and where they actually put them is ' +
        'not where the score imagined they would.',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const lines = finished
          ? [`"${duet.score.title}" is finished. All ${parts.length} parts are painted.`]
          : [
              `"${duet.score.title}": ${done.size} of ${parts.length} parts painted.`,
              mine.length
                ? `You are holding ${mine.map((p) => `"${p.title}"`).join(' and ')}.`
                : 'You are not holding anything. Take a free part to start.',
              parts
                .map((p) => `  ${p.title} [${stateOf(p)}] ${p.short}`)
                .join('\n'),
            ]
        return show(
          lines.filter(Boolean).join('\n\n'),
          snapshotScene(studio.getScene()),
          {
            score: duet.score.id,
            title: duet.score.title,
            painted: done.size,
            of: parts.length,
            holding: mine.map((p) => p.id),
            parts: parts.map((p) => ({
              id: p.id,
              title: p.title,
              suits: p.by,
              state: stateOf(p),
              brief: p.hint,
              // Where the human is being guided to draw, so you can see what is
              // about to appear and where your own parts will have to sit.
              guides: p.guides ?? undefined,
            })),
          },
        )
      },
    })

    if (!finished && free.length > 0) {
      tools.push({
        name: 'duet_take_part',
        description:
          'Put your hand on one part of the picture, so the human knows not to start it. This ' +
          'is the only coordination in a duet and it is worth doing before you paint rather ' +
          'than after. Free right now: ' +
          free
            .map((p) => {
              const blocked = studio.blockedBy(p)
              return `"${p.id}" (${p.title}, suits the ${p.by}${
                blocked.length ? `, wants ${blocked.map((b) => b.title).join(' and ')} down first` : ''
              })`
            })
            .join('; ') +
          '. A part marked for the human is still yours to take if they have said so; ' +
          'nothing here is locked to one painter.',
          inputSchema: {
          type: 'object',
          properties: {
            part: {
              type: 'string',
              enum: free.map((p) => p.id),
              description: free.map((p) => `${p.id}: ${p.short}`).join(' '),
            },
          },
          required: ['part'],
        },
        execute: (input: { part?: string }) => {
          const claim = studio.takePart(String(input?.part ?? ''), 'agent')
          if (!claim.ok || !claim.part) return fail(claim.why)
          const blocked = studio.blockedBy(claim.part)
          return say(
            `You have "${claim.part.title}".\n\n${claim.part.hint}` +
              (blocked.length
                ? `\n\nNothing stops you, but ${blocked
                    .map((b) => b.title.toLowerCase())
                    .join(' and ')} is not painted yet, and this part is meant to sit on it.`
                : ''),
            { part: claim.part.id, brief: claim.part.hint },
          )
        },
      })
    }

    if (mine.length > 0) {
      const brief = mine.map((p) => `"${p.title}": ${p.hint}`).join('\n\n')
      tools.push({
        name: 'duet_finish_part',
        description:
          `Call a part painted and let it go, so the board shows it done. You are holding ` +
          `${mine.map((p) => `"${p.id}"`).join(' and ')}.\n\n${brief}\n\n` +
          'Paint it with the ordinary paint tool first, looking at the sheet before and after. ' +
          'Do not call this before you have actually put paint down. Then take another free ' +
          'part, or say what you are leaving for the human.',
          inputSchema: {
          type: 'object',
          properties: {
            part: {
              type: 'string',
              enum: mine.map((p) => p.id),
              description: 'Which of the parts you are holding is finished.',
            },
            note: {
              type: 'string',
              description: 'One line for the human on what you did and why.',
            },
          },
          required: ['part'],
        },
        execute: (input: { part?: string; note?: string }) => {
          const part = studio.finishPart(String(input?.part ?? ''), 'agent')
          if (!part) return fail(`You are not holding a part called "${String(input?.part)}".`)
          if (typeof input?.note === 'string' && input.note.trim()) {
            studio.noteFromAgent(input.note.trim())
          }
          const left = studio.freeParts()
          return show(
            `"${part.title}" is done. ` +
              (left.length === 0
                ? 'Every part is off the board. The painting is finished.'
                : `Still free: ${left.map((p) => p.title).join(', ')}.`),
            snapshotScene(studio.getScene()),
          )
        },
      })

      tools.push({
        name: 'duet_release_part',
        description:
          'Put a part back on the board without painting it, so the human can take it instead. ' +
          `You are holding ${mine.map((p) => `"${p.id}"`).join(' and ')}. Use this the moment ` +
          'they say they want one of them.',
          inputSchema: {
          type: 'object',
          properties: {
            part: { type: 'string', enum: mine.map((p) => p.id) },
          },
          required: ['part'],
        },
        execute: (input: { part?: string }) => {
          const id = String(input?.part ?? '')
          if (!studio.releasePart(id, 'agent')) return fail(`You are not holding "${id}".`)
          return say(`Put "${id}" back. It is free for the human now.`)
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
    // A duet's tools carry the board inside their descriptions: which parts are
    // free, which the agent is holding, and the brief for each. All three change
    // the shape of the toolbox, so all three belong in the key.
    duetKey(),
  ].join('|')
}

function duetKey(): string {
  const duet = studio.getDuet()
  if (!duet) return 'no-duet'
  const held = Object.entries(duet.held)
    .map(([id, who]) => `${id}:${who}`)
    .sort()
    .join(',')
  return `duet:${duet.score.id}:${duet.done.slice().sort().join(',')}:${held}`
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
  /**
   * One registration per contextual tool, against what it looked like.
   *
   * The rebuild used to abort the whole contextual batch and then re-register
   * it, which meant that for the length of that loop every one of these tools
   * was missing from `getTools()`. An agent calling two of them back to back
   * lands in that window: taking a part of a duet changes the board, the board
   * is in the description of the tool for taking parts, so the rebuild fires,
   * and the very next call finds nothing to call. Two of nine rapid takes
   * failed exactly that way.
   *
   * Holding a controller per tool means a tool whose definition has not changed
   * is never taken down at all, and the one that did change is unavailable for a
   * single await rather than for a whole batch.
   */
  private slots = new Map<string, { controller: AbortController; print: string }>()
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
      title: tool.title ?? TITLES[tool.name],
      annotations: { ...HINTS[tool.name], ...tool.annotations },
      /**
       * Closed at the top level, which the documented shape of a WebMCP tool
       * includes and none of these bothered to say. Nothing here has ever
       * wanted a property it did not name, so saying so costs nothing and
       * leaves one less thing for a strict validator on the other side to
       * decide about on our behalf.
       */
      inputSchema:
        tool.inputSchema.type === 'object' && tool.inputSchema.additionalProperties === undefined
          ? { ...tool.inputSchema, additionalProperties: false }
          : tool.inputSchema,
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
    // A different context registers nothing yet, so the old slots describe
    // registrations that no longer exist anywhere.
    for (const slot of this.slots.values()) slot.controller.abort()
    this.slots.clear()
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
  /**
   * Watch for somebody better turning up, and stop the moment they have.
   *
   * The reason this exists is the polyfill: on a browser with no WebMCP of its
   * own the page installs a context, and a bridge extension can attach a real
   * one afterwards, at which point the tools have to move across to it. That is
   * a transition out of `local` and nothing else.
   *
   * It used to keep polling forever, comparing `document.modelContext` by
   * identity every second and re-adopting on any change. Against a browser that
   * implements WebMCP itself that is a standing offer to abort and re-register
   * two dozen tools, on a timer, for the life of the page, if that browser ever
   * hands back a different object. Re-registration fires `toolchange`, and a
   * client trying to enumerate the toolbox while it is being torn down and
   * rebuilt is a fault this page would have caused and could not see.
   *
   * So once the context belongs to the browser or to an extension, the page
   * stops touching it. It has what it came for.
   */
  private watch(): void {
    if (this.watching) return
    if (this.transport === 'native' || this.transport === 'bridge') return
    this.watching = true
    const startedAt = Date.now()
    const tick = async () => {
      const live = existing()
      if (live && live !== this.context) {
        await this.adopt(live, classify(live))
      }
      if (this.transport === 'native' || this.transport === 'bridge') {
        this.watching = false
        return
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
    if (next === this.key && this.slots.size > 0) return
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
      const wanted = contextualTools()
      const names = new Set(wanted.map((t) => t.name))

      // Anything that no longer belongs goes first. These are genuinely gone,
      // so there is no window to protect.
      for (const [name, slot] of this.slots) {
        if (!names.has(name)) {
          slot.controller.abort()
          this.slots.delete(name)
        }
      }

      for (const tool of wanted) {
        const print = JSON.stringify([tool.title, tool.description, tool.inputSchema])
        const prev = this.slots.get(tool.name)
        // Unchanged since the last rebuild, so leave it registered. This is the
        // whole point: selecting a mark must not briefly unregister the duet.
        if (prev && prev.print === print) continue

        prev?.controller.abort()
        const controller = new AbortController()
        try {
          await context.registerTool(this.observed(tool) as never, { signal: controller.signal })
          this.slots.set(tool.name, { controller, print })
        } catch {
          // A name colliding with a still-unwinding abort is not fatal, but the
          // slot must not claim a registration that did not happen.
          this.slots.delete(tool.name)
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
