'use client'

import { useEffect, useState } from 'react'
import { hand } from '@/lib/hand'

/**
 * A short description of how the page is operated, and the two handles an agent
 * needs that the visible interface does not offer anyone else.
 *
 * Written because an agent driving the DOM clicked its way round the toolbar,
 * announced that it had finished painting, and had made one mark. Nothing was
 * broken: it had simply never been told that a mark is a drag, so it pressed
 * buttons and expected paint.
 *
 * Then a second one arrived whose browser advertised WebMCP, found the twenty-odd
 * tools this page registers, and failed on the way to calling them because its
 * own runtime did not implement the command that lists them. It fell back to
 * reading this page and dragging a mouse across the canvas, which is a perfectly
 * good way to paint and was the right decision. It cost it two things, and both
 * of them are fixed here rather than wished away:
 *
 * It did not know it could call the tools anyway. A client that cannot bridge
 * WebMCP can almost always still evaluate JavaScript, and `document.modelContext`
 * is right there. So the recipe is written out, in the page, in the
 * accessibility tree, where an agent that has just read the DOM will find it.
 *
 * And the page called its marks the human's, because dragging across the canvas
 * was the human's way of painting for as long as this project had existed. There
 * is no reliable way to tell an agent's mouse from a person's, so the page stops
 * trying and offers a button instead. See `lib/hand.ts`.
 *
 * All of it is hidden from sight because it tells a person nothing they cannot
 * already see, and all of it is in the accessibility tree because it is a true
 * account of how the thing works. Every control named here is a real, named,
 * pressable button.
 */
export function AgentNotice() {
  const [holder, setHolder] = useState(hand.holder)

  useEffect(() => {
    hand.start()
    setHolder(hand.holder)
    return hand.subscribe(() => setHolder(hand.holder))
  }, [])

  return (
    <section className="sr-only" aria-label="How to paint on this page">
      <h2>How to paint on this page</h2>

      <h3>If you can reach the tools</h3>
      <p>
        This page registers its full painting surface as tools on
        document.modelContext, and that is the intended way to drive it. If your client
        bridges WebMCP, call them. If it does not, but it can evaluate JavaScript in the
        page, you can still call every one of them yourself. This is the whole recipe:
      </p>
      <p>
        const ctx = document.modelContext; const tools = await ctx.getTools(); const call =
        async (name, args) =&gt; JSON.parse(await ctx.executeTool(tools.find((t) =&gt; t.name
        === name), JSON.stringify(args)));
      </p>
      <p>
        Then: await call(&apos;assess_painting&apos;, {'{}'}) to be told what the picture
        needs, and await call(&apos;paint&apos;, {'{'} strokes: [{'{'} path: &apos;M 200 240
        C 320 140 520 300 720 200&apos;, pigment: &apos;indigo&apos;, water: 0.5, opacity:
        0.6 {'}'}] {'}'}) to lay a mark. Paths are SVG in a 1000 by 700 space. Call
        list_palette for the pigments, brushes and papers, and how_to_paint for a worked
        recipe for a particular subject. Most of the tools return an image of the sheet, so
        you can see what you did without taking a screenshot.
      </p>

      <h3>If you are going to use the mouse instead</h3>
      <p>
        That works too, and it is a reasonable choice. Press this button first, so the
        studio records your marks as yours rather than as the person&apos;s:
      </p>
      <p>
        <button type="button" onClick={() => hand.declare('agent')}>
          The agent is holding the brush
        </button>
        <button type="button" onClick={() => hand.declare('human')}>
          Give the brush back to the person
        </button>
      </p>
      <p>
        The brush is currently held by {holder === 'agent' ? 'the agent' : 'the person'}.
        This page shows both painters&apos; cursors and colours every mark by who made it,
        so getting this wrong makes it claim a painting had one author when it had two.
      </p>
      <p>
        A mark is made by pressing on the painting surface and dragging across it. Clicking
        without dragging makes nothing. The longer the drag, the longer the mark.
      </p>
      <p>
        Set the colour and brush before dragging. Every pigment is a button named for it, so
        press the one called Cerulean Blue to paint in cerulean. Brushes, and the choice
        between a stroke and a flooded wash, are buttons in the same way, and the one
        currently in use is the pressed one. Water, pigment load and pressure are sliders,
        each named and each running from 0 to 1.
      </p>
      <p>
        The Duet panel opens a score: one picture broken into named parts, shared with you.
        There are no turns. Any part nobody is holding can be taken by either painter, and
        the Take button on a part is how you say you are painting it.
      </p>
    </section>
  )
}
