import {
  addPolygon,
  boundsOf,
  buildOutline,
  decimate,
  deform,
  expand,
  makeRng,
  sampleSubpaths,
  tracePolygon,
  type Point,
} from './geometry'
import { getPigment, hexToRgb, type Pigment } from './palette'
import {
  BRUSHES,
  CANVAS_H,
  CANVAS_W,
  PAPERS,
  type Layer,
  type PaperKind,
  type Scene,
  type Stroke,
} from './types'

/* ------------------------------------------------------------------ *
 * Tuning
 *
 * Every constant here was set by rendering a test sheet and looking at it.
 * The named groups map onto real behaviours of the medium.
 * ------------------------------------------------------------------ */

const TUNING = {
  /** Centreline samples used to build the brush footprint. */
  centreSamples: 34,
  /** Independent pigment layers stamped per stroke. */
  stampsDry: 8,
  stampsWet: 18,
  /** Alpha of a single stamp before pigment/opacity weighting. */
  stampAlpha: 0.168,
  /** Fractal edge roughness. */
  roughDry: 0.09,
  roughWet: 0.4,
  /** How far the wettest stamps creep past the brush footprint. */
  spread: 0.26,
  /** Each stamp drifts a little; this is what stops interiors reading flat. */
  drift: 4.5,
  /** Strength of the dark rim left by a drying wash. */
  edgeDarken: 1.5,
  /** Pigment settling into the paper tooth. */
  granulation: 0.9,
  /** Water pushing dried pigment outward into a cauliflower. */
  bloom: 0.85,
  /**
   * Size of one granulation tile in sheet units.
   *
   * The stroke buffer is drawn through a scaled context, so a 256px tile would
   * otherwise stretch across a quarter of the sheet and read as camouflage.
   * This pulls it back to the scale of actual pigment settling in paper tooth.
   */
  grainSpan: 58,
  /** Same, for the tooth of the blank sheet, in device pixels. */
  paperSpan: 74,
}

/** A repeating pattern scaled so its features are the size we actually want. */
function scaledPattern(
  ctx: CanvasRenderingContext2D,
  tile: HTMLCanvasElement,
  span: number,
  rotation = 0,
): CanvasPattern | null {
  const pattern = ctx.createPattern(tile, 'repeat')
  if (!pattern) return null
  const k = span / tile.width
  const cos = Math.cos(rotation) * k
  const sin = Math.sin(rotation) * k
  try {
    pattern.setTransform(new DOMMatrix([cos, sin, -sin, cos, 0, 0]))
  } catch {
    // Older engines without CanvasPattern.setTransform still get a valid, if
    // coarser, texture rather than nothing.
  }
  return pattern
}

/* ------------------------------------------------------------------ *
 * Textures
 * ------------------------------------------------------------------ */

/** Multi-octave value noise on a wrapping lattice. */
function noiseTile(
  size: number,
  octaves: Array<[freq: number, weight: number, seed: number]>,
  contrast: (n: number) => number,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)

  const samplers = octaves.map(([freq, weight, seed]) => {
    const rng = makeRng(seed)
    const grid = new Float32Array(freq * freq)
    for (let i = 0; i < grid.length; i++) grid[i] = rng()
    const at = (ix: number, iy: number) =>
      grid[(((iy % freq) + freq) % freq) * freq + (((ix % freq) + freq) % freq)]
    return {
      weight,
      sample(x: number, y: number) {
        const fx = (x / size) * freq
        const fy = (y / size) * freq
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const tx = fx - x0
        const ty = fy - y0
        const sx = tx * tx * (3 - 2 * tx)
        const sy = ty * ty * (3 - 2 * ty)
        const a = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx
        const b = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx
        return a * (1 - sy) + b * sy
      },
    }
  })

  const total = samplers.reduce((s, o) => s + o.weight, 0)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0
      for (const o of samplers) n += o.sample(x, y) * o.weight
      const v = Math.round(255 * Math.max(0, Math.min(1, contrast(n / total))))
      const i = (y * size + x) * 4
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }

  ctx.putImageData(img, 0, 0)
  return c
}

let paperTile: HTMLCanvasElement | null = null
let granTile: HTMLCanvasElement | null = null

/** Fine, low-contrast tooth for the blank sheet. */
function getPaperTile(): HTMLCanvasElement {
  paperTile ??= noiseTile(
    256,
    [
      [18, 0.44, 1337],
      [46, 0.34, 90210],
      [110, 0.22, 55555],
    ],
    (n) => 0.8 + n * 0.2,
  )
  return paperTile
}

