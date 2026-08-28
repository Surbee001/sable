import { presence } from './presence'
import { studio } from './store'
import { toolSurface } from './webmcp'

/**
 * Whose turn it is, without anyone having to press anything.
 *
 * A duet with a button on the agent's passes is not a duet, it is a slideshow
 * the human advances. So the turn simply happens: when the score comes round to
 * the agent, the studio pauses for a beat and then paints it.
 *
 * Unless a real agent is already working, in which case the studio keeps out of
 * the way. It can tell the difference because tool calls are counted: if the
 * count has moved since this turn began, something is out there thinking, and
 * the right thing to do is wait for it. That is the whole handover protocol,
 * and it needs no coordination between the two of them because the tool surface
 * is already the thing they share.
 */

/** Pause before the studio takes a turn itself, so the change is legible. */
const HANDOVER_MS = 1500
/** How long to keep waiting once an agent has actually started painting. */
const PAINTING_MS = 60000
/** How long a silent agent gets after its last look at the sheet. */
const THINKING_MS = 9000
/** How often to look back in while an agent is mid-turn. */
const POLL_MS = 900

class Conductor {
  private timer: ReturnType<typeof setTimeout> | null = null
  private turnIndex = -1
  private turnStartedAt = 0
  private mutationsAtStart = 0
  private started = false

  start(): void {
    if (this.started) return
    this.started = true
    studio.subscribe(() => this.sync())
    this.sync()
  }

  /** True while the studio is waiting on something that is not the human. */
  get waiting(): boolean {
    return this.timer !== null
  }

  private sync(): void {
    const duet = studio.getDuet()
    if (!duet) {
      this.stop()
      this.turnIndex = -1
      return
    }
    if (duet.index === this.turnIndex) return

    // A new pass. Note where the tool counter stood, so we can tell whether
    // anything picks the turn up.
    this.turnIndex = duet.index
    this.turnStartedAt = Date.now()
    this.mutationsAtStart = toolSurface.status().mutationCount
    this.stop()

    const step = studio.currentStep()
    if (step?.by === 'agent') this.schedule(HANDOVER_MS)
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
    const step = studio.currentStep()
    if (!step || step.by !== 'agent') return

    // Never talk over the previous pass while it is still landing.
    if (presence.agentBusy) {
      this.schedule(POLL_MS)
      return
    }

    const status = toolSurface.status()
    const now = Date.now()

    // Mid-call: never cut across it.
    if (status.activeTool !== null) {
      this.schedule(POLL_MS)
      return
    }

    // Something out there has put paint on this pass, so it owns the turn.
    if (status.mutationCount > this.mutationsAtStart && now - this.turnStartedAt < PAINTING_MS) {
      this.schedule(POLL_MS)
      return
    }

    // It has only been looking. Looking is not taking the turn, but it is a
    // reason to hold off a little longer before painting over its thinking.
    if (status.lastCallAt > 0 && now - status.lastCallAt < THINKING_MS) {
      this.schedule(POLL_MS)
      return
    }

    studio.playAgentStep()
  }
}

export const conductor = new Conductor()
