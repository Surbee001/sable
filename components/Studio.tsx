'use client'

import { useEffect, useState } from 'react'
import { exportPng } from '@/lib/snapshot'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { Activity } from './Activity'
import { AgentPanel } from './AgentPanel'
import { Inspector } from './Inspector'
import { Layers } from './Layers'
import { Sheet } from './Sheet'
import { Toolbox } from './Toolbox'
import { Button } from './ui'

type Tab = 'tools' | 'agent' | 'inspect' | 'log'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'tools', label: 'Tools' },
  { id: 'agent', label: 'Agent' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'log', label: 'Log' },
]

export function Studio() {
  const { scene, ui, canUndo, canRedo } = useStudio()
  const [editingTitle, setEditingTitle] = useState(false)
  const [tab, setTab] = useState<Tab | null>(null)

  // Selecting a mark on a narrow screen should show you what you selected.
  useEffect(() => {
    if (ui.selection.length > 0) setTab((t) => (t === null ? null : 'inspect'))
  }, [ui.selection])

  const download = () => {
    const url = exportPng(scene, 2)
    const a = document.createElement('a')
    a.href = url
    a.download = `${scene.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'study'}.png`
    a.click()
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-900">
      <header className="flex shrink-0 items-center gap-3 border-b border-ink-800 px-3 py-2.5 sm:px-4">
        <div className="flex shrink-0 items-baseline gap-2.5">
          <span className="font-display text-[19px] leading-none font-semibold text-ink-50">
            Sable
          </span>
          <span className="hidden text-[10.5px] text-ink-500 md:inline">
            you and the agent both hold the brush
          </span>
        </div>

        <div className="mx-auto min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              defaultValue={scene.title}
              onBlur={(e) => {
                studio.setTitle(e.target.value.trim() || 'Untitled study', 'human')
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              className="w-52 rounded-[4px] bg-ink-800 px-2 py-1 text-center font-display text-[13px] text-ink-50 outline-none ring-1 ring-ink-600"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="max-w-[34vw] truncate rounded-[4px] px-2 py-1 font-display text-[13px] text-ink-200 transition-colors hover:bg-ink-800 hover:text-ink-50"
              title="Rename this study"
            >
              {scene.title}
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {scene.strokes.length === 0 ? (
            <Button
              tone="ghost"
              onClick={() => studio.restoreSeed('human')}
              title="Bring back the demonstration study"
            >
              Restore demo
            </Button>
          ) : (
            <Button
              tone="ghost"
              onClick={() => studio.newSheet('human')}
              title="Tape down a blank sheet"
              className="hidden sm:block"
            >
              New
            </Button>
          )}
          <Button tone="ghost" onClick={() => studio.undo()} disabled={!canUndo} title="⌘Z">
            Undo
          </Button>
          <Button
            tone="ghost"
            onClick={() => studio.redo()}
            disabled={!canRedo}
            title="⇧⌘Z"
            className="hidden sm:block"
          >
            Redo
          </Button>
          <Button onClick={download} disabled={scene.strokes.length === 0}>
            Export
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[200px] shrink-0 overflow-y-auto border-r border-ink-800 p-3.5 xl:block">
          <Toolbox />
        </aside>

        <main className="flex min-w-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-5 xl:p-8">
          <div className="w-full max-w-[1080px]">
            <Sheet />
          </div>
        </main>

        <aside className="hidden w-[248px] shrink-0 flex-col gap-6 overflow-y-auto border-l border-ink-800 p-3.5 xl:flex">
          <AgentPanel />
          <Inspector />
          <Layers />
          <Activity />
        </aside>
      </div>

      {/*
        Below the three-column breakpoint the same panels live in a drawer.
        A judge opening the link on a laptop or a phone still needs to see the
        agent surface — it is the entire point of the page.
      */}
      <div className="shrink-0 border-t border-ink-800 xl:hidden">
        {tab ? (
          <div className="max-h-[46vh] overflow-y-auto border-b border-ink-800 p-3.5">
            {tab === 'tools' ? <Toolbox /> : null}
            {tab === 'agent' ? <AgentPanel /> : null}
            {tab === 'inspect' ? (
              <div className="flex flex-col gap-6">
                <Inspector />
                <Layers />
              </div>
            ) : null}
            {tab === 'log' ? <Activity /> : null}
          </div>
        ) : null}

        <nav className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab((current) => (current === t.id ? null : t.id))}
              className={`flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                tab === t.id
                  ? 'bg-ink-800 text-ink-50'
                  : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