/**
 * Coarse, high-contrast clumping for granulation.
 *
 * Granulating pigments such as ultramarine, cerulean and burnt sienna are made of
 * comparatively heavy particles that sink into the valleys of the paper before
 * the water evaporates. The result is not fine grain but visible mottling, so
 * this tile is deliberately low-frequency and hard-contrasted.
 */
function getGranulationTile(): HTMLCanvasElement {
  // Deliberately no low-frequency octave. Broad variation across a wash comes
  // from the tonal gradient and the drift between stamps; if it came from a
  // repeating tile instead, the repeat itself becomes visible as a grid.
  granTile ??= noiseTile(
    256,
    [
      [14, 0.4, 8080],
      [34, 0.36, 31337],
      [88, 0.24, 6161],
    ],
    (n) => {
      // Push toward clumps: dark where pigment settles, clear where it does not.
      const s = Math.max(0, Math.min(1, (n - 0.38) / 0.3))
      return 0.56 + s * s * (3 - 2 * s) * 0.44
    },
  )
  return granTile
}

/** Paint the blank sheet: base tone, tooth, and a whisper of cockling. */
export function renderPaper(
  ctx: CanvasRenderingContext2D,
  paper: PaperKind,
  w: number,
  h: number,
): void {
  const spec = PAPERS[paper]
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = spec.base
  ctx.fillRect(0, 0, w, h)

  const pattern = scaledPattern(ctx, getPaperTile(), TUNING.paperSpan)
  if (pattern) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = 0.1 + spec.grain * 0.16
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, w, h)
  }

  // Paper never dries perfectly flat, so the corners take the faintest shading.
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = 1
  const vignette = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.34,
    w / 2, h / 2, Math.max(w, h) * 0.8,
  )
  vignette.addColorStop(0, 'rgba(255,255,255,0)')
  vignette.addColorStop(1, 'rgba(190,175,150,0.22)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)

  ctx.restore()
}

/* ------------------------------------------------------------------ *
 * Strokes
 * ------------------------------------------------------------------ */

export interface StrokeContext {
  wetness: number
  tooth: number
}

let scratch: HTMLCanvasElement | null = null
let scratchCtx: CanvasRenderingContext2D | null = null

function getScratch(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  if (!scratch || scratch.width !== w || scratch.height !== h) {
    scratch = document.createElement('canvas')
    scratch.width = w
    scratch.height = h
    scratchCtx = scratch.getContext('2d')
  }
  return [scratch, scratchCtx!]
}

