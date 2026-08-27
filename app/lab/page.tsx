'use client'

import { useEffect, useRef } from 'react'
import { CANVAS_H, CANVAS_W, type Scene, type Stroke } from '@/lib/types'
import { renderScene } from '@/lib/watercolor'

/** A test sheet. Not shipped — this is how the renderer gets tuned. */
export default function Lab() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = 2
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    const ctx = canvas.getContext('2d')!

    let id = 0
    const mk = (s: Partial<Stroke>): Stroke => ({
      id: `s${id++}`,
      layerId: 'l1',
      kind: 'round',
      path: 'M 0 0',
      pigment: 'ultramarine',
      water: 0.5,
      pressure: 0.7,
      opacity: 0.7,
      seed: 1000 + id * 37,
      author: 'agent',
      createdAt: id,
      ...s,
    })

    const strokes: Stroke[] = [
      // Row 1 — water sweep, same pigment
      ...[0, 0.25, 0.5, 0.75, 1].map((w, i) =>
        mk({
          path: `M ${60 + i * 190} 60 C ${100 + i * 190} 40 ${140 + i * 190} 80 ${180 + i * 190} 60`,
          water: w,
          pigment: 'ultramarine',
          seed: 100 + i * 13,
        }),
      ),
      // Row 2 — brushes
      ...(['round', 'flat', 'liner', 'mop', 'dry'] as const).map((k, i) =>
        mk({
          path: `M ${60 + i * 190} 190 C ${110 + i * 190} 150 ${130 + i * 190} 230 ${180 + i * 190} 190`,
          kind: k,
          pigment: 'burnt-sienna',
          water: 0.45,
          seed: 200 + i * 29,
        }),
      ),
      // Row 3 — granulating vs staining, as filled shapes
      ...['ultramarine', 'cerulean', 'phthalo-blue', 'viridian', 'quinacridone-rose'].map(
        (p, i) =>
          mk({
            path: `M ${60 + i * 190} 320 q 60 -48 120 0 q -60 48 -120 0 Z`,
            pigment: p,
            water: 0.7,
            opacity: 0.75,
            fill: true,
            seed: 300 + i * 41,
          }),
      ),
      // Row 4 — opacity ramp on a flooded disc
      ...[0.2, 0.4, 0.6, 0.8, 1].map((o, i) =>
        mk({
          path: `M ${110 + i * 190} 450 m -50 0 a 50 50 0 1 0 100 0 a 50 50 0 1 0 -100 0 Z`,
          pigment: 'sap-green',
          opacity: o,
          water: 0.6,
          fill: true,
          seed: 400 + i * 17,
        }),
      ),
      // Row 5 — a long calligraphic line and a big wash
      mk({
        path: 'M 60 600 C 200 540 320 660 460 590 S 700 540 940 610',
        kind: 'liner',
        pigment: 'sepia',
        water: 0.3,
        pressure: 1,
        seed: 501,
      }),
      mk({
        path: 'M 60 660 C 300 630 700 700 940 655',
        kind: 'mop',
        pigment: 'paynes-grey',
        water: 0.9,
        pressure: 0.8,
        opacity: 0.45,
        seed: 502,
      }),
    ]

    const scene: Scene = {
      title: 'lab',
      paper: 'cold-press',
      layers: [{ id: 'l1', name: 'Test', visible: true, wetness: 0, opacity: 1 }],
      strokes,
    }

    const t0 = performance.now()
    renderScene(ctx, scene, canvas.width, canvas.height)
    const ms = performance.now() - t0
    const el = document.getElementById('timing')
    if (el) el.textContent = `${strokes.length} strokes in ${ms.toFixed(0)}ms`
  }, [])

  return (
    <div className="min-h-screen bg-ink-900 p-6">
      <div id="timing" className="label mb-3" />
      <canvas
        ref={ref}
        className="w-full max-w-[1000px] rounded-sm shadow-2xl"
        style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
      />
    </div>
  )
}
