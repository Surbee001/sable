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
/**
 * How recently a tool must have been called for an agent to count as attached.
 *
 * This is the distinction that matters. "Is something mid-turn" is not the same
 * question as "is anyone out there", and answering only the first one means the
 * studio paints over a model that is simply still thinking. A model reasoning
 * in a chat window can easily take half a minute between deciding to paint and
 * saying so, which is an eternity next to a timer built for an empty room.
 */
const ATTACHED_MS = 180000
/** How long an attached agent gets before the studio assumes it has stalled. */
const ATTENDED_MS = 90000
/** How long to keep waiting once an agent has actually started painting. */
const PAINTING_MS = 120000
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

  /**
   * Whether anything outside the page has used the tools lately.
   *
   * If so the turns belong to it and the studio should keep its hands off,
   * however long it takes to answer. If not, nobody is coming, and painting the
   * pass ourselves is the only way the score moves.
   */
  get attached(): boolean {
    const { lastCallAt } = toolSurface.status()
    return lastCallAt > 0 && Date.now() - lastCallAt < ATTACHED_MS
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
    if (step?.by === 'agent') this.schedule(this.attached ? POLL_MS : HANDOVER_MS)
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

    // An agent is attached and this turn is its own. Silence is it thinking,
    // not it being absent, so wait rather than paint over the top of it.
    if (this.attached && now - this.turnStartedAt < ATTENDED_MS) {
      this.schedule(POLL_MS)
      return
    }

    studio.playAgentStep()
  }
}

export const conductor = new Conductor()
