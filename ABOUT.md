# Sable

**One sheet, two painters.** A watercolour studio where you and an AI agent both
hold the brush.

## Where it came from

Every time I make a picture with a model, I get the same feeling: I am standing
outside the thing I made. One petal is wrong, and my only move is to rewrite the
prompt and roll the dice on the whole image again. What comes back is a bitmap.
Every decision that produced it is already gone.

Then I read the WebMCP spec and realised it is the same complaint, one floor up.
An agent poking at a website by guessing which pixel is a button is stuck in
exactly that position: it can only act on the whole thing from the outside. The
fix in both cases is the same. Stop making it guess. Hand it real handles.

So Sable keeps the decisions. Every mark is an object with a pigment, a water
level, a brush, a layer and a path, whether a person dragged it with a mouse or
an agent wrote it as an SVG path through a tool call. Either of you can pick up
any mark, including the other's, and change it.

The agent isn't a generator here. It's a second painter at the same table.

**Why watercolour?** Because it's the hardest possible case for that argument.
You don't control watercolour by specifying an outcome. You choose how much
water is on the brush and then live with wherever it goes. If a structured,
revisable document beats prompting anywhere, it had better beat it here.

It also gives the agent numbers that mean something. `water: 0.9` isn't a style
token. It decides how far pigment creeps into the paper and whether the edge
blooms.

## What it does

Twenty-three tools on `document.modelContext`, and no prompt box anywhere.

Three of them I'm quietly proud of. **The paint answers back**: every `paint`
call returns what the water decided rather than what you asked for, so the agent
hears that its wash finished 109 units outside the path it gave, went soft on
the top left, and fused with something still wet. **The sheet dries on a clock**,
so painting into an open passage now fuses the marks and waiting means it won't.
And **it can squint**: a blur and a posterize down to four flat tones, which is
the cheapest thing in the codebase and by a mile the most useful, because the
faults that sink a painting are invisible in a normal look at it.

A duet is one picture split into named parts. No turns. Either painter grabs
whatever's free, and grabbing it is a click for you and `duet_take_part` for the
agent, both writing to the same board. The parts make you need each other: the
agent's foliage has to hang off branches you actually drew, and they never end
up where the score assumed.

Any painting also folds into a link, and I mean the painting, not a picture of
one. Every mark travels with its seed, so it re-renders identically and whoever
opens it can change anything in it.

## How it's built

The renderer is Canvas 2D written from scratch. No image models, no libraries,
no pre-baked brush textures. The brush footprint gets subdivided and each new
midpoint pushed sideways in proportion to its edge, over and over, so the
boundary gains detail at every scale. Everything composites with `multiply`,
because paint over paint filters the light twice. You can always deepen a
passage and never lighten one, and that constraint is most of what makes the
medium feel like the medium.

The important architectural decision is boring: the WebMCP handlers have no
private door into the document. They call the same commands the mouse does. One
undo stack, every stroke records its author, and an agent literally cannot reach
a state the UI couldn't have produced.

The toolbox is also alive. Select a mark and two new tools come into existence,
and one of them names the mark you just picked in its own description, so "make
this one wetter" needs no lookup. `undo` only exists when there's something to
undo.

## Everything I got wrong first

**The duet used to take turns.** Twelve passes, strictly alternating, nobody
allowed to touch the paper out of order. It proved two painters can share a
picture the way a metronome proves you can play music. Half the time you spent
in it, you were being told to wait. I deleted the queue.

**The studio used to paint the agent's parts itself** when nothing was
connected, so the demo still moved on a page with no agent attached. It moved,
and it was a lie. A canvas animating itself is not a collaboration. That's gone
too: an agent part gets painted by an agent, or it stays blank.

**The page called the agent's marks mine.** An agent whose browser couldn't
bridge WebMCP did the sensible thing and used the mouse, and every mark it made
got logged as mine, with the cursor beside it cheerfully reading "You". On a
page whose entire subject is two authors sharing a document, that's about the
worst thing it could get wrong. There's no reliable way to tell an agent's mouse
from a person's, and guessing from how the pointer moves would occasionally
inform a real human that they're a robot. So the page offers a handle instead of
inferring an answer: a real, named button sitting in the accessibility tree that
says the brush is the agent's now.

**One tool call weighed 44,000 characters**, nearly all of it base64. Fine if
the client understands image blocks. Catastrophic if it just stringifies them
into the model's context. Every image is bounded now and re-encodes smaller
until it fits. Same sheet, 13,000 characters, no harder to judge.

**And the two painters were getting different materials on one sheet.** My marks
looked like paint. The agent's looked like television static. Neither number was
wrong: granulation fills whatever shape it's clipped to, so a small mark shows a
fragment of the texture and reads as paper tooth, while a big flooded wash gets
the whole tile several times over and reads as noise. Scale was doing the
damage, and only one of us ever paints at the scale where it shows. Texture now
falls off as a mark grows:

$$\tau(r) \;=\; \frac{1}{1 + \dfrac{\max(0,\; r - 110)}{420}}$$

which is a claim about how eyes work rather than about pigment, and it belongs
in the renderer for the same reason the drying rim does.

## What I'd tell anyone building one of these

A tool that returns `{ ok: true }` leaves the agent painting blind. Give it a
picture back and it can look, judge and correct.

Tool descriptions are the API. I spent more time on the prose inside
`inputSchema` than on most of the functions behind it.

And build for the bridge failing, because it will. The fallback isn't a worse
version of your product. It's the accessibility tree, and it can carry a
three-line recipe for calling every one of your tools through evaluated
JavaScript. An agent that just read your DOM has already read that too.
