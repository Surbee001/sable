'use client'

import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'

const VERB: Record<string, string> = {
  paint: 'painted',
  edit: 'revised',
  erase: 'lifted',
  move: 'moved',
  layer: 'layers',
  paper: 'sheet',
  history: 'history',
  note: 'note',
}

/**
 * The co-authorship record.
 *
 * Two people are working on this sheet and one of them is not in the room, so
 * this is not a debug view. It is how the human keeps track of what the agent
 * did and why, and how they reach back and undo it.
 */
export function Activity() {
  const { activity } = useStudio()

  if (activity.length === 0) {
    return (
      <p className="note">
        Nothing yet. Every mark either of you makes is recorded here, with who made it.
      </p>
    )
  }

  return (
    <ol className="log">
      {activity.slice(0, 40).map((entry) => {
        const agent = entry.author === 'agent'
        return (
          <li key={entry.id}>
            <button
              type="button"
              className="log-item"
              disabled={entry.strokeIds.length === 0}
              onClick={() => {
                studio.setMode('select')
                studio.select(entry.strokeIds)
              }}
            >
              <span className={`dot log-dot ${agent ? 'dot--agent' : 'dot--human'}`} />
              <span className="grow">
                <span className="log-text">
                  <span className={`log-who${agent ? ' log-who--agent' : ''}`}>
                    {agent ? 'Agent' : 'You'}
                  </span>{' '}
                  <span className="log-verb">{VERB[entry.kind] ?? entry.kind}</span>{' '}
                  {entry.summary}
                </span>
                {entry.note ? <span className="quote">{entry.note}</span> : null}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
