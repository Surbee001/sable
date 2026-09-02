# Sable

**One sheet, two painters.** A watercolour studio where you and an AI agent both
hold the brush.

## Inspiration

When you make a picture with a model, the only way to take part is the prompt.
You cannot reach into the image. If one petal is wrong you go back and roll the
dice on all of it. What you get is a bitmap, and the decisions that made it are
gone by the time you see it.

An agent driving a website by guessing at the UI is in exactly the same
position. It can only act on the whole thing from outside, by pressing what
looks like a button and hoping. That is what WebMCP fixes: the page stops making
the agent guess and hands out real handles.

Sable does the same move one layer further down, for the picture itself. Every
mark, whether a person dragged it with a mouse or an agent wrote it as an SVG
path through a tool call, stays a structured object with a pigment, a water
level, a brush, a layer and a path. Either author can pick up any mark,
including the other's, and change it.

**The agent is not a generator here. It is a second painter at the same table.**

### Why watercolour

Because it is the hardest case for that argument. Watercolour is not controlled
by specifying an outcome. You choose how much water is on the brush and live
with where it goes. If a structured, revisable document beats prompting
anywhere, it should beat it here.

It also gives the agent parameters that mean something. `water: 0.9` is not a
style token. It changes how far pigment creeps into the paper, whether the edge
blooms, and how far the wash feathers out.

## What it does

Twenty-three tools on `document.modelContext`. The agent can look at the sheet,
squint at it, measure what it needs, paint, revise marks already down, move
them, lift them, and take parts of a shared score. There is no prompt box
anywhere in the product.

Three things here that an agent-driven canvas does not usually have.

**The paint reports what it did.** Every `paint` call comes back with the things
the water decided, not the things that were asked for: how far past its path a
wash finished, which side went soft, where a cauliflower opened, what fused with
what. An agent that never hears where the water went is not painting in the
medium, it is issuing shapes and receiving a JPEG.

**The sheet is wet in places and dries on a clock.** Paint into an open passage
now and the marks fuse; wait and they will not. Every result says which passages
are still open and roughly how many seconds are left in them. That is the one
decision watercolour has that no other medium does, and it is now a decision
rather than an accident.

**It can squint.** A photograph of a painting shows you what you painted, which
is exactly why the faults that sink a picture are invisible in one. `squint`
throws away the detail and the colour and returns the sheet as four flat tones,
plus where the weight actually sits and how hard the edges came out once the
water had finished with them. It is a blur and a posterize, the cheapest thing
in the codebase and by a distance the most useful.

## How we built it

**The renderer is written from scratch in Canvas 2D.** No image models, no
libraries, no pre-baked brush textures. The brush footprint is subdivided and
each new midpoint pushed sideways in proportion to its edge, repeatedly, so the
boundary gains detail at every scale. A dozen independently deformed copies are
stamped at low alpha. Everything composites with `multiply`, because paint over
paint filters the light twice: you can always deepen a passage and never lighten
one, which is the constraint that makes the medium what it is.

How far a wash creeps past the path it was given:

$$s \;=\; k\,\bigl(0.2 + 0.8\,w + 0.5\,g\bigr)$$

with $w$ the water on the brush and $g$ the wetness already in the paper. The
same arithmetic that draws the pixels emits the report the agent reads, so the
two can never drift apart.

**The WebMCP surface has no private door into the document.** Every handler
calls the same commands the mouse does, so there is one shared undo stack, every
stroke records its author, and an agent cannot reach a state the UI could not
have produced.

**The toolbox is a live description of what is possible.** The registered set is
rebuilt, firing `toolchange`, whenever the *shape* of what the studio can do
changes. Select a mark and `describe_selection` and `revise_selection` come into
existence, and the latter's description **names the mark you picked**, so "make
this one wetter" needs no lookup. `undo` exists only when there is something to
undo.

**A duet is a board, not a queue.** One picture split into named parts, each with
a brief. Nobody takes turns. Any free part can be claimed by either painter at
any moment, and claiming it is a click for the human and `duet_take_part` for
the agent, both writing to the same board. The parts make the two need each
other: the agent's foliage has to hang off branches the human actually drew, and
where those ended is not where the score imagined.

