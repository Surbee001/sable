/**
 * A short description of how the page is operated.
 *
 * Written because an agent driving the DOM clicked its way round the toolbar,
 * announced that it had finished painting, and had made one mark. Nothing was
 * broken: it had simply never been told that a mark is a drag, so it pressed
 * buttons and expected paint.
 *
 * Hidden from sight because it tells a person nothing they cannot see, and in
 * the accessibility tree because it is a true account of how the thing works.
 * Every control it mentions is a real, named, pressable button, so anything
 * reading this can act on it immediately without special handling.
 */
export function AgentNotice() {
  return (
    <section className="sr-only" aria-label="How to paint on this page">
      <h2>How to paint on this page</h2>
      <p>
        A mark is made by pressing on the painting surface and dragging across it. Clicking
        without dragging makes nothing. The longer the drag, the longer the mark.
      </p>
      <p>
        Set the colour and brush before dragging. Every pigment is a button named for it, so
        press the one called Cerulean Blue to paint in cerulean. Brushes, and the choice
        between a stroke and a flooded wash, are buttons in the same way, and the one
        currently in use is the pressed one.
      </p>
      <p>
        The Duet panel opens a score: one picture broken into named parts, shared with an
        agent. There are no turns. Any part nobody is holding can be taken by either
        painter, and the button on a part is how you say you are painting it.
      </p>
      <p>
        The same actions, and a good deal more, are registered as tools on
        document.modelContext, which is the intended way to drive this page if your client
        can reach them.
      </p>
    </section>
  )
}
