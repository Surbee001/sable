import { BRUSHES, type BrushKind } from './types'

export interface Point {
  x: number
  y: number
}

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 * ------------------------------------------------------------------ */

/** mulberry32 — small, fast, well-distributed. Same seed, same painting. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ *
 * SVG path sampling
 *
 * Rather than hand-rolling a bezier flattener we lean on the browser's own
 * SVG geometry engine. That buys us the entire path grammar — cubics, arcs,
 * smooth continuations — for free, and it is exactly the notation a language
 * model is most fluent in.
 * ------------------------------------------------------------------ */

let scratch: SVGPathElement | null = null

function scratchPath(): SVGPathElement {
  if (!scratch) {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.style.position = 'absolute'
    svg.style.opacity = '0'
    svg.style.pointerEvents = 'none'
    scratch = document.createElementNS(ns, 'path')
    svg.appendChild(scratch)
    document.body.appendChild(svg)
  }
  return scratch
}

export function isValidPath(d: string): boolean {
  if (!d || !/[Mm]/.test(d)) return false
  try {
    const p = scratchPath()
    p.setAttribute('d', d)
    const len = p.getTotalLength()
    return Number.isFinite(len)
  } catch {
    return false
  }
}

/** Sample a path into evenly spaced points. Returns [] for an unusable path. */
export function samplePath(d: string, spacing = 5): Point[] {
  try {
    const p = scratchPath()
    p.setAttribute('d', d)
    const total = p.getTotalLength()
    if (!Number.isFinite(total)) return []

    // A zero-length path is a dab of the brush, not an error.
    if (total < 0.01) {
      const pt = p.getPointAtLength(0)
      return [
        { x: pt.x, y: pt.y },
        { x: pt.x + 0.01, y: pt.y },
      ]
    }

    const n = Math.max(2, Math.min(600, Math.ceil(total / spacing)))
    const out: Point[] = []
    for (let i = 0; i <= n; i++) {
      const pt = p.getPointAtLength((i / n) * total)
      out.push({ x: pt.x, y: pt.y })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Sample a path, split into its disconnected runs.
 *
 * `getPointAtLength` walks a multi-subpath path as one continuous parameter,
 * so a `M`/`m` jump shows up as a sudden leap between consecutive samples.
 * Detecting those leaps keeps a moveto from being welded into the outline as a
 * spurious chord — which is exactly what put a wedge through every filled disc
 * the first time this ran.
 */
export function sampleSubpaths(d: string, spacing = 5): Point[][] {
  const pts = samplePath(d, spacing)
  if (pts.length < 2) return pts.length ? [pts] : []

  // A real segment never advances much more than the sampling step.
  const threshold = Math.max(spacing * 6, 12)
  const runs: Point[][] = [[pts[0]]]
  for (let i = 1; i < pts.length; i++) {
    const jump = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (jump > threshold) runs.push([pts[i]])
    else runs[runs.length - 1].push(pts[i])
  }
  return runs.filter((r) => r.length >= 2)
}

/** Turn a freehand drag into compact, smooth SVG path data. */
export function pointsToPath(pts: Point[]): string {
  if (pts.length === 0) return ''
  const r = (n: number) => Math.round(n * 10) / 10
  if (pts.length === 1) return `M ${r(pts[0].x)} ${r(pts[0].y)}`
  if (pts.length === 2) {
    return `M ${r(pts[0].x)} ${r(pts[0].y)} L ${r(pts[1].x)} ${r(pts[1].y)}`
  }

  // Catmull-Rom through the samples, emitted as cubic beziers.
  let d = `M ${r(pts[0].x)} ${r(pts[0].y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(p2.x)} ${r(p2.y)}`
  }
  return d
}

/** Drop samples that are closer together than `min` — keeps paths small. */
export function decimate(pts: Point[], min = 3): Point[] {
  if (pts.length < 2) return pts
  const out: Point[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const last = out[out.length - 1]
    if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= min) out.push(pts[i])
  }
  const tail = pts[pts.length - 1]
  const last = out[out.length - 1]
  if (last.x !== tail.x || last.y !== tail.y) out.push(tail)
  return out
}

/* ------------------------------------------------------------------ *
 * Brush body
 * ------------------------------------------------------------------ */

/**
 * Width along the stroke, 0..1 of full width.
 * taper 0 → blunt flat brush; taper 1 → fine point that lifts off the paper.
 */
export function widthProfile(t: number, taper: number): number {
  const belly = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.45)
  return 1 - taper + taper * belly
}

