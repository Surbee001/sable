/**
 * Who is on the other end of the pointer.
 *
 * The studio assumed that a mark made by dragging across the canvas was made by
 * a person, because for most of its life that was the only way one could be. It
 * is not true any more. An agent in a browser that cannot reach
 * `document.modelContext` still has a mouse, and it uses it: it reads the page,
 * presses the pigment button by its name, drags across the sheet, and takes a
 * screenshot to see what happened. Every one of those marks was logged as the
 * human's, the cursor beside it said "You", and the authorship colours showed a
 * painting made entirely by one painter. On a page whose whole subject is two
 * authors sharing a document, that is the worst thing it could get wrong.
 *
 * So the pointer has a holder, and it is not assumed. Two ways it changes:
 *
 * **The page can tell.** An event synthesised by injected script is not trusted,
 * and a session under automation says so on the navigator. Either is proof, and
 * proof is acted on without asking.
 *
 * **Or it can be told.** Neither signal catches an agent driving the real input
 * pipeline of its own browser, which is exactly what the in-app browsers do, and
 * no amount of watching the pointer distinguishes that from a hand with
 * certainty. Guessing from the shape of the movement would mean sometimes
 * telling a person they are a robot, which is a worse failure than the one being
 * fixed. So the page offers a handle instead: a named, pressable button that
 * says the brush is the agent's now. It sits in the accessibility tree, next to
 * the note explaining how to paint here, where an agent reading the page will
 * find it and a person will not be bothered by it.
 *
 * Offering the handle rather than inferring the answer is the same choice the
 * rest of this project makes about agents. Do not make it guess, and do not
 * guess about it.
 */

export type Holder = 'human' | 'agent'

class Hand {
  private declared: Holder | null = null
  private machine = false
  private listeners = new Set<() => void>()
  private started = false

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  /** Look for the signals that are available at load. */
  start(): void {
    if (this.started || typeof navigator === 'undefined') return
    this.started = true
    if (navigator.webdriver === true) {
      this.machine = true
      this.emit()
    }
  }

  /** Whose marks the pointer is making. */
  get holder(): Holder {
    if (this.declared) return this.declared
    return this.machine ? 'agent' : 'human'
  }

  /** True when the page worked it out rather than being told. */
  get detected(): boolean {
    return this.machine
  }

  /** True when somebody said so outright. */
  get declaredHolder(): Holder | null {
    return this.declared
  }

  /**
   * Say who is holding the brush. Null goes back to whatever the page can tell.
   *
   * A person taking the brush back says `human` rather than null, because on a
   * page that has already proved it is automated, going back to the automatic
   * answer would hand it straight back to the agent.
   */
  declare(who: Holder | null): void {
    if (this.declared === who) return
    this.declared = who
    this.emit()
  }

  /**
   * Watch a pointer event for proof.
   *
   * `isTrusted` is false only for an event some script dispatched, which is one
   * of the two ways an agent without WebMCP reaches this canvas. It is never
   * false for a hand.
   *
   * Proof outranks the declaration, and this is the one place it does. Everywhere
   * else being told beats guessing, but "somebody said a person was holding the
   * brush" and "this event was not made by a person" are not two opinions: the
   * second is a fact about the event that just arrived, and a stale claim must
   * not be able to launder synthesised input into the human's column.
   */
  observe(e: { isTrusted: boolean }): void {
    if (e.isTrusted) return
    const wasHuman = this.declared === 'human'
    if (this.machine && !wasHuman) return
    this.machine = true
    if (wasHuman) this.declared = null
    this.emit()
  }
}

export const hand = new Hand()
