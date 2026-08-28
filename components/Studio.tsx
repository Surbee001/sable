'use client'

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  DownloadSimple,
  FilePlus,
  Moon,
  Sun,
} from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { conductor } from '@/lib/conductor'
import { exportPng } from '@/lib/snapshot'
import { studio } from '@/lib/store'
import { applyTheme, currentTheme, type Theme } from '@/lib/theme'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useStudio } from '@/lib/useStudio'
import { toolSurface } from '@/lib/webmcp'
import { Activity } from './Activity'
import { AgentPanel } from './AgentPanel'
import { Duet } from './Duet'
import { Inspector } from './Inspector'
import { Layers } from './Layers'
import { Sheet } from './Sheet'
import { Toolbox } from './Toolbox'
import { Welcome } from './Welcome'
import { Button } from './ui'

type Tab = 'mark' | 'duet' | 'tools' | 'agent' | 'layers' | 'log'

export function Studio() {
  const { scene, ui, canUndo, canRedo } = useStudio()
  const [editingTitle, setEditingTitle] = useState(false)
  const [tab, setTab] = useState<Tab>('agent')
  const hasSelection = ui.selection.length > 0
  const [theme, setTheme] = useState<Theme>('light')
  const [chromeHidden, setChromeHidden] = useState(false)
  /**
   * The studio is a canvas, a pointer and a tool surface, none of which exist
   * on a server. Rendering it only once mounted costs nothing and removes a
   * whole class of hydration mismatch on hosting we cannot test against, which
   * matters when the people who most need the page to work are opening it
   * somewhere we have never seen.
   */
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const narrow = useMediaQuery('(max-width: 1120px)')
  const [openTab, setOpenTab] = useState<Tab | null>(null)

  useEffect(() => setTheme(currentTheme()), [])

  // Turns hand over on their own, whichever panel happens to be open.
  useEffect(() => conductor.start(), [])

  // Register the tools as soon as the studio exists. This used to live in the
  // Agent panel, which meant the toolbox only came into being once that tab was
  // rendered: on a narrow screen the dock opens closed, so an agent arriving at
  // the page found no tools at all until someone tapped a tab. What the page
  // offers an agent cannot depend on what the person is looking at.
  useEffect(() => {
    void toolSurface.mount()
  }, [])

  // Selecting a mark is a request to look at it, so the panel follows. Letting
  // go of it falls back rather than leaving an empty tab selected. On a narrow
  // screen the dock opens on the mark and closes again when it is released.
  useEffect(() => {
    setTab((current) => (hasSelection ? 'mark' : current === 'mark' ? 'agent' : current))
    setOpenTab((current) => (hasSelection ? 'mark' : current === 'mark' ? null : current))
  }, [hasSelection])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (e.key === 'Tab') {
        e.preventDefault()
        setChromeHidden((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  const download = () => {
    const url = exportPng(scene, 2)
    const a = document.createElement('a')
    a.href = url
    a.download = `${scene.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'study'}.png`
    a.click()
  }

  const hide = chromeHidden ? ' float--hidden' : ''

  if (!ready) {
    return (
      <div className="studio">
        <header className="bar">
          <div className="pill pill--text">
            <span className="wordmark">Sable</span>
            <span className="tagline">one sheet, two painters</span>
          </div>
        </header>
      </div>
    )
  }

  const panel = (id: Tab) => {
    if (id === 'mark') return hasSelection ? <Inspector /> : null
    if (id === 'duet') return <Duet />
    if (id === 'tools') return <Toolbox />
    if (id === 'agent') return <AgentPanel />
    if (id === 'layers') return <Layers />
    return <Activity />
  }

  const tabsFor = (ids: readonly Tab[]) =>
    ids.filter((id) => id !== 'mark' || hasSelection)

  const LABEL: Record<Tab, string> = {
    mark: 'Mark',
    duet: 'Duet',
    tools: 'Tools',
    agent: 'Agent',
    layers: 'Layers',
    log: 'Log',
  }

  if (narrow) {
    const ids = tabsFor(['mark', 'duet', 'tools', 'agent', 'layers', 'log'] as const)
    return (
      <div className={`studio${chromeHidden ? ' studio--bare' : ''}`}>
        <Welcome />

        <header className="bar">
          <div className="pill pill--text">
            <span className="wordmark">Sable</span>
            <span className="tagline">one sheet, two painters</span>
          </div>
          <div className="pill">
            <Button icon onClick={() => studio.undo()} disabled={!canUndo} ariaLabel="Undo" title="Undo">
              <ArrowCounterClockwise size={14} weight="bold" />
            </Button>
            <Button
              icon
              onClick={toggleTheme}
              ariaLabel="Switch between light and dark"
              title="Switch between light and dark"
            >
              {theme === 'dark' ? <Sun size={14} weight="bold" /> : <Moon size={14} weight="bold" />}
            </Button>
            <Button solid onClick={download} disabled={scene.strokes.length === 0}>
              <DownloadSimple size={13} weight="bold" />
              Export
            </Button>
          </div>
        </header>

        <div className="stage">
          <div className="stage-inner">
            <Sheet />
          </div>
        </div>

        <div className={`dock${hide}`}>
          {openTab ? <div className="dock-body">{panel(openTab)}</div> : null}
          <div className="dock-bar">
            <div className="tabs dock-tabs">
              {ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`tab${openTab === id ? ' tab--on' : ''}`}
                  onClick={() => setOpenTab((c) => (c === id ? null : id))}
                >
                  {LABEL[id]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`studio${chromeHidden ? ' studio--bare' : ''}`}>
      <Welcome />

      <header className="bar">
        <div className="pill pill--text">
          <span className="wordmark">Sable</span>
          <span className="tagline">one sheet, two painters</span>
        </div>

        <span className="spacer" />

        <div className="pill pill--text pill--title">
          {editingTitle ? (
            <input
              autoFocus
              className="title-field grow"
              defaultValue={scene.title}
              onBlur={(e) => {
                studio.setTitle(e.target.value.trim() || 'Untitled study', 'human')
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
            />
          ) : (
            <button
              type="button"
              className="title-field grow"
              title="Rename this study"
              onClick={() => setEditingTitle(true)}
            >
              {scene.title}
            </button>
          )}
        </div>

        <span className="spacer" />

        <div className="pill">
          <Button onClick={() => studio.newSheet('human')} title="Tape down a blank sheet">
            <FilePlus size={12} weight="bold" />
            New
          </Button>
          <Button onClick={() => studio.undo()} disabled={!canUndo} title="Undo, or press Cmd Z">
            Undo
          </Button>
          <Button onClick={() => studio.redo()} disabled={!canRedo} title="Redo">
            Redo
          </Button>
          <Button
            icon
            onClick={toggleTheme}
            ariaLabel="Switch between light and dark"
            title="Switch between light and dark"
          >
            {theme === 'dark' ? <Sun size={14} weight="bold" /> : <Moon size={14} weight="bold" />}
          </Button>
          <Button solid onClick={download} disabled={scene.strokes.length === 0}>
            Export
          </Button>
        </div>
      </header>

      <div className="stage">
        <div className="stage-inner">
          <Sheet />
        </div>
      </div>

      <aside className="rail rail--left">
        <Toolbox />
      </aside>

      <aside className="rail rail--right">
        <div className="card">
          <div className="tabs">
            {hasSelection ? (
              <button
                type="button"
                className={`tab${tab === 'mark' ? ' tab--on' : ''}`}
                onClick={() => setTab('mark')}
              >
                Mark
              </button>
            ) : null}
            {(['duet', 'agent', 'layers', 'log'] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`tab${tab === id ? ' tab--on' : ''}`}
                onClick={() => setTab(id)}
              >
                {LABEL[id]}
              </button>
            ))}
          </div>
          {tab === 'mark' && hasSelection ? <Inspector /> : null}
          {tab === 'duet' ? <Duet /> : null}
          {tab === 'agent' ? <AgentPanel /> : null}
          {tab === 'layers' ? <Layers /> : null}
          {tab === 'log' ? <Activity /> : null}
        </div>
      </aside>
    </div>
  )
}