/**
 * Offset a centreline into a closed outline polygon: down one side of the
 * stroke and back up the other. This is the brush's footprint before any
 * water gets involved.
 */
export function buildOutline(
  centre: Point[],
  halfWidth: number,
  kind: BrushKind,
): Point[] {
  const n = centre.length
  if (n < 2) return []
  const taper = BRUSHES[kind].taper

  // Flat brushes hold a fixed chisel angle instead of following the path normal.
  const flatAngle = kind === 'flat' ? Math.PI * 0.28 : null

  const left: Point[] = []
  const right: Point[] = []

  for (let i = 0; i < n; i++) {
    const prev = centre[Math.max(0, i - 1)]
    const next = centre[Math.min(n - 1, i + 1)]
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len

    let nx: number
    let ny: number
    if (flatAngle !== null) {
      nx = Math.cos(flatAngle)
      ny = Math.sin(flatAngle)
    } else {
      nx = -dy
      ny = dx
    }

    const t = i / (n - 1)
    const w = halfWidth * widthProfile(t, taper)
    left.push({ x: centre[i].x + nx * w, y: centre[i].y + ny * w })
    right.push({ x: centre[i].x - nx * w, y: centre[i].y - ny * w })
  }

  return [...left, ...right.reverse()]
}

/**
 * Fractal midpoint displacement.
 *
 * This single function is what makes the result read as watercolour rather than
 * vector art. Each pass inserts a midpoint on every edge and shoves it sideways
 * by an amount proportional to that edge's length, so the boundary acquires
 * detail at every scale — the same way a wet edge creeps unevenly into paper
 * fibre. Stack a dozen independently-deformed copies at low alpha and you get
 * the layered, granular, slightly unpredictable edge of a real wash.
 */
export function deform(
  poly: Point[],
  amount: number,
  rng: () => number,
  maxDisp = Infinity,
): Point[] {
  const n = poly.length
  if (n < 3) return poly
  const out: Point[] = new Array(n * 2)
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    out[i * 2] = a
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) {
      out[i * 2 + 1] = { x: a.x, y: a.y }
      continue
    }
    // Displacement is proportional to edge length — that is what makes the
    // boundary fractal — but an uncapped proportional wobble turns a big wash
    // into torn paper. The cap keeps the character and loses the shredding.
    let disp = (rng() - 0.5) * len * amount
    if (disp > maxDisp) disp = maxDisp
    else if (disp < -maxDisp) disp = -maxDisp
    out[i * 2 + 1] = {
      x: (a.x + b.x) / 2 - (dy / len) * disp,
      y: (a.y + b.y) / 2 + (dx / len) * disp,
    }
  }
  return out
}

/** Push a polygon outward from its centroid — how a wet edge spreads. */
export function expand(poly: Point[], scale: number): Point[] {
  if (poly.length === 0) return poly
  let cx = 0
  let cy = 0
  for (const p of poly) {
    cx += p.x
    cy += p.y
  }
  cx /= poly.length
  cy /= poly.length
  return poly.map((p) => ({
    x: cx + (p.x - cx) * scale,
    y: cy + (p.y - cy) * scale,
  }))
}

export function tracePolygon(ctx: CanvasRenderingContext2D, poly: Point[]): void {
  if (poly.length < 3) return
  ctx.beginPath()
  addPolygon(ctx, poly)
}

/** Append a closed polygon to the current path without starting a new one. */
export function addPolygon(ctx: CanvasRenderingContext2D, poly: Point[]): void {
  if (poly.length < 3) return
  ctx.moveTo(poly[0].x, poly[0].y)
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
  ctx.closePath()
}

/* ------------------------------------------------------------------ *
 * Measurement + hit testing
 * ------------------------------------------------------------------ */

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export function boundsOf(pts: Point[], pad = 0): Bounds {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  }
}

