'use client'

import { CursorClick, Drop, PaintBrush, PenNib } from '@phosphor-icons/react'
import { PIGMENTS, getPigment } from '@/lib/palette'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { BRUSHES, type BrushKind } from '@/lib/types'
import { Section, Segmented, Slider } from './ui'

/** A miniature of the mark each brush makes, quicker to read than a label. */
function BrushGlyph({ kind }: { kind: BrushKind }) {
  const spec = BRUSHES[kind]
  return (
    <svg viewBox="0 0 44 16" width="44" height="16" aria-hidden="true">
      <path
        d="M 3 8 C 12 2 20 14 29 8 C 34 5 38 7 41 8"
        fill="none"
        stroke="currentColor"
        strokeWidth={Math.max(1, spec.baseWidth / 6)}
        strokeLinecap={kind === 'flat' ? 'butt' : 'round'}
        strokeDasharray={kind === 'dry' ? '3 2.5' : undefined}
        opacity={kind === 'mop' ? 0.5 : 0.9}
      />
    </svg>
  )
}

export function Toolbox() {
  const { ui } = useStudio()
  const brush = ui.brush
  const pigment = getPigment(brush.pigment)

  return (
    <>
      <Section>
        <Segmented
          value={ui.mode}
          onChange={(m) => studio.setMode(m)}
          options={[
            { value: 'paint', label: 'Paint', title: 'Draw with the mouse. Shortcut: B', Icon: PaintBrush },
            { value: 'select', label: 'Select', title: 'Pick a mark up. Shortcut: V', Icon: CursorClick },
          ]}
        />
        <p className="note">
          {ui.mode === 'paint'
            ? 'Drag to lay a mark. Press V to pick one up instead.'
            : 'Click a mark to select it, drag to move it. The agent can see what you have selected.'}
        </p>
      </Section>

      <Section title="Brush">
        <div className="stack-tight">
          {(Object.keys(BRUSHES) as BrushKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              title={BRUSHES[kind].hint}
              onClick={() => studio.setBrush({ kind })}
              className={`row${brush.kind === kind ? ' row--on' : ''}`}
            >
              <BrushGlyph kind={kind} />
              <span className="row-title">{BRUSHES[kind].label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Mark">
        <Segmented
          value={brush.fill ? 'fill' : 'line'}
          onChange={(v) => studio.setBrush({ fill: v === 'fill' })}
          options={[
            { value: 'line', label: 'Stroke', title: 'The path is a centreline the brush travels', Icon: PenNib },
            { value: 'fill', label: 'Wash', title: 'The path encloses a region that floods with colour', Icon: Drop },
          ]}
        />
      </Section>

      <Section title={pigment.name}>
        <div className="swatch-grid">
          {PIGMENTS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-label={p.name}
              title={`${p.name}. Granulation ${p.granulation}, staining ${p.staining}.`}
              onClick={() => studio.setBrush({ pigment: p.id })}
              className={`swatch pig-${p.id}${p.id === brush.pigment ? ' swatch--on' : ''}`}
            />
          ))}
        </div>
        <p className="note">
          {pigment.granulation > 0.5
            ? 'Granulates heavily, so it will mottle into the tooth of the paper.'
            : pigment.staining > 0.7
              ? 'Staining, so it holds a hard edge and will not lift again.'
              : 'Even and predictable in a wash.'}
        </p>
      </Section>

      <Section title="Load">
        <div className="stack">
          <Slider
            label="Water"
            value={brush.water}
            onChange={(water) => studio.setBrush({ water })}
            hint={
              brush.water > 0.65
                ? 'Wet enough to spread and bloom.'
                : brush.water < 0.25
                  ? 'Nearly dry, for a crisp and controlled edge.'
                  : 'An ordinary working wash.'
            }
          />
          <Slider
            label="Pigment"
            value={brush.opacity}
            onChange={(opacity) => studio.setBrush({ opacity })}
          />
          <Slider
            label="Pressure"
            value={brush.pressure}
            onChange={(pressure) => studio.setBrush({ pressure })}
          />
        </div>
      </Section>
    </>
  )
}
