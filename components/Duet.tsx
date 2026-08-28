'use client'

import { CheckCircle, Circle, Play } from '@phosphor-icons/react'
import { conductor } from '@/lib/conductor'
import { KAWA } from '@/lib/duet'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { Button } from './ui'

/**
 * One painting, painted in turns.
 *
 * A blank sheet never forces the two of them to depend on each other. A score
 * does: the human's grass has to sit on the bank the agent laid down, and the
 * agent's foliage has to hang off branches the human drew.
 */
export function Duet() {
  const { duet } = useStudio()

  if (!duet) {
    return (
      <>
        <p className="note note--lead">
          A landscape in twelve passes, taken in turns. It lays the ground, you trace the ridge.
          You draw the pine, it hangs the foliage off your branches.
        </p>
        <Button solid onClick={() => studio.startDuet(KAWA)}>
          <Play size={12} weight="fill" />
          Begin {KAWA.title}
        </Button>
        <p className="note">Fresh sheet. Turns hand over by themselves.</p>
      </>
    )
  }

  const { score, index, traced } = duet
  const step = score.steps[index]
  const done = index >= score.steps.length

  return (
    <>
      <div className="duet-head">
        <span className="duet-title">{score.title}</span>
        <span className="field-value">
          {Math.min(index, score.steps.length)} of {score.steps.length}
        </span>
      </div>

      {done ? (
        <>
          <p className="note note--lead">
            Finished. Half of it is yours and half of it is not, and the two halves needed each
            other to make sense.
          </p>
          <Button onClick={() => studio.endDuet()}>Close the score</Button>
        </>
      ) : (
        <div className={`turn turn--${step.by}`}>
          <span className="turn-who">
            {step.by === 'agent' ? 'The agent&rsquo;s turn' : 'Your turn'}
          </span>
          <span className="turn-title">{step.title}</span>
          <p className="turn-hint">{step.short}</p>

          {step.by === 'human' && step.guides ? (
            <p className="note">
              {traced} of {step.guides.length} traced. The mark is your line, not the guide.
            </p>
          ) : null}

          {step.by === 'agent' ? (
            <span className="waiting">
              <span className="working-pip" />
              {conductor.attached ? 'Waiting for the agent' : 'Handing over'}
            </span>
          ) : null}
        </div>
      )}

      <ol className="score">
        {score.steps.map((s, i) => (
          <li
            key={s.id}
            className={`score-step${i === index ? ' score-step--now' : ''}${
              i < index ? ' score-step--done' : ''
            }`}
          >
            {i < index ? (
              <CheckCircle size={12} weight="fill" />
            ) : (
              <Circle size={12} weight={i === index ? 'fill' : 'regular'} />
            )}
            <span className="score-name">{s.title}</span>
            <span className={`dot ${s.by === 'agent' ? 'dot--agent' : 'dot--human'}`} />
          </li>
        ))}
      </ol>

      {!done ? (
        <Button onClick={() => studio.endDuet()}>Leave the score</Button>
      ) : null}
    </>
  )
}
