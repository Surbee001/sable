# Testing Sable

## How the judges reach it

The rules ask for a **working live URL, accessible via ChatGPT's in-app browser
or Chrome with WebMCP enabled**, plus a demo video under three minutes and a
public repository.

So a judge does one of three things:

1. **Opens it in ChatGPT's in-app browser.** ChatGPT is the agent. This is the
   path the rules name first and the one to optimise for.
2. **Opens it in Chrome with the flag**, driven by whatever agent they have.
3. **Opens it in an ordinary browser with no agent.** They still get the studio,
   the duet, the timeline and the whole tool surface listed, and the Agent panel
   says plainly that nothing is connected. Assume this happens and let the video
   carry the rest.

## What you see, per browser

| Where | `document.modelContext` | The panel says | Reachable by an agent |
| --- | --- | --- | --- |
| ChatGPT in-app browser | native | Native WebMCP | Yes |
| Chrome, `--enable-features=WebMCP` | native | Native WebMCP | Yes, if one is attached |
| Chrome with an MCP bridge extension | supplied by the extension | Connected through an extension | Yes, relayed to your client |
| Chrome, plain | polyfill | Polyfill only, nothing connected | No |
| Anything without either | absent | Not available in this browser | No |

Chrome 152 has **no** WebMCP by default and **does** have it behind the flag.
Both were checked directly.

## Running it with a real agent

### ChatGPT's in-app browser

Needs a public URL, so deploy first, then open the link inside ChatGPT and ask
it to paint. Good things to say:

- *"Assess the painting and do whatever it needs most."*
- *"Start the duet and take your turns."*
- Select a mark, then: *"push this one back."*

### Chrome with the flag

```bash
open -na "Google Chrome" --args --enable-features=WebMCP
```

The flag exposes `document.modelContext` to the page. It does not by itself put
an agent behind it, so pair it with a bridge extension or use the self check.

### A bridge extension into a desktop MCP client

The most practical way to get a real model driving it locally. The extension at
[docs.mcp-b.ai](https://docs.mcp-b.ai) injects its own `document.modelContext`
and relays whatever the page registers out to an MCP client over stdio. Sable
finds the context already there and registers into it, and the panel will say
**Connected through an extension**.

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