/**
 * Render one stroke.
 *
 * Built up in a scratch buffer as a stack of independently deformed polygons,
 * each one a notional layer of pigment dropping out of suspension, then
 * composited onto the sheet in a single multiply. Doing the build-up off-sheet
 * means the wash darkens correctly where it laps over itself without the
 * intermediate stamps reacting with the paint already down.
 */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  context: StrokeContext,
  scaleX: number,
  scaleY: number,
): void {
  const rawRuns = sampleSubpaths(stroke.path, 4)
  if (rawRuns.length === 0) return

  const brush = BRUSHES[stroke.kind]
  const pigment = getPigment(stroke.pigment)
  const water = clamp01(stroke.water)
  const pressure = clamp01(stroke.pressure)
  const wetness = clamp01(context.wetness)
  const filled = stroke.fill === true

  const span = rawRuns.reduce((t, r) => t + pathSpan(r), 0)
  const targetStep = Math.max(2.5, span / TUNING.centreSamples)
  const runs = rawRuns
    .map((r) => decimate(r, targetStep))
    .filter((r) => r.length >= (filled ? 3 : 2))
  if (runs.length === 0) return

  const allPoints = runs.flat()
  const halfWidth = (brush.baseWidth * (0.34 + pressure * 0.92)) / 2

  // Water and a wet ground loosen the edge; staining pigments tighten it.
  const rough =
    (TUNING.roughDry + water * (TUNING.roughWet - TUNING.roughDry)) *
      (1 + wetness * 0.75) *
      (1 - pigment.staining * 0.3) +
    brush.chatter * 0.1

  const stamps = Math.round(
    TUNING.stampsDry + water * (TUNING.stampsWet - TUNING.stampsDry),
  )
  const spread = TUNING.spread * (0.2 + water * 0.8 + wetness * 0.5)
  const radius = spanRadius(allPoints)
  // A big wash pools further than a small one, so drift scales with the mark.
  const drift =
    TUNING.drift * (0.2 + water * 0.8) * (filled ? 1 + Math.min(2.6, radius / 55) : 1)
  // Absolute ceiling on how far any one edge may wander.
  const maxDisp = filled
    ? Math.max(5, Math.min(24, radius * 0.16))
    : Math.max(3, halfWidth * 0.8)

  const [rgb, alpha] = pigmentInk(pigment, stroke)
  const falloff = 1.4 + (1 - water) * 2.5

  const reach = filled
    ? spanRadius(allPoints) * spread + drift + 14
    : halfWidth * (1 + spread) + rough * halfWidth * 4 + drift + 12
  const dev = boundsOf(allPoints, reach)
  const px = {
    x: Math.max(0, Math.floor(dev.x * scaleX) - 2),
    y: Math.max(0, Math.floor(dev.y * scaleY) - 2),
    w: Math.min(ctx.canvas.width, Math.ceil(dev.w * scaleX) + 4),
    h: Math.min(ctx.canvas.height, Math.ceil(dev.h * scaleY) + 4),
  }
  if (px.w <= 0 || px.h <= 0) return

  const [buf, bctx] = getScratch(ctx.canvas.width, ctx.canvas.height)
  bctx.setTransform(1, 0, 0, 1, 0, 0)
  bctx.globalCompositeOperation = 'source-over'
  bctx.globalAlpha = 1
  bctx.clearRect(px.x, px.y, px.w, px.h)
  bctx.save()
  bctx.beginPath()
  bctx.rect(px.x, px.y, px.w, px.h)
  bctx.clip()
  bctx.scale(scaleX, scaleY)

  bctx.globalCompositeOperation = 'multiply'
  bctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
  bctx.strokeStyle = bctx.fillStyle

  const jitter = makeRng(stroke.seed ^ 0x9e37)
  let widest: Point[][] = []
  let rimPolys: Point[][] | null = null

  /** One layer of pigment: every subpath deformed and laid down together. */
  const stampPolys = (t: number, index: number): Point[][] => {
    const out: Point[][] = []
    for (let r = 0; r < runs.length; r++) {
      let poly = filled
        ? expand(runs[r], 1 + spread * t)
        : buildOutline(runs[r], halfWidth * (1 + spread * t), stroke.kind)
      if (poly.length < 3) continue

      // Coarse wobble is shared so the stamps read as one wash...
      const coarse = makeRng(stroke.seed + r * 31)
      poly = deform(poly, rough * 0.5, coarse, maxDisp)
      // ...fine detail diverges, so they never stack into a hard vector edge.
      const fine = makeRng(stroke.seed + r * 31 + 977 * (index + 1))
      poly = deform(poly, rough * 0.72, fine, maxDisp * 0.6)
      poly = deform(poly, rough * 0.9, fine, maxDisp * 0.32)
      out.push(poly)
    }
    return out
  }

  for (let i = 0; i < stamps; i++) {
    const t = stamps === 1 ? 0 : i / (stamps - 1)
    const polys = stampPolys(t, i)
    if (polys.length === 0) continue

    // A little drift per layer. Without this the interior reads dead flat;
    // with it, the wash pools unevenly the way a real one does.
    const dx = (jitter() - 0.5) * drift
    const dy = (jitter() - 0.5) * drift

    bctx.save()
    bctx.translate(dx, dy)
    bctx.globalAlpha = alpha * (1 - t * 0.5)
    bctx.beginPath()
    for (const poly of polys) addPolygon(bctx, poly)
    // evenodd so a path that encloses a hole paints a ring, not a disc.
    bctx.fill('evenodd')
    bctx.restore()

    if (t > 0.62 && !rimPolys) rimPolys = polys
    widest = polys
  }

  // Edge darkening. As a wash dries, water evaporates fastest at the perimeter
  // and drags pigment with it, leaving the rim darker than the pool. It is the
  // single most recognisable signature of the medium, so it is worth several
  // concentric passes rather than one hairline.
  // Edge darkening needs pigment to darken with. A very dilute wash has almost
  // none left to migrate, which is exactly why a background wash reads as
  // atmosphere and a loaded one reads as a shape with a hard rim.
  const load = clamp01(stroke.opacity)
  const rim =
    TUNING.edgeDarken *
    (0.3 + water * 0.7) *
    (1 - pigment.staining * 0.35) *
    (0.18 + load * 0.82)
  if (rim > 0.02 && rimPolys) {
    bctx.lineJoin = 'round'
    bctx.lineCap = 'round'
    const band = (1.5 + water * 4) * (filled ? 1.4 : 1)
    for (const [scale, weight] of [[1, 0.35], [0.62, 0.55], [0.34, 0.9], [0.16, 1]] as const) {
      bctx.globalAlpha = Math.min(0.6, alpha * rim * weight)
      bctx.lineWidth = band * scale
      bctx.beginPath()
      for (const poly of rimPolys) addPolygon(bctx, poly)
      bctx.stroke()
    }
  }

  // Granulation: heavy particles drop into the valleys of the tooth.
  // Same reasoning: no pigment in suspension, nothing to settle into the tooth.
  const gran = pigment.granulation * context.tooth * TUNING.granulation * (0.2 + load * 0.8)
  if (gran > 0.06 && widest.length) {
    // Each mark gets its own grain orientation, so the tile never lines up
    // with its neighbours into a visible weave.
    const grainAngle = makeRng(stroke.seed ^ 0x6a11)() * Math.PI * 2
    const pattern = scaledPattern(bctx, getGranulationTile(), TUNING.grainSpan, grainAngle)
    if (pattern) {
      bctx.save()
      bctx.beginPath()
      for (const poly of widest) addPolygon(bctx, poly)
      bctx.clip('evenodd')
      bctx.globalCompositeOperation = 'multiply'
      bctx.globalAlpha = Math.min(0.85, gran * (0.45 + water * 0.55))
      bctx.fillStyle = pattern
      const b = boundsOf(widest.flat(), 6)
      bctx.fillRect(b.x, b.y, b.w, b.h)
      bctx.restore()
    }
  }

  // Gravity and an uneven drying front leave one side of a wash deeper than the
  // other. Without this a flooded shape reads as a flat vector fill however
  // ragged its edge is.
  if (widest.length) {
    const rng = makeRng(stroke.seed ^ 0x9a17)
    const b = boundsOf(widest.flat())
    const angle = rng() * Math.PI * 2
    const grad = bctx.createLinearGradient(
      b.x + b.w / 2 - (Math.cos(angle) * b.w) / 2,
      b.y + b.h / 2 - (Math.sin(angle) * b.h) / 2,
      b.x + b.w / 2 + (Math.cos(angle) * b.w) / 2,
      b.y + b.h / 2 + (Math.sin(angle) * b.h) / 2,
    )
    const depth = Math.min(0.5, alpha * 2.4 * (0.4 + water * 0.6))
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`)
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${depth.toFixed(3)})`)
    bctx.save()
    bctx.beginPath()
    for (const poly of widest) addPolygon(bctx, poly)
    bctx.clip('evenodd')
    bctx.globalCompositeOperation = 'multiply'
    bctx.globalAlpha = 1
    bctx.fillStyle = grad
    bctx.fillRect(b.x, b.y, b.w, b.h)
    bctx.restore()
  }

  // Blooms. Drop clean water into a wash that has begun to set and it shoves
  // the pigment outward into a pale cauliflower. Lifting pigment back out of
  // the buffer is exactly what destination-out does.
  if (water > 0.62 && widest.length) {
    applyBloom(bctx, widest.flat(), stroke.seed, water, TUNING.bloom)
  }

  // A dry brush skips across the tooth instead of flooding it.
  if (stroke.kind === 'dry') {
    for (const run of runs) applySkip(bctx, run, halfWidth, stroke.seed)
  }

  bctx.restore()

  // One composite onto the sheet. Multiply, because watercolour is subtractive:
  // paint laid over paint filters the light twice.
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = 1
  ctx.drawImage(buf, px.x, px.y, px.w, px.h, px.x, px.y, px.w, px.h)
  ctx.restore()
}

