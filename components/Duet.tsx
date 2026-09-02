'use client'

import { ArrowUUpLeft, Check, CheckCircle, Circle, Hand, Play } from '@phosphor-icons/react'
import { conductor } from '@/lib/conductor'
import { SCORES, type DuetPart } from '@/lib/duet'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { Button } from './ui'

/**
 * One painting, two painters, no queue.
 *
 * The old version of this panel told you whose turn it was. That was the whole
 * problem with it: half the time you spent in a duet was spent being told to
 * wait. A board of parts fixes it without giving up the thing the score was
 * for, which was making the two painters actually depend on each other. The
 * foliage still has to hang off branches somebody drew. It just no longer
 * matters who drew them or when.
 *
 * So the only state a part has is: painted, held by somebody, or free. Taking
 * one is how you tell the other painter what you are doing, and it is a click
 * here and a tool call there.
 */
export function Duet() {
  const { duet } = useStudio()

  if (!duet) {
    return (
      <>
        <p className="note note--lead">
          A score is one picture broken into named parts, each with a brief. Nobody takes
          turns: you and the agent both work the board, and taking a part is how you say
          which one is yours.
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
                <span className="field-value">{score.parts.length} parts</span>
              </span>
              <span className="score-card-sub">{score.subtitle}</span>
              <span className="score-card-blurb">{score.blurb}</span>
              <span className="score-card-go">
                <Play size={11} weight="fill" />
                Begin on a fresh sheet
              </span>
            </button>
          ))}
        </div>
        <p className="note">
          Ask your agent to <em>start the duet and take whatever it likes</em>. If nothing is
          connected, the studio paints its parts itself so you can still see how it goes.
        </p>
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
          {painted.size} of {score.parts.length} painted
        </span>
      </div>

      {finished ? (
        <p className="note note--lead">
          Finished. Some of it is yours and some of it is not, and neither half would have
          made sense on its own.
        </p>
      ) : myPart ? (
        <div className="turn turn--human">
          <span className="turn-who">You have this one</span>
          <span className="turn-title">{myPart.title}</span>
          <p className="turn-hint">{myPart.short}</p>
          {myPart.guides ? (
            <p className="note">
              {traced} of {myPart.guides.length} traced. The mark is your line, not the guide.
            </p>
          ) : null}
          <div className="turn-acts">
            <Button solid onClick={() => studio.finishPart(myPart.id, 'human')}>
              <Check size={11} weight="bold" />
              Done with it
            </Button>
            <Button onClick={() => studio.releasePart(myPart.id, 'human')}>
              <ArrowUUpLeft size={11} weight="bold" />
              Put it back
            </Button>
          </div>
        </div>
      ) : (
        <p className="note note--lead">
          Take a part below, or just paint. The sheet is yours either way, and nothing is
          waiting on you.
        </p>
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
                          .join(' and ')} down first.`
                      : part.short
                  }
                  onClick={() => studio.takePart(part.id, 'human')}
                >
                  <Hand size={11} weight="bold" />
                  Take
                </button>
              ) : (
                <span className="score-state">
                  {state === 'done' ? 'painted' : state === 'mine' ? 'yours' : 'agent'}
                </span>
              )}
              <span className={`dot ${part.by === 'agent' ? 'dot--agent' : 'dot--human'}`} />
            </li>
          )
        })}
      </ol>

      <p className="note">
        The dot says which painter a part suits. It is a suggestion, not a lock: take any of
        them.{' '}
        {conductor.attached
          ? 'An agent is working, so the studio is keeping its hands off.'
          : 'Nothing is connected, so the studio is painting the agent parts itself.'}
      </p>

      <Button onClick={() => studio.endDuet()}>Leave the score</Button>
    </>
  )
}
