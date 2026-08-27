'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { decimate, pointsToPath, type Point } from '@/lib/geometry'
import { hitTest, selectionOutline } from '@/lib/hit'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { CANVAS_H, CANVAS_W, PAPERS, type Stroke } from '@/lib/types'
import { paintOrder, renderScene, renderStroke } from '@/lib/watercolor'

const MAX_DPR = 2
/** Movement below this reads as a click, not a drag. */
const CLICK_SLOP = 3
const FLASH_MS = 2600

/**
 * Overlay colours come from the stylesheet rather than being written here, so
 * selection and agent marks follow the theme like everything else. Canvas
 * cannot take a class, so the tokens are read back off the document.
 */
function themeInk(): { accent: string; agent: string; guide: string } {
  const s = getComputedStyle(document.documentElement)
  return {
    accent: s.getPropertyValue('--accent').trim() || '#b8791f',
    agent: s.getPropertyValue('--agent').trim() || '#3b7fa8',
    guide: 'rgba(40, 32, 24, 0.34)',
  }
}

export function Sheet() {
  const { scene, ui } = useStudio()
  const wrapRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const [size, setSize] = useState({ w: 0, h: 0 })

  /** What the main canvas currently shows, so we can append instead of redraw. */
  const paintedRef = useRef<Stroke[] | null>(null)
  const drawingRef = useRef<{ points: Point[] } | null>(null)
  const dragRef = useRef<{ last: Point; moved: number; ids: string[] } | null>(null)
  const flashRef = useRef<{ ids: string[]; at: number } | null>(null)
  const [, tick] = useState(0)

  /* ---------------- sizing ---------------- */

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(([entry]) => {
      const cssW = entry.contentRect.width
      if (cssW <= 0) return
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      setSize({
        w: Math.round(cssW * dpr),
        h: Math.round(((cssW * CANVAS_H) / CANVAS_W) * dpr),
      })
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  /* ---------------- main render ---------------- */

  useEffect(() => {
    const canvas = mainRef.current
    if (!canvas || size.w === 0) return
    if (canvas.width !== size.w || canvas.height !== size.h) {
      canvas.width = size.w
      canvas.height = size.h
      paintedRef.current = null
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const order = paintOrder(scene)
    const prev = paintedRef.current

    // If the new paint order merely extends the old one, which is the common
    // case while someone is painting, only the added strokes need drawing. A
    // full sheet of washes costs hundreds of polygon fills, far too slow to
    // redo on every stroke and completely unnecessary.
    const isAppend =
      prev !== null && order.length >= prev.length && prev.every((s, i) => order[i] === s)

    if (isAppend && order.length === prev.length) return

    if (isAppend) {
      const tooth = PAPERS[scene.paper].tooth
      const layerOf = new Map(scene.layers.map((l) => [l.id, l]))
      for (const stroke of order.slice(prev.length)) {
        renderStroke(
          ctx,
          stroke,
          { wetness: layerOf.get(stroke.layerId)?.wetness ?? 0, tooth },
          size.w / CANVAS_W,
          size.h / CANVAS_H,
        )
      }
    } else {
      renderScene(ctx, scene, size.w, size.h)
    }
    paintedRef.current = order
  }, [scene, size])

  /* ---------------- agent flash ---------------- */

  useEffect(() => {
    if (ui.recentAgent.length === 0) return
    flashRef.current = { ids: ui.recentAgent, at: performance.now() }
    let raf = 0
    const step = () => {
      const flash = flashRef.current
      if (!flash) return
      tick((n) => n + 1)
      if (performance.now() - flash.at > FLASH_MS) {
        flashRef.current = null
        studio.clearRecentAgent()
        tick((n) => n + 1)
        return
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [ui.recentAgent])

  /* ---------------- overlay render ---------------- */

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current
    if (!canvas || size.w === 0) return
    if (canvas.width !== size.w || canvas.height !== size.h) {
      canvas.width = size.w
      canvas.height = size.h
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ink = themeInk()

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.scale(size.w / CANVAS_W, size.h / CANVAS_H)

    // The mark being drawn right now: a thin guide, not a fake of the wash.
    const drawing = drawingRef.current
    if (drawing && drawing.points.length > 1) {
      ctx.save()
      ctx.strokeStyle = ink.guide
      ctx.lineWidth = 1.6
      ctx.setLineDash([7, 5])
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(drawing.points[0].x, drawing.points[0].y)
      for (const p of drawing.points.slice(1)) ctx.lineTo(p.x, p.y)
      if (ui.brush.fill) ctx.closePath()
      ctx.stroke()
      ctx.restore()
    }

    const byId = new Map(scene.strokes.map((s) => [s.id, s]))

    for (const id of ui.selection) {
      const stroke = byId.get(id)
      if (stroke) outline(ctx, stroke, ink.accent, 2.2, 1)
    }

    // What the agent just did, pulsed briefly so it is impossible to miss.
    const flash = flashRef.current
    if (flash) {
      const age = performance.now() - flash.at
      const fade = 1 - Math.min(1, age / FLASH_MS)
      const pulse = Math.sin(age / 190) * 0.5 + 0.5
      const alpha = fade * (0.35 + pulse * 0.45)
      for (const id of flash.ids) {
        const stroke = byId.get(id)
        if (stroke) outline(ctx, stroke, ink.agent, 2.6, alpha)
      }
    }
  }, [scene, size, ui.selection, ui.brush.fill])

  useEffect(() => {
    drawOverlay()
  })

  /* ---------------- pointer ---------------- */

  const toSheet = useCallback((e: React.PointerEvent): Point => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    }
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const pt = toSheet(e)
      e.currentTarget.setPointerCapture(e.pointerId)

      if (ui.mode === 'select') {
        const hit = hitTest(scene, pt)
        if (hit) {
          const already = ui.selection.includes(hit.id)
          const next = e.shiftKey
            ? already
              ? ui.selection.filter((id) => id !== hit.id)
              : [...ui.selection, hit.id]
            : already
              ? ui.selection
              : [hit.id]
          studio.select(next)
          dragRef.current = { last: pt, moved: 0, ids: next }
        } else if (!e.shiftKey) {
          studio.select([])
        }
        return
      }

      drawingRef.current = { points: [pt] }
      drawOverlay()
    },
    [drawOverlay, scene, toSheet, ui.mode, ui.selection],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pt = toSheet(e)

      const drag = dragRef.current
      if (drag) {
        const dx = pt.x - drag.last.x
        const dy = pt.y - drag.last.y
        drag.moved += Math.hypot(dx, dy)
        // Only commit once it is clearly a drag, so a plain click to select
        // does not push a no-op onto the undo stack.
        if (drag.moved > CLICK_SLOP && drag.ids.length > 0) {
          studio.move(drag.ids, dx, dy, 'human')
          drag.last = pt
        }
        return
      }

      const drawing = drawingRef.current
      if (!drawing) return
      const last = drawing.points[drawing.points.length - 1]
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1.6) return
      drawing.points.push(pt)
      drawOverlay()
    },
    [drawOverlay, toSheet],
  )

  const finish = useCallback(() => {
    dragRef.current = null
    const drawing = drawingRef.current
    drawingRef.current = null
    if (!drawing) {
      drawOverlay()
      return
    }

    const points = decimate(drawing.points, 2.5)
    if (points.length < 2) {
      drawOverlay()
      return
    }

    const brush = studio.getUi().brush
    studio.paint(
      { path: pointsToPath(points) + (brush.fill ? ' Z' : ''), fill: brush.fill },
      'human',
    )
    drawOverlay()
  }, [drawOverlay])

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) studio.redo()
        else studio.undo()
        return
      }
      if (e.key === 'b' || e.key === 'B') studio.setMode('paint')
      if (e.key === 'v' || e.key === 'V') studio.setMode('select')
      if (e.key === 'Escape') studio.select([])
      if ((e.key === 'Backspace' || e.key === 'Delete') && studio.getUi().selection.length) {
        e.preventDefault()
        studio.erase(studio.getUi().selection, 'human')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div ref={wrapRef}>
      <div className="sheet-frame">
        <canvas ref={mainRef} className="sheet-layer" />
        <canvas
          ref={overlayRef}
          className={`sheet-layer sheet-layer--interactive ${
            ui.mode === 'paint' ? 'cursor-paint' : 'cursor-pick'
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      </div>
    </div>
  )
}

function outline(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  colour: string,
  width: number,
  alpha: number,
): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = colour
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.setLineDash(stroke.fill ? [] : [9, 6])
  for (const run of selectionOutline(stroke)) {
    if (run.length < 2) continue
    ctx.beginPath()
    ctx.moveTo(run[0].x, run[0].y)
    for (const p of run.slice(1)) ctx.lineTo(p.x, p.y)
    if (stroke.fill) ctx.closePath()
    ctx.stroke()
  }
  ctx.restore()
}
