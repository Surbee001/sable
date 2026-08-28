'use client'

import { Pause, Play, SkipBack } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { getPigment } from '@/lib/palette'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { BRUSHES, type Stroke } from '@/lib/types'
import { paintOrder } from '@/lib/watercolor'

const STEP_MS = 300

function describe(stroke: Stroke): string {
  return `${BRUSHES[stroke.kind].label} ${stroke.fill ? 'wash' : 'stroke'} in ${
    getPigment(stroke.pigment).name
  }`
}

/**
 * The journey, in two lanes.
 *
 * The same information as a list of marks, arranged so the collaboration is
 * the thing you see: the agent's passes above, the human's below, in the order
 * they happened. Long runs in one lane are somebody working alone; the places
 * they interleave are where the painting was actually made together.
 *
 * Both lanes hold a cell for every mark, filled in one lane and empty in the
 * other, so the two stay in step without anything being positioned by hand.
 */
export function Timeline() {
  const { scene, replay } = useStudio()
  const [playing, setPlaying] = useState(false)
  const order = paintOrder(scene)
  const total = order.length

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const at = studio.getSnapshot().replay
      const next = (at ?? 0) + 1
      if (next >= total) {
        studio.setReplay(null)
        setPlaying(false)
      } else {
        studio.setReplay(next)
      }
    }, STEP_MS)
    return () => clearInterval(timer)
  }, [playing, total])

  if (total < 3) return null

  const at = replay ?? total
  const current = replay === null ? null : order[Math.max(0, at - 1)]

  const play = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    studio.setReplay(replay === null || replay >= total ? 0 : replay)
    setPlaying(true)
  }

  const scrubTo = (i: number) => {
    setPlaying(false)
    studio.setReplay(i + 1 >= total ? null : i + 1)
  }

  const lane = (who: 'agent' | 'human') => (
    <div className="lane">
      <span className={`lane-name lane-name--${who}`}>{who === 'agent' ? 'Agent' : 'You'}</span>
      <div className="lane-track">
        {order.map((stroke, i) => {
          if (stroke.author !== who) return <span key={stroke.id} className="cell" />
          const state = i + 1 === at ? ' mark--now' : i < at ? ' mark--done' : ''
          return (
            <button
              key={stroke.id}
              type="button"
              className={`cell mark mark--${who}${state}`}
              title={`${i + 1}. ${describe(stroke)}${stroke.note ? `. ${stroke.note}` : ''}`}
              aria-label={`Mark ${i + 1} of ${total}, ${describe(stroke)}`}
              onClick={() => scrubTo(i)}
            />
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button
          type="button"
          className="btn btn--icon"
          onClick={play}
          aria-label={playing ? 'Pause' : 'Replay the painting'}
          title={playing ? 'Pause' : 'Watch it being painted'}
        >
          {playing ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}
        </button>
        {replay !== null ? (
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => {
              setPlaying(false)
              studio.setReplay(null)
            }}
            aria-label="Back to the finished sheet"
            title="Back to the finished sheet"
          >
            <SkipBack size={13} weight="bold" />
          </button>
        ) : null}
      </div>

      <div className="lanes">
        {lane('agent')}
        {lane('human')}
      </div>

      <div className="timeline-read">
        {current ? (
          <>
            <span className="replay-count">{`${at} of ${total}`}</span>
            <span className={`replay-who replay-who--${current.author}`}>
              {current.author === 'agent' ? 'Agent' : 'You'} · {describe(current)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  )
}