/** Shortest distance from a point to a polyline. Used for click selection. */
export function distanceToPolyline(pt: Point, line: Point[]): number {
  if (line.length === 0) return Infinity
  if (line.length === 1) return Math.hypot(pt.x - line[0].x, pt.y - line[0].y)
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    let t = l2 === 0 ? 0 : ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy))
    if (d < best) best = d
  }
  return best
}

/* ------------------------------------------------------------------ *
 * Path rewriting
 * ------------------------------------------------------------------ */

interface PathSegment {
  cmd: string
  args: number[]
}

/** Number of arguments each SVG path command consumes per repetition. */
const ARITY: Record<string, number> = {
  m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0,
}

/** Tokenise path data into command groups. Tolerant of loose whitespace. */
export function parsePath(d: string): PathSegment[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g)
  if (!tokens) return []

  const segments: PathSegment[] = []
  let i = 0
  let cmd = ''

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i]
      i++
    } else if (!cmd) {
      i++
      continue
    } else if (cmd === 'M') {
      cmd = 'L' // implicit repeats of moveto are linetos
    } else if (cmd === 'm') {
      cmd = 'l'
    }

    const n = ARITY[cmd.toLowerCase()] ?? 0
    const args: number[] = []
    for (let k = 0; k < n && i < tokens.length; k++) args.push(parseFloat(tokens[i++]))
    if (args.length < n) break
    segments.push({ cmd, args })
  }

  return segments
}

export function serializePath(segments: PathSegment[]): string {
  const r = (n: number) => {
    const v = Math.round(n * 100) / 100
    return Object.is(v, -0) ? '0' : String(v)
  }
  return segments
    .map((s) => (s.args.length ? `${s.cmd} ${s.args.map(r).join(' ')}` : s.cmd))
    .join(' ')
}

/**
 * Which argument slots of a command are absolute positions.
 * Relative commands carry deltas, which a translation must leave alone — with
 * one exception: a leading `m` is measured from the origin, so it does move.
 */
function positionSlots(cmd: string): [xSlots: number[], ySlots: number[]] {
  switch (cmd.toUpperCase()) {
    case 'H': return [[0], []]
    case 'V': return [[], [0]]
    case 'C': return [[0, 2, 4], [1, 3, 5]]
    case 'S':
    case 'Q': return [[0, 2], [1, 3]]
    case 'A': return [[5], [6]]
    case 'Z': return [[], []]
    default:  return [[0], [1]] // M, L, T
  }
}

/** Translate a path in absolute space. Used by move_stroke and nudges. */
export function translatePath(d: string, dx: number, dy: number): string {
  const segments = parsePath(d)
  return serializePath(
    segments.map((seg, index) => {
      const absolute = seg.cmd === seg.cmd.toUpperCase()
      const leadingMoveto = index === 0 && seg.cmd === 'm'
      if (!absolute && !leadingMoveto) return seg

      const [xs, ys] = positionSlots(seg.cmd)
      const args = seg.args.slice()
      for (const i of xs) if (i < args.length) args[i] += dx
      for (const i of ys) if (i < args.length) args[i] += dy
      return { cmd: seg.cmd, args }
    }),
  )
}

/** Scale a path about a fixed point. Used by scale_stroke. */
export function scalePath(d: string, factor: number, originX: number, originY: number): string {
  const segments = parsePath(d)
  return serializePath(
    segments.map((seg, index) => {
      const absolute = seg.cmd === seg.cmd.toUpperCase()
      const leadingMoveto = index === 0 && seg.cmd === 'm'
      const args = seg.args.slice()

      if (seg.cmd.toUpperCase() === 'A') {
        args[0] *= factor
        args[1] *= factor
        if (absolute || leadingMoveto) {
          args[5] = originX + (args[5] - originX) * factor
          args[6] = originY + (args[6] - originY) * factor
        } else {
          args[5] *= factor
          args[6] *= factor
        }
        return { cmd: seg.cmd, args }
      }

      const [xs, ys] = positionSlots(seg.cmd)
      if (absolute || leadingMoveto) {
        for (const i of xs) if (i < args.length) args[i] = originX + (args[i] - originX) * factor
        for (const i of ys) if (i < args.length) args[i] = originY + (args[i] - originY) * factor
      } else {
        for (let i = 0; i < args.length; i++) args[i] *= factor
      }
      return { cmd: seg.cmd, args }
    }),
  )
}
