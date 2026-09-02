# Video script

Under three minutes, public on YouTube, audio required, no webcam needed. Screen
recording of the ChatGPT desktop app with the studio open, narrated live while
you and the agent paint.

Rough timings assume a normal speaking pace. Everything in **bold** is the
action on screen, not something to read out.

---

**Open on the ChatGPT desktop app, Site tools panel already showing the list.**

> This is Sable. It's a watercolour studio, and it's built so an AI agent can
> paint in it alongside me rather than for me.

> Everything you can see here is what the page hands the agent. Twenty-three
> tools, registered on `document.modelContext`. No prompt box anywhere in the
> product. The agent doesn't describe a picture to a model. It picks up a brush.

**(~20s. Switch to the studio, blank sheet, open the Duet panel.)**

> A duet is one picture split into named parts, each with a brief. There are no
> turns. Anything nobody's holding, either of us can take.

**Type to the agent: "Start the fox, take the parts you want, and tell me which
ones you're leaving me."**

> I'm asking it to take whatever it wants and tell me what's left.

**(~40s. Marks start landing. Let one wash arrive on screen before talking over
it.)**

> That's a real tool call. It chose a path, a pigment, a water level and a
> brush, and the studio painted it. The watercolour is simulated from scratch in
> Canvas 2D. There's no image model anywhere in this.

> And the paint answers back. When a wash lands, the tool result tells the agent
> what the water actually did, not what it asked for: how far past its path it
> finished, which side went soft, what fused with something still wet. So the
> next mark can be a reply.

**(~70s. Take a human part. The brief appears, the brush loads itself, guides
show on the paper. Draw them.)**

> Now my half. Taking a part loads my brush for me and puts guides on the paper.
> What lands is my line, not the guide.

> And this is the point of doing it this way: its next part hangs off the marks
> I just made, and where they actually ended isn't where the score assumed. So
> its brief tells it to go and look first.

**(~105s. Let the agent take another part that depends on yours.)**

> The toolbox is also alive. It changes shape as the studio does.

**Press V and click one of the agent's marks.**

> Watch the tool list when I select one of its marks. Two new tools just came
> into existence, and one of them names this exact mark in its own description,
> so I can say "make this one wetter" and it doesn't need to look anything up.

**Say to the agent: "Push this one back."**

**(~135s. It revises the selected mark in place.)**

> It didn't repaint it. It changed the mark that was already there. Same object,
> same id, same undo stack, because the tools call exactly the same commands my
> mouse does.

**Press Replay.**

> And because the painting is a list of decisions in the order they were taken,
> it replays without anything being recorded. Blue is the agent, orange is me.

**(~155s. Let it run for a few seconds.)**

> I'll be honest with you: these aren't good paintings. Not yet. But nobody
> prompted this one. Every mark in it is a decision somebody made and either of
> us can still change.

> That's a different thing from generating an image, and it's the thing I
> actually wanted: a picture I can reach into and argue with.

**(~175s. End on the finished sheet.)**

---

## If you have to cut

The three that have to survive: **Site tools listing the tools**, **the agent
painting a real mark**, and **selecting a mark and asking it to change that
one**. Everything else is optional. The replay is the nicest thing to lose last.

## Notes

- Open on the tool list, not on the studio. Judges may stop at three minutes and
  the WebMCP part has to land in the first fifteen seconds.
- Say the words "WebMCP", "`document.modelContext`" and "tools" out loud. The
  rules ask the audio to cover how you used WebMCP.
- No music. The rules forbid copyrighted material and it is not worth the risk.
- Don't narrate over silence while nothing moves. If a wash is landing, stop
  talking and let it land.
