import { sampleSubpaths, type Point } from './geometry'
import { WET, type Stroke } from './types'

/**
 * Who is at the table, and where their hand is.
 *
 * The agent's marks arrive all at once, in a single tool call, which is honest
 * about how the model works but tells you nothing about what it did. So the
 * document takes the strokes immediately, and this layer decides when the
 * screen shows them: one at a time, with a cursor travelling along each path as
 * it lands. The picture on screen catches up with the document within about a
 * second, and in the meantime you get to watch someone paint.
 *
 * This is presentation only. Every tool that reports back on the sheet renders
 * the whole document, so the agent is never shown a half-finished version of
 * its own work.
 */

export type Who = 'human' | 'agent'

export interface Cursor {
  x: number
  y: number
  visible: boolean
  /** True while the brush is down, which thickens the trail. */
  painting: boolean
}

const IDLE: Cursor = { x: 0, y: 0, visible: false, painting: false }

/** How long the agent's hand takes to travel one mark. */
function durationFor(length: number): number {
  return Math.max(240, Math.min(900, 180 + length * 1.5))
}

/**
 * How long a mark takes to sink into the paper.
 *
 * Paint does not arrive finished. It goes on pale and tight, creeps outward
 * into the fibre, deepens as the water carries pigment down, and only pulls a
 * dark rim once it starts to dry. Wetter paint takes longer to do all of it.
 */
function settleFor(water: number): number {
  return 620 + water * 900
}

/** Slow at the end, the way a drying edge does. */
function ease(t: number): number {
  return 1 - Math.pow(1 - t, 2.2)
}

class Presence {
  private cursors: Record<Who, Cursor> = { human: { ...IDLE }, agent: { ...IDLE } }
  /**
   * Marks queued but not yet shown. Held as the exception rather than keeping a
   * set of everything visible: a stroke nobody queued is simply on the paper,
   * so undo, redo, loading a study and painting by hand all need no special
   * case here.
   */
  private pending = new Set<string>()
  private queue: Array<{ id: string; points: Point[] }> = []
  /** Marks on the paper but still wetting in, against when they landed. */
  private settling = new Map<string, { at: number; duration: number }>()
  private settleFrame = 0
  /** The mark currently being laid down, and how much of it exists so far. */
  private drawing: { id: string; points: Point[]; fill: boolean } | null = null
  private running = false
  private listeners = new Set<() => void>()
  private failsafe: ReturnType<typeof setTimeout> | null = null

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  cursor(who: Who): Cursor {
    return this.cursors[who]
  }

  /**
   * The part of the agent's current mark that exists so far.
   *
   * A mark that appears whole the moment the cursor stops is not a mark being
   * painted, it is a mark being pasted. The line has to come out from under the
   * cursor as it travels, which means the view needs the traversed portion of
   * the path, not just where the hand is.
   */
  get inProgress(): { id: string; points: Point[]; fill: boolean } | null {
    return this.drawing
  }

  get agentBusy(): boolean {
    return this.running
  }

  /* -------------------- the human -------------------- */

  setHuman(x: number, y: number, painting: boolean): void {
    const c = this.cursors.human
    if (c.x === x && c.y === y && c.painting === painting && c.visible) return
    this.cursors.human = { x, y, painting, visible: true }
    this.emit()
  }

  hideHuman(): void {
    if (!this.cursors.human.visible) return
    this.cursors.human = { ...this.cursors.human, visible: false, painting: false }
    this.emit()
  }

  /* -------------------- reveal -------------------- */

  isRevealed(id: string): boolean {
    return !this.pending.has(id)
  }

  /** True once the mark has finished wetting in and belongs on the sheet. */
  isSettled(id: string): boolean {
    return !this.pending.has(id) && !this.settling.has(id)
  }

  get settlingIds(): string[] {
    return [...this.settling.keys()]
  }

  /** 0 the instant it lands, 1 when it has dried. */
  settleProgress(id: string): number {
    const entry = this.settling.get(id)
    if (!entry) return 1
    const t = ease(Math.min(1, (performance.now() - entry.at) / entry.duration))
    // Picks up exactly where the mark under the brush left off.
    return WET + (1 - WET) * t
  }

  /** Start a mark wetting into the paper. */
  beginSettle(ids: Array<{ id: string; water: number }>): void {
    const now = performance.now()
    for (const { id, water } of ids) {
      this.settling.set(id, { at: now, duration: settleFor(water) })
    }
    if (ids.length > 0) this.runSettle()
  }

