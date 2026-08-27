'use client'

import { useEffect, useRef, useState } from 'react'
import { toolSurface, type SurfaceStatus } from '@/lib/webmcp'
import { Section } from './ui'

/** Tools that only exist while the studio is in a particular state. */
const CONTEXTUAL = new Set([
  'describe_selection',
  'revise_selection',
  'undo',
  'redo',
  'clear_sheet',
])

export function AgentPanel() {
  const [status, setStatus] = useState<SurfaceStatus>({
    supported: false,
    native: false,
    toolNames: [],
  })
  const [appeared, setAppeared] = useState<string[]>([])
  const previous = useRef<string[]>([])

  useEffect(() => {
    void toolSurface.mount()
    return toolSurface.onStatus(setStatus)
  }, [])

  // Flag tools that have just come into existence, so the change is visible
  // rather than something you have to be told about.
  useEffect(() => {
    const before = new Set(previous.current)
    const fresh = status.toolNames.filter((n) => !before.has(n))
    previous.current = status.toolNames
    if (fresh.length === 0) return
    setAppeared(fresh)
    const timer = setTimeout(() => setAppeared([]), 2200)
    return () => clearTimeout(timer)
  }, [status.toolNames])

  const contextual = status.toolNames.filter((n) => CONTEXTUAL.has(n))

  return (
    <Section title="Agent surface">
      <div className="mb-2.5 flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            status.supported ? 'bg-emerald-400' : 'bg-ink-600'
          }`}
        />
        <span className="text-[10.5px] text-ink-300">
          {status.supported
            ? status.native
              ? 'Native WebMCP'
              : 'WebMCP via polyfill'
            : 'Not available'}
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-ink-500">
          {status.toolNames.length} tools
        </span>
      </div>

      {status.error ? (
        <p className="mb-2 text-[10px] leading-snug text-amber-500/80">{status.error}</p>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {status.toolNames.map((name) => {
          const isNew = appeared.includes(name)
          const isContextual = CONTEXTUAL.has(name)
          return (
            <span
              key={name}
              className={`rounded-[3px] px-1.5 py-0.5 font-mono text-[9.5px] transition-colors duration-500 ${
                isNew
                  ? 'bg-wash/25 text-wash ring-1 ring-wash/50'
                  : isContextual
                    ? 'bg-ink-800 text-[#8cc4e4] ring-1 ring-[#5ca8d6]/25'
                    : 'bg-ink-900 text-ink-400'
              }`}
            >
              {name}
            </span>
          )
        })}
      </div>

      <p className="mt-2.5 text-[10px] leading-snug text-ink-500">
        {contextual.length > 0 ? (
          <>
            <span className="text-[#8cc4e4]">{contextual.length} tool{contextual.length === 1 ? '' : 's'}</span>{' '}
            exist only in the studio&rsquo;s current state. Select a mark and watch the toolbox change.
          </>
        ) : (
          <>The toolbox is live. Select a mark and tools for revising it appear here.</>
        )}
      </p>
    </Section>
  )
}
