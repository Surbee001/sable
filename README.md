# Sable

**A watercolour studio where you and an AI agent both hold the brush.**

Built for [The WebMCP Challenge](https://webmcp.devpost.com/). MIT licensed.

---

## The argument

When you make an image with a model, the only way to take part is the prompt.
You cannot reach into the picture. If one petal is wrong you go back to the
prompt and roll the dice on all of it again. The output is a bitmap, and the
decisions that produced it are gone by the time you see it.

Sable keeps the decisions. Every mark on the sheet, whether a person dragged it
with a mouse or an agent wrote it as an SVG path through a tool call, stays a
structured object with a pigment, a water level, a brush, a layer and a path.
Either author can pick up any mark, including the other's, and change it.

That is also, almost exactly, what WebMCP is for. An agent driving a web app by
guessing at the UI is in the same position as someone editing a painting by
re-prompting: it can only act on the whole thing from the outside. WebMCP lets
the page hand out real handles. Sable does the same thing one layer down, for
the picture.

**The agent is not a generator here. It is a second painter at the same table.**

## Why watercolour

Because it is the hardest case for this argument, and the most honest one.

Watercolour is not a medium you control by specifying an outcome. You control it
by choosing how much water is on the brush and then living with where it goes.
It is the least promptable thing to paint. If a structured, revisable document
beats prompting anywhere, it should beat it here.

It also gives the agent parameters that mean something. `water: 0.9` is not a
style token. It changes how far the pigment creeps into the paper, whether the
edge blooms, and how much the wash feathers out. The agent is reaching for real
properties of a real medium, not adjectives.

## What is actually simulated

The renderer is written from scratch in Canvas 2D (`lib/watercolor.ts`). No
image models, no libraries, no pre-baked brush textures. Every mark is built the
way a wash actually forms:

- **Fractal edge deformation.** The brush footprint is subdivided and each new
  midpoint pushed sideways in proportion to its edge, repeatedly, so the boundary
  gains detail at every scale, the way a wet edge creeps unevenly into paper
  fibre. Roughly a dozen independently deformed copies are stamped at low alpha.
- **Subtractive layering.** Everything composites with `multiply`, because
  watercolour is subtractive: paint over paint filters the light twice. You can
  always deepen a passage and never lighten one, which is the constraint that
  makes the medium what it is.
- **Edge darkening.** As a wash dries, water evaporates fastest at the perimeter
  and drags pigment with it, leaving the rim darker than the pool. It is the
  single most recognisable signature of the medium.
- **Granulation.** Heavy pigments such as ultramarine, cerulean and burnt sienna
  settle into the valleys of the paper tooth and mottle. Staining pigments such
  as phthalo blue and quinacridone rose do not. Both are properties on the
  pigment, and both scale with how much pigment is actually in suspension.
- **Blooms.** Above a certain wetness, water shoves pigment outward into a pale
  cauliflower, done by lifting paint back out of the stroke buffer.
- **Dry brush.** Fine channels parallel to the brush's travel, so a starved brush
  skips across the tooth instead of flooding it.
- **Wetting in.** A mark does not arrive finished. It goes on pale and tight,
  creeps outward into the fibre, deepens, and only pulls its dark rim once it
  begins to dry. You watch every stroke do this, whoever made it.
- **Pigment separation.** Each layer of pigment lands slightly warmer or cooler
  than the last, so a wash is never exactly one hue.

Paper is not decorative either. Tooth depth changes how strongly granulating
pigments mottle, and painting onto a wet layer makes the mark bleed.

## The WebMCP surface

Registered on `document.modelContext`, with
[`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill)
as the fallback where the browser has no native implementation. Everything lives
in `lib/webmcp.ts`.

### Core tools

| Tool | What it does |
| --- | --- |
| `assess_painting` | **Measures** the sheet and says what it needs next |
| `look_at_canvas` | Returns an image of the sheet plus a written summary |
| `inspect_region` | Returns an enlarged crop, for judging one passage closely |
| `read_painting` | Every stroke as structured data: id, pigment, water, bounds, path |
| `paint` | Lays down one or many marks, and returns an image of the result |
| `revise_stroke` | Changes a mark that is already down, by id, keeping it the same mark |
| `transform_strokes` | Moves and resizes marks without repainting them |
| `lift_strokes` | Takes marks back off |
| `list_palette` | Pigments, brushes and papers, with how each behaves |
| `manage_layers` | Adds layers, sets wetness and visibility |
| `set_sheet` | Changes the paper or retitles the study |

### Three things worth looking at

**1. The tools return pictures.** A tool result that only says `{ ok: true }`
leaves the agent painting blind. It has to imagine the consequence of its own
brushwork, in a medium whose whole character is that it does something you did
not quite specify. `paint`, `revise_stroke`, `transform_strokes`,
`look_at_canvas` and `inspect_region` all return an `image` content block, so
the agent can look at what it did, judge it, and correct it. That loop is the
difference between an agent that fires off strokes and one that paints.

**2. The agent works out what to do, rather than being told.** There is no
prompt box on this page. `assess_painting` measures the document instead: how
many pigments are in play, whether there is a genuine dark anywhere, how far the
values actually spread, which ninths of the sheet are untouched, and how the
soft edges balance against the crisp ones. Then it says what follows.

The failure mode of painting without measuring is always the same, whoever is
holding the brush: a new hue for every shape, nothing properly dark, every edge
equally soft, and a picture that goes flat. Those are not lapses of taste. They
are lapses of measurement, and every one of them is visible in the document, so
the page can just compute them and hand them over.

**3. The toolbox is a live description of what is possible.** Watch the Agent
tab while the agent works: a tool lights up while it is being called, and leaves
a fading trail of what was used just before. The set of
registered tools is not a fixed manifest. It is rebuilt, firing `toolchange`,
whenever the *shape* of what the studio can do changes:

- Select a mark in the UI and `describe_selection` and `revise_selection` come
  into existence, and `revise_selection`'s **description names the mark you
  picked**: *"Revise exactly what the human currently has selected, which is a
  wash in Quinacridone Rose on layer 'Body' (round brush, water 0.75, around
  380,300)."* So when you say "make this one wetter", the agent already knows
  what "this" is. It never has to ask, and it never has to guess.
- `undo` exists only when there is something to undo. `redo` only after an undo.
  `clear_sheet` only when the sheet is not already empty.

The registration key is deliberately the *shape* of the surface rather than the
document, so `toolchange` fires exactly when the available tools genuinely
differ, not on every brushstroke. The rebuild is also deferred by a task: some
of these tools change the state that decides whether they exist, and tearing
down a registration while its own call is still running fails that call.

You can watch all of this happen. The **Agent** tab lists the live tool set and
highlights entries as they appear.

### One command path

The WebMCP handlers do not have a private door into the document. They call the
same commands on the same store that the mouse does (`lib/store.ts`), which
means:

- One shared undo stack. You can undo the agent's marks, and it can undo yours.
- Every stroke records its author, and the studio log shows who did what, with
  the agent's own note on why.
- An agent cannot reach a state the UI could not have produced.

## The duet

A blank sheet never forces a person and an agent to depend on each other. A
score does.

**Evening river** is a landscape in the old manner, painted in twelve passes
that alternate. The agent lays the sun and the far hills; you trace the nearer
ridge. It floods the river; you break it with ripples. It lays the bank; you
grow grass out of it, draw the pine, and put the branches where you want them.
Then it hangs the foliage off the branches you actually made, which is not
where the score imagined they would be, so its brief tells it to go and look
first.

The guide shows where a mark goes. It does not make the mark: what lands on the
paper is your line, with your hand in it. Your brush is loaded for you at the
start of each pass, so a pass is about placement rather than about hunting for
the right pigment.

While a score is running, two more tools exist:

| Tool | What it does |
| --- | --- |
| `duet_status` | The whole score, which pass is current, whose turn, and the brief for it |
| `duet_complete_turn` | Hands the brush back. Registered only when it is actually the agent's turn |

`duet_complete_turn`'s description **is** the brief for the current pass, so the
agent's instructions change every time the turn comes back to it.

### Turns hand over by themselves

There is no button to make the agent go. A duet with a button on the agent's
passes is not a duet, it is a slideshow the human advances.

So the turn simply happens: when the score comes round to the agent, the studio
pauses for a beat and then paints it. Unless a real agent is already working, in
which case the studio keeps out of the way. It can tell the difference because
tool calls are counted, and counted in two kinds: a call that changes the
painting means something out there has taken the turn, and a call that only
looks at it means something is still thinking. Looking buys a few more seconds.
Painting buys a minute.

That is the whole handover protocol, and it needs no coordination between the
two of them, because the tool surface is already the thing they share.

## The timeline

Under the sheet, the whole journey in two lanes: the agent's marks above, yours
below, in the order they happened. Play it back and the painting rebuilds itself
mark by mark, with the one that has just landed ringed on the paper so you can
see which it is.

The arrangement is the point. A list of marks tells you what happened; two lanes
tell you *how it went*. Long runs in one lane are somebody working alone, and
the places the lanes interleave are where the painting was actually made
together. On the study that ships with the app you can read it without playing
anything: seven marks laid in by the agent, then a human one, then back and
forth to the end.

Both lanes hold a cell for every mark, filled in one and empty in the other, so
the two stay in step without anything being positioned by hand.

None of it is possible unless the sheet is a list of marks rather than a picture
of them. There is nothing to reconstruct: winding back just means drawing fewer.
A flattened image cannot be asked what it looked like ten minutes ago, and that
difference is the entire argument of the project, so it is worth being able to
watch.

## Try it

Open the live URL and the sheet already has a study on it, painted partly by an
agent and partly by hand, as the log shows.

- Press **V**, click any mark, and the Mark panel takes it apart: pigment, water,
  pressure, brush, its literal SVG path. Change any of it. Marks the agent
  painted are no more fixed than your own.
- Watch the **Agent** tab as you select and deselect.
- Press **Tab** to hide the panels and leave only the paper.
- Open the **Duet** tab and start *Evening river* to paint one landscape in
  turns.
- Then ask the agent something like:
  - *"Assess the painting and do whatever it needs most."*
  - *"Look at the canvas. What would you add?"*
  - *"The top petal is too cold. Warm it and make it bleed more."*
  - *"Paint a second flower behind this one, smaller and paler so it sits back."*
  - Select a mark and say *"push this one back"*.

## Running locally

```bash
npm install
npm run dev
```

### Connecting an agent

The page is a WebMCP *provider*: it registers tools on `document.modelContext`
and never speaks MCP itself. Something else has to carry the calls in. There are
three ways that happens, and the Agent tab tells you which one you are in.

- **The browser implements WebMCP.** Chrome launched with
  `--enable-features=WebMCP`, or ChatGPT's in-app browser. Sable registers into
  the browser's own context and its agent can call every tool. Nothing to set up.
- **An extension supplies it.** The [MCP-B extension](https://docs.mcp-b.ai)
  injects a `document.modelContext` of its own and relays the page's tools out
  to a client such as Claude Desktop. Sable finds it already there and registers
  into it. This is the easiest path on an ordinary Chrome.
- **Neither, so the polyfill.** `@mcp-b/webmcp-polyfill` gives the page the same
  API and **no transport at all**, and is explicit that browser transport
  belongs to the separate MCP-B runtime. The toolbox is real and wired to the
  document, the studio works, and nothing outside the page can call it. The
  panel says so rather than showing a live connection, because the failure it
  would otherwise cause is someone debugging their agent when the answer is
  their browser.

```bash
npm run build      # production build, fully static
npm run typecheck
```

## Layout

```
lib/
  types.ts          the document model: strokes, layers, brushes, papers
  palette.ts        pigments, with granulation, staining and density
  geometry.ts       SVG path sampling, brush outlines, fractal deformation
  watercolor.ts     the renderer
  store.ts          the observable document, one command path for both authors
  webmcp.ts         the tool surface, core and contextual
  snapshot.ts       offscreen rendering, so tools can return images
  hit.ts            click testing
  assess.ts         what the picture needs next, measured rather than guessed
  conductor.ts      whose turn it is, without anyone pressing anything
  seed.ts           the study on the sheet when you arrive
  duet.ts           the score for a painting made in turns
  presence.ts       cursors, and when a mark appears rather than when it exists
  theme.ts          light and dark
components/         the studio UI
app/globals.css     the whole design system, including every swatch colour
```

Nothing is styled inline. Colour, elevation, type and layout all live in
`app/globals.css`, including a generated class per pigment and paper, so the
markup never carries a `style` attribute.

## Credits

Watercolour behaviour is modelled on the real medium rather than on any
particular paper, and the pigment properties are drawn from how those pigments
actually handle. Type is Figtree.
