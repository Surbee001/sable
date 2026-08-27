'use client'

import { Eye, EyeSlash, Plus } from '@phosphor-icons/react'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { PAPERS, type PaperKind } from '@/lib/types'
import { Button, Section } from './ui'

export function Layers() {
  const { scene, ui } = useStudio()

  return (
    <>
      <Section
        title="Layers"
        action={
          <Button
            onClick={() => studio.addLayer(`Layer ${scene.layers.length + 1}`, 0.15, 'human')}
          >
            <Plus size={11} weight="bold" />
            Add
          </Button>
        }
      >
        {/* Top of the list is the top of the stack, as a painter expects. */}
        <div className="stack-tight">
          {scene.layers
            .slice()
            .reverse()
            .map((layer) => {
              const count = scene.strokes.filter((s) => s.layerId === layer.id).length
              return (
                <div
                  key={layer.id}
                  className={`row${layer.id === ui.activeLayerId ? ' row--on' : ''}`}
                >
                  <button
                    type="button"
                    aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                    onClick={() =>
                      studio.updateLayer(layer.id, { visible: !layer.visible }, 'human')
                    }
                    className={`eye${layer.visible ? '' : ' eye--off'}`}
                  >
                    {layer.visible ? (
                      <Eye size={13} weight="bold" />
                    ) : (
                      <EyeSlash size={13} weight="bold" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="grow row"
                    onClick={() => studio.setActiveLayer(layer.id)}
                  >
                    <span className="grow">
                      <span className="row-title">{layer.name}</span>
                      <span className="row-sub">
                        {count} mark{count === 1 ? '' : 's'},{' '}
                        {layer.wetness > 0.5 ? 'wet' : layer.wetness > 0.1 ? 'damp' : 'dry'}
                      </span>
                    </span>
                  </button>
                  <input
                    className="range range--mini"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={layer.wetness}
                    aria-label={`Wetness of ${layer.name}`}
                    title={`Wetness ${layer.wetness.toFixed(2)}. Paint onto a wet layer and it bleeds.`}
                    onChange={(e) =>
                      studio.updateLayer(
                        layer.id,
                        { wetness: parseFloat(e.target.value) },
                        'human',
                      )
                    }
                  />
                </div>
              )
            })}
        </div>
      </Section>

      <Section title="Paper">
        <div className="paper-grid">
          {(Object.keys(PAPERS) as PaperKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              title={PAPERS[kind].hint}
              onClick={() => studio.setPaper(kind, 'human')}
              className={`paper${scene.paper === kind ? ' paper--on' : ''}`}
            >
              <span className={`paper-chip paper-${kind}`} />
              {PAPERS[kind].label}
            </button>
          ))}
        </div>
      </Section>
    </>
  )
}
