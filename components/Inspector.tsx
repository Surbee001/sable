'use client'

import { PIGMENTS, getPigment } from '@/lib/palette'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { BRUSHES, type BrushKind } from '@/lib/types'
import { Button, Section, Slider } from './ui'

/**
 * The inspector is the argument of the whole project in one panel.
 *
 * A mark the agent painted is not a region of pixels — it is an object with
 * properties, and they are all sitting here, editable, the moment it lands.
 */
export function Inspector() {
  const { scene, ui } = useStudio()
  const selected = ui.selection
    .map((id) => scene.strokes.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  if (selected.length === 0) {
    return (
      <Section title="Inspector">
        <p className="text-[11px] leading-relaxed text-ink-500">
          Nothing selected. Press <kbd className="font-mono text-ink-300">V</kbd> and click any
          mark — including one the agent painted — to take it apart and change it.
        </p>
      </Section>
    )
  }

  const first = selected[0]
  const many = selected.length > 1
  const ids = selected.map((s) => s.id)
  const byAgent = selected.filter((s) => s.author === 'agent').length

  return (
    <Section
      title={many ? `Inspector · ${selected.length} marks` : 'Inspector'}
      action={
        <Button tone="ghost" onClick={() => studio.erase(ids, 'human')}>
          Lift
        </Button>
      }
    >
      <div className="mb-3 flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            byAgent > 0 ? 'bg-[#5ca8d6]' : 'bg-wash'
          }`}
        />
        <span className="text-[10px] text-ink-400">
          {many
            ? `${byAgent} of ${selected.length} painted by the agent`
            : first.author === 'agent'
              ? 'Painted by the agent'
              : 'Painted by you'}
        </span>
      </div>

      {first.note ? (
        <p className="mb-3 border-l border-ink-700 pl-2 text-[10.5px] leading-snug text-ink-300 italic">
          “{first.note}”
        </p>
      ) : null}

      <div className="flex flex-col gap-3.5">
        <div>
          <span className="label mb-1 block">Pigment</span>
          <div className="grid grid-cols-8 gap-1">
            {PIGMENTS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.name}
                onClick={() => studio.updateMany(ids, { pigment: p.id }, 'human')}
                className={`aspect-square rounded-full transition-transform hover:scale-110 ${
                  !many && p.id === first.pigment
                    ? 'ring-2 ring-ink-50 ring-offset-2 ring-offset-ink-850'
                    : ''
                }`}
                style={{ background: p.hex }}
              />
            ))}
          </div>
          {!many ? (
            <span className="mt-1 block text-[10px] text-ink-500">
              {getPigment(first.pigment).name}
            </span>
          ) : null}
        </div>

        <div>
          <span className="label mb-1 block">Brush</span>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(BRUSHES) as BrushKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => studio.updateMany(ids, { kind }, 'human')}
                className={`rounded-[4px] px-2 py-1 text-[10.5px] font-medium transition-colors ${
                  !many && first.kind === kind
                    ? 'bg-ink-700 text-ink-50'
                    : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
                }`}
              >
                {BRUSHES[kind].label}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label="Water"
          value={first.water}
          onChange={(water) => studio.updateMany(ids, { water }, 'human')}
        />
        <Slider
          label="Pigment load"
          value={first.opacity}
          onChange={(opacity) => studio.updateMany(ids, { opacity }, 'human')}
        />
        <Slider
          label="Pressure"
          value={first.pressure}
          onChange={(pressure) => studio.updateMany(ids, { pressure }, 'human')}
        />

        <div className="flex gap-1">
          <Button
            className="flex-1"
            onClick={() => studio.updateMany(ids, { fill: !first.fill }, 'human')}
          >
            {first.fill ? 'Make a stroke' : 'Flood as a wash'}
          </Button>
          <Button onClick={() => studio.restack(first.id, 'front', 'human')} title="Bring to front">
            Front
          </Button>
          <Button onClick={() => studio.restack(first.id, 'back', 'human')} title="Send to back">
            Back
          </Button>
        </div>

        {!many ? (
          <div>
            <span className="label mb-1 block">Path</span>
            <code className="block max-h-20 overflow-auto rounded-[4px] bg-ink-900 p-2 font-mono text-[9.5px] leading-relaxed break-all text-ink-400">
              {first.path}
            </code>
          </div>
        ) : null}
      </div>
    </Section>
  )
}
