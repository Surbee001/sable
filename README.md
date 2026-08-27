# Sable

**A watercolour studio where you and an AI agent both hold the brush.**

Built for [The WebMCP Challenge](https://webmcp.devpost.com/). MIT licensed.

---

## The argument

When you make an image with a model, the only way to participate is the prompt.
You cannot reach into the picture. If one petal is wrong you go back to the
prompt and roll the dice on all of it again. The output is a bitmap: the
decisions that produced it are gone by the time you see it.

Sable keeps the decisions. Every mark on the sheet — whether a person dragged it
with a mouse or an agent wrote it as an SVG path through a tool call — stays a
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

Watercolour is not a medium you control by specifying an outcome — you control
it by choosing how much water is on the brush and then living with where it
goes. It is the least promptable thing to paint. If a structured, revisable
document beats prompting anywhere, it should beat it here.

It also gives the agent parameters that mean something. `water: 0.9` is not a
style token; it changes how far the pigment creeps into the paper, whether the
edge blooms, and how much the wash feathers out. The agent is reaching for real
properties of a real medium, not adjectives.

## What is actually simulated

The renderer is written from scratch in Canvas 2D (`lib/watercolor.ts`). No
image models, no libraries, no pre-baked brush textures. Every mark is built the
same way a wash actually forms:

- **Fractal edge deformation.** The brush footprint is subdivided and each new
  midpoint pushed sideways in proportion to its edge, repeatedly, so the boundary
  gains detail at every scale — the way a wet edge creeps unevenly into paper
  fibre. Roughly a dozen independently deformed copies are stamped at low alpha.
- **Subtractive layering.** Everything composites with `multiply`, because
  watercolour is subtractive: paint over paint filters the light twice. You can
  always deepen a passage and never lighten one, which is the constraint that
  makes the medium what it is.
- **Edge darkening.** As a wash dries, water evaporates fastest at the perimeter
  and drags pigment with it, leaving the rim darker than the pool. It is the
  single most recognisable signature of the medium.
- **Granulation.** Heavy pigments — ultramarine, cerulean, burnt sienna — settle
  into the valleys of the paper tooth and mottle. Staining pigments — phthalo
  blue, quinacridone rose — do not. Both are properties on the pigment, and both
  scale with how much pigment is actually in suspension.
- **Blooms.** Above a certain wetness, water shoves pigment outward into a pale
  cauliflower, done by lifting paint back out of the stroke buffer.
- **Dry brush.** Fine channels parallel to the brush's travel, so a starved brush
  skips across the tooth instead of flooding it.

Paper is not decorative either: tooth depth changes how strongly granulating
pigments mottle, and painting onto a *wet layer* makes the mark bleed.

## The WebMCP surface

Registered on `document.modelContext`, with
[`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill)
as the fallback where the browser has no native implementation. Everything lives
in `lib/webmcp.ts`.

### Core tools

| Tool | What it does |
| --- | --- |
| `look_at_canvas` | Returns **an image of the sheet** plus a written summary |
| `inspect_region` | Returns an enlarged crop, for judging one passage closely |
| `read_painting` | Every stroke as structured data — id, pigment, water, bounds, path |
| `paint` | Lays down one or many marks; returns an image of the result |
| `revise_stroke` | Changes a mark that is already down, by id, keeping it the same mark |
| `transform_strokes` | Moves and resizes marks without repainting them |
| `lift_strokes` | Takes marks back off |
| `list_palette` | Pigments, brushes and papers, with how each behaves |
| `manage_layers` | Adds layers, sets wetness and visibility |
| `set_sheet` | Changes the paper or retitles the study |

### Two things worth looking at

**1. The tools return pictures.** A tool result that only says `{ ok: true }`
leaves the agent painting blind — it has to imagine the consequence of its own
brushwork, in a medium whose whole character is that it does something you did
not quite specify. `paint`, `revise_stroke`, `look_at_canvas` and
`inspect_region` all return an `image` content block, so the agent can look at
what it did, judge it, and correct it. That loop is the difference between an
agent that fires off strokes and one that paints.

**2. The toolbox is a live description of what is possible.** The set of
registered tools is not a fixed manifest. It is rebuilt, firing `toolchange`,
whenever the *shape* of what the studio can do changes:

- Select a mark in the UI and `describe_selection` and `revise_selection` come
  into existence — and `revise_selection`'s **description names the mark you
  picked**: *"Revise exactly what the human currently has selected — a wash in
  Quinacridone Rose on layer 'Body' (round brush, water 0.75, around 380,300)."*
  So when you say "make this one wetter", the agent already knows what "this"
  is. It never has to ask, and it never has to guess.
- `undo` exists only when there is something to undo. `redo` only after an undo.
  `clear_sheet` only when the sheet is not already empty.

The registration key is deliberately the *shape* of the surface rather than the
document, so `toolchange` fires exactly when the available tools genuinely
differ, not on every brushstroke.

You can watch this happen: the **Agent surface** panel lists the live tool set
and highlights entries as they appear.

### One command path

The WebMCP handlers do not have a private door into the document. They call the
same commands on the same store that the mouse does (`lib/store.ts`), which
means:

- One shared undo stack. You can undo the agent's marks; it can undo yours.
- Every stroke records its author, and the studio log shows who did what, with
  the agent's own note on why.
- An agent cannot reach a state the UI could not have produced.

## Try it

Open the live URL and the sheet already has a study on it — painted partly by an
agent, partly by hand, as the log shows.

- Press **V**, click any mark, and the inspector takes it apart: pigment, water,
  pressure, brush, its literal SVG path. Change any of it. Marks the agent
  painted are no more fixed than your own.
- Watch the **Agent surface** panel as you select and deselect.
- Then ask the agent something like:
  - *"Look at the canvas. What would you add?"*
  - *"The top petal is too cold — warm it and make it bleed more."*
  - *"Paint a second flower behind this one, smaller and paler so it sits back."*
  - Select a mark and say *"push this one back"*.

## Running locally

```bash
npm install
npm run dev
```

WebMCP needs a browser that exposes `document.modelContext` — recent Chrome, or
ChatGPT's in-app browser. Everywhere else the polyfill installs it, so the page
and its tools still work.

```bash
npm run build      # production build; fully static
npm run typecheck
```

## Layout

```
lib/
  types.ts        the document model — strokes, layers, brushes, papers
  palette.ts      pigments, with granulation / staining / density
  geometry.ts     SVG path sampling, brush outlines, fractal deformation
  watercolor.ts   the renderer
  store.ts        the observable document: one command path for both authors
  webmcp.ts       the tool surface, core and contextual
  snapshot.ts     offscreen rendering, so tools can return images
  hit.ts          click testing
  seed.ts         the study on the sheet when you arrive
components/       the studio UI
app/lab/          a renderer test sheet, used to tune the engine by eye
```

`app/lab` is not linked from the app. It renders a grid of swatches — a water
sweep, every brush, granulating against staining pigments, an opacity ramp — and
is how the constants in `TUNING` were chosen. It is left in because it is how
the engine was actually built.

## Credits

Watercolour behaviour is modelled on the real medium rather than on any
particular paper; the pigment properties are drawn from how those pigments
actually handle. Type is Fraunces and Inter.
