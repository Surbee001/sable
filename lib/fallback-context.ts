/**
 * A `document.modelContext` of our own, for when nothing else provides one.
 *
 * The spec surface is small, and every part of it that matters here is a map of
 * names to handlers plus an event when that map changes. Depending on an
 * external polyfill to install it turned out to be a real failure: in at least
 * one agent browser the polyfill did not install, the page had no context at
 * all, and a studio full of working tools reported that it had none.
 *
 * There is no good reason for that to be possible. If nobody else has defined
 * the property by the time we need it, we define it, and the toolbox exists
 * whatever the surrounding environment does or does not do.
 */

interface ToolLike {
  name: string
  title?: string
  description: string
  inputSchema?: unknown
  annotations?: Record<string, unknown>
  execute: (input: unknown) => unknown
}

interface RegisterOptions {
  signal?: AbortSignal
}

export class FallbackModelContext extends EventTarget {
  private tools = new Map<string, ToolLike>()

  async registerTool(tool: ToolLike, options?: RegisterOptions): Promise<void> {
    if (!tool || typeof tool.name !== 'string' || typeof tool.execute !== 'function') {
      throw new TypeError('A tool needs a name and an execute function.')
    }
    if (options?.signal?.aborted) return
    this.tools.set(tool.name, tool)

    options?.signal?.addEventListener('abort', () => {
      if (this.tools.get(tool.name) === tool) {
        this.tools.delete(tool.name)
        this.announce()
      }
    })

    this.announce()
  }

  async getTools(): Promise<
    Array<{ name: string; title: string; description: string; inputSchema: unknown }>
  > {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      title: t.title ?? t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      annotations: t.annotations,
    }))
  }

  /** Chromium's optional extension, and how anything in-page drives a tool. */
  async executeTool(
    tool: { name: string } | string,
    input?: string | Record<string, unknown>,
  ): Promise<string | null> {
    const name = typeof tool === 'string' ? tool : tool?.name
    const found = name ? this.tools.get(name) : undefined
    if (!found) throw new Error(`No tool named "${String(name)}".`)
    const args =
      typeof input === 'string' ? (input ? JSON.parse(input) : {}) : (input ?? {})
    return JSON.stringify(await found.execute(args))
  }

  /** The MCP-B runtimes expose this, and some clients look for it. */
  listTools(): string[] {
    return [...this.tools.keys()]
  }

  private announce(): void {
    this.dispatchEvent(new Event('toolchange'))
  }
}

/**
 * Make sure `document.modelContext` exists, and say whether we had to make it.
 * Never throws: a studio that cannot install a context is still a studio.
 */
export function ensureModelContext(): { installed: boolean; error?: string } {
  try {
    if ('modelContext' in document && document.modelContext) return { installed: false }
    const context = new FallbackModelContext()
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: context,
    })
    // Some clients still look at the deprecated alias.
    if (!('modelContext' in navigator)) {
      try {
        Object.defineProperty(navigator, 'modelContext', {
          configurable: true,
          enumerable: false,
          writable: true,
          value: context,
        })
      } catch {
        // Optional, and not worth failing the install over.
      }
    }
    return { installed: true }
  } catch (err) {
    return { installed: false, error: err instanceof Error ? err.message : String(err) }
  }
}
