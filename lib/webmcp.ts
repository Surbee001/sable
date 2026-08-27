import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill'
import { isValidPath, scalePath } from './geometry'
import { PIGMENTS, resolvePigment } from './palette'
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
        'Call this before your first mark to see what the human has already done, and again after every pass — ' +
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
        return show(narrateScene(scene), image, { canvas: { width: CANVAS_W, height: CANVAS_H } })
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
      name: 'paint',
      description:
        'Paint one or more watercolour marks. This is the main way to put paint on the sheet.\n\n' +
        `THE SHEET is ${CANVAS_W} wide by ${CANVAS_H} tall, square units, origin top-left.\n\n` +
        'TWO KINDS OF MARK, and choosing right matters more than anything else here:\n' +
        '  fill: false (default) — the path is a centreline the brush travels along. Stems, branches, ' +
        'contours, calligraphic lines.\n' +
        '  fill: true — the path is a closed region flooded with a wash. Petals, leaves, skies, water, ' +
        'anything with area. A petal is a filled shape, not an outlined one. This is the single most ' +
        'common mistake: outlining a form instead of flooding it.\n\n' +
        'HOW THE PAINT BEHAVES, because the renderer really simulates it:\n' +
        '  • Work light to dark. Layers multiply, so you can always deepen a passage and never lighten one.\n' +
        '  • Water spreads and softens. Above about 0.65 a wash blooms into a pale cauliflower.\n' +
        '  • Granulating pigments (ultramarine, cerulean, burnt sienna) mottle into the paper. ' +
        'Staining ones (phthalo blue, quinacridone rose) stay smooth and hold a hard edge.\n' +
        '  • Painting on a wet layer bleeds outward. The lowest layer is the wettest.\n' +
        '  • Leave paper white. Untouched sheet is the only true highlight you get.\n\n' +
        'Pass several strokes at once — a whole passage in one call lands as one undoable action, ' +
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
            `Ids: ${made.map((s) => s.id).join(', ')}. Here is the sheet now — check it before painting more.`,
          snapshotScene(scene, { width: 760 }),
          { painted: made.map((s) => summariseStroke(scene, s)) },
        )
      },
    },

    {
      name: 'revise_stroke',
      description:
        'Change a mark that is already on the sheet, by id, keeping it the same mark. This is the part ' +
        'that a prompt-only image model cannot do: the stroke stays an object, so its water, pigment, ' +
        'pressure or even its path can be changed after the fact without repainting anything around it. ' +
        'Get ids from read_painting.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The stroke id, from read_painting.' },
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
        required: ['id'],
      },
      execute: (input: RawStroke & { id?: string }) => {
        const id = typeof input?.id === 'string' ? input.id : ''
        const existing = studio.getStroke(id)
        if (!existing) return fail(`No stroke with id "${id}". Call read_painting for current ids.`)

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

        const next = studio.update(id, patch, 'agent')
        if (!next) return fail(`Could not revise "${id}".`)
        const scene = studio.getScene()
        return show(
          `Revised ${id}. ${Object.keys(patch).join(', ')} changed.`,
          snapshotScene(scene, { width: 760 }),
          { stroke: summariseStroke(scene, next) },
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
        `Revise exactly what the human currently has selected — ${subject}. ` +
        'Use this instead of revise_stroke when they say "make this wetter", "warm this up", ' +
        '"push that back" — you do not need to look up an id, because they have already pointed at it.',
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

  if (canUndo) {
    tools.push({
      name: 'undo',
      description:
        'Step the whole studio back one action — including the human\'s. One shared history: ' +
        'if a mark you made is wrong, this takes it back off.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        studio.undo('agent')
        return show('Stepped back one action.', snapshotScene(studio.getScene(), { width: 760 }))
      },
    })
  }

  if (canRedo) {
    tools.push({
      name: 'redo',
      description: 'Step the studio forward again, after an undo.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        studio.redo('agent')
        return show('Stepped forward one action.', snapshotScene(studio.getScene(), { width: 760 }))
      },
    })
  }

  if (scene.strokes.length > 0) {
    tools.push({
      name: 'clear_sheet',
      description:
        'Take every mark off the sheet and start again. Destructive, though the human can undo it. ' +
        'Ask before using this on work they painted themselves.',
      inputSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            description: 'Must be true. A guard against clearing someone else\'s painting by accident.',
          },
        },
        required: ['confirm'],
      },
      execute: (input: { confirm?: unknown }) => {
        if (input?.confirm !== true) {
          return fail('Set confirm: true to clear the sheet.')
        }
        studio.clear('agent')
        return say('Sheet cleared.')
      },
    })
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
  ].join('|')
}

export interface SurfaceStatus {
  supported: boolean
  native: boolean
  toolNames: string[]
  error?: string
}

type StatusListener = (status: SurfaceStatus) => void

class ToolSurface {
  private core: AbortController | null = null
  private contextual: AbortController | null = null
  private key = ''
  private mounted = false
  private native = false
  private listeners = new Set<StatusListener>()
  private names: string[] = []
  private error?: string
  private pending: Promise<void> = Promise.resolve()
  private syncQueued = false

  onStatus(fn: StatusListener): () => void {
    this.listeners.add(fn)
    fn(this.status())
    return () => this.listeners.delete(fn)
  }

  status(): SurfaceStatus {
    return {
      supported: this.mounted,
      native: this.native,
      toolNames: this.names,
      error: this.error,
    }
  }

  private emit(): void {
    const s = this.status()
    for (const fn of this.listeners) fn(s)
  }

  async mount(): Promise<void> {
    if (this.mounted) return
    if (typeof document === 'undefined') return

    // Native WebMCP where the browser has it; the polyfill everywhere else, so
    // the same page works in Chrome behind the flag, in ChatGPT's browser, and
    // for anyone who just opens the link.
    this.native = 'modelContext' in document && Boolean(document.modelContext)
    if (!this.native) {
      try {
        initializeWebMCPPolyfill()
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      }
    }

    const context = document.modelContext
    if (!context) {
      this.error ??= 'This browser does not expose document.modelContext.'
      this.emit()
      return
    }

    this.mounted = true
    await this.registerCore()
    this.key = surfaceKey()
    await this.rebuildContextual()

    // Keep the toolbox in step with the studio.
    studio.subscribe(() => {
      this.scheduleSync()
    })
    this.emit()
  }

  private async registerCore(): Promise<void> {
    const context = document.modelContext
    if (!context) return
    this.core?.abort()
    this.core = new AbortController()
    for (const tool of coreTools()) {
      try {
        await context.registerTool(tool as never, { signal: this.core.signal })
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
   * state that decides whether they exist — `undo` flips whether there is
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
      const context = document.modelContext
      if (!context) return
      this.contextual?.abort()
      this.contextual = new AbortController()
      for (const tool of contextualTools()) {
        try {
          await context.registerTool(tool as never, { signal: this.contextual.signal })
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