  /**
   * Retire marks as they finish drying.
   *
   * Only emits when the set actually changes. The frame-by-frame redraw of a
   * drying wash is driven by the view's own animation loop; waking React sixty
   * times a second to say the same thing would cost far more than the painting.
   */
  private runSettle(): void {
    this.emit()
    if (this.settleFrame) return
    const step = () => {
      this.settleFrame = 0
      const now = performance.now()
      let changed = false
      for (const [id, entry] of this.settling) {
        if (now - entry.at >= entry.duration) {
          this.settling.delete(id)
          changed = true
        }
      }
      if (changed) this.emit()
      if (this.settling.size > 0) this.settleFrame = requestAnimationFrame(step)
    }
    this.settleFrame = requestAnimationFrame(step)
  }

  /** Queue the agent's marks so they arrive one at a time, under a cursor. */
  announce(strokes: Stroke[]): void {
    this.water = new Map([
      ...this.water,
      ...strokes.map((s) => [s.id, s.water] as const),
    ])
    this.filled = new Map([
      ...this.filled,
      ...strokes.map((s) => [s.id, s.fill === true] as const),
    ])
    if (strokes.length === 0) return

    for (const stroke of strokes) {
      const points = sampleSubpaths(stroke.path, 6).flat()
      if (points.length < 2) continue
      this.pending.add(stroke.id)
      this.queue.push({ id: stroke.id, points })
    }
    if (this.queue.length === 0) return

    // If the tab is hidden the animation frame never fires, so guarantee the
    // painting is complete regardless of whether anyone watched it happen.
    if (this.failsafe) clearTimeout(this.failsafe)
    this.failsafe = setTimeout(() => this.flush(), 1200 + strokes.length * 700)

    if (!this.running) this.run()
  }

  /** Show everything immediately and stop animating. */
  private water = new Map<string, number>()
  private filled = new Map<string, boolean>()

  flush(): void {
    this.drawing = null
    const now = performance.now()
    for (const id of this.pending) {
      this.settling.set(id, { at: now, duration: settleFor(this.water.get(id) ?? 0.5) })
    }
    if (this.pending.size > 0) this.runSettle()
    this.pending.clear()
    this.queue = []
    this.running = false
    this.cursors.agent = { ...IDLE }
    if (this.failsafe) {
      clearTimeout(this.failsafe)
      this.failsafe = null
    }
    this.emit()
  }

  private run(): void {
    this.running = true
    let item = this.queue.shift()
    if (!item) {
      this.running = false
      return
    }

    let start = performance.now()
    let length = pathLengthOf(item.points)
    let duration = durationFor(length)

    const step = () => {
      if (!item) return
      const t = Math.min(1, (performance.now() - start) / duration)
      const at = pointAt(item.points, t)
      this.cursors.agent = { x: at.x, y: at.y, painting: true, visible: true }

      // Hand the view the line so far, so the mark comes out from under the
      // cursor instead of arriving once the cursor has stopped.
      this.drawing = {
        id: item.id,
        points: walked(item.points, t),
        fill: this.filled.get(item.id) === true,
      }

      if (t >= 1) {
        this.drawing = null
        this.pending.delete(item.id)
        this.beginSettle([{ id: item.id, water: this.water.get(item.id) ?? 0.5 }])
        item = this.queue.shift()
        if (!item) {
          this.running = false
          this.drawing = null
          // Let the hand rest a moment where it finished, then lift away.
          setTimeout(() => {
            if (!this.running) {
              this.cursors.agent = { ...IDLE }
              this.emit()
            }
          }, 700)
          this.emit()
          return
        }
        start = performance.now()
        length = pathLengthOf(item.points)
        duration = durationFor(length)
      }

      this.emit()
      requestAnimationFrame(step)
    }

    requestAnimationFrame(step)
  }
}

function pathLengthOf(pts: Point[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return total
}

/** The part of a polyline already travelled, at fraction t. */
function walked(pts: Point[], t: number): Point[] {
  if (pts.length < 2 || t <= 0) return pts.slice(0, 1)
  if (t >= 1) return pts
  const target = pathLengthOf(pts) * t
  const out: Point[] = [pts[0]]
  let gone = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (gone + seg >= target) {
      const f = seg === 0 ? 0 : (target - gone) / seg
      out.push({
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
      })
      return out
    }
    out.push(pts[i])
    gone += seg
  }
  return out
}

/** Position a fraction of the way along a polyline. */
function pointAt(pts: Point[], t: number): Point {
  if (pts.length === 0) return { x: 0, y: 0 }
  if (pts.length === 1 || t <= 0) return pts[0]
  if (t >= 1) return pts[pts.length - 1]

  const target = pathLengthOf(pts) * t
  let walked = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (walked + seg >= target) {
      const f = seg === 0 ? 0 : (target - walked) / seg
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
      }
    }
    walked += seg
  }
  return pts[pts.length - 1]
}

export const presence = new Presence()
