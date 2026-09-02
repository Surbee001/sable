# Sable

**One sheet, two painters.** A watercolour studio where you and an AI agent both
hold the brush.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/). MIT licensed.

---

## The argument

When you make an image with a model, the only way to take part is the prompt.
You cannot reach into the picture. If one petal is wrong you go back and roll
the dice on all of it. The output is a bitmap, and the decisions that made it
are gone by the time you see it.

Sable keeps the decisions. Every mark, whether a person dragged it with a mouse
or an agent wrote it as an SVG path through a tool call, stays a structured
object with a pigment, a water level, a brush, a layer and a path. Either author
can pick up any mark, including the other's, and change it.

That is also what WebMCP is for. An agent driving a web app by guessing at the
UI is in the same position as someone editing a painting by re-prompting: it can
only act on the whole thing from outside. WebMCP lets the page hand out real
handles. Sable does the same one layer down, for the picture.

**The agent is not a generator here. It is a second painter at the same table.**

## Why watercolour

Because it is the hardest case for that argument. Watercolour is not controlled
by specifying an outcome, but by choosing how much water is on the brush and
living with where it goes. If a structured, revisable document beats prompting
anywhere, it should beat it here.

It also gives the agent parameters that mean something. `water: 0.9` is not a
style token. It changes how far pigment creeps into the paper, whether the edge
blooms, and how far the wash feathers out.

## What is simulated

Written from scratch in Canvas 2D (`lib/watercolor.ts`). No image models, no
libraries, no pre-baked brush textures.

- **Fractal edge deformation.** The brush footprint is subdivided and each new
  midpoint pushed sideways in proportion to its edge, repeatedly, so the
  boundary gains detail at every scale. A dozen independently deformed copies
  are stamped at low alpha.
- **Subtractive layering.** Everything composites with `multiply`, because paint
  over paint filters the light twice. You can always deepen a passage and never
  lighten one, which is the constraint that makes the medium what it is.
- **Edge darkening.** Water evaporates fastest at the perimeter and drags
  pigment with it, leaving the rim darker than the pool.
- **Granulation.** Heavy pigments settle into the paper tooth and mottle.
  Staining pigments do not. Both scale with how much pigment is in suspension.
- **Blooms**, **dry brush**, and **pigment separation**, so a wash is never
  exactly one hue.
- **Wetting in.** A mark arrives pale and tight, creeps outward, deepens, and
  pulls its rim last. You watch every stroke do it, whoever made it.

Paper is not decorative either: tooth depth changes how strongly pigments
mottle, and painting onto a wet layer makes the mark bleed.

## The WebMCP surface

