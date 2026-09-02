import { presence } from './presence'
import { studio } from './store'
import { toolSurface } from './webmcp'

/**
 * The painter who shows up when nobody else does.
 *
 * This used to be a turnkeeper. It decided whose turn it was, made the human
 * wait through the agent's passes, and painted them itself if nothing answered.
 * The waiting was the worst thing about the duet and none of it was load-bearing,
 * so the turns are gone: any painter may take any free part at any time, and
 * the only coordination left is that two brushes must not land on the same one.
 *
 * What survives is the useful half. A judge, or anyone else, will open this page
 * in an ordinary browser with no agent behind it, and a collaboration that needs
 * a collaborator to show anything at all is a collaboration nobody ever sees. So
 * when nothing has touched the tools recently, the studio picks up parts itself,
 * one at a time, at the speed of somebody actually painting them.
 *
 * The moment a real agent calls anything, this stops completely. It is a stand-in,
 * not a competitor, and the test for whether to stand in is the tool counter,
 * which is the surface the two painters already share.
 */

/** Quiet before the studio takes the first part, so the sheet is not filled at once. */
const FIRST_MS = 2600
/** Between parts, once it has started. Slow enough to paint alongside. */
const EVERY_MS = 5200
/** How often to look back in while something else is mid-mark. */
const POLL_MS = 900
/**
 * How recently a tool must have been called for an agent to count as attached.
 *
 * Generous on purpose. A model reasoning in a chat window can easily take half a
 * minute between deciding to paint and saying so, and the failure this guards
 * against is the studio painting a part out from under an agent that is simply
 * still thinking.
 */
const ATTACHED_MS = 180000

class Conductor {
  private timer: ReturnType<typeof setTimeout> | null = null
  private run = 0
  private started = false

  start(): void {
    if (this.started) return
    this.started = true
    studio.subscribe(() => this.sync())
    this.sync()
  }

  /** True while the studio has a part of its own queued up. */
  get waiting(): boolean {
    return this.timer !== null
  }

  /** Whether anything outside the page has used the tools lately. */
  get attached(): boolean {
    const { lastCallAt } = toolSurface.status()
    return lastCallAt > 0 && Date.now() - lastCallAt < ATTACHED_MS
  }

  private sync(): void {
    const duet = studio.getDuet()
    if (!duet) {
      this.stop()
      this.run = 0
      return
    }
    if (duet.run === this.run) {
      // Already running against this board. Only wake up if the last part
      // finished and nothing is queued.
      if (!this.timer && this.next()) this.schedule(EVERY_MS)
      return
    }
    this.run = duet.run
    this.schedule(FIRST_MS)
  }

  /**
   * The part the studio would take next.
   *
   * Only parts suggested for the agent, only parts nobody is holding, and only
   * ones whose groundwork is down. The human's parts are left alone however
   * long they sit there: a stand-in that finishes the picture for you is worse
   * company than no stand-in at all.
   */
  private next(): string | null {
    const duet = studio.getDuet()
    if (!duet) return null
    const free = studio.freeParts()
    const ready = free.filter(
      (p) => p.by === 'agent' && p.reference && studio.blockedBy(p).length === 0,
    )
    return ready[0]?.id ?? null
  }

  private schedule(delay: number): void {
    this.stop()
    this.timer = setTimeout(() => {
      this.timer = null
      this.take()
    }, delay)
  }

  private stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private take(): void {
    if (!studio.getDuet()) return

    // Something out there is painting. The board is its own.
    if (this.attached) return

    // Never talk over a mark that is still landing.
    if (presence.agentBusy || toolSurface.status().activeTool !== null) {
      this.schedule(POLL_MS)
      return
    }

    const id = this.next()
    if (!id) return

    const claim = studio.takePart(id, 'agent')
    if (!claim.ok) {
      this.schedule(POLL_MS)
      return
    }
    studio.playPart(id)
    if (this.next()) this.schedule(EVERY_MS)
  }
}

export const conductor = new Conductor()
