'use client'

import { useEffect, useState } from 'react'
import { exportPng } from '@/lib/snapshot'
import { studio } from '@/lib/store'
import { applyTheme, currentTheme, type Theme } from '@/lib/theme'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useStudio } from '@/lib/useStudio'
import { Activity } from './Activity'
import { AgentPanel } from './AgentPanel'
import { Inspector } from './Inspector'
import { Layers } from './Layers'
import { Sheet } from './Sheet'
import { Toolbox } from './Toolbox'
import { Welcome } from './Welcome'
import { Button } from './ui'

type Tab = 'mark' | 'tools' | 'agent' | 'layers' | 'log'

export function Studio() {
  const { scene, ui, canUndo, canRedo } = useStudio()
  const [editingTitle, setEditingTitle] = useState(false)
  const [tab, setTab] = useState<Tab>('agent')
  const hasSelection = ui.selection.length > 0
  const [theme, setTheme] = useState<Theme>('light')
  const [chromeHidden, setChromeHidden] = useState(false)
  const narrow = useMediaQuery('(max-width: 1120px)')
  const [openTab, setOpenTab] = useState<Tab | null>(null)

  useEffect(() => setTheme(currentTheme()), [])

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

  const panel = (id: Tab) => {
    if (id === 'mark') return hasSelection ? <Inspector /> : null
    if (id === 'tools') return <Toolbox />
    if (id === 'agent') return <AgentPanel />
    if (id === 'layers') return <Layers />
    return <Activity />
  }

  const tabsFor = (ids: readonly Tab[]) =>
    ids.filter((id) => id !== 'mark' || hasSelection)

  const LABEL: Record<Tab, string> = {
    mark: 'Mark',
    tools: 'Tools',
    agent: 'Agent',
    layers: 'Layers',
    log: 'Log',
  }

  if (narrow) {
    const ids = tabsFor(['mark', 'tools', 'agent', 'layers', 'log'] as const)
    return (
      <div className="studio">
        <Welcome />

        <div className="stage">
          <div className="stage-inner">
            <Sheet />
          </div>
        </div>

        <header className={`float float-top${hide}`}>
          <div className="pill pill--text">
            <span className="wordmark">Sable</span>
            <span className="tagline">you and the agent both hold the brush</span>
          </div>
          <div className="pill">
            <Button onClick={() => studio.undo()} disabled={!canUndo} title="Undo">
              Undo
            </Button>
            <Button
              icon
              onClick={toggleTheme}
              ariaLabel="Switch between light and dark"
            >
              {theme === 'dark' ? '\u2600' : '\u263D'}
            </Button>
            <Button solid onClick={download} disabled={scene.strokes.length === 0}>
              Export
            </Button>
          </div>
        </header>

        <div className={`dock${hide}`}>
          {openTab ? <div className="card dock-body">{panel(openTab)}</div> : null}
          <div className="card card--flush dock-bar">
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
    <div className="studio">
      <Welcome />

      <div className="stage">
        <div className={`stage-inner${chromeHidden ? ' stage-inner--wide' : ''}`}>
          <Sheet />
        </div>
      </div>

      <header className={`float float-top${hide}`}>
        <div className="pill pill--text">
          <span className="wordmark">Sable</span>
          <span className="tagline">you and the agent both hold the brush</span>
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
          {scene.strokes.length === 0 ? (
            <Button
              onClick={() => studio.restoreSeed('human')}
              title="Bring back the demonstration study"
            >
              Restore
            </Button>
          ) : (
            <Button onClick={() => studio.newSheet('human')} title="Tape down a blank sheet">
              New
            </Button>
          )}
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
            {theme === 'dark' ? '☀' : '☽'}
          </Button>
          <Button solid onClick={download} disabled={scene.strokes.length === 0}>
            Export
          </Button>
        </div>
      </header>

      <aside className={`float float-left card${hide}`}>
        <Toolbox />
      </aside>

      <aside className={`float float-right${hide}`}>
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
            {(['agent', 'layers', 'log'] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`tab${tab === id ? ' tab--on' : ''}`}
                onClick={() => setTab(id)}
              >
                {id === 'agent' ? 'Agent' : id === 'layers' ? 'Layers' : 'Log'}
              </button>
            ))}
          </div>
          {tab === 'mark' && hasSelection ? <Inspector /> : null}
          {tab === 'agent' ? <AgentPanel /> : null}
          {tab === 'layers' ? <Layers /> : null}
          {tab === 'log' ? <Activity /> : null}
        </div>
      </aside>
    </div>
  )
}
