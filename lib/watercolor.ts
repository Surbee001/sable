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
  type MediumEvent,
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

/**
 * Where along the spread the visible edge of a wash sits.
 *
 * The stamps fan outward and fade as they go, so the mark does not end at the
 * last one. This is the point the drying rim is taken from, and by the same
 * argument it is the point the mark reads as ending at.
 */
const RIM_AT = 0.62

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
  /** Points along a mark at which its bleed is asked about. */
  bleedSamples: 24,
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
  /**
   * Each stamp drifts a little; this is what stops interiors reading flat.
   *
   * Not one of the noise knobs, whatever it looks like in the list. Drift makes
   * broad, soft variation by scattering where the layers of one mark land; the
   * grain knobs make texture by laying a tile over the finished shape. Turning
   * this down to quieten a wash does the opposite: the stamps stop smearing into
   * each other, their deformed edges line up, and a large flooded shape gains
   * visible contour rings where it used to be cloudy.
   */
  drift: 4.5,
  /** Strength of the dark rim left by a drying wash. */
  edgeDarken: 1.5,
  /** Pigment settling into the paper tooth. */
  granulation: 0.62,
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
  pooling: 0.32,
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
  separation: 11,
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

/**
 * A repeating pattern scaled so its features are the size we actually want.
 *
 * The offset matters as much as the angle. Two washes that pick the same
 * rotation still line their tiles up with each other and with the sheet, and a
 * texture that starts at the origin every time is a texture the eye can find
 * the grid of. Shifting each one to its own phase costs nothing and means no
 * two passages ever repeat together.
 */
function scaledPattern(
  ctx: CanvasRenderingContext2D,
  tile: HTMLCanvasElement,
  span: number,
  rotation = 0,
  offsetX = 0,
  offsetY = 0,
): CanvasPattern | null {
  const pattern = ctx.createPattern(tile, 'repeat')
  if (!pattern) return null
  const k = span / tile.width
  const cos = Math.cos(rotation) * k
  const sin = Math.sin(rotation) * k
  try {
    pattern.setTransform(new DOMMatrix([cos, sin, -sin, cos, offsetX, offsetY]))
  } catch {
    // Older engines without CanvasPattern.setTransform still get a valid, if
    // coarser, texture rather than nothing.
  }
  return pattern
}

/* ------------------------------------------------------------------ *
 * Textures
 * ------------------------------------------------------------------ */

