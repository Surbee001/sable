import {
  addPolygon,
  boundsOf,
  buildOutline,
  deform,
  expand,
  expandVarying,
  makeRng,
  resample,
  sampleSubpaths,
  smoothPolyline,
  tracePolygon,
  type Point,
} from './geometry'
import { getPigment, hexToRgb, type Pigment } from './palette'
import {
  BRUSHES,
  CANVAS_H,
  CANVAS_W,
  PAPERS,
  WET,
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
  /**
   * Ceiling on the gap between centreline samples, in sheet units.
   *
   * A sample budget alone is a trap: dividing the length by a fixed count means
   * a long stroke is described by exactly as many points as a short one, so the
   * longer the line, the coarser the polygon that stands in for it. Past a few
   * hundred units the brush footprint becomes a visible chain of flat segments
   * with hard corners where the hand drew a curve. Capping the step instead
   * means fidelity is constant per unit of paper and only the cost grows with
   * the mark, which is the right way round.
   */
  maxCentreStep: 7,
  /** Floor on the same, so a small mark does not turn into a point cloud. */
  minCentreStep: 2.5,
  /**
   * Stamps to use for the mark under the brush right now.
   *
   * The preview is redrawn every frame for as long as the brush is down, so its
   * cost is the one that decides whether drawing feels alive or syrupy. The
   * finished mark is rendered once and can afford the full stack.
   */
  previewStamps: 7,
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
   * Pooling.
   *
   * A wash does not dry to one value. The sheet is never perfectly flat, the
   * water finds the low places, and pigment ends up gathered in some parts of a
   * shape and thin in others. Nothing else in this renderer produces that, and
   * without it a flooded shape is a single uniform colour, which is the
   * clearest possible tell that it was computed rather than poured. Scaled to
   * the mark rather than the sheet, so a petal and a sky both get a handful of
   * pools across them instead of the petal getting a fragment of one.
   */
  pooling: 0.42,
  /** Roughly how many pools across the longest edge of a mark. */
  poolsAcross: 2.6,
  /**
   * Lost and found edges.
   *
   * How much the spread swings between the parts of a perimeter that stayed
   * tight and the parts that dissolved. This is most of what separates a shape
   * that looks painted from one that looks filled, so it is worth rather more
   * than it looks: at zero, every mark in the picture meets the paper the same
   * way all the way round, which no wash has ever done.
   */
  lostEdges: 0.62,
  /**
   * Pigment separation.
   *
   * Real paint is a suspension of particles that do not travel together, so a
   * single wash drifts warmer in one part and cooler in another. Without it
   * every wash is exactly one hue, which is the flattest possible tell that
   * something was computed rather than mixed.
   */
  separation: 16,
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
    // Offset each octave by its own fraction of a cell. The tempting fix for a
    // visible lattice is to rotate the sample coordinates, but the wrap that
    // makes this tile depends on x and y mapping straight onto the lattice, so
    // rotating breaks the seam and every tile edge shows as a hard rectangle.
    // Shifting instead keeps the tile whole and still stops the octaves from
    // lining up their cell boundaries into a weave.
    const shiftX = (freq * 0.61803398875) % 1
    const shiftY = (freq * 0.41421356237) % 1

    return {
      weight,
      sample(x: number, y: number) {
        const fx = (x / size) * freq + shiftX
        const fy = (y / size) * freq + shiftY
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const tx = fx - x0
        const ty = fy - y0
        // Quintic rather than cubic: its second derivative vanishes at the
        // lattice points too, so the cell boundaries stop showing as creases.
        const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
        const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
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
let poolTile: HTMLCanvasElement | null = null

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

/**
 * Broad, soft, high-contrast variation: where the water gathered and where it
 * ran thin. Deliberately low frequency, because this is the shape of a puddle
 * rather than the grain of the paper.
 */
function getPoolTile(): HTMLCanvasElement {
  poolTile ??= noiseTile(
    256,
    [
      [2, 0.5, 20260829],
      [4, 0.3, 771],
      [9, 0.2, 4242],
    ],
    (n) => {
      // Widen the middle so most of the shape sits near its stated value and
      // the pooling reads as a few deep places, not as general noise.
      const s = Math.max(0, Math.min(1, (n - 0.28) / 0.44))
      return 0.34 + s * s * (3 - 2 * s) * 0.66
    },
  )
  return poolTile
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
  /**
   * How far this mark has got into the paper, 0 to 1. Defaults to fully dry.
   *
   * A wash goes on pale and tight, creeps outward into the fibre, deepens, and
   * only pulls its dark rim once it begins to dry. Rendering the finished state
   * immediately is the difference between paint and a decal.
   */
  settle?: number
  /**
   * Centreline already in hand, one array per subpath, in sheet units.
   *
   * The mark being drawn right now exists as points before it exists as a path.
   * Without this the preview converts those points to SVG path data, hands the
   * string to the DOM to parse, and walks it back out with `getPointAtLength`,
   * every frame, over a path that has grown by one more curve since the last
   * one. That round trip costs more the longer the brush stays down, which is
   * precisely when it can least afford to, and it produces the same points it
   * was given. Passing them straight through skips all of it.
   */
  centre?: Point[][]
  /**
   * Draft quality, for a mark that is still under the brush.
   *
   * Drops the passes that cost the most and read the least at this size, and
   * thins the stack of pigment layers. What it must not do is change how dark
   * the mark lands, or lifting the brush would make it jump.
   */
  preview?: boolean
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
  const preview = context.preview === true
  const rawRuns = context.centre ?? sampleSubpaths(stroke.path, 4)
  if (rawRuns.length === 0) return

  const brush = BRUSHES[stroke.kind]
  const pigment = getPigment(stroke.pigment)
  const water = clamp01(stroke.water)
  const pressure = clamp01(stroke.pressure)
  const wetness = clamp01(context.wetness)
  const filled = stroke.fill === true

  const span = rawRuns.reduce((t, r) => t + pathSpan(r), 0)
  // Fidelity per unit of paper, not per stroke: see TUNING.maxCentreStep.
  const targetStep = Math.min(
    TUNING.maxCentreStep,
    Math.max(TUNING.minCentreStep, span / TUNING.centreSamples),
  )
  const runs = rawRuns
    // Resample before smoothing: evenly spaced samples are what makes a fixed
    // smoothing strength mean the same thing everywhere along the line.
    .map((r) => smoothPolyline(resample(r, targetStep), 0.5, 1))
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

  const fullStamps = Math.round(
    TUNING.stampsDry + water * (TUNING.stampsWet - TUNING.stampsDry),
  )
  /**
   * The preview draws a subset of the finished stack, not a shorter one.
   *
   * Every layer's shape comes out of its own index: `t` decides how far it is
   * expanded and how transparent it is, and the index seeds the wobble that
   * keeps it from nesting inside its neighbours. Rendering seven layers instead
   * of eighteen therefore did not thin the mark, it built a different one,
   * seven layers at seven other positions with seven other edges, so lifting
   * the brush reshuffled every bit of mottling in the interior even with the
   * seed held fixed. Keeping the loop at its full length and skipping most of
   * the layers means the ones that do get drawn are the same layers, in the
   * same places, that the finished mark will have.
   */
  const lastStamp = Math.max(0, fullStamps - 1)
  const skip = preview ? Math.max(1, Math.ceil(fullStamps / TUNING.previewStamps)) : 1
  // The widest layer sets the clip for the pooling, grain and gradient, and the
  // first past 0.62 is the one the rim is stroked around. Both are drawn
  // whatever the decimation lands on, so neither moves at the handover.
  const rimStamp = fullStamps > 1 ? Math.floor(0.62 * lastStamp) + 1 : -1
  const drawsStamp = (i: number): boolean =>
    i % skip === 0 || i === lastStamp || i === rimStamp
  let stamps = 0
  for (let i = 0; i < fullStamps; i++) if (drawsStamp(i)) stamps++
  /**
   * Thinning the stack would otherwise thin the paint with it, and the mark
   * would jump darker the moment the brush lifted. Layers of low-alpha paint
   * accumulate as 1-(1-a)^n, so raising a in proportion to the layers dropped
   * lands the preview within a shade or two of the finished mark.
   */
  const stampBoost = stamps < fullStamps ? Math.min(2.4, fullStamps / stamps) : 1
  const settle = context.settle === undefined ? 1 : clamp01(context.settle)
  /**
   * The drying, remapped to start where the preview lets go.
   *
   * `settle` runs from WET to 1, because the mark is already visibly on the
   * paper the moment the brush touches down. That is the right curve for
   * anything the preview also draws: it is already showing some of the effect,
   * and the settle carries it the rest of the way. It is the wrong curve for
   * anything the preview skips, which is absent one frame and then whatever
   * `settle` happens to be on the next, better than half of it, arriving all
   * at once, which is the pop you see when the brush lifts. Those passes ramp
   * on this instead, so they start from nothing at the handover.
   */
  const dried = clamp01((settle - WET) / (1 - WET))
  const spreadFull = TUNING.spread * (0.2 + water * 0.8 + wetness * 0.5)
  /**
   * The wash starts as a tight core and creeps out to its full reach.
   *
   * On `dried` rather than `settle`, which is the whole of the creep instead of
   * the last two fifths of it. Paint under a moving brush has not gone anywhere
   * yet: it is still the shape of the footprint, and the spreading is what
   * happens in the seconds afterwards. Ramping from WET meant the mark was
   * already most of the way out when the brush lifted, so the part you could
   * actually watch was a few per cent of the brush width, present in the
   * numbers, invisible on the paper. The dry mark is unchanged; only how far it
   * travels to get there is.
   */
  const spread = spreadFull * (0.12 + dried * 0.88)
  const radius = spanRadius(allPoints)
  // A big wash pools further than a small one, so drift scales with the mark.
  const drift =
    TUNING.drift * (0.2 + water * 0.8) * (filled ? 1 + Math.min(2.6, radius / 55) : 1)
  // Absolute ceiling on how far any one edge may wander.
  const maxDisp = filled
    ? Math.max(5, Math.min(24, radius * 0.16))
    : Math.max(3, halfWidth * 0.8)

  const [rgb, baseAlpha] = pigmentInk(pigment, stroke)
  const alpha = Math.min(0.92, baseAlpha * stampBoost)
  const falloff = 1.4 + (1 - water) * 2.5

  /**
   * Fill rule.
   *
   * evenodd is what lets a path with a second subpath inside it paint a ring
   * rather than a disc, so a shape drawn with a hole in it keeps the hole. But
   * it also means any path that crosses itself cancels where it overlaps, and a
   * brush dragged back over its own line makes exactly that: a ribbon crossing
   * itself, punched through with holes where the painter went over twice.
   * Multiple subpaths are a deliberate hole; one subpath crossing itself is
   * just someone working into a mark.
   */
  const rule: CanvasFillRule = runs.length > 1 ? 'evenodd' : 'nonzero'

  // Measured at full spread so the working area covers where the mark will end
  // up, not where it currently is.
  const reach = filled
    ? spanRadius(allPoints) * spreadFull + drift + 14
    : halfWidth * (1 + spreadFull) + rough * halfWidth * 4 + drift + 12
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
      // Where this mark dissolves and where it holds. Fixed per stroke, so the
      // same side stays soft through every stamp and the eye reads one edge
      // rather than a shimmer.
      const phase = (stroke.seed % 1000) / 1000 * Math.PI * 2 + r * 1.7
      let poly = filled
        ? expandVarying(runs[r], 1 + spread * t, TUNING.lostEdges, phase)
        : buildOutline(
            runs[r],
            halfWidth * (1 + spread * t),
            stroke.kind,
            TUNING.lostEdges * 0.5,
            phase,
          )
      if (poly.length < 3) continue

      // Coarse wobble is mostly shared, so the stamps still read as one wash,
      // but not identically: stamps deformed the same way and then expanded are
      // exact concentric copies, and the eye reads a stack of those as contour
      // lines on a map rather than as an edge. A little divergence per stamp is
      // what makes them cross instead of nest.
      const coarse = makeRng(stroke.seed + r * 31)
      poly = deform(poly, rough * 0.5, coarse, maxDisp)
      const wander = makeRng(stroke.seed + r * 31 + index * 5209)
      poly = deform(poly, rough * 0.34, wander, maxDisp * 0.75)
      // ...fine detail diverges, so they never stack into a hard vector edge.
      const fine = makeRng(stroke.seed + r * 31 + 977 * (index + 1))
      poly = deform(poly, rough * 0.72, fine, maxDisp * 0.6)
      poly = deform(poly, rough * 0.9, fine, maxDisp * 0.32)
      out.push(poly)
    }
    return out
  }

  for (let i = 0; i < fullStamps; i++) {
    const t = fullStamps === 1 ? 0 : i / lastStamp

    // A little drift per layer. Without this the interior reads dead flat;
    // with it, the wash pools unevenly the way a real one does.
    // Drawn onto its own or not, every layer takes its two numbers, so a
    // skipped one still advances the sequence and the layers that survive the
    // decimation sit exactly where the full stack would have put them.
    const dx = (jitter() - 0.5) * drift
    const dy = (jitter() - 0.5) * drift
    if (!drawsStamp(i)) continue

    const polys = stampPolys(t, i)
    if (polys.length === 0) continue

    bctx.save()
    bctx.translate(dx, dy)
    bctx.globalAlpha = alpha * (1 - t * 0.5)
    bctx.beginPath()
    for (const poly of polys) addPolygon(bctx, poly)
    bctx.fill(rule)
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
    (0.18 + load * 0.82) *
    // The rim is left behind by evaporation, so it is the last thing to appear.
    settle * settle
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
  // Pooling. Laid before the granulation so the heavy particles settle into a
  // wash that already has deep and thin places, rather than onto a flat one.
  if (widest.length && settle > 0.15) {
    const b = boundsOf(widest.flat())
    const span = Math.max(b.w, b.h) / TUNING.poolsAcross
    const angle = makeRng(stroke.seed ^ 0x4f00)() * Math.PI * 2
    const pattern = scaledPattern(bctx, getPoolTile(), Math.max(24, span), angle)
    if (pattern) {
      bctx.save()
      bctx.beginPath()
      for (const poly of widest) addPolygon(bctx, poly)
      bctx.clip(rule)
      bctx.globalCompositeOperation = 'multiply'
      bctx.globalAlpha = Math.min(
        0.9,
        TUNING.pooling * (0.35 + water * 0.65) * (0.4 + load * 0.6) * settle,
      )
      bctx.fillStyle = pattern
      bctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8)
      bctx.restore()
    }
  }

  // Same reasoning: no pigment in suspension, nothing to settle into the tooth.
  const gran =
    pigment.granulation * context.tooth * TUNING.granulation * (0.2 + load * 0.8) * dried
  // Granulation is a clipped pattern fill over the whole mark, so it costs the
  // most of anything here and scales with the area the stroke has reached. It
  // is also the least visible thing at draft: pigment settling into the tooth
  // arrives as the wash dries, which is exactly what the settle animation is
  // already doing in the frames after the brush lifts.
  if (!preview && gran > 0.06 && widest.length) {
    // Each mark gets its own grain orientation, so the tile never lines up
    // with its neighbours into a visible weave.
    const grainAngle = makeRng(stroke.seed ^ 0x6a11)() * Math.PI * 2
    const pattern = scaledPattern(bctx, getGranulationTile(), TUNING.grainSpan, grainAngle)
    if (pattern) {
      bctx.save()
      bctx.beginPath()
      for (const poly of widest) addPolygon(bctx, poly)
      bctx.clip(rule)
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
    bctx.clip(rule)
    bctx.globalCompositeOperation = 'multiply'
    bctx.globalAlpha = 1
    bctx.fillStyle = grad
    bctx.fillRect(b.x, b.y, b.w, b.h)
    bctx.restore()
  }

  // Blooms. Drop clean water into a wash that has begun to set and it shoves
  // the pigment outward into a pale cauliflower. Lifting pigment back out of
  // the buffer is exactly what destination-out does.
  // A bloom needs the wash to have begun setting before water can push it, so
  // it starts late, but it has to grow rather than switch on. A threshold on
  // `settle` put a finished cauliflower into one frame partway through the
  // drying, which is the same pop the granulation used to make, just later.
  const bloom = clamp01((dried - 0.38) / 0.62)
  if (water > 0.62 && bloom > 0.02 && widest.length) {
    applyBloom(
      bctx,
      widest.flat(),
      stroke.seed,
      water,
      TUNING.bloom * bloom,
      `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
    )
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
/**
 * A backrun, which is not a soft glow.
 *
 * Drop clean water into a wash that has started to set and it shoves the
 * pigment ahead of it, leaving a pale patch fenced by a darker, distinctly
 * hard, distinctly wandering line. Painters call the result a cauliflower and
 * spend years learning to want it. Rendering it as a radial gradient produces a
 * lens flare in the middle of the sky instead, so the shape is built as an
 * irregular polygon: clear in the middle, hard at the boundary, with the lifted
 * pigment banked up just outside it.
 */
function applyBloom(
  bctx: CanvasRenderingContext2D,
  poly: Point[],
  seed: number,
  water: number,
  strength: number,
  ink: string,
): void {
  const rng = makeRng(seed ^ 0xb100)
  const b = boundsOf(poly)
  const across = Math.min(b.w, b.h)
  if (across < 30) return

  // Not every wet wash backruns, and one that does usually does it once. Making
  // it happen every time turned the sky into a field of splats.
  if (rng() > 0.34 + water * 0.4) return

  const lift = Math.min(0.34, strength * (water - 0.6) * 0.85)
  if (lift < 0.03) return

  const count = rng() < 0.75 ? 1 : 2
  for (let i = 0; i < count; i++) {
    const cx = b.x + b.w * (0.2 + rng() * 0.6)
    const cy = b.y + b.h * (0.2 + rng() * 0.6)
    const r = Math.min(across * (0.12 + rng() * 0.18), 54)
    if (r < 8) continue

    // Enough sides that the boundary wanders rather than spikes. The earlier
    // version used eighteen with heavy wobble and produced starbursts.
    const sides = 44
    const squash = 0.66 + rng() * 0.42
    const tilt = rng() * Math.PI
    const lobe = 0.72 + rng() * 0.3
    const ring: Point[] = []
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2
      const wobble =
        1 + Math.sin(a * 3 + tilt) * 0.16 * lobe + Math.sin(a * 7 + tilt * 2) * 0.09
      const px = Math.cos(a) * r * wobble
      const py = Math.sin(a) * r * squash * wobble
      ring.push({
        x: cx + px * Math.cos(tilt) - py * Math.sin(tilt),
        y: cy + px * Math.sin(tilt) + py * Math.cos(tilt),
      })
    }

    // Irregular where it meets the wash, soft where it fades. Clipping a
    // radial falloff to the wandering outline gives both; a bare polygon fill
    // gives a hole with a cut edge, and a bare gradient gives a lens flare.
    bctx.save()
    tracePolygon(bctx, ring)
    bctx.clip()
    bctx.globalCompositeOperation = 'destination-out'
    const g = bctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r)
    g.addColorStop(0, `rgba(0,0,0,${lift.toFixed(3)})`)
    g.addColorStop(0.7, `rgba(0,0,0,${(lift * 0.8).toFixed(3)})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    bctx.globalAlpha = 1
    bctx.fillStyle = g
    bctx.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2)
    bctx.restore()

    // The pigment the water pushed ahead of it, banked against the boundary.
    // Faint: it is a tide line, not an outline.
    bctx.save()
    bctx.globalCompositeOperation = 'multiply'
    bctx.globalAlpha = Math.min(0.2, lift * 0.5)
    bctx.strokeStyle = ink
    bctx.lineWidth = 1 + r * 0.03
    bctx.lineJoin = 'round'
    tracePolygon(bctx, ring)
    bctx.stroke()
    bctx.restore()
  }
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

function channel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
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
