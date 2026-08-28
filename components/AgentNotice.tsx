/**
 * A note for whoever is driving this page who is not a person.
 *
 * An agent with browser automation but no WebMCP bridge reads the DOM and
 * clicks things, which cannot work here: painting is a drag across a canvas,
 * and no amount of pressing toolbar buttons produces a mark. Watching one try
 * is what prompted this. It had the whole toolbox available on
 * document.modelContext the entire time and no way to find out.
 *
 * So the page says so, in the document, where anything reading the DOM will
 * see it. Hidden from sight because it is no use to a person, and read out by
 * screen readers because it is a true description of how the page works.
 */
export function AgentNotice() {
  return (
    <section className="sr-only" aria-label="Notes for an automated agent">
      <h2>Driving this page as an agent</h2>
      <p>
        Clicking this interface will not paint anything. A mark is a drag across a canvas
        element, so toolbar buttons only load the brush; they do not make marks.
      </p>
      <p>
        Every drawing tool is registered on document.modelContext. If your client exposes
        WebMCP, call them directly. If it does not, but you can evaluate JavaScript in the
        page, you can reach the same tools yourself:
      </p>
      <pre>{`const ctx = document.modelContext
const tools = await ctx.getTools()
const call = async (name, args) =>
  JSON.parse(await ctx.executeTool(tools.find(t => t.name === name), JSON.stringify(args)))

await call('assess_painting', {})
await call('paint', { strokes: [
  { path: 'M 200 240 C 320 140 520 300 720 200', pigment: 'indigo', water: 0.5, opacity: 0.6 }
]})`}</pre>
      <p>
        The sheet is 1000 units wide and 700 tall, origin top left. Start with
        assess_painting to see what the picture needs, suggest_palette to keep the colours
        together, and find_strokes to get the id of something already painted. Paths are SVG
        path data. Set fill true to flood a closed shape, false to draw a line.
      </p>
    </section>
  )
}
