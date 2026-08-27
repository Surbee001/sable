'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { decimate, pointsToPath, type Point } from '@/lib/geometry'
import { hitTest, selectionOutline } from '@/lib/hit'
import { presence, type Who } from '@/lib/presence'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { BRUSHES, CANVAS_H, CANVAS_W, PAPERS, type Stroke } from '@/lib/types'
import { paintOrder, renderScene, renderStroke } from '@/lib/watercolor'

const MAX_DPR = 2
/** Movement below this reads as a click, not a drag. */
const CLICK_SLOP = 3
const FLASH_MS = 2600

/**
 * Overlay colours come from the stylesheet rather than being written here, so
 * selection, cursors and agent marks follow the theme like everything else.
 * A canvas cannot take a class, so the tokens are read back off the document.
 */
function themeInk(): { accent: string; agent: string; guide: string } {
  const s = getComputedStyle(document.documentElement)
  return {
    accent: s.getPropertyValue('--accent').trim() || '#b8791f',
    agent: s.getPropertyValue('--agent').trim() || '#3b7fa8',
    guide: 'rgba(40, 32, 24, 0.3)',
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
  const frameRef = useRef(0)
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

  /* ---------------- presence drives repaints ---------------- */

  useEffect(() => presence.subscribe(() => tick((n) => n + 1)), [])

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

    // A mark the agent has queued but not yet reached is in the document and
    // not yet on the paper. Only this view honours that; every tool result
    // renders the document in full.
    const order = paintOrder(scene).filter((s) => presence.isRevealed(s.id))
    const prev = paintedRef.current

    // If the new paint order merely extends the old one, which is the common
    // case while either of them is painting, only the added strokes need
    // drawing. A full sheet of washes costs hundreds of polygon fills, far too
    // slow to redo on every stroke and completely unnecessary.
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
      renderScene(ctx, { ...scene, strokes: order }, size.w, size.h)
    }
    paintedRef.current = order
  })

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

  /* ---------------- overlay ---------------- */

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
    const sx = size.w / CANVAS_W
    const sy = size.h / CANVAS_H

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.save()
    ctx.scale(sx, sy)

    // The mark in progress, painted for real rather than outlined. Watercolour
    // does not behave the way a preview line suggests, so the preview is the
    // actual wash.
    const drawing = drawingRef.current
    if (drawing && drawing.points.length > 1) {
      const brush = studio.getUi().brush
      const layer = studio.getLayer(studio.getUi().activeLayerId)
      renderStroke(
        ctx,
        {
          id: 'preview',
          layerId: layer?.id ?? '',
          kind: brush.kind,
          path: pointsToPath(decimate(drawing.points, 2.5)) + (brush.fill ? ' Z' : ''),
          pigment: brush.pigment,
          water: brush.water,
          pressure: brush.pressure,
          opacity: brush.opacity,
          fill: brush.fill,
          seed: 7,
          author: 'human',
          createdAt: 0,
        },
        { wetness: layer?.wetness ?? 0, tooth: PAPERS[scene.paper].tooth },
        sx,
        sy,
      )
      // renderStroke leaves its own transform; put ours back.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(sx, sy)
    }

    const byId = new Map(scene.strokes.map((s) => [s.id, s]))

    for (const id of ui.selection) {
      const stroke = byId.get(id)
      if (stroke) outline(ctx, stroke, ink.accent, 2.2, 1)
    }

    const flash = flashRef.current
    if (flash) {
      const age = performance.now() - flash.at
      const fade = 1 - Math.min(1, age / FLASH_MS)
      const pulse = Math.sin(age / 190) * 0.5 + 0.5
      for (const id of flash.ids) {
        const stroke = byId.get(id)
        if (stroke && presence.isRevealed(id)) {
          outline(ctx, stroke, ink.agent, 2.6, fade * (0.3 + pulse * 0.4))
        }
      }
    }

    // The brush footprint, in paper units, so you can see how big the mark
    // will be before you commit to it.
    const human = presence.cursor('human')
    if (human.visible && ui.mode === 'paint') {
      const spec = BRUSHES[ui.brush.kind]
      const r = (spec.baseWidth * (0.34 + ui.brush.pressure * 0.92)) / 2
      ctx.save()
      ctx.globalAlpha = human.painting ? 0.5 : 0.32
      ctx.strokeStyle = ink.guide
      ctx.lineWidth = 1 / ((sx + sy) / 2)
      ctx.beginPath()
      ctx.arc(human.x, human.y, Math.max(2, r), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    ctx.restore()

    // Cursors are drawn in screen units so they stay a readable size however
    // large the sheet is.
    const agent = presence.cursor('agent')
    if (agent.visible) {
      drawCursor(ctx, agent.x * sx, agent.y * sy, ink.agent, 'Agent', 'Agent is painting', agent.painting, sx)
    }
    if (human.visible) {
      drawCursor(ctx, human.x * sx, human.y * sy, ink.accent, 'You', 'You are painting', human.painting, sx)
    }
  }, [scene, size, ui.selection, ui.brush, ui.mode])

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
      presence.setHuman(pt.x, pt.y, true)

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
    },
    [scene, toSheet, ui.mode, ui.selection],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pt = toSheet(e)
      const drawing = drawingRef.current
      presence.setHuman(pt.x, pt.y, Boolean(drawing) || Boolean(dragRef.current))

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

      if (!drawing) return
      const last = drawing.points[drawing.points.length - 1]
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 2.2) return
      drawing.points.push(pt)

      // Repainting the wash is a few milliseconds, so it is thrown at the next
      // frame rather than run for every pointer event.
      if (!frameRef.current) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0
          drawOverlay()
        })
      }
    },
    [drawOverlay, toSheet],
  )

  const finish = useCallback(() => {
    dragRef.current = null
    const drawing = drawingRef.current
    drawingRef.current = null
    presence.setHuman(
      presence.cursor('human').x,
      presence.cursor('human').y,
      false,
    )
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
          onPointerLeave={() => {
            presence.hideHuman()
            drawOverlay()
          }}
        />
      </div>
    </div>
  )
}

/**
 * A collaborator's hand, drawn the way a shared document draws one: an arrow
 * with a name on it. Two people are working here and one of them is not in the
 * room, so it matters that you can see where it is looking.
 */
function drawCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colour: string,
  label: string,
  busyLabel: string,
  painting: boolean,
  scale: number,
): void {
  const k = Math.max(1, Math.min(2, scale))
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.translate(x, y)
  ctx.scale(k, k)

  ctx.shadowColor = 'rgba(0,0,0,0.28)'
  ctx.shadowBlur = 5
  ctx.shadowOffsetY = 1.5

  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, 16.5)
  ctx.lineTo(4.1, 12.8)
  ctx.lineTo(6.8, 19)
  ctx.lineTo(9.6, 17.7)
  ctx.lineTo(7, 11.7)
  ctx.lineTo(12.2, 11.4)
  ctx.closePath()
  ctx.fillStyle = colour
  ctx.fill()
  ctx.lineWidth = 1.3
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.stroke()

  ctx.shadowColor = 'transparent'

  // Name tag.
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  const text = painting ? busyLabel : label
  const w = ctx.measureText(text).width + 12
  const h = 17
  const bx = 13
  const by = 13

  ctx.beginPath()
  ctx.roundRect(bx, by, w, h, 8)
  ctx.fillStyle = colour
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, bx + 6, by + h / 2 + 0.5)
  ctx.restore()
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

export type { Who }
