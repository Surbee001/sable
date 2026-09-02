import { boundsOf, sampleSubpaths } from './geometry'
import { getPigment } from './palette'
import { BRUSHES, CANVAS_H, CANVAS_W, type Scene, type Stroke } from './types'
import { paintOrder, renderScene } from './watercolor'

/**
 * Rendering the sheet for someone who is not looking at the screen.
 *
 * A tool call that only returns "ok, painted" leaves the agent working blind.
 * it has to imagine the consequence of its own brushwork. Handing back an
 * actual image closes the loop, and it is the difference between an agent that
 * fires off strokes and one that can look, judge, and correct.
 */

let exportCanvas: HTMLCanvasElement | null = null

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  if (!exportCanvas) exportCanvas = document.createElement('canvas')
  if (exportCanvas.width !== w || exportCanvas.height !== h) {
    exportCanvas.width = w
    exportCanvas.height = h
  }
  const ctx = exportCanvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable in this browser')
  return [exportCanvas, ctx]
}

export interface SnapshotOptions {
  /** Longest edge of the returned image, in pixels. */
  width?: number
  quality?: number
}

/**
 * The most base64 any single tool result may carry.
 *
 * There is no way for the page to know what happens to an image content block
 * once it leaves. A client that understands them shows the model a picture; one
 * that does not may put the base64 into its context as text, and forty thousand
 * characters of it is most of a small model's working memory spent on a wash it
 * cannot read. Every image the studio hands out is therefore bounded, and a
 * bound that is occasionally a little soft is a far better failure than one
 * result that swamps the conversation it was meant to inform.
 *
 * Twelve thousand characters is about nine kilobytes of JPEG, which at these
 * sizes is a legible watercolour, because a watercolour is mostly soft edges
 * and there is very little here for the compressor to struggle with.
 */
const MAX_BASE64 = 12000

/**
 * Encode, and if it came out too big, encode again smaller.
 *
 * Quality first, because dropping it costs almost nothing on a soft image, then
 * the dimensions once quality has stopped paying. Bounded to four attempts: the
 * point is a ceiling, not the smallest possible file.
 */
function encodeWithin(
  draw: (w: number, h: number) => HTMLCanvasElement,
  width: number,
  height: number,
  quality: number,
): string {
  let w = width
  let h = height
  let q = quality
  let out = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = draw(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
    out = canvas.toDataURL('image/jpeg', q).split(',')[1] ?? ''
    if (out.length <= MAX_BASE64) return out
    if (attempt === 0) {
      q = 0.6
    } else {
      const shrink = Math.max(0.5, Math.sqrt(MAX_BASE64 / out.length))
      w *= shrink
      h *= shrink
    }
  }
  return out
}

/** Render the whole sheet to a base64 JPEG (no data: prefix). */
export function snapshotScene(scene: Scene, options: SnapshotOptions = {}): string {
  const w = Math.round(options.width ?? 640)
  const h = Math.round((w * CANVAS_H) / CANVAS_W)
  return encodeWithin(
    (cw, ch) => {
      const [canvas, ctx] = canvasOf(cw, ch)
      renderScene(ctx, scene, cw, ch)
      return canvas
    },
    w,
    h,
    options.quality ?? 0.74,
  )
}

/**
 * Render a crop of the sheet, enlarged.
 *
 * Painting is judged at two distances: the whole composition, and the passage
 * you are actually working on. This is the second one.
 */
