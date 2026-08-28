'use client'

import { Pause, Play, SkipBack } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { paintOrder } from '@/lib/watercolor'

const STEP_MS = 260

/**
 * Wind the painting back.
 *
 * This is only possible because the sheet is a list of marks rather than a
 * picture of them. There is nothing to reconstruct: winding back just means
 * drawing fewer of them. A flattened image cannot be asked what it looked like
 * ten minutes ago, and that difference is the entire argument of the project,
 * so it is worth being able to see.
 *
 * The track is one tick per mark, coloured by who made it, which means the
 * shape of the collaboration is legible before you play anything.
 */
export function Replay() {
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
  const current = order[Math.max(0, at - 1)]

  const play = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    studio.setReplay(replay === null || replay >= total ? 0 : replay)
    setPlaying(true)
  }

  return (
    <div className="replay">
      <button
        type="button"
        className="btn btn--icon"
        onClick={play}
        aria-label={playing ? 'Pause the replay' : 'Replay the painting'}
        title={playing ? 'Pause' : 'Watch it being painted'}
      >
        {playing ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}
      </button>

      <div className="track" role="group" aria-label="Painting history">
        {order.map((stroke, i) => (
          <button
            key={stroke.id}
            type="button"
            aria-label={`${i + 1} of ${total}, painted by the ${stroke.author}`}
            title={`${i + 1}. ${stroke.author === 'agent' ? 'Agent' : 'You'}`}
            onClick={() => {
              setPlaying(false)
              studio.setReplay(i + 1 >= total ? null : i + 1)
            }}
            className={`tick tick--${stroke.author}${i < at ? ' tick--shown' : ''}`}
          />
        ))}
      </div>

      <span className="replay-count">
        {replay === null ? `${total} marks` : `${at} of ${total}`}
      </span>

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

      {replay !== null && current ? (
        <span className={`replay-who replay-who--${current.author}`}>
          {current.author === 'agent' ? 'Agent' : 'You'}
        </span>
      ) : null}
    </div>
  )
}
