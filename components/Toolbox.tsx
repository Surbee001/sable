'use client'

import { CursorClick, Drop, PaintBrush, PenNib } from '@phosphor-icons/react'
import { PIGMENTS, getPigment } from '@/lib/palette'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { BRUSHES, type BrushKind } from '@/lib/types'
import { Segmented, Slider } from './ui'

/** A miniature of the mark each brush makes, quicker to read than a label. */
function BrushGlyph({ kind }: { kind: BrushKind }) {
  const spec = BRUSHES[kind]
  return (
    <svg viewBox="0 0 32 14" width="32" height="14" aria-hidden="true">
      <path
        d="M 3 7 C 9 2 15 12 21 7 C 24 5 27 6 29 7"
        fill="none"
        stroke="currentColor"
        strokeWidth={Math.max(1, spec.baseWidth / 8)}
        strokeLinecap={kind === 'flat' ? 'butt' : 'round'}
        strokeDasharray={kind === 'dry' ? '2.5 2' : undefined}
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
    <div className="tools">
      <Segmented
        value={ui.mode}
        onChange={(m) => studio.setMode(m)}
        options={[
          { value: 'paint', label: 'Paint', title: 'Draw with the mouse. Shortcut: B', Icon: PaintBrush },
          { value: 'select', label: 'Select', title: 'Pick a mark up. Shortcut: V', Icon: CursorClick },
        ]}
      />

      <div className="brush-row">
        {(Object.keys(BRUSHES) as BrushKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-label={BRUSHES[kind].label}
            title={`${BRUSHES[kind].label}. ${BRUSHES[kind].hint}`}
            onClick={() => studio.setBrush({ kind })}
            className={`brush${brush.kind === kind ? ' brush--on' : ''}`}
          >
            <BrushGlyph kind={kind} />
          </button>
        ))}
      </div>

      <Segmented
        value={brush.fill ? 'fill' : 'line'}
        onChange={(v) => studio.setBrush({ fill: v === 'fill' })}
        options={[
          { value: 'line', label: 'Stroke', title: 'The path is a centreline the brush travels', Icon: PenNib },
          { value: 'fill', label: 'Wash', title: 'The path encloses a region that floods with colour', Icon: Drop },
        ]}
      />

      <div>
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
        <span className="pigment-name">{pigment.name}</span>
      </div>

      <div className="dials">
        <Slider label="Water" value={brush.water} onChange={(water) => studio.setBrush({ water })} />
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
    </div>
  )
}
