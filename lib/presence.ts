import { sampleSubpaths, type Point } from './geometry'
import type { Stroke } from './types'

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

  /** Queue the agent's marks so they arrive one at a time, under a cursor. */
  announce(strokes: Stroke[]): void {
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
  flush(): void {
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

      if (t >= 1) {
        this.pending.delete(item.id)
        item = this.queue.shift()
        if (!item) {
          this.running = false
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
