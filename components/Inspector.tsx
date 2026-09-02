'use client'

import { Eraser } from '@phosphor-icons/react'
import { PIGMENTS, getPigment } from '@/lib/palette'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { BRUSHES, type BrushKind } from '@/lib/types'
import { Button, Section, Slider } from './ui'

/**
 * The argument of the whole project, in one panel.
 *
 * A mark the agent painted is not a region of pixels. It is an object with
 * properties, and they are all sitting here, editable, the moment it lands.
 */
export function Inspector() {
  const { scene, ui } = useStudio()
  const selected = ui.selection
    .map((id) => scene.strokes.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  if (selected.length === 0) return null

  const first = selected[0]
  const many = selected.length > 1
  const ids = selected.map((s) => s.id)
  const byAgent = selected.filter((s) => s.author === 'agent').length

  return (
    <>
      <Section
        title={many ? `${selected.length} marks` : 'Selected mark'}
        action={
          <Button onClick={() => studio.erase(ids, 'human')} title="Take it back off the paper">
            <Eraser size={11} weight="bold" />
            Lift
          </Button>
        }
      >
        <div className="byline">
          <span className={`dot ${byAgent > 0 ? 'dot--agent' : 'dot--human'}`} />
          <span className="note">
            {many
              ? `${byAgent} of ${selected.length} painted by the agent`
              : first.author === 'agent'
                ? 'Painted by the agent'
                : 'Painted by you'}
          </span>
        </div>

        {first.note ? <p className="quote">{first.note}</p> : null}
      </Section>

      <Section title="Pigment">
        <div className="swatch-grid">
          {PIGMENTS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-label={p.name}
              title={p.name}
              onClick={() => studio.updateMany(ids, { pigment: p.id }, 'human')}
              className={`swatch${!many && p.id === first.pigment ? ' swatch--on' : ''}`}
            >
              <span className={`swatch-dot pig-${p.id}`} />
            </button>
          ))}
        </div>
        {!many ? <span className="note">{getPigment(first.pigment).name}</span> : null}
      </Section>

      <Section title="Brush">
        <div className="seg">
          {(Object.keys(BRUSHES) as BrushKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              title={BRUSHES[kind].hint}
              onClick={() => studio.updateMany(ids, { kind }, 'human')}
              className={`seg-item${!many && first.kind === kind ? ' seg-item--on' : ''}`}
            >
              {BRUSHES[kind].label}
            </button>
          ))}
        </div>
      </Section>

      <Section>
        <div className="stack">
          <Slider
            label="Water"
            value={first.water}
            onChange={(water) => studio.updateMany(ids, { water }, 'human')}
          />
          <Slider
            label="Pigment"
            value={first.opacity}
            onChange={(opacity) => studio.updateMany(ids, { opacity }, 'human')}
          />
          <Slider
            label="Pressure"
            value={first.pressure}
            onChange={(pressure) => studio.updateMany(ids, { pressure }, 'human')}
          />
        </div>
      </Section>

      <Section>
        <div className="seg">
          <button
            type="button"
            className="seg-item"
            onClick={() => studio.updateMany(ids, { fill: !first.fill }, 'human')}
          >
            {first.fill ? 'To stroke' : 'To wash'}
          </button>
          <button
            type="button"
            className="seg-item"
            title="Bring to front"
            onClick={() => studio.restack(first.id, 'front', 'human')}
          >
            Front
          </button>
          <button
            type="button"
            className="seg-item"
            title="Send to back"
            onClick={() => studio.restack(first.id, 'back', 'human')}
          >
            Back
          </button>
        </div>
      </Section>

      {!many ? (
        <Section title="Path">
          <code className="path-code">{first.path}</code>
        </Section>
      ) : null}
    </>
  )
}
