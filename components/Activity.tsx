'use client'

import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { Section } from './ui'

const KIND_LABEL: Record<string, string> = {
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
 * the log is not a debug view — it is how the human keeps track of what the
 * agent did and why, and how they reach back and undo it.
 */
export function Activity() {
  const { activity } = useStudio()

  return (
    <Section title="Studio log">
      {activity.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-ink-500">
          Nothing yet. Every mark either of you makes is recorded here, with who made it.
        </p>
      ) : (
        <ol className="flex flex-col gap-px">
          {activity.slice(0, 40).map((entry) => {
            const agent = entry.author === 'agent'
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  disabled={entry.strokeIds.length === 0}
                  onClick={() => {
                    studio.setMode('select')
                    studio.select(entry.strokeIds)
                  }}
                  className="group flex w-full items-baseline gap-2 rounded-[3px] px-1.5 py-1 text-left transition-colors hover:bg-ink-800 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      agent ? 'bg-[#5ca8d6]' : 'bg-wash'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] leading-snug text-ink-200">
                      <span className={agent ? 'text-[#8cc4e4]' : 'text-ink-100'}>
                        {agent ? 'Agent' : 'You'}
                      </span>{' '}
                      <span className="text-ink-500">{KIND_LABEL[entry.kind] ?? entry.kind}</span>{' '}
                      {entry.summary}
                    </span>
                    {entry.note ? (
                      <span className="mt-0.5 block text-[10px] leading-snug text-ink-400 italic">
                        “{entry.note}”
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </Section>
  )
}
