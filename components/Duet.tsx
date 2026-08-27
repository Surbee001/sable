'use client'

import { CheckCircle, Circle, PaintBrush, Play } from '@phosphor-icons/react'
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
          A landscape in the old manner, painted in twelve passes that alternate between you and
          the agent. It lays the ground, you trace the ridge. It floods the river, you break it
          with ripples. You draw the pine, it hangs the foliage off the branches you actually
          made.
        </p>
        <Button solid onClick={() => studio.startDuet(KAWA)}>
          <Play size={12} weight="fill" />
          Begin {KAWA.title}
        </Button>
        <p className="note">
          Starts a fresh sheet. An agent takes its turns through the duet tools; press the button
          on its passes if there is nobody connected.
        </p>
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
          <p className="turn-hint">{step.hint}</p>

          {step.by === 'human' && step.guides ? (
            <p className="note">
              Trace the marked line. {traced} of {step.guides.length} done. What lands on the
              paper is your line, not the guide.
            </p>
          ) : null}

          {step.by === 'agent' ? (
            <Button solid onClick={() => studio.playAgentStep()}>
              <PaintBrush size={12} weight="bold" />
              Let the agent take this turn
            </Button>
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
