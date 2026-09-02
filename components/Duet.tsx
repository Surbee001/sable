'use client'

import { ArrowUUpLeft, Check, CheckCircle, Circle, Hand, Play } from '@phosphor-icons/react'
import { SCORES, type DuetPart } from '@/lib/duet'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { Button } from './ui'

/**
 * One painting, two painters, no queue.
 *
 * A score is a board of named parts. Any part nobody is holding can be taken by
 * either painter at any moment, and taking one is how you tell the other what
 * you are doing. Nothing on this board moves by itself: the agent's parts are
 * painted by an agent calling the tools, or they stay unpainted.
 */
export function Duet() {
  const { duet } = useStudio()

  if (!duet) {
    return (
      <>
        <p className="note note--lead">
          One picture, split into parts. No turns: take any part, the agent takes others.
        </p>
        <div className="scores">
          {SCORES.map((score) => (
            <button
              key={score.id}
              type="button"
              className="score-card"
              onClick={() => studio.startDuet(score)}
            >
              <span className="score-card-head">
                <span className="score-card-title">{score.title}</span>
                <span className="field-value">{score.parts.length}</span>
              </span>
              <span className="score-card-sub">{score.subtitle}</span>
              <span className="score-card-go">
                <Play size={11} weight="fill" />
                Fresh sheet
              </span>
            </button>
          ))}
        </div>
      </>
    )
  }

  const { score, held, done, mine, traced } = duet
  const painted = new Set(done)
  const myPart = mine ? score.parts.find((p) => p.id === mine) ?? null : null
  const finished = painted.size >= score.parts.length

  const stateOf = (part: DuetPart): 'done' | 'mine' | 'agent' | 'free' => {
    if (painted.has(part.id)) return 'done'
    if (held[part.id] === 'human') return 'mine'
    if (held[part.id] === 'agent') return 'agent'
    return 'free'
  }

  return (
    <>
      <div className="duet-head">
        <span className="duet-title">{score.title}</span>
        <span className="field-value">
          {painted.size} of {score.parts.length}
        </span>
      </div>

      {finished ? (
        <p className="note note--lead">Finished. Some of it is yours and some of it is not.</p>
      ) : myPart ? (
        <div className="turn turn--human">
          <span className="turn-who">Yours</span>
          <span className="turn-title">{myPart.title}</span>
          <p className="turn-hint">{myPart.short}</p>
          <p className="note">
            {myPart.guides
              ? `${traced} of ${myPart.guides.length} traced.`
              : 'No guide for this one. Your brush is loaded for it.'}
          </p>
          <div className="turn-acts">
            <Button solid onClick={() => studio.finishPart(myPart.id, 'human')}>
              <Check size={11} weight="bold" />
              Done
            </Button>
            <Button onClick={() => studio.releasePart(myPart.id, 'human')}>
              <ArrowUUpLeft size={11} weight="bold" />
              Put back
            </Button>
          </div>
        </div>
      ) : (
        <p className="note note--lead">Take a part, or just paint.</p>
      )}

      <ol className="score">
        {score.parts.map((part) => {
          const state = stateOf(part)
          const blocked = studio.blockedBy(part)
          return (
            <li key={part.id} className={`score-step score-step--${state}`}>
              {state === 'done' ? (
                <CheckCircle size={12} weight="fill" />
              ) : (
                <Circle size={12} weight={state === 'free' ? 'regular' : 'fill'} />
              )}
              <span className="score-name" title={part.short}>
                {part.title}
              </span>
              {state === 'free' ? (
                <button
                  type="button"
                  className="score-take"
                  title={
                    blocked.length
                      ? `${part.short} Wants ${blocked
                          .map((b) => b.title.toLowerCase())
                          .join(' and ')} first.`
                      : part.short
                  }
                  onClick={() => studio.takePart(part.id, 'human')}
                >
                  <Hand size={11} weight="bold" />
                  Take
                </button>
              ) : (
                <span className="score-state">
                  {state === 'done' ? 'done' : state === 'mine' ? 'yours' : 'agent'}
                </span>
              )}
              <span className={`dot ${part.by === 'agent' ? 'dot--agent' : 'dot--human'}`} />
            </li>
          )
        })}
      </ol>

      <p className="note">The dot suggests a painter. Take any of them.</p>

      <Button onClick={() => studio.endDuet()}>Leave</Button>
    </>
  )
}
