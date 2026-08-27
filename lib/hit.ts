import { distanceToPolyline, sampleSubpaths, type Point } from './geometry'
import { BRUSHES, type Scene, type Stroke } from './types'
import { paintOrder } from './watercolor'

/** Ray casting. Standard, and correct for the self-intersecting shapes agents write. */
function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** Cached sampling — hit tests run on every pointer move while dragging. */
const sampleCache = new Map<string, Point[][]>()

function runsFor(stroke: Stroke): Point[][] {
  const key = `${stroke.id}:${stroke.path}`
  let runs = sampleCache.get(key)
  if (!runs) {
    runs = sampleSubpaths(stroke.path, 6)
    if (sampleCache.size > 400) sampleCache.clear()
    sampleCache.set(key, runs)
  }
  return runs
}

export function hitsStroke(stroke: Stroke, pt: Point, slack = 6): boolean {
  const runs = runsFor(stroke)
  if (runs.length === 0) return false

  if (stroke.fill) {
    // Filled marks are regions; an odd number of enclosing rings means inside.
    let inside = false
    for (const run of runs) if (pointInPolygon(pt, run)) inside = !inside
    if (inside) return true
    // Still allow grabbing the rim, which is easier to aim at than the middle.
    return runs.some((run) => distanceToPolyline(pt, [...run, run[0]]) <= slack)
  }

  const halfWidth = (BRUSHES[stroke.kind].baseWidth * (0.34 + stroke.pressure * 0.92)) / 2
  return runs.some((run) => distanceToPolyline(pt, run) <= halfWidth + slack)
}

/** Topmost stroke under the cursor, matching what the eye expects to grab. */
export function hitTest(scene: Scene, pt: Point, slack = 6): Stroke | null {
  const ordered = paintOrder(scene)
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (hitsStroke(ordered[i], pt, slack)) return ordered[i]
  }
  return null
}

/** Outline of a stroke, for drawing selection handles. */
export function selectionOutline(stroke: Stroke): Point[][] {
  return runsFor(stroke)
}
