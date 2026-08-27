'use client'

import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { PAPERS, type PaperKind } from '@/lib/types'
import { Button, Section } from './ui'

export function Layers() {
  const { scene, ui } = useStudio()

  return (
    <Section
      title="Layers"
      action={
        <Button
          tone="ghost"
          onClick={() => studio.addLayer(`Layer ${scene.layers.length + 1}`, 0.15, 'human')}
        >
          + Add
        </Button>
      }
    >
      {/* Top of the list is the top of the stack, as a painter would expect. */}
      <div className="flex flex-col-reverse gap-0.5">
        {scene.layers.map((layer) => {
          const active = layer.id === ui.activeLayerId
          const count = scene.strokes.filter((s) => s.layerId === layer.id).length
          return (
            <div
              key={layer.id}
              className={`group flex items-center gap-2 rounded-[4px] px-2 py-1.5 transition-colors ${
                active ? 'bg-ink-700' : 'hover:bg-ink-800'
              }`}
            >
              <button
                type="button"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                onClick={() => studio.updateLayer(layer.id, { visible: !layer.visible }, 'human')}
                className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                  layer.visible ? 'bg-ink-200' : 'bg-transparent ring-1 ring-ink-600'
                }`}
              />
              <button
                type="button"
                onClick={() => studio.setActiveLayer(layer.id)}
                className="flex-1 text-left"
              >
                <span
                  className={`block text-[11px] font-medium ${active ? 'text-ink-50' : 'text-ink-300'}`}
                >
                  {layer.name}
                </span>
                <span className="block text-[9.5px] text-ink-500">
                  {count} mark{count === 1 ? '' : 's'} ·{' '}
                  {layer.wetness > 0.5 ? 'wet' : layer.wetness > 0.1 ? 'damp' : 'dry'}
                </span>
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layer.wetness}
                title={`Wetness ${layer.wetness.toFixed(2)} — paint onto a wet layer and it bleeds`}
                onChange={(e) =>
                  studio.updateLayer(layer.id, { wetness: parseFloat(e.target.value) }, 'human')
                }
                className="sable-range w-12 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </div>
          )
        })}
      </div>

      <div className="mt-3">
        <h3 className="label mb-1.5">Paper</h3>
        <div className="grid grid-cols-2 gap-1">
          {(Object.keys(PAPERS) as PaperKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              title={PAPERS[kind].hint}
              onClick={() => studio.setPaper(kind, 'human')}
              className={`rounded-[4px] px-2 py-1.5 text-left text-[10.5px] font-medium transition-colors ${
                scene.paper === kind
                  ? 'bg-ink-700 text-ink-50'
                  : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
              }`}
            >
              <span
                className="mb-1 block h-1.5 w-full rounded-sm"
                style={{ background: PAPERS[kind].base }}
              />
              {PAPERS[kind].label}
            </button>
          ))}
        </div>
      </div>
    </Section>
  )
}
