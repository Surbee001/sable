# Testing Sable

## The short version

**In the ChatGPT desktop app.** Open the link in its in-app browser, which
supports WebMCP by default, then open **Site tools** in the address bar to see
the twenty-odd tools this page registers. Ask it to assess the painting and do
what it needs. It is the desktop app specifically: the challenge names that
surface, and other ChatGPT surfaces do not all carry the same browser.

**Or in Chrome 149 or later.** Turn on `chrome://flags/#enable-webmcp-testing`,
restart, and drive it with whatever agent you have.

**Or in any browser at all.** The studio, the duet, the replay and the whole
tool surface are still there, the Agent panel says plainly that nothing is
connected, and the sheet still paints. Nothing here needs an agent to be worth
looking at.

## How the judges reach it

The rules ask for a **working live URL, accessible via ChatGPT's in-app browser
or Chrome with WebMCP enabled**, plus a demo video under three minutes and a
public repository. They also say judges **are not required to test the project**
and may judge on the description, images and video alone, which is the reason
the video has to show the tools being called rather than describe them.

So a judge does one of three things:

1. **Opens it in the ChatGPT desktop app's in-app browser.** ChatGPT is the
   agent. This is the path the rules name first and the one to optimise for.
2. **Opens it in Chrome 149+ with the flag**, driven by whatever agent they have.
3. **Opens it in an ordinary browser with no agent.** They still get the studio,
   the duet, the replay and the whole tool surface listed, and the Agent panel
   says plainly that nothing is connected. Assume this happens and let the video
   carry the rest.

## What you see, per browser

| Where | `document.modelContext` | The panel says | Reachable by an agent |
| --- | --- | --- | --- |
| ChatGPT in-app browser | native | Native WebMCP | Yes |
| Chrome 149+, `#enable-webmcp-testing` | native | Native WebMCP | Yes, if one is attached |
| Chrome with an MCP bridge extension | supplied by the extension | Connected through an extension | Yes, relayed to your client |
| Chrome, plain | polyfill | Polyfill only, nothing connected | No |
| Anything without either | absent | Not available in this browser | No |

Chrome has **no** WebMCP by default and **does** have it behind
`chrome://flags/#enable-webmcp-testing`. Both were checked directly.

## Running it with a real agent

### The ChatGPT desktop app's in-app browser

Needs a public URL, so deploy first, then open the link inside the desktop app
and ask it to paint. The tools are listed under **Site tools** in the address
bar; if that control shows them, registration worked and anything that goes
wrong afterwards is between the runtime and the tools, not the page. Good things
to say:

- *"Assess the painting and do whatever it needs most."*
- *"Start the fox, take the parts you want, and tell me which ones you are
  leaving me."*
- *"Take the shadow, but look at where my legs actually landed first."*
- *"Share this and give me the link."*
- Select a mark, then: *"push this one back."*

### Chrome with the flag

Turn on `chrome://flags/#enable-webmcp-testing` and restart. That exposes
`document.modelContext` to the page. It does not by itself put an agent behind
it, so pair it with a bridge extension or use the self check below.

### A bridge extension into a desktop MCP client

The most practical way to get a real model driving it locally. The extension at
[docs.mcp-b.ai](https://docs.mcp-b.ai) injects its own `document.modelContext`
and relays whatever the page registers out to an MCP client over stdio. Sable
finds the context already there and registers into it, and the panel will say
**Connected through an extension**.

## If the browser says WebMCP and your agent still cannot call anything

This has been seen: a browser that implements WebMCP natively, a page that
registers its tools into it successfully, and a model runtime that then refuses
the command listing them. The page cannot fix that, and it says so in the Agent
panel rather than leaving you to hunt for a fault in the registration.

The way through is the next section. Every tool is reachable from evaluated
JavaScript whether or not the bridge works, and the recipe is written into the
page itself, in the accessibility tree under "How to paint on this page", so an
agent that has read the DOM has already read it.

If the agent is going to use the mouse instead, that is supported and worth
doing well. Ask it to press the button called **The agent is holding the brush**
first. It is a real button in the accessibility tree and it makes the studio
record those marks as the agent's, which is the difference between a painting
that shows two authors and one that claims to have had one.

## If your agent drives browsers rather than speaking WebMCP

Some agents have browser automation and no WebMCP bridge. They read the DOM and
click things, which cannot work here: a mark is a drag across a canvas, so
toolbar buttons load the brush and nothing else. Watching one try is what
prompted the note the page now carries in its own DOM.

Such an agent can still reach every tool, because it can evaluate JavaScript:

```js
const ctx = document.modelContext
const tools = await ctx.getTools()
const call = async (name, args) =>
  JSON.parse(await ctx.executeTool(tools.find((t) => t.name === name), JSON.stringify(args)))

await call('duet_start', { score: 'fox' })
await call('duet_take_part', { part: 'body' })
await call('assess_painting', {})
await call('paint', { strokes: [
  { path: 'M 200 240 C 320 140 520 300 720 200', pigment: 'indigo', water: 0.5, opacity: 0.6 },
]})
```

If it clicked around the toolbar and reported that it had finished while almost
nothing appeared, this is why, and this is the fix.

## The self check, no agent required

Open the page, open DevTools, paste in the contents of
[`public/selfcheck.js`](public/selfcheck.js). It drives the tool surface exactly
as an agent does, through `document.modelContext`, and prints what came back:
the registered tools, an assessment of the sheet, a palette, and a mark painted,
revised and lifted again.

It works in plain Chrome too, because the polyfill provides `executeTool` even
though nothing outside the page can reach it. If every group prints a result the
page is working, and any remaining fault is in the agent or the transport.

To see the dynamic half of the surface, select a mark and run:

```js
;(await document.modelContext.getTools()).map((t) => t.name)
```

`describe_selection` and `revise_selection` will have appeared, and the latter's
description will name the mark you picked.

## Turn taking with a real model

This matters for the ChatGPT case. The studio takes an agent's duet pass only
when nothing is attached. A tool call in the last three minutes counts as an
agent being present, and a present agent gets ninety seconds, silence included.
A model reasoning in a chat window can easily take half a minute between
deciding to paint and saying so, and a timer built for an empty room would paint
straight over it. The panel says which it is doing: **Handing over** when nobody
is there, **Waiting for the agent** when somebody is.

## Verified, and not

Checked on every build, in Chrome 152:

- 48 automated checks across five suites: the tool surface and its error
  handling, dynamic registration and unregistration, the duet end to end,
  automatic handover, deferring to a silent agent for 25 seconds, the timeline,
  and both live-drawing paths.
- Every tool called through `document.modelContext.executeTool`, the same entry
  point an agent uses.
- Both transports, and the panel telling the truth about each.

**Not checked: a real language model driving the tools.** Everything so far has
been programmatic calls with well-formed arguments. A model writes its own SVG
paths, picks its own pigments, and sometimes gets an argument wrong. Do this
before submitting. It is the highest-value test left and the only one that can
still surprise you.
