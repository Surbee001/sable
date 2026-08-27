'use client'

import { useEffect, useRef, useState } from 'react'
import { toolSurface, type SurfaceStatus } from '@/lib/webmcp'

/** Tools that exist only while the studio is in a particular state. */
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

  // Flag tools that have just come into existence, so the change is something
  // you can watch rather than something you have to be told about.
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
    <>
      <div className="section-head">
        <span className="row-title">
          <span className={`dot ${status.supported ? 'dot--live' : 'dot--off'}`} />
        </span>
        <span className="note grow">
          {status.supported
            ? status.native
              ? 'Native WebMCP'
              : 'WebMCP via polyfill'
            : 'Not available in this browser'}
        </span>
        <span className="field-value">{status.toolNames.length} tools</span>
      </div>

      {status.error ? <p className="note">{status.error}</p> : null}

      <div className="tag-wrap">
        {status.toolNames.map((name) => (
          <span
            key={name}
            className={`tag${
              appeared.includes(name)
                ? ' tag--new'
                : CONTEXTUAL.has(name)
                  ? ' tag--contextual'
                  : ''
            }`}
          >
            {name}
          </span>
        ))}
      </div>

      <p className="note">
        {contextual.length > 0
          ? `${contextual.length} of these exist only in the studio's current state. Select a mark and watch the toolbox change.`
          : 'The toolbox is live. Select a mark and tools for revising it appear here.'}
      </p>
    </>
  )
}
