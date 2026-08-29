import { CANVAS_H, CANVAS_W } from './types'
import type { Bounds } from './geometry'

/**
 * How wet the paper is, where, and for how much longer.
 *
 * Layer wetness is a constant chosen when the layer was made: the Ground layer
 * is 0.6 wet and stays 0.6 wet whether you painted on it a second ago or never.
 * That is a setting, not a sheet. Real paper is wet in the places you just put
 * water and nowhere else, and it stops being wet while you are deciding what to
 * do next. Everything watercolour is famous for (one wash running into
 * another, a soft edge you cannot get back, a bloom where a loaded brush
 * touched a drying passage) is a consequence of that clock, and none of it can
 * happen in a medium where wetness is a property of a layer.
 *
 * So the sheet keeps its own wetness, on a coarse grid, decaying in real time.
 * A mark deposits water where it lands; the paper gives it back over the next
 * half-minute or so, wetter passages taking longer. Whoever paints next lands
 * on whatever is there by then.
 *
 * Two consequences worth being explicit about:
 *
 * A mark's ground wetness is frozen into the mark when it lands. The renderer
 * must stay deterministic (same seed, same painting, forever) so it can never
 * ask what the sheet is doing *now*. It asks what the sheet was doing at the
 * moment the brush touched, which is a permanent fact about that mark and the
 * one a painter would recognise.
 *
 * And this is deliberately not part of the document. A saved painting is a
 * record of decisions; whether the paper was still damp forty seconds ago is
 * not one of them. It lives here, next to `presence`, as state about the studio
 * rather than about the picture.
 */

/** Sheet units per cell. Coarse: this is about passages, not pixels. */
const CELL = 50
const COLS = Math.ceil(CANVAS_W / CELL)
const ROWS = Math.ceil(CANVAS_H / CELL)

/**
 * How long paper stays open, in milliseconds.
 *
 * Long enough that an agent which paints, looks at the sheet, thinks, and
 * paints again is still working into a damp passage, because that round trip is
 * seconds, not milliseconds. Short enough that a sheet left alone genuinely
 * dries and the chance is genuinely gone, because a window that never closes is
 * not a window.
 */
function dryingTime(water: number): number {
  return 18_000 + clamp01(water) * 62_000
}

