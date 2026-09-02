# Video script

Under three minutes, public on YouTube, audio required, no webcam needed. A
screen recording of the ChatGPT desktop app with Sable open, narrated live while
you and the agent paint *The fox* together.

The split: **the agent paints the whole animal, you paint the world it sits in.**
Most of the animal's parts are marked as yours in the score, and asking it to
take them anyway is the point. The dot beside a part is a suggestion, not a
lock, and the fastest way to show that is to ignore it on camera.

It also gives you a dependency running in both directions. You lay the snow
first so the animal lands on wet paper. It paints the legs. Then you put the
shadow where its legs *actually* ended, which is not where the score assumed.

---

## The prompt

Say this out loud while you type it. It is written to be spoken.

> Sable's open in front of me and you should have its tools. Start the fox, and
> paint the whole animal: the body, the head, the ears, the tail and the white
> tip, the chest, the legs, the eye and the nose, the whiskers. A few of those
> are marked as mine. Take them anyway, that's what I'm asking for. Take one or
> two at a time and paint them before you take any more, rather than claiming
> the lot up front. I'll do the world around it, so leave me the ground, the
> shadow and the weeds. Tell me what you've taken as you go.

If you want a shorter opener:

> Sable's open here and its tools should be in your list. Start the fox and
> paint the whole animal, a part or two at a time. Leave me the ground, the
> shadow and the weeds.

Follow-up once its marks are down, with one of them selected:

> Make this one wetter, and let it bleed into the body.

---

## The run

**Open on the ChatGPT desktop app with the Site tools panel showing the list.**

> This is Sable. It's a watercolour studio built so an agent can paint in it
> alongside me instead of for me.

> Everything here is what the page hands it. Twenty-three tools registered on
> `document.modelContext`. There's no prompt box anywhere in the product. It
> doesn't describe a picture to a model. It picks up a brush.

**(~20s. Switch to the studio, open Duet, take "The ground" and lay the snow
wash yourself before you say anything to the agent.)**

> A duet is one picture split into named parts. No turns. Anything nobody's
> holding, either of us can take. I'm laying the snow first so the animal has
> wet paper to land on.

**(~40s. Send the prompt.)**

> I've asked it for the whole animal. Notice that most of those parts are
> marked as mine. That dot is a suggestion, not a rule, and it just took them.

**(~55s. Marks start landing. Stop talking and let a wash arrive.)**

> That's a real tool call. It chose a path, a pigment, a water level and a
> brush, and the studio painted it. The watercolour is simulated from scratch in
> Canvas 2D. There is no image model anywhere in this.

> And the paint answers back. When a wash lands, the result tells it what the
> water actually did rather than what it asked for: how far past its path it
> finished, which side went soft, what fused with something still wet. So the
> next mark can be a reply.

**(~85s. Take "The shadow" while it is still working.)**

> I'm taking the shadow, and I'm doing it last on purpose, because I need to see
> where its legs actually landed. The score guessed. It was wrong. That's the
> whole reason to paint this way with somebody.

**(~105s. Paint the shadow under the real legs, then trace the weeds.)**

**Press V and click one of the agent's marks.**

> The toolbox is alive too. Watch the tool list when I select one of its marks.
> Two tools just came into existence, and one of them names this exact mark in
> its own description, so I don't have to look anything up.

**Send: "Make this one wetter, and let it bleed into the body."**

**(~140s. It revises the selected mark in place.)**

> It didn't repaint it. It changed the mark that was already there. Same object,
> same id, same undo stack, because its tools call exactly the same commands my
> mouse does.

**Press Replay.**

> And because the painting is a list of decisions in the order they were taken,
> it replays with nothing recorded. Blue is the agent, orange is me.

**(~160s.)**

> I'll be honest: this is not a good painting. Not yet. But nobody prompted it.
> Every mark in it is a decision one of us made, and either of us can still
> change any of them.

> That's a different thing from generating an image, and it's the thing I
> actually wanted. A picture I can reach into and argue with.

**(~180s. End on the finished sheet.)**

---

## If you have to cut

Three beats have to survive: **Site tools listing the tools**, **the agent
painting a real mark**, and **selecting one of its marks and asking it to change
that one**. Everything else is optional. Lose the replay last.

## Notes

- Open on the tool list, not the studio. A judge may stop at exactly three
  minutes, so the WebMCP claim has to land in the first fifteen seconds.
- Say "WebMCP", "`document.modelContext`" and "tools" out loud. The rules ask
  the audio to cover how you used WebMCP.
- No music. The rules forbid copyrighted material and it is not worth the risk.
- When a wash is landing, stop talking and let it land. The silence sells it
  better than narration.
- If it only takes some of the animal, just say "take the rest of it too" rather
  than re-explaining. That exchange is more convincing than a clean first try.
- Ask it to work a part or two at a time. It is better television than a silent
  minute of claiming, the human can see what it intends, and it keeps the tool
  descriptions short, which is what a browser is actually willing to hold.