Registered on `document.modelContext`, with
[`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill)
as the fallback. All of it is in `lib/webmcp.ts`.

| Tool | What it does |
| --- | --- |
| `assess_painting` | **Measures** the sheet and says what it needs next |
| `how_to_paint` | A worked recipe for a subject: the passes, the numbers, and the trap |
| `find_strokes` | Finds marks by pigment, author, region or note, without reading everything |
| `select_strokes` | Highlights marks on the human's screen, to point at something |
| `set_brush` | Loads the brush the human is holding, and sets their mode |
| `undo`, `redo`, `clear_sheet` | Full control of the canvas, always available |
| `look_at_canvas` | An image of the sheet, plus a written summary |
| `squint` | The sheet as four flat values, the way a painter checks one |
| `inspect_region` | An enlarged crop, for judging one passage |
| `read_painting` | Every stroke as data: id, pigment, water, bounds, path |
| `paint` | Lays down one or many marks, returning an image of the result |
| `revise_stroke` | Changes marks already down, one or many, keeping them the same marks |
| `transform_strokes` | Moves and resizes without repainting |
| `lift_strokes` | Takes marks back off |
| `suggest_palette` | Seven limited palettes, with a role per pigment |
| `list_palette` | Pigments, brushes and papers, and how each behaves |
| `manage_layers`, `set_sheet` | Layers, wetness, paper, title |
| `share_painting` | Turns the sheet into a link that carries the marks, not a picture |
| `open_painting` | Opens somebody else's link, every mark still editable |

### The sheet answers back

Three things here that an agent-driven canvas does not usually have. All three
were already simulated in `lib/watercolor.ts` and none of them was ever said out
loud, which meant the agent was working in a medium it could not perceive.

**1. The paint reports what it did.** Every `paint` call comes back with the
things the water decided, not the things that were asked for: how far past its
path a wash finished, which side of it went soft, where a cauliflower opened,
what granulated, what fused with what.

```
WHAT THE PAINT DID, which is not what you asked for and is the point:
  • The sky finished about 109 units outside the path you gave it,
    and went softest on its top left.
  • A cauliflower opened in the far range at (775, 224), about 108 across.
    The water backran before the wash had set. It cannot be painted out,
    only worked with.
  • The near land landed on paper still wet from the far range and fused
    with it. There is no edge between them now, and there is no getting one back.
```

This is the README's own argument made mechanical. Watercolour is not controlled
by specifying an outcome; you choose how much water is on the brush and live
with where it goes. An agent that never hears where it went is not painting in
the medium, it is issuing shapes and receiving a JPEG. Now the next mark can be
a reply. The renderer emits these as it draws (`StrokeContext.observe`), so the
report is the same arithmetic that made the pixels rather than a second copy of
it that would drift.

**2. The sheet is wet in places, and dries on a clock.** Layer wetness was a
constant: the Ground layer was 0.6 wet whether you had painted on it a second
ago or never. `lib/wetfield.ts` gives the paper its own wetness on a grid,
charged where a mark lands and decaying over the next half-minute or so. Every
result says which passages are still open and roughly how many seconds are left
in them. Paint into one now and the marks fuse and soften; wait and they will
not. That is the one decision watercolour has that no other medium does, and it
is now a decision rather than an accident.

A mark's ground wetness is frozen into the mark when it lands, so re-rendering
stays deterministic (same seed, same painting, forever). What the sheet was
doing when the brush touched is a permanent fact about that mark.

**3. It can squint.** A photograph of a painting shows you what you painted, and
every mark in it still looks like the thing you meant, which is exactly why the
faults that sink a picture are invisible in one. `squint` throws away the detail
and the colour and returns the sheet as four flat tones, plus where the weight
actually sits, where the eye will actually go, and how hard the edges actually
came out once the water had finished with them, all measured off the rendered
paint rather than off what was requested.

It is a blur and a posterize, the cheapest thing in `lib/perceive.ts` and by a
distance the most useful, because it turns the question that decides whether a
painting works into something an agent can be shown rather than told.

### Three more things worth looking at

**1. The tools return pictures.** A result that only says `{ ok: true }` leaves
the agent painting blind, in a medium whose whole character is doing something
you did not quite specify. `paint`, `revise_stroke`, `look_at_canvas` and the
rest return an `image` content block, so the agent can look at what it did,
judge it, and correct it.

**2. The agent works out what to do rather than being told.** There is no prompt
box. `assess_painting` measures two different things. From the document: pigment
count, which ninths are untouched, whether the big shapes are anchored to the
edges. From the rendered paint itself: the value structure, where the weight
sits, where the eye goes, how hard the edges came out. The failure mode of
painting without measuring is always the same, whoever holds the brush, and the
half of it that lives in the pixels rather than in the document is the half that
used to be guessed at.

**3. The toolbox is a live description of what is possible.** The registered set
is rebuilt, firing `toolchange`, whenever the *shape* of what the studio can do
changes. Select a mark and `describe_selection` and `revise_selection` come into
existence, and the latter's description **names the mark you picked**, so "make
this one wetter" needs no lookup. `undo` exists only when there is something to
undo. The Agent tab lists the live set and lights a tool up while it is called.

### One command path

The WebMCP handlers have no private door into the document. They call the same
commands the mouse does (`lib/store.ts`), so there is one shared undo stack,
every stroke records its author, and an agent cannot reach a state the UI could
not have produced.

## The duet

A blank sheet never forces two people to depend on each other. A score does.

A score is one picture broken into named **parts**, each with a brief, a
suggested painter and, where a hand is meant to make the mark, a guide to trace.
There are three of them: **Evening river**, a landscape; **The fox**, an animal
that arrives as one flooded silhouette; and **Deep water**, a jellyfish painted
on bare paper and then glazed over with the sea, which is the order watercolour
actually demands and the reason the medium is painted light to dark.

### Nobody waits

The first version of this alternated. Twelve passes, human, agent, human, agent,
nobody allowed to touch the paper out of turn. It proved that the two of them can
work on one picture the way a metronome proves you can play music, and half the
time you spent in it was spent being told to wait.

So the queue is gone. Every part with nothing standing in front of it is open to
either painter at any moment, and the only rule left is the honest one: two
brushes must not land on the same part. **Taking a part is how you say so**, and
it is a click for the human and `duet_take_part` for the agent, both writing to
the same board. That makes the coordination a real negotiation over a shared
surface rather than a turn the software hands out. `duet_release_part` exists for
the moment one of them says they wanted that one.

`by` is a suggestion about which painter a part suits, and the panel says so.
Take any of them.

Dependencies advise rather than refuse. Foliage hung on branches nobody has drawn
is a worse painting, not an error, so the panel greys the part and names what is
missing, and lets you take it anyway.

Two things survive from the old version and both earn their place. The parts
still make the painters need each other: the agent's foliage hangs off branches
the human drew, and where those actually ended is not where the score imagined
they would be, so its brief sends it to look first. And **the studio stands in**.
Open this page with no agent behind it and the parts marked for one get painted
anyway, one at a time, at the speed of somebody actually painting them, because a
collaboration that needs a collaborator before it shows anything is one nobody
ever sees. The moment a real agent calls anything, the studio stops completely.
It can tell, because tool calls are counted, and the tool surface is the thing the
two of them already share.

## When the bridge does not work

An agent turned up in a browser that advertised WebMCP, found the tools this
page registers, and never called one. Its runtime did not implement the command
that lists them, which is not something this page can fix. So it did the sensible
thing: it read the DOM, pressed the pigment button by its name, dragged a mouse
across the canvas, and took screenshots to see what it had done.

That is a fine way to paint here and the page now supports it properly.

**It is told it can call the tools anyway.** A client that cannot bridge WebMCP
can almost always still evaluate JavaScript, and `document.modelContext` is
right there. The three-line recipe for calling any tool through it is written out
in the page, in the accessibility tree, next to the note explaining that a mark
is a drag. An agent that has just read the DOM will have read that too.

**And its marks are its own.** The studio used to record anything dragged across
the canvas as the human's, because for as long as it had existed that was the
only way one could be made. So an agent painting with a mouse got a sheet where
the cursor beside its own work said "You" and the authorship colours showed one
painter. On a page about two authors sharing a document, that is the worst thing
it could get wrong.

There is no reliable way to tell an agent's mouse from a person's. Events
synthesised by injected script are not trusted and a session under automation
says so, and both are acted on as proof, but neither catches an agent driving the
real input pipeline of its own browser, which is what the in-app browsers do.
Guessing from the shape of the movement would mean sometimes telling a person
they are a robot, which is a worse failure than the one being fixed.

So the page offers a handle instead of inferring an answer: a real, named,
pressable button saying the brush is the agent's now, sitting in the
accessibility tree where an agent will find it and a person will not be bothered
by it. While it is held, the human sees a line saying so and a button to take it
back. Proof outranks the declaration in the one place it should: an event that
was not made by a person cannot be laundered into the human's column by a stale
claim that it was.

Not making the agent guess, and not guessing about the agent, is the same choice
twice.

## Keeping the decisions

The studio spent its README arguing that a painting is a list of decisions rather
than a bitmap while reloading the tab destroyed every one of them, and while the
only thing you could take away was a PNG, which is exactly the flattened
unrevisable object the argument is against.

**The sheet writes itself down** as you work and comes back when you return.

**The painting packs into a link.** What travels is the document: every mark
arrives as a mark, with its pigment, its water, its brush, its author and its
seed, so the person who opens it can select any of them and change it, or ask
their own agent to. It re-renders identically because the seeds travel too. A
study of a hundred marks gzips to a URL you can paste into a message. `Share`
does it for the human, `share_painting` for the agent, and `open_painting` reads
one back.

That last one is also why the reading tools now carry
`untrustedContentHint`. Once a painting can arrive from a stranger, the notes on
its marks are that stranger's prose being handed to a model, and saying so is
what the hint is for.

**And it replays.** Because the document is already a list of decisions in the
order they were taken, each carrying who took it, playing the painting back is a
slice of that list and a clock. Nothing is recorded. A study that arrived in a
link plays back exactly as well as one painted in the room, which no amount of
screen recording would manage. Watching it is the clearest thing this project has
to say: a finished sheet looks like one painting, and played back, with each mark
named as it lands, it is visibly a conversation.

## Try it

The sheet starts blank. Paint on it, or open **Duet** and paint one in turns.

- Press **V**, click any mark, and the Mark panel takes it apart: pigment,
  water, pressure, brush, its literal SVG path. Change any of it.
- Press **Tab** to hide the panels and leave only the paper.
- Open **Duet**, pick a score, and take whatever part you like. The studio takes
  the rest if nothing is connected.
- Press **Replay** and watch it get made, mark by mark, colour-coded by who made
  each one.
- Press **Share**, send the link to somebody, and watch them change your marks.
- Ask an agent: *"Assess the painting and do whatever it needs most."* Or
  *"start the fox and take the parts you want, tell me which ones you left me."*
  Or select a mark and say *"push this one back."*

See [TESTING.md](TESTING.md) for how to connect an agent and a console self
check that needs none.

## Running locally

```bash
npm install
npm run dev      # then npm run build for a static production build
```

WebMCP needs a browser exposing `document.modelContext`: recent Chrome with
`--enable-features=WebMCP`, or ChatGPT's in-app browser. Elsewhere the polyfill
installs it so the studio still works, and the Agent panel says plainly that
nothing is connected.

## Layout

```
lib/
  types.ts        the document model
  palette.ts      pigments, with granulation, staining, density
  geometry.ts     path sampling, brush outlines, fractal deformation
  watercolor.ts   the renderer
  store.ts        the observable document, one command path for both authors
  webmcp.ts       the tool surface, core and contextual
  assess.ts       what the picture needs next, measured
  presence.ts     cursors, and when a mark appears rather than when it exists
  hand.ts         who is on the other end of the pointer
  conductor.ts    the painter who shows up when nobody else does
  duet.ts         the three scores, and what each part of them is
  subjects.ts     how particular things are painted, pass by pass
  fallback-context.ts  our own document.modelContext, for when nothing supplies one
  snapshot.ts     offscreen rendering, so tools can return images
  persist.ts      the sheet written down, and packed into a link
components/       the studio UI
app/globals.css   the design system, including every swatch colour
```

Nothing is styled inline. Colour, elevation, type and layout live in
`app/globals.css`, including a generated class per pigment, so the markup never
carries a `style` attribute.