/** Wet at the start, then off quickly, then a long damp tail. Like paper. */
function decay(t: number): number {
  if (t <= 0) return 1
  if (t >= 1) return 0
  return Math.pow(1 - t, 1.7)
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

interface Cell {
  /** How wet this patch went on. */
  water: number
  /** When, in ms on the same clock as `now()`. */
  at: number
}

/** Where the sheet is still open, as a passage rather than a cell. */
export interface WetPatch {
  x: number
  y: number
  w: number
  h: number
  /** Current wetness at its wettest, 0..1. */
  wetness: number
  /** Roughly how long before this passage is dry, in seconds. */
  secondsLeft: number
  /** Which ninth of the sheet it sits in, for talking about it. */
  where: string
}

const PLACES = [
  ['the top left', 'the top', 'the top right'],
  ['the left', 'the middle', 'the right'],
  ['the bottom left', 'the bottom', 'the bottom right'],
]

function placeOf(x: number, y: number): string {
  const col = Math.max(0, Math.min(2, Math.floor((x / CANVAS_W) * 3)))
  const row = Math.max(0, Math.min(2, Math.floor((y / CANVAS_H) * 3)))
  return PLACES[row][col]
}

class WetField {
  private cells = new Map<number, Cell>()

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  private key(col: number, row: number): number {
    return row * COLS + col
  }

  /** Wetness of one cell right now, 0 if it has never been painted or has dried. */
  private cellWetness(col: number, row: number, now: number): number {
    const cell = this.cells.get(this.key(col, row))
    if (!cell) return 0
    return cell.water * decay((now - cell.at) / dryingTime(cell.water))
  }

  /** How wet the paper is at a point on the sheet, 0..1. */
  wetnessAt(x: number, y: number): number {
    const col = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)))
    const row = Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)))
    return this.cellWetness(col, row, this.now())
  }

  /**
   * The wettest the paper is anywhere under a mark.
   *
   * The wettest rather than the average, because a mark that catches a damp
   * passage with one end of itself bleeds at that end. Averaging over the
   * whole footprint of a long stroke reports a mark that is slightly damp
   * everywhere, which is not a thing that happens.
   */
  wetnessUnder(b: Bounds): number {
    const now = this.now()
    const c0 = Math.max(0, Math.floor(b.x / CELL))
    const c1 = Math.min(COLS - 1, Math.floor((b.x + b.w) / CELL))
    const r0 = Math.max(0, Math.floor(b.y / CELL))
    const r1 = Math.min(ROWS - 1, Math.floor((b.y + b.h) / CELL))

    let most = 0
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const w = this.cellWetness(col, row, now)
        if (w > most) most = w
      }
    }
    return most
  }

  /**
   * Lay water down where a mark landed.
   *
   * The wetter of what is there and what just arrived, rather than the sum: a
   * second wash into a damp passage does not make the paper twice as wet, it
   * resets the clock on it. Adding would let an agent charge one patch to
   * saturation by painting the same place repeatedly, which is a bug shaped
   * exactly like a technique.
   */
  deposit(b: Bounds, water: number): void {
    const w = clamp01(water)
    if (w <= 0.02) return
    const now = this.now()

    const c0 = Math.max(0, Math.floor(b.x / CELL))
    const c1 = Math.min(COLS - 1, Math.floor((b.x + b.w) / CELL))
    const r0 = Math.max(0, Math.floor(b.y / CELL))
    const r1 = Math.min(ROWS - 1, Math.floor((b.y + b.h) / CELL))

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const key = this.key(col, row)
        const existing = this.cells.get(key)
        const current = existing
          ? existing.water * decay((now - existing.at) / dryingTime(existing.water))
          : 0
        this.cells.set(key, { water: Math.max(current, w), at: now })
      }
    }
  }

  /**
   * Lay water down along a mark's centreline rather than across its box.
   *
   * A stroke running corner to corner has a bounding box the size of the sheet
   * and wets almost none of it. Charging the box turned every diagonal mark
   * into a claim that the whole sheet was open, which is both wrong and, worse,
   * useless: an agent told the entire sheet is wet learns nothing it can act
   * on. Areas still use the box, because a flooded shape genuinely does wet its
   * own interior.
   */
  depositAlong(points: Array<{ x: number; y: number }>, radius: number, water: number): void {
    const w = clamp01(water)
    if (w <= 0.02 || points.length === 0) return
    const now = this.now()
    const reach = Math.max(CELL / 2, radius)

    const touched = new Set<number>()
    for (const pt of points) {
      const c0 = Math.max(0, Math.floor((pt.x - reach) / CELL))
      const c1 = Math.min(COLS - 1, Math.floor((pt.x + reach) / CELL))
      const r0 = Math.max(0, Math.floor((pt.y - reach) / CELL))
      const r1 = Math.min(ROWS - 1, Math.floor((pt.y + reach) / CELL))
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) touched.add(this.key(col, row))
      }
    }

    for (const key of touched) {
      const existing = this.cells.get(key)
      const current = existing
        ? existing.water * decay((now - existing.at) / dryingTime(existing.water))
        : 0
      this.cells.set(key, { water: Math.max(current, w), at: now })
    }
  }

  /**
   * Every passage still open, merged into rectangles worth naming.
   *
   * Cells are an implementation detail; nobody paints into cell 47. This walks
   * the wet cells into connected groups so the answer is "the top left is still
   * open, about twenty seconds", which is how a painter holds it.
   */
  openPatches(threshold = 0.12): WetPatch[] {
    const now = this.now()
    const wet = new Map<number, number>()
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const w = this.cellWetness(col, row, now)
        if (w >= threshold) wet.set(this.key(col, row), w)
      }
    }
    if (wet.size === 0) return []

    const seen = new Set<number>()
    const patches: WetPatch[] = []

    for (const start of wet.keys()) {
      if (seen.has(start)) continue

      // Flood fill across the four-neighbourhood.
      const group: number[] = []
      const stack = [start]
      seen.add(start)
      while (stack.length > 0) {
        const key = stack.pop() as number
        group.push(key)
        const col = key % COLS
        const row = Math.floor(key / COLS)
        const around = [
          [col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1],
        ]
        for (const [c, r] of around) {
          if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue
          const k = this.key(c, r)
          if (!wet.has(k) || seen.has(k)) continue
          seen.add(k)
          stack.push(k)
        }
      }

      let minC = COLS
      let maxC = 0
      let minR = ROWS
      let maxR = 0
      let peak = 0
      let peakKey = group[0]
      for (const key of group) {
        const col = key % COLS
        const row = Math.floor(key / COLS)
        if (col < minC) minC = col
        if (col > maxC) maxC = col
        if (row < minR) minR = row
        if (row > maxR) maxR = row
        const w = wet.get(key) as number
        if (w > peak) {
          peak = w
          peakKey = key
        }
      }

      // Time left is asked of the wettest cell: the passage is open until its
      // last damp corner closes.
      //
      // Solving wetness(age) = threshold for age. With
      //   wetness = water * (1 - age/dry)^1.7
      // that is
      //   age = dry * (1 - (threshold/water)^(1/1.7))
      const cell = this.cells.get(peakKey)
      const left = cell
        ? Math.max(
            0,
            dryingTime(cell.water) * (1 - Math.pow(threshold / cell.water, 1 / 1.7)) - (now - cell.at),
          )
        : 0

      const x = minC * CELL
      const y = minR * CELL
      const w = (maxC - minC + 1) * CELL
      const h = (maxR - minR + 1) * CELL
      patches.push({
        x, y, w, h,
        wetness: Math.round(peak * 100) / 100,
        secondsLeft: Math.round(left / 1000),
        where: placeOf(x + w / 2, y + h / 2),
      })
    }

    return patches.sort((a, b) => b.w * b.h - a.w * a.h)
  }

  /** Everything dries at once. For clearing the sheet and for tests. */
  reset(): void {
    this.cells.clear()
  }
}

export const wetField = new WetField()