/** Lift pigment back out of a wet wash to leave a pale cauliflower edge. */
function applyBloom(
  bctx: CanvasRenderingContext2D,
  poly: Point[],
  seed: number,
  water: number,
  strength: number,
): void {
  const rng = makeRng(seed ^ 0xb100)
  const b = boundsOf(poly)
  const count = Math.round(1 + rng() * 2 * water)
  bctx.save()
  bctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < count; i++) {
    const cx = b.x + b.w * (0.25 + rng() * 0.5)
    const cy = b.y + b.h * (0.25 + rng() * 0.5)
    const r = Math.min(b.w, b.h) * (0.16 + rng() * 0.24)
    if (r < 3) continue
    const g = bctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    const a = strength * (water - 0.6) * 1.4
    g.addColorStop(0, `rgba(0,0,0,${Math.min(0.8, a).toFixed(3)})`)
    g.addColorStop(0.55, `rgba(0,0,0,${Math.min(0.5, a * 0.55).toFixed(3)})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    bctx.globalAlpha = 1
    bctx.fillStyle = g
    bctx.beginPath()
    bctx.ellipse(cx, cy, r, r * (0.7 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2)
    bctx.fill()
  }
  bctx.restore()
}

/**
 * Break the stroke up along its own direction so a dry brush reads as a brush
 * skipping over the tooth rather than as scattered noise.
 */
function applySkip(
  bctx: CanvasRenderingContext2D,
  centre: Point[],
  halfWidth: number,
  seed: number,
): void {
  const rng = makeRng(seed ^ 0x5eed)
  bctx.save()
  bctx.globalCompositeOperation = 'destination-out'
  bctx.lineCap = 'butt'

  // Fine channels parallel to the travel of the brush, standing in for the gaps between the
  // hairs. Many thin lanes read as tooth; a few fat ones read as worms.
  const lanes = Math.max(6, Math.round(halfWidth / 1.1))
  const laneWidth = (halfWidth * 2) / lanes
  for (let lane = 0; lane < lanes; lane++) {
    if (rng() < 0.52) continue
    const offset = ((lane + 0.5) / lanes - 0.5) * 2 * halfWidth
    bctx.lineWidth = laneWidth * (0.35 + rng() * 0.5)
    bctx.globalAlpha = 0.2 + rng() * 0.5
    bctx.beginPath()
    let drawing = false
    for (let i = 0; i < centre.length; i++) {
      const prev = centre[Math.max(0, i - 1)]
      const next = centre[Math.min(centre.length - 1, i + 1)]
      let dx = next.x - prev.x
      let dy = next.y - prev.y
      const len = Math.hypot(dx, dy) || 1
      dx /= len
      dy /= len
      // Taper the lanes in from the ends so the stroke keeps its silhouette.
      const t = centre.length > 1 ? i / (centre.length - 1) : 0
      const inset = Math.min(1, Math.sin(Math.PI * t) * 2.2)
      const x = centre[i].x - dy * offset * inset
      const y = centre[i].y + dx * offset * inset
      if (rng() < 0.3) {
        drawing = false
        continue
      }
      if (!drawing) {
        bctx.moveTo(x, y)
        drawing = true
      } else {
        bctx.lineTo(x, y)
      }
    }
    bctx.stroke()
  }
  bctx.restore()
}

/** Convert pigment properties plus stroke settings into ink colour and alpha. */
function pigmentInk(
  pigment: Pigment,
  stroke: Stroke,
): [[number, number, number], number] {
  const rgb = hexToRgb(pigment.hex)
  const load = clamp01(stroke.opacity)
  const water = clamp01(stroke.water)

  // Dilution lifts the masstone toward the paper rather than fading it out.
  // watercolour gets lighter by carrying less pigment, not by going transparent.
  const dilute = 0.03 + water * 0.26 * (1 - load)
  const lifted: [number, number, number] = [
    Math.round(rgb[0] + (255 - rgb[0]) * dilute),
    Math.round(rgb[1] + (255 - rgb[1]) * dilute),
    Math.round(rgb[2] + (255 - rgb[2]) * dilute),
  ]

  const alpha =
    (TUNING.stampAlpha *
      (0.5 + pigment.density * 0.7) *
      (0.25 + load * 1.0)) /
    (1 + water * 0.4)

  return [lifted, alpha]
}

function pathSpan(pts: Point[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return total
}

function spanRadius(pts: Point[]): number {
  const b = boundsOf(pts)
  return Math.max(b.w, b.h) / 2
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))
}

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */

/** Strokes in paint order: layer stacking first, then time within a layer. */
export function paintOrder(scene: Scene): Stroke[] {
  const order = new Map(scene.layers.map((l, i) => [l.id, i]))
  const visible = new Map(scene.layers.map((l) => [l.id, l.visible !== false]))
  return scene.strokes
    .filter((s) => visible.get(s.layerId) !== false)
    .slice()
    .sort((a, b) => {
      const la = order.get(a.layerId) ?? 0
      const lb = order.get(b.layerId) ?? 0
      if (la !== lb) return la - lb
      return a.createdAt - b.createdAt
    })
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  deviceW: number,
  deviceH: number,
): void {
  const scaleX = deviceW / CANVAS_W
  const scaleY = deviceH / CANVAS_H
  renderPaper(ctx, scene.paper, deviceW, deviceH)

  const tooth = PAPERS[scene.paper].tooth
  const byLayer = new Map<string, Layer>(scene.layers.map((l) => [l.id, l]))

  for (const stroke of paintOrder(scene)) {
    const layer = byLayer.get(stroke.layerId)
    renderStroke(ctx, stroke, { wetness: layer?.wetness ?? 0, tooth }, scaleX, scaleY)
  }
}