**A painting packs into a link.** Not a picture of one. Every mark travels with
its pigment, water, brush, author and seed, so it re-renders identically and
whoever opens it can change any of it, or ask their own agent to. And because
the document is already a list of decisions in the order they were taken, it
replays without anything being recorded.

## Challenges we ran into

**The turn-based duet was the wrong idea.** The first version alternated: twelve
passes, nobody allowed to touch the paper out of turn. It proved two painters
can share a picture the way a metronome proves you can play music. Half the time
you spent in it was spent being told to wait. We threw the queue away.

**The studio used to paint the agent's parts when nothing was connected.** It
made the demo move on a page with no agent attached, and it was a lie. A canvas
animating itself is not a collaboration. It is gone: an agent part is painted by
an agent calling the tools, or it stays unpainted.

**The page called the agent's marks the human's.** An agent whose browser could
not bridge WebMCP did the sensible thing and used the mouse, and every one of
its marks was logged as ours, with the cursor beside it reading "You". There is
no reliable way to tell an agent's mouse from a person's, and guessing from how
the pointer moves would occasionally tell a person they are a robot. So the page
offers a handle instead of inferring an answer: a real, named button in the
accessibility tree saying the brush is the agent's now.

**A tool call was too heavy.** `look_at_canvas` was returning 44,000 characters,
nearly all base64. A client that understands image blocks shows the model a
picture; one that does not puts that into the context as text. Every image is
now bounded, re-encoding smaller until it fits. Same sheet, 13,000 characters,
no harder to judge.

**The two painters were getting different materials on one sheet.** Granulation
and pooling fill whatever shape they are clipped to. A hand paints small marks
and sees a fragment of the texture, which reads as paper tooth; an agent paints
big flooded shapes and got the whole tile several times over, which reads as
static. Neither number was wrong. Scale was doing the damage, and only one of
the two painters ever works at the scale where it shows. So texture is now
pulled back as a mark grows:

$$\tau(r) \;=\; \frac{1}{1 + \dfrac{\max(0,\; r - r_0)}{\lambda}}, \qquad r_0 = 110,\; \lambda = 420$$

which is a statement about looking rather than about pigment, and belongs in the
renderer for the same reason the drying rim does.

## What we learned

**A result that says `{ ok: true }` leaves the agent painting blind.** Tools that
return an image close the loop, and in a medium whose whole character is doing
something you did not quite specify, that is the difference between an agent
that fires off strokes and one that can look, judge and correct.

**Tool descriptions are the API.** More thought went into the prose in
`inputSchema` than into most of the functions behind it.

**Registering tools and being reachable are different things.** The polyfill
installs the API and no transport with it, so a complete working toolbox can sit
there unreachable. Reporting that as a live connection sends someone hunting for
a fault in their agent when the answer is their browser, so the page says which
of the two it is.

**Build for the bridge failing.** It will. The fallback is not a worse version of
the product: it is the accessibility tree, and it can carry a three-line recipe
for calling every tool through evaluated JavaScript. An agent that has just read
the DOM has already read that too.

## Built with

- **TypeScript**, **React 19**, **Next.js 16** (App Router, statically exported)
- **Canvas 2D** for the entire watercolour renderer, written from scratch
- **WebMCP** via `document.modelContext`, with `@mcp-b/webmcp-polyfill` and
  `@mcp-b/webmcp-types` as the fallback, plus a hand-rolled context of our own
  for browsers where even the polyfill does not take
- **CompressionStream** (gzip) and base64url, so a painting fits in a URL
- **Tailwind CSS 4** for its reset only; every rule in the design system is
  hand-written in one stylesheet, including a generated class per pigment, so no
  markup carries a `style` attribute
- **Phosphor Icons**, **Figtree** via `next/font`
- **Node.js** and **npm** for tooling, **Vercel** for hosting, **Vercel
  Analytics**
- About 14,000 lines, MIT licensed, no image models anywhere in it
