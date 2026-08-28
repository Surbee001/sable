'use client'

import { Eye, Lightning, PaintBrush, Palette } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { toolSurface, type SurfaceStatus } from '@/lib/webmcp'

/**
 * Tools grouped the way a person would describe them, rather than in the order
 * they happened to be registered. A flat list of thirteen identifiers is
 * technically the same information and tells you nothing.
 */
const GROUPS: Array<{
  id: string
  label: string
  Icon: typeof Eye
  tools: string[]
}> = [
  {
    id: 'look',
    label: 'Looking',
    Icon: Eye,
    tools: [
      'assess_painting',
      'look_at_canvas',
      'inspect_region',
      'read_painting',
      'describe_selection',
    ],
  },
  {
    id: 'paint',
    label: 'Painting',
    Icon: PaintBrush,
    tools: ['paint', 'revise_stroke', 'revise_selection', 'transform_strokes', 'lift_strokes'],
  },
  {
    id: 'setup',
    label: 'Setting up',
    Icon: Palette,
    tools: ['suggest_palette', 'list_palette', 'manage_layers', 'set_sheet'],
  },
  {
    id: 'state',
    label: 'Only right now',
    Icon: Lightning,
    tools: ['duet_status', 'duet_complete_turn', 'undo', 'redo', 'clear_sheet'],
  },
]

/** Tools that exist only while the studio is in a particular state. */
const CONTEXTUAL = new Set([
  'describe_selection',
  'revise_selection',
  'duet_status',
  'duet_complete_turn',
  'undo',
  'redo',
  'clear_sheet',
])

const EMPTY: SurfaceStatus = {
  supported: false,
  native: false,
  toolNames: [],
  activeTool: null,
  recentTools: [],
  callCount: 0,
  mutationCount: 0,
  lastCallAt: 0,
}

export function AgentPanel() {
  const [status, setStatus] = useState<SurfaceStatus>(EMPTY)
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

  const live = new Set(status.toolNames)
  const contextualCount = status.toolNames.filter((n) => CONTEXTUAL.has(n)).length

  const tagClass = (name: string) => {
    if (status.activeTool === name) return 'tag tag--active'
    if (appeared.includes(name)) return 'tag tag--new'
    if (status.recentTools.includes(name)) return 'tag tag--recent'
    if (CONTEXTUAL.has(name)) return 'tag tag--contextual'
    return 'tag'
  }

  return (
    <>
      <div className="status">
        <span className={`dot ${status.supported ? 'dot--live' : 'dot--off'}`} />
        <span className="note grow">
          {status.supported
            ? status.native
              ? 'Native WebMCP'
              : 'WebMCP via polyfill'
            : 'Not available in this browser'}
        </span>
        <span className="field-value">{status.toolNames.length} tools</span>
      </div>

      {status.activeTool ? (
        <div className="working">
          <span className="working-pip" />
          <span className="working-text">
            Agent is calling <code>{status.activeTool}</code>
          </span>
        </div>
      ) : null}

      {status.error ? <p className="note">{status.error}</p> : null}

      <div className="groups">
        {GROUPS.map(({ id, label, Icon, tools }) => {
          const present = tools.filter((t) => live.has(t))
          if (present.length === 0) return null
          return (
            <div key={id} className="group">
              <span className="group-head">
                <Icon size={11} weight="bold" />
                {label}
              </span>
              <div className="tag-wrap">
                {present.map((name) => (
                  <span key={name} className={tagClass(name)}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <p className="note note--spaced">
        {contextualCount > 0
          ? `${contextualCount} of these exist only in the studio's current state. Select a mark and watch the toolbox change.`
          : 'The toolbox is live. Select a mark and tools for revising it appear here.'}
        {status.callCount > 0 ? ` ${status.callCount} calls so far.` : ''}
      </p>
    </>
  )
}