/**
 * Multi-octave gradient noise on a wrapping lattice, with the domain warped.
 *
 * Two deliberate choices here, both of them cures for the same disease.
 *
 * Gradient rather than value noise. Value noise stores a number at each lattice
 * point and interpolates between them, so every local maximum and minimum sits
 * exactly on the grid. Stack a few octaves on one aligned lattice and those
 * extrema line up into a regular diagonal crosshatch, and the tile stops reading
 * as paper and starts reading as woven fabric, which is precisely what a large
 * flat wash made visible. Gradient noise stores a direction instead and is zero
 * at every lattice point, so the structure has nowhere to pin itself to.
 *
 * And the sample coordinates are pushed around by a low-frequency field before
 * they are used. Warping the domain bends whatever regularity survives into
 * something organic, and it is the standard cure for exactly this artefact. It
 * costs the tile nothing: the warp field is built on the same wrapping lattice,
 * so at x = size it has come back to the value it had at x = 0, and the tile
 * still meets itself exactly.
 */
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

  const quintic = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

  /** One octave of wrapping gradient noise, returning roughly -1..1. */
  const gradientOctave = (freq: number, seed: number) => {
    const rng = makeRng(seed)
    const gx = new Float32Array(freq * freq)
    const gy = new Float32Array(freq * freq)
    for (let i = 0; i < gx.length; i++) {
      const a = rng() * Math.PI * 2
      gx[i] = Math.cos(a)
      gy[i] = Math.sin(a)
    }
    const at = (ix: number, iy: number): number =>
      (((iy % freq) + freq) % freq) * freq + (((ix % freq) + freq) % freq)

    return (fx: number, fy: number): number => {
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = fx - x0
      const ty = fy - y0
      const sx = quintic(tx)
      const sy = quintic(ty)
      const dot = (ix: number, iy: number, dx: number, dy: number): number => {
        const i = at(ix, iy)
        return gx[i] * dx + gy[i] * dy
      }
      const a = dot(x0, y0, tx, ty) * (1 - sx) + dot(x0 + 1, y0, tx - 1, ty) * sx
      const b = dot(x0, y0 + 1, tx, ty - 1) * (1 - sx) + dot(x0 + 1, y0 + 1, tx - 1, ty - 1) * sx
      // Gradient noise peaks near ±0.7; scaled so a single octave spans -1..1.
      return (a * (1 - sy) + b * sy) * 1.4
    }
  }

  // The warp. Low frequency on purpose: this is meant to bend the lattice, not
  // to add detail of its own, and a fast warp would only trade one regular
  // texture for another.
  const warpFreq = 3
  const warpX = gradientOctave(warpFreq, 0x5eed01)
  const warpY = gradientOctave(warpFreq, 0x5eed02)
  /** In lattice cells of the octave being sampled. */
  const WARP = 0.42

  const samplers = octaves.map(([freq, weight, seed]) => {
    const noise = gradientOctave(freq, seed)
    return {
      weight,
      sample(x: number, y: number): number {
        const u = x / size
        const v = y / size
        const wx = warpX(u * warpFreq, v * warpFreq)
        const wy = warpY(u * warpFreq, v * warpFreq)
        // Map to 0..1 here rather than at the end, so `contrast` keeps seeing
        // the range it was tuned against.
        return noise(u * freq + wx * WARP, v * freq + wy * WARP) * 0.5 + 0.5
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
    512,
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
 * How much of the paper's texture a mark of this size is allowed to show.
 *
 * The two painters were getting visibly different materials on one sheet, and
 * this is why. Granulation and pooling are area effects: they fill whatever
 * shape they are clipped to, at full strength, however big it is. A hand paints
 * small marks and sees a fragment of a tile in each, which reads as tooth. An
 * agent paints big flooded shapes and gets the whole tile, several times over,
 * across a third of the sheet, which reads as static. Nothing was wrong with
 * either number; scale itself was doing the damage, and only one of the two
 * painters ever works at the scale where it shows.
 *
 * A real wash does granulate all the way across. It does not shout about it at
 * arm's length, because the eye reads a large mottled area as one surface and a
 * small one as detail. So the texture is pulled back as the mark grows, which is
 * a statement about looking rather than about pigment, and belongs in the
 * renderer for the same reason the drying rim does.
 *
 * `r` is the mark's half-span in sheet units. Marks up to about a fifth of the
 * sheet are untouched; a full-sheet wash keeps something over a third.
 */
function textureAtScale(r: number): number {
  return 1 / (1 + Math.max(0, r - 110) / 420)
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
    512,
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
    512,
    [
      // Not lower than this. A frequency-2 lattice has four gradient points in
      // the whole tile, so its cells are literally the quadrants of the square
      // and a wash big enough to show one octave of it shows corners. On a
      // full-sheet sky, which stretches this tile to about its own width, that
      // put soft rounded rectangles in the clouds.
      [4, 0.48, 20260829],
      [9, 0.32, 771],
      [19, 0.2, 4242],
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
    ctx.globalAlpha = 0.075 + spec.grain * 0.11
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
   * The paper's own colour, which is as pale as lifting can get.
   *
   * A lift does not go to white, it goes back to the sheet. Defaults to a
   * warm white when the caller has not said.
   */
  paperTone?: string
  /**
   * Called with anything the paint does that was not asked for.
   *
   * Off by default and absent on every drawing path, so the studio pays nothing
   * for it. Attached only when somebody wants to know what the medium did,
   * which in practice means an agent about to decide what to paint next.
   */
  observe?: (event: MediumEvent) => void
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
   * The settle at a fraction along the mark, rather than for the mark at large.
   *
   * A stroke is not laid down all at once, so it does not dry all at once
   * either: by the time the brush reaches the end of a long pull, the start has
   * been sitting in the paper for a second and has crept out into it. With only
   * `settle` to go on the whole mark had to share one clock, and that clock
   * could not start until the mark existed, which is to say until the brush
   * lifted. So the mark held the exact width of the footprint for as long as
   * you were drawing it and then did all of its bleeding afterwards. Given
   * this, every point carries its own age and the spreading happens under the
   * hand, where it belongs.
   */
  bleed?: (t: number) => number
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
 * The same way whether the brush is still on it or it dried an hour ago. There
 * used to be a draft path that thinned the stack of pigment layers for the mark
 * under the brush, with the per-layer alpha raised to compensate. It could not
 * be made to compensate: layers of the same colour composite through multiply
 * as well as through alpha, so a stack of seven does not merely land paler than
 * a stack of thirteen, it lands a slightly different colour, and no single
 * scaling of alpha fixes both at once. What you saw was the mark stepping a
 * shade brighter as the brush came up. The finished stack is what the settle
 * animation has always drawn, sixty times a second for a second after every
 * mark, so the cost was never the problem the draft path was solving.
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
  // The mark's own width when it names one, the brush's when it does not.
  // Pressure still slides it either way, so a named width is a size of brush
  // rather than a fixed measurement.
  const baseWidth = stroke.width !== undefined && stroke.width > 0 ? stroke.width : brush.baseWidth
  const halfWidth = (baseWidth * (0.34 + pressure * 0.92)) / 2

  // Water and a wet ground loosen the edge; staining pigments tighten it.
  const rough =
    (TUNING.roughDry + water * (TUNING.roughWet - TUNING.roughDry)) *
      (1 + wetness * 0.75) *
      (1 - pigment.staining * 0.3) +
    brush.chatter * 0.1

  const fullStamps = Math.round(
    TUNING.stampsDry + water * (TUNING.stampsWet - TUNING.stampsDry),
  )
  const lastStamp = Math.max(0, fullStamps - 1)
  const uniform = context.settle === undefined ? 1 : clamp01(context.settle)
  const bleed = context.bleed
  /**
   * The settle averaged over the length.
   *
   * Most of what drying does to a mark belongs to the mark as a whole: how dark
   * the rim has pulled, how much pigment has dropped into the tooth. Those want
   * one number for the whole thing. Only the spreading is local enough to be
   * worth asking about point by point, because it is the part you watch happen.
   */
  const settle = bleed
    ? (() => {
        let sum = 0
        for (let i = 0; i < TUNING.bleedSamples; i++) {
          sum += clamp01(bleed(i / (TUNING.bleedSamples - 1)))
        }
        return sum / TUNING.bleedSamples
      })()
    : uniform
  /**
   * The drying, with zero at the moment the paint lands.
   *
   * `settle` starts at WET, not at nothing, because paint is visibly on the
   * paper as soon as the brush touches it. That is the right zero for how dark
   * a mark is. It is the wrong zero for the things that develop over the
   * drying, which have genuinely not started yet when the brush is still
   * moving: the creep outward into the fibre, the heavy particles dropping into
   * the tooth, the bloom. Those are asked in terms of this instead.
   */
  const driedFrom = (s: number): number => clamp01((s - WET) / (1 - WET))
  const dried = driedFrom(settle)
  const spreadFull = TUNING.spread * (0.2 + water * 0.8 + wetness * 0.5)
  /**
   * The wash starts as a tight core and creeps out to its full reach.
   *
   * On `dried` rather than `settle`, which is the whole of the creep instead of
   * the last two fifths of it. Ramping from WET meant the mark was already most
   * of the way out by the time anyone could watch, so the visible travel was a
   * few per cent of the brush width: present in the numbers, invisible on the
   * paper. The dry mark is unchanged; only how far it travels to get there is.
   */
  const spread = spreadFull * (0.12 + dried * 0.88)
  // The same figure, asked about one place on the mark rather than all of it.
  const spreadAt = bleed
    ? (u: number): number => spreadFull * (0.12 + driedFrom(clamp01(bleed(u))) * 0.88)
    : null
  const radius = spanRadius(allPoints)

  const observe = context.observe
  if (observe) {
    /**
     * How far the pigment finished from where the path put it.
     *
     * Measured at the stamp the rim is taken from rather than at the outermost
     * one. The stamps fade as they spread, so the very widest carries almost no
     * pigment and reporting its reach describes a boundary nobody can see.
     * on a full-sheet wash that came out as nearly two hundred units of creep,
     * which is true of the geometry and a lie about the picture. The rim is
     * where the wash visibly ends, so it is where this is asked.
     */
    const creep = RIM_AT * spreadFull * (filled ? radius : halfWidth)
    if (creep >= 6) {
      observe({ kind: 'spread', amount: Math.round(creep) })
    }
  }

  // A big wash pools further than a small one, so drift scales with the mark.
  const drift =
    TUNING.drift * (0.2 + water * 0.8) * (filled ? 1 + Math.min(2.6, radius / 55) : 1)
  // Absolute ceiling on how far any one edge may wander.
  const maxDisp = filled
    ? Math.max(5, Math.min(24, radius * 0.16))
    : Math.max(3, halfWidth * 0.8)

  const [rgb, baseAlpha] = pigmentInk(pigment, stroke)
  const alpha = Math.min(0.92, baseAlpha)
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

  /**
   * Taking pigment off rather than putting it on.
   *
   * Everything above this line is the same for a lift as for a mark: the same
   * fractal edge, the same spread into the fibre, the same soft side. That is
   * not a shortcut, it is the point: a passage lifted with a damp brush has an
   * edge made by exactly the physics that made the wash's, so it has to be made
   * the same way. Only two things differ. The pigment is the paper's own
   * colour, and the buffer goes onto the sheet with `lighten` instead of
   * `multiply`, so the mark can only ever pull a passage back toward the sheet
   * and never darken one.
   *
   * The effects further down are all consequences of pigment arriving
   * (granulation, pooling, the drying rim) so a lift skips them.
   */
  const lifting = stroke.lift === true
  const paperTone = context.paperTone ?? '#f6f2e8'

  bctx.globalCompositeOperation = lifting ? 'source-over' : 'multiply'
  const flatInk = lifting ? paperTone : `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`

  /**
   * A wash that is not the same at both ends.
   *
   * Built as a canvas gradient across the mark's own bounds along the requested
   * angle, so the stamps carry it rather than having it painted over them
   * afterwards: a gradient laid on top would sit above the edge darkening and
   * the granulation and read as a filter, where this one is the pigment itself
   * arriving unevenly, which is what a graded wash is.
   *
   * Running toward white rather than toward transparent, because the buffer
   * composites with multiply and white is multiply's nothing. Fading to
   * transparent would leave the far end of the wash showing the buffer's own
   * empty pixels instead of the paper.
   */
  const ink = ((): string | CanvasGradient => {
    const grade = stroke.grade
    if (lifting || !grade || allPoints.length === 0) return flatInk

    const b = boundsOf(allPoints)
    const angle = ((grade.angle ?? 90) * Math.PI) / 180
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    // Half the diagonal projected on the axis: the gradient spans the shape
    // whatever direction it is asked to run in.
    const reachAlong = (Math.abs(dx) * b.w + Math.abs(dy) * b.h) / 2
    const mx = b.x + b.w / 2
    const my = b.y + b.h / 2
    const g = bctx.createLinearGradient(
      mx - dx * reachAlong, my - dy * reachAlong,
      mx + dx * reachAlong, my + dy * reachAlong,
    )

    const far = grade.pigment ? getPigment(grade.pigment) : null
    const fade = clamp01(grade.fade ?? (far ? 0 : 0.7))
    const [fr, fg, fb] = far ? hexToRgb(far.hex) : rgb
    // Toward white by `fade`, so the far end thins out on the paper.
    const mix = (c: number): number => Math.round(c + (255 - c) * fade)

    g.addColorStop(0, flatInk)
    g.addColorStop(1, `rgb(${mix(fr)},${mix(fg)},${mix(fb)})`)
    return g
  })()

  bctx.fillStyle = ink
  bctx.strokeStyle = flatInk

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
      /**
       * Where the loose side of this mark faces.
       *
       * `expandVarying` swells the perimeter as `sin(2a + phase)`, so the first
       * maximum sits at a = (pi/2 - phase)/2. Solving that for a requested
       * direction is what turns a decorative wobble into a decision: ask for
       * soft toward the light and every shape in the passage agrees about where
       * the light is. Subpaths after the first keep their offset so a shape
       * with a hole does not have both boundaries swelling identically.
       */
      const phase =
        stroke.softToward === undefined
          ? ((stroke.seed % 1000) / 1000) * Math.PI * 2 + r * 1.7
          : Math.PI / 2 - 2 * ((stroke.softToward * Math.PI) / 180) + r * 1.7
      // A filled wash has no along-the-line to vary over. It is a shape, not a
      // pull, so it keeps the averaged spread and only the drawn stroke asks
      // per point.
      let poly = filled
        ? expandVarying(runs[r], 1 + spread * t, TUNING.lostEdges, phase)
        : buildOutline(
            runs[r],
            halfWidth,
            stroke.kind,
            TUNING.lostEdges * 0.5,
            phase,
            spreadAt ? (u) => 1 + spreadAt(u) * t : () => 1 + spread * t,
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
    const polys = stampPolys(t, i)
    if (polys.length === 0) continue

    // A little drift per layer. Without this the interior reads dead flat;
    // with it, the wash pools unevenly the way a real one does.
    const dx = (jitter() - 0.5) * drift
    const dy = (jitter() - 0.5) * drift

    bctx.save()
    bctx.translate(dx, dy)
    /**
     * A lift builds its buffer to full strength and is metered on the way out.
     *
     * Stacking eight to eighteen partly-opaque stamps of the paper tone with
     * source-over saturates the middle of the shape to solid paper within the
     * first few, so every lift above the faintest came out as a flat pale patch
     * with a hard boundary, which is the one thing a lifted passage never is. Building
     * the buffer solid and scaling the whole thing by the requested strength at
     * the composite keeps the stamps' soft edge intact and makes opacity mean
     * what it says: a little of the pigment back, or most of it.
     */
    bctx.globalAlpha = lifting ? Math.min(0.5, 1.4 / fullStamps) : alpha * (1 - t * 0.5)
    bctx.beginPath()
    for (const poly of polys) addPolygon(bctx, poly)
    bctx.fill(rule)
    bctx.restore()

    if (t > RIM_AT && !rimPolys) rimPolys = polys
    widest = polys
  }

  // Which way the mark went soft.
  //
  // `expandVarying` swells the perimeter unevenly around a phase fixed per
  // stroke, so one side of every wash is looser than the other. That is the
  // lost-and-found edge the whole renderer is built around, and until now the
  // only way to find out where it landed was to look at the picture.
  if (observe && widest.length > 0) {
    const rim2 = widest.flat()
    let cx = 0
    let cy = 0
    for (const p of rim2) { cx += p.x; cy += p.y }
    cx /= rim2.length
    cy /= rim2.length

    let loosest = rim2[0]
    let far = -Infinity
    let tightest = rim2[0]
    let near = Infinity
    for (const p of rim2) {
      const d = Math.hypot(p.x - cx, p.y - cy)
      if (d > far) { far = d; loosest = p }
      if (d < near) { near = d; tightest = p }
    }
    if (far - near > Math.max(4, far * 0.14)) {
      observe({
        kind: 'lost-edge',
        x: Math.round(loosest.x),
        y: Math.round(loosest.y),
        detail: `tightest at ${Math.round(tightest.x)},${Math.round(tightest.y)}`,
      })
    }
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
    /**
     * Almost nothing, on paper that was still wet.
     *
     * A rim forms because the water has a boundary to evaporate at and drags
     * pigment to it. A mark laid into a passage that is still open has no
     * boundary: its water is continuous with the water already there, and the
     * pigment simply keeps travelling. This was missing, and the symptom was
     * exact: three washes laid wet into wet to make one soft mass each drew
     * their own dark outline, so an animal painted the way the recipe says came
     * out as three overlapping shapes with edges rather than one form. Fusion
     * that the studio reports but does not draw is not fusion.
     */
    (1 - wetness * 0.85) *
    // The rim is left behind by evaporation, so it is the last thing to appear.
    settle * settle
  // Guarded the same way the rim itself is: a lift does not leave a drying rim,
  // and reporting one it never drew is worse than silence, because the agent answers
  // an edge that is not on the sheet.
  if (!lifting && observe && rim > 0.18) {
    observe({ kind: 'rim', amount: Math.round(rim * 100) / 100 })
  }
  if (!lifting && rim > 0.02 && rimPolys) {
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
  if (!lifting && widest.length && settle > 0.15) {
    const b = boundsOf(widest.flat())
    const span = Math.max(b.w, b.h) / TUNING.poolsAcross
    const poolRng = makeRng(stroke.seed ^ 0x4f00)
    const angle = poolRng() * Math.PI * 2
    const pattern = scaledPattern(
      bctx, getPoolTile(), Math.max(24, span), angle,
      poolRng() * span, poolRng() * span,
    )
    if (pattern) {
      bctx.save()
      bctx.beginPath()
      for (const poly of widest) addPolygon(bctx, poly)
      bctx.clip(rule)
      bctx.globalCompositeOperation = 'multiply'
      bctx.globalAlpha = Math.min(
        0.5,
        TUNING.pooling *
          (0.35 + water * 0.65) *
          (0.4 + load * 0.6) *
          settle *
          textureAtScale(Math.max(b.w, b.h) / 2),
      )
      bctx.fillStyle = pattern
      bctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8)
      bctx.restore()
    }
  }

  /**
   * Grain: the mark meeting the tooth of the paper.
   *
   * Two things at once, on two clocks. Wet paint finds the hollows in the sheet
   * the moment the brush puts it there, and that part is there to see straight
   * away; the heavy particles in a granulating pigment then drop out of
   * suspension over the drying and deepen it. The floor is the first, `dried`
   * is the second.
   *
   * This pass used to be skipped for the mark under the brush, on the grounds
   * that it is a clipped pattern fill over the whole mark and so the most
   * expensive thing here. But it is the pass that makes paint look like paint on
   * paper rather than ink on glass, and skipping it meant the sheet had no tooth
   * at all until the brush came up. It costs about what the pooling beside it
   * costs, and that has always run every frame.
   */
  const gran =
    pigment.granulation *
    context.tooth *
    TUNING.granulation *
    (0.2 + load * 0.8) *
    (0.32 + dried * 0.68)
  if (!lifting && observe && gran > 0.16) {
    observe({
      kind: 'granulation',
      amount: Math.round(gran * 100) / 100,
      detail: pigment.name,
    })
  }
  if (!lifting && gran > 0.06 && widest.length) {
    // Each mark gets its own grain orientation and its own phase, so the tile
    // never lines up with its neighbours into a visible weave.
    const grainRng = makeRng(stroke.seed ^ 0x6a11)
    const grainAngle = grainRng() * Math.PI * 2
    const pattern = scaledPattern(
      bctx, getGranulationTile(), TUNING.grainSpan, grainAngle,
      grainRng() * TUNING.grainSpan, grainRng() * TUNING.grainSpan,
    )
    if (pattern) {
      const b = boundsOf(widest.flat(), 6)
      bctx.save()
      bctx.beginPath()
      for (const poly of widest) addPolygon(bctx, poly)
      bctx.clip(rule)
      bctx.globalCompositeOperation = 'multiply'
      bctx.globalAlpha = Math.min(
        0.5,
        gran * (0.45 + water * 0.55) * textureAtScale(Math.max(b.w, b.h) / 2),
      )
      bctx.fillStyle = pattern
      bctx.fillRect(b.x, b.y, b.w, b.h)
      bctx.restore()
    }
  }

  // Gravity and an uneven drying front leave one side of a wash deeper than the
  // other. Without this a flooded shape reads as a flat vector fill however
  // ragged its edge is.
  if (!lifting && widest.length) {
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

  /**
   * Charging: a second pigment dropped into the wash while it still ran.
   *
   * Laid inside the same buffer as the wash itself and clipped to it, which is
   * the whole distinction being drawn. A second mark painted on top is a second
   * mark, and it brings its own edge, its own rim and its own spread however
   * softly it is laid. This has none of those, because it is not a mark: it is
   * more pigment arriving in water that is already there, so it fades out into
   * the wash with no boundary at all.
   */
  if (!lifting && stroke.charge?.length && widest.length) {
    const chargeRng = makeRng(stroke.seed ^ 0xc7a6)
    bctx.save()
    bctx.beginPath()
    for (const poly of widest) addPolygon(bctx, poly)
    bctx.clip(rule)
    bctx.globalCompositeOperation = 'multiply'

    const cb = boundsOf(widest.flat())
    const across = Math.max(cb.w, cb.h)
    for (const drop of stroke.charge) {
      const dropPigment = getPigment(drop.pigment)
      const [dr, dg, db] = hexToRgb(dropPigment.hex)
      const reach = Math.max(12, across * clamp01(drop.spread ?? 0.34))
      const strength = Math.min(0.85, alpha * 2.2 * clamp01(drop.strength ?? 0.7) * settle)
      if (strength < 0.02) continue

      // An irregular boundary rather than a clean disc, for the same reason
      // the bloom has one: water does not travel the same distance in every
      // direction through paper fibre.
      const tilt = chargeRng() * Math.PI * 2
      const squash = 0.7 + chargeRng() * 0.5
      const sides = 40
      const ring: Point[] = []
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2
        const wobble = 1 + Math.sin(a * 3 + tilt) * 0.2 + Math.sin(a * 7 + tilt * 1.7) * 0.1
        const rx = Math.cos(a) * reach * wobble
        const ry = Math.sin(a) * reach * squash * wobble
        ring.push({
          x: drop.x + rx * Math.cos(tilt) - ry * Math.sin(tilt),
          y: drop.y + rx * Math.sin(tilt) + ry * Math.cos(tilt),
        })
      }

      bctx.save()
      tracePolygon(bctx, ring)
      bctx.clip()
      const g = bctx.createRadialGradient(drop.x, drop.y, reach * 0.05, drop.x, drop.y, reach)
      g.addColorStop(0, `rgba(${dr},${dg},${db},${strength.toFixed(3)})`)
      g.addColorStop(0.55, `rgba(${dr},${dg},${db},${(strength * 0.45).toFixed(3)})`)
      g.addColorStop(1, `rgba(${dr},${dg},${db},0)`)
      bctx.globalAlpha = 1
      bctx.fillStyle = g
      bctx.fillRect(drop.x - reach * 1.6, drop.y - reach * 1.6, reach * 3.2, reach * 3.2)
      bctx.restore()
    }
    bctx.restore()
  }

  /**
   * Spatter: pigment knocked off the brush rather than drawn with it.
   *
   * Kept to the mark's own shape by clipping, so a path is a region to spatter
   * into rather than a thing to spatter along. The specks vary in size by about
   * four to one and in strength rather more, because a flicked brush throws a
   * few heavy drops and a great many small ones, and an even scatter of equal
   * dots reads as noise laid over a picture instead of as paint thrown at it.
   */
  if (!lifting && stroke.spatter && widest.length) {
    const spatterRng = makeRng(stroke.seed ^ 0x5b17)
    const sb = boundsOf(widest.flat())
    const density = Math.max(1, Math.min(400, stroke.spatter.density ?? 40))
    const size = Math.max(0.5, Math.min(24, stroke.spatter.size ?? 2.5))
    const count = Math.min(1400, Math.round((sb.w * sb.h) / 10_000 * density))

    if (count > 0) {
      bctx.save()
      bctx.beginPath()
      for (const poly of widest) addPolygon(bctx, poly)
      bctx.clip(rule)
      bctx.globalCompositeOperation = 'multiply'
      bctx.fillStyle = flatInk

      for (let i = 0; i < count; i++) {
        const x = sb.x + spatterRng() * sb.w
        const y = sb.y + spatterRng() * sb.h
        /**
         * Very many tiny specks and a very few large ones.
         *
         * A knocked brush throws a spray whose sizes are wildly uneven, and the
         * first version of this used a cubic skew that still put most of its
         * specks in the middle of the range. The result was a field of evenly
         * sized circles: not grit but polka dots, which is worse than no
         * texture at all. A fourth power puts nine specks in ten below half the
         * nominal size, and the handful of big ones are what the eye reads as
         * spatter.
         */
        const roll = spatterRng()
        const r = size * (0.16 + roll * roll * roll * roll * 3.2)
        // Small specks are usually faint too, so the texture fades out rather
        // than stopping at a size.
        const faint = 0.25 + roll * roll * 1.5
        bctx.globalAlpha = Math.min(0.85, alpha * faint * (0.5 + spatterRng()) * settle)
        // Squashed and turned, so a speck is a splash rather than a dot.
        bctx.save()
        bctx.translate(x, y)
        bctx.rotate(spatterRng() * Math.PI)
        bctx.scale(1, 0.4 + spatterRng() * 0.75)
        bctx.beginPath()
        bctx.arc(0, 0, r, 0, Math.PI * 2)
        bctx.fill()
        bctx.restore()
      }
      bctx.restore()
    }
  }

  bctx.restore()

  // One composite onto the sheet. Multiply, because watercolour is subtractive:
  // paint laid over paint filters the light twice.
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = lifting ? 'lighten' : 'multiply'
  // Lifts meter here rather than per stamp; see the stamp alpha above.
  ctx.globalAlpha = lifting ? clamp01(stroke.opacity) : 1
  ctx.drawImage(buf, px.x, px.y, px.w, px.h, px.x, px.y, px.w, px.h)
  ctx.restore()
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
  /** Notified of everything the paint does on its own, per stroke. Optional. */
  observe?: (strokeId: string, event: MediumEvent) => void,
): void {
  const scaleX = deviceW / CANVAS_W
  const scaleY = deviceH / CANVAS_H
  renderPaper(ctx, scene.paper, deviceW, deviceH)

  const tooth = PAPERS[scene.paper].tooth
  const byLayer = new Map<string, Layer>(scene.layers.map((l) => [l.id, l]))

  for (const stroke of paintOrder(scene)) {
    const layer = byLayer.get(stroke.layerId)
    // The wetter of the two: a mark laid into a passage that was still open
    // bleeds like one, whatever the layer it happens to belong to.
    const wetness = Math.max(layer?.wetness ?? 0, stroke.ground ?? 0)
    renderStroke(
      ctx,
      stroke,
      {
        wetness,
        tooth,
        paperTone: PAPERS[scene.paper].base,
        observe: observe ? (event) => observe(stroke.id, event) : undefined,
      },
      scaleX,
      scaleY,
    )
  }
}
