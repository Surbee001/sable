'use client'

import { Pause, Play, Rewind, X } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'

/**
 * Watch the painting get made.
 *
 * Nothing is recorded to do this. The document is already a list of decisions in
 * the order they were taken, each one carrying who took it, so a replay is a
 * slice of that list and a clock. It costs one number of state, and it works on
 * a painting that arrived in a link from someone you have never met, which no
 * amount of screen recording would.
 *
 * It is also the clearest thing this project has to say. A sheet with two
 * authors' marks on it looks like one painting; played back, with each mark
 * named as it lands, it is visibly a conversation.
 */

const STEP_MS = 260

export function Replay({ onClose }: { onClose: () => void }) {
  const { scene } = useStudio()
  const marks = studio.chronological()
  const total = marks.length

  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(
    (n: number) => {
      const clamped = Math.max(0, Math.min(total, n))
      setAt(clamped)
      studio.setReplay(clamped)
    },
    [total],
  )

  // Enter showing nothing, leave showing everything. Leaving the sheet cut
  // short because a component unmounted would be a painting that had lost
  // marks, which is a far worse bug than a replay that does not run.
  useEffect(() => {
    studio.setReplay(0)
    return () => studio.setReplay(null)
  }, [])

  useEffect(() => {
    if (!playing) return
    if (at >= total) {
      setPlaying(false)
      return
    }
    timer.current = setTimeout(() => show(at + 1), STEP_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [at, playing, show, total])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const landing = at > 0 ? marks[at - 1] : null
  const byAgent = marks.slice(0, at).filter((m) => m.author === 'agent').length

  return (
    <div className="replay">
      <div className="replay-acts">
        <button
          type="button"
          className="btn btn--icon"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            if (at >= total) show(0)
            setPlaying((p) => !p)
          }}
        >
          {playing ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}
        </button>
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Back to the first mark"
          onClick={() => {
            show(0)
            setPlaying(true)
          }}
        >
          <Rewind size={13} weight="fill" />
        </button>
      </div>

      <input
        className="range replay-range"
        type="range"
        min={0}
        max={total}
        step={1}
        value={at}
        aria-label="Which mark the replay is showing"
        onChange={(e) => {
          setPlaying(false)
          show(parseInt(e.target.value, 10))
        }}
      />

      <div className="replay-read">
        <span className="replay-count">
          {at} / {total}
        </span>
        <span className="replay-line">
          {landing ? (
            <>
              <span className={`dot ${landing.author === 'agent' ? 'dot--agent' : 'dot--human'}`} />
              {landing.author === 'agent' ? 'the agent' : 'you'}
              {landing.note ? `, ${landing.note}` : ''}
            </>
          ) : (
            `${scene.title}, from the first mark`
          )}
        </span>
        <span className="replay-split">
          {byAgent} of {at} by the agent
        </span>
      </div>

      <button type="button" className="btn btn--icon" aria-label="Close the replay" onClick={onClose}>
        <X size={13} weight="bold" />
      </button>
    </div>
  )
}
