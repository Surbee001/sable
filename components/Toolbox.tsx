'use client'

import { PIGMENTS, getPigment } from '@/lib/palette'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { BRUSHES, type BrushKind } from '@/lib/types'
import { Section, Segmented, Slider } from './ui'

/** A miniature of the mark each brush makes — faster to read than a label. */
function BrushGlyph({ kind, active }: { kind: BrushKind; active: boolean }) {
  const spec = BRUSHES[kind]
  const w = spec.baseWidth / 6
  const colour = active ? 'var(--color-ink-50)' : 'var(--color-ink-500)'
  return (
    <svg viewBox="0 0 44 16" className="h-4 w-11" aria-hidden>
      <path
        d="M 3 8 C 12 2 20 14 29 8 C 34 5 38 7 41 8"
        fill="none"
        stroke={colour}
        strokeWidth={Math.max(1, w)}
        strokeLinecap={kind === 'flat' ? 'butt' : 'round'}
        strokeDasharray={kind === 'dry' ? '3 2.5' : undefined}
        opacity={kind === 'mop' ? 0.55 : 1}
      />
    </svg>
  )
}

export function Toolbox() {
  const { ui } = useStudio()
  const brush = ui.brush
  const pigment = getPigment(brush.pigment)

  return (
    <div className="flex flex-col gap-6">
      <Section title="Mode">
        <Segmented
          value={ui.mode}
          onChange={(m) => studio.setMode(m)}
          options={[
            { value: 'paint', label: 'Paint', title: 'Shortcut: B' },
            { value: 'select', label: 'Select', title: 'Shortcut: V' },
          ]}
        />
        <p className="mt-1.5 text-[10px] leading-snug text-ink-500">
          {ui.mode === 'paint'
            ? 'Drag to lay a mark. Press V to pick one up instead.'
            : 'Click a mark to select it, drag to move it. The agent can see what you have selected.'}
        </p>
      </Section>

      <Section title="Brush">
        <div className="grid gap-0.5">
          {(Object.keys(BRUSHES) as BrushKind[]).map((kind) => {
            const active = brush.kind === kind
            return (
              <button
                key={kind}
                type="button"
                title={BRUSHES[kind].hint}
                onClick={() => studio.setBrush({ kind })}
                className={`flex items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-left transition-colors ${
                  active ? 'bg-ink-700' : 'hover:bg-ink-800'
                }`}
              >
                <BrushGlyph kind={kind} active={active} />
                <span
                  className={`text-[11px] font-medium ${active ? 'text-ink-50' : 'text-ink-300'}`}
                >
                  {BRUSHES[kind].label}
                </span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Mark">
        <Segmented
          value={brush.fill ? 'fill' : 'line'}
          onChange={(v) => studio.setBrush({ fill: v === 'fill' })}
          options={[
            { value: 'line', label: 'Stroke', title: 'The path is a centreline the brush travels' },
            { value: 'fill', label: 'Wash', title: 'The path encloses a region that floods with colour' },
          ]}
        />
      </Section>

      <Section title={`Pigment · ${pigment.name}`}>
        <div className="grid grid-cols-8 gap-1">
          {PIGMENTS.map((p) => {
            const active = p.id === brush.pigment
            return (
              <button
                key={p.id}
                type="button"
                title={`${p.name} — granulation ${p.granulation}, staining ${p.staining}`}
                onClick={() => studio.setBrush({ pigment: p.id })}
                className={`aspect-square rounded-full transition-transform hover:scale-110 ${
                  active ? 'ring-2 ring-ink-50 ring-offset-2 ring-offset-ink-850' : ''
                }`}
                style={{ background: p.hex }}
              />
            )
          })}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-ink-500">
          {pigment.granulation > 0.5
            ? 'Granulates heavily — it will mottle into the tooth of the paper.'
            : pigment.staining > 0.7
              ? 'Staining — holds a hard edge and will not lift again.'
              : 'Even and predictable in a wash.'}
        </p>
      </Section>

      <Section title="Load">
        <div className="flex flex-col gap-3.5">
          <Slider
            label="Water"
            value={brush.water}
            onChange={(water) => studio.setBrush({ water })}
            hint={
              brush.water > 0.65
                ? 'Wet enough to spread and bloom.'
                : brush.water < 0.25
                  ? 'Nearly dry — a crisp, controlled edge.'
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
    </div>
  )
}