export function snapshotRegion(
  scene: Scene,
  region: { x: number; y: number; w: number; h: number },
  options: SnapshotOptions = {},
): string {
  const x = clamp(region.x, 0, CANVAS_W)
  const y = clamp(region.y, 0, CANVAS_H)
  const rw = clamp(region.w, 8, CANVAS_W - x)
  const rh = clamp(region.h, 8, CANVAS_H - y)

  // Render the full sheet at a resolution that gives the crop the requested size.
  const target = Math.round(options.width ?? 640)
  const scale = target / rw
  const fullW = Math.round(CANVAS_W * scale)
  const fullH = Math.round(CANVAS_H * scale)

  // Guard against absurdly deep zooms blowing out memory.
  const capped = Math.min(1, 4200 / Math.max(fullW, fullH))
  const w = Math.round(fullW * capped)
  const h = Math.round(fullH * capped)

  const [full, fullCtx] = canvasOf(w, h)
  renderScene(fullCtx, scene, w, h)

  const crop = document.createElement('canvas')
  crop.width = Math.max(1, Math.round(rw * (w / CANVAS_W)))
  crop.height = Math.max(1, Math.round(rh * (h / CANVAS_H)))
  const cropCtx = crop.getContext('2d')
  if (!cropCtx) throw new Error('2D canvas is unavailable in this browser')
  cropCtx.drawImage(
    full,
    Math.round(x * (w / CANVAS_W)),
    Math.round(y * (h / CANVAS_H)),
    crop.width,
    crop.height,
    0, 0, crop.width, crop.height,
  )
  return encodeWithin(
    (cw, ch) => {
      if (cw === crop.width && ch === crop.height) return crop
      const small = document.createElement('canvas')
      small.width = cw
      small.height = ch
      small.getContext('2d')?.drawImage(crop, 0, 0, cw, ch)
      return small
    },
    crop.width,
    crop.height,
    options.quality ?? 0.8,
  )
}

/** Full-resolution PNG for the human to download. */
export function exportPng(scene: Scene, scale = 2): string {
  const w = CANVAS_W * scale
  const h = CANVAS_H * scale
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable in this browser')
  renderScene(ctx, scene, w, h)
  return canvas.toDataURL('image/png')
}

/* ------------------------------------------------------------------ *
 * Describing the sheet in words
 * ------------------------------------------------------------------ */

export interface StrokeSummary {
  id: string
  layer: string
  brush: string
  fill: boolean
  pigment: string
  water: number
  pressure: number
  opacity: number
  author: string
  bounds: { x: number; y: number; w: number; h: number }
  path: string
  note?: string
}

export function summariseStroke(scene: Scene, stroke: Stroke): StrokeSummary {
  const runs = sampleSubpaths(stroke.path, 8)
  const pts = runs.flat()
  const pad = stroke.fill ? 0 : (BRUSHES[stroke.kind].baseWidth * stroke.pressure) / 2
  const b = boundsOf(pts, pad)
  const layer = scene.layers.find((l) => l.id === stroke.layerId)
  return {
    id: stroke.id,
    layer: layer?.name ?? stroke.layerId,
    brush: stroke.kind,
    fill: stroke.fill === true,
    pigment: getPigment(stroke.pigment).name,
    water: round2(stroke.water),
    pressure: round2(stroke.pressure),
    opacity: round2(stroke.opacity),
    author: stroke.author,
    bounds: {
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.w),
      h: Math.round(b.h),
    },
    path: stroke.path,
    note: stroke.note,
  }
}

/** Every stroke on the sheet, in the order it is painted. */
export function describeScene(scene: Scene): {
  title: string
  paper: string
  canvas: { width: number; height: number }
  layers: Array<{ id: string; name: string; visible: boolean; wetness: number; strokes: number }>
  strokes: StrokeSummary[]
} {
  const ordered = paintOrder(scene)
  return {
    title: scene.title,
    paper: scene.paper,
    canvas: { width: CANVAS_W, height: CANVAS_H },
    layers: scene.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      wetness: round2(l.wetness),
      strokes: scene.strokes.filter((s) => s.layerId === l.id).length,
    })),
    strokes: ordered.map((s) => summariseStroke(scene, s)),
  }
}

/** A short prose read of the sheet, for the top of a tool result. */
export function narrateScene(scene: Scene): string {
  const n = scene.strokes.length
  if (n === 0) {
    return `"${scene.title}" is a blank sheet of ${scene.paper} paper, ${CANVAS_W} by ${CANVAS_H} units.`
  }
  const byAuthor = { human: 0, agent: 0 }
  const pigments = new Map<string, number>()
  for (const s of scene.strokes) {
    byAuthor[s.author] += 1
    const name = getPigment(s.pigment).name
    pigments.set(name, (pigments.get(name) ?? 0) + 1)
  }
  const top = [...pigments.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ')

  return [
    `"${scene.title}" on ${scene.paper} paper, ${CANVAS_W} by ${CANVAS_H} units.`,
    `${n} stroke${n === 1 ? '' : 's'}: ${byAuthor.human} painted by the human, ${byAuthor.agent} by an agent.`,
    `Pigments in use: ${top}.`,
    `Layers bottom to top: ${scene.layers.map((l) => l.name).join(' → ')}.`,
  ].join(' ')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
}
