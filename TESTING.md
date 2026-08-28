# Testing Sable

## How the judges will reach it

The rules ask for a **working live URL, accessible via ChatGPT's in-app browser
or Chrome with WebMCP enabled**, plus a demo video under three minutes and a
public repository. Judging runs in two stages: a first pass for baseline
viability and theme fit, then the four criteria.

So a judge does one of three things, in roughly this order of likelihood:

1. **Opens the URL in ChatGPT's in-app browser.** ChatGPT is the agent. It sees
   the tools and can paint. This is the path the rules name first and the one
   worth optimising for.
2. **Opens it in Chrome with the flag**, and drives it with whatever agent they
   have wired up.
3. **Opens it in an ordinary browser with no agent at all.** They still get the
   studio, the duet, the timeline and the whole tool surface listed, and the
   Agent panel says plainly that nothing is connected and how to connect one.
   Assume this happens and make sure the video carries the rest.

## What you will see, per browser

| Where | `document.modelContext` | The panel says | An agent can call the tools |
| --- | --- | --- | --- |
| ChatGPT in-app browser | native | Native WebMCP | Yes |
| Chrome, `--enable-features=WebMCP` | native | Native WebMCP | Yes, if one is attached |
| Chrome with the MCP-B extension | supplied by the extension | Connected through an extension | Yes, relayed to your MCP client |
| Chrome, plain | polyfill | Polyfill only, nothing connected | No |
| Anything without either | absent | Not available in this browser | No |

Chrome 152 on this machine has **no** WebMCP by default and **does** have it
behind the flag. Both were checked directly.

## Running it with a real agent

### ChatGPT's in-app browser

Needs a public URL, so deploy first. Then open the link inside ChatGPT and ask
it to paint. Good things to say:

- *"Assess the painting and do whatever it needs most."*
- *"Start the duet and take your turns."*
- *"The top petal is too cold. Warm it and make it bleed more."*
- Select a mark in the app, then: *"push this one back."*

### Chrome with the flag

```bash
open -na "Google Chrome" --args --enable-features=WebMCP
```

The flag exposes `document.modelContext` to the page. It does not by itself put
an agent behind it, so pair it with an extension or use the self check below.

### The MCP-B extension into Claude Desktop

The most practical way to get a real model driving it locally, and you already
have Claude Desktop installed. The extension at
[docs.mcp-b.ai](https://docs.mcp-b.ai) injects its own `document.modelContext`
and relays whatever the page registers out to an MCP client. Sable finds it
already there and registers into it, and the panel will say **Connected through
an extension**.

## The self check, no agent required

Open the page, open DevTools, and paste the contents of
[`public/selfcheck.js`](public/selfcheck.js) into the console. It drives the
tool surface exactly the way an agent does, through `document.modelContext`, and
prints what came back: the registered tools, an assessment of the sheet, a
palette, a mark painted, revised and lifted again.

It works in plain Chrome too, because the polyfill provides `executeTool` even
though nothing outside the page can reach it. If every group prints a result,
the page is working, and any remaining fault is in the agent or the transport.

To see the dynamic half of the surface, select a mark in the app and run:

```js
;(await document.modelContext.getTools()).map((t) => t.name)
```

`describe_selection` and `revise_selection` will have appeared, and
`revise_selection`'s description will name the mark you picked.

## Turn taking when a real model is connected

This matters for the ChatGPT case specifically. The studio takes an agent's duet
pass only when nothing is attached. It counts a tool call in the last three
minutes as an agent being present, and once one is present it waits up to ninety
seconds for it, silence included. A model reasoning in a chat window can easily
take half a minute between deciding to paint and saying so, and a timer built
for an empty room would paint straight over it.

The panel says which of the two it is doing: **Handing over** when nobody is
there, **Waiting for the agent** when somebody is.

## What has been verified, and what has not

Checked, on every build, in Chrome 152:

- 48 automated checks across five suites: the tool surface and its error
  handling, dynamic registration and unregistration, the duet playing end to
  end, automatic turn handover, deferring to a slow agent for a full 25 seconds
  of silence, the timeline, and both live-drawing paths.
- Every tool called through `document.modelContext.executeTool`, the same
  entry point an agent uses.
- Both transports, native and polyfill only, and the panel telling the truth
  about each.

**Not yet checked: a real language model driving the tools.** Everything so far
has been programmatic calls with well-formed arguments. A model will write its
own SVG paths, pick its own pigments and occasionally get an argument wrong, and
none of that has been exercised. Do this before submitting. It is the single
highest-value test left, and the only one that can still surprise you.
