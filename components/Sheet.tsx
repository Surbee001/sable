'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { decimate, pointsToPath, sampleSubpaths, type Point } from '@/lib/geometry'
import { hitTest, selectionOutline } from '@/lib/hit'
import { presence } from '@/lib/presence'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { BRUSHES, CANVAS_H, CANVAS_W, PAPERS, type Stroke } from '@/lib/types'
import { paintOrder, renderScene, renderStroke } from '@/lib/watercolor'

const MAX_DPR = 2
/** Movement below this reads as a click, not a drag. */
const CLICK_SLOP = 3
const FLASH_MS = 2600

/**
 * The sheet is four stacked canvases, because the four things drawn on it
 * change at completely different rates:
 *
 *   main    marks that have dried. Appended to, almost never redrawn.
 *   fx      marks still wetting in, and the mark being drawn right now.
 *           Repainted every frame while either is true.
 *   ui      selection, guides, the brush footprint. Repainted on state changes.
 *   cursor  the two hands. Repainted the instant either moves.
 *
 * Keeping them apart is what lets the cursor track the mouse with no delay:
 * it never waits on a React render, and it never waits on a wash being redrawn.
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
  const { scene, ui, duet } = useStudio()
  const wrapRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const uiRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLCanvasElement>(null)

  const [size, setSize] = useState({ w: 0, h: 0 })

  const paintedRef = useRef<Stroke[] | null>(null)
  const drawingRef = useRef<{ points: Point[] } | null>(null)
  const dragRef = useRef<{ last: Point; moved: number; ids: string[] } | null>(null)
  const flashRef = useRef<{ ids: string[]; at: number } | null>(null)
  const fxFrameRef = useRef(0)
  const sceneRef = useRef(scene)
  const [, tick] = useState(0)

  sceneRef.current = scene

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

  const fit = useCallback(
    (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
      if (!canvas || size.w === 0) return null
      if (canvas.width !== size.w || canvas.height !== size.h) {
        canvas.width = size.w
        canvas.height = size.h
      }
      return canvas.getContext('2d')
    },
    [size],
  )

  /* ---------------- main: what has dried ---------------- */

  useEffect(() => {
    const canvas = mainRef.current
    if (!canvas || size.w === 0) return
    const resized = canvas.width !== size.w || canvas.height !== size.h
    const ctx = fit(canvas)
    if (!ctx) return
    if (resized) paintedRef.current = null

    const order = paintOrder(scene).filter((s) => presence.isSettled(s.id))
    const prev = paintedRef.current

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

  /* ---------------- fx: what is still wet ---------------- */

  const drawFx = useCallback(() => {
    const ctx = fit(fxRef.current)
    if (!ctx) return
    const sx = size.w / CANVAS_W
    const sy = size.h / CANVAS_H
    const current = sceneRef.current
    const tooth = PAPERS[current.paper].tooth
    const layerOf = new Map(current.layers.map((l) => [l.id, l]))

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    const settling = presence.settlingIds
    if (settling.length > 0) {
      const byId = new Map(current.strokes.map((s) => [s.id, s]))
      for (const id of settling) {
        const stroke = byId.get(id)
        if (!stroke) continue
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(sx, sy)
        renderStroke(
          ctx,
          stroke,
          {
            wetness: layerOf.get(stroke.layerId)?.wetness ?? 0,
            tooth,
            settle: presence.settleProgress(id),
          },
          sx,
          sy,
        )
      }
    }

    // The agent's line, as far as it has got. Rendered every frame so the mark
    // comes out from under its cursor rather than arriving complete once the
    // cursor has stopped moving.
    const live = presence.inProgress
    if (live && live.points.length > 1) {
      const stroke = current.strokes.find((s) => s.id === live.id)
      if (stroke) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(sx, sy)
        renderStroke(
          ctx,
          {
            ...stroke,
            path: pointsToPath(live.points) + (live.fill ? ' Z' : ''),
          },
          {
            wetness: layerOf.get(stroke.layerId)?.wetness ?? 0,
            tooth,
            settle: 0.5,
          },
          sx,
          sy,
        )
      }
    }

    // The mark in progress, painted for real rather than outlined. A dashed
    // line looks like a selection lasso, and watercolour never behaves the way
    // an outline suggests it will.
    const drawing = drawingRef.current
    if (drawing && drawing.points.length > 1) {
      const brush = studio.getUi().brush
      const layer = studio.getLayer(studio.getUi().activeLayerId)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(sx, sy)
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
        { wetness: layer?.wetness ?? 0, tooth, settle: 0.55 },
        sx,
        sy,
      )
    }
  }, [fit, size])

  /** Keep repainting for as long as anything is wet or being drawn. */
  const pumpFx = useCallback(() => {
    if (fxFrameRef.current) return
    const step = () => {
      fxFrameRef.current = 0
      drawFx()
      if (presence.settlingIds.length > 0 || presence.inProgress || drawingRef.current) {
        fxFrameRef.current = requestAnimationFrame(step)
      }
    }
    fxFrameRef.current = requestAnimationFrame(step)
  }, [drawFx])

  const pumpRef = useRef(pumpFx)
  pumpRef.current = pumpFx

  /**
   * Subscribed once, with no dependencies, and deliberately so.
   *
   * Every pointer move updates presence, and presence used to wake React on
   * each one. That re-created this effect, whose cleanup cancelled the frame
   * that was about to paint the preview, so nothing appeared until the brush
   * lifted. React only needs to hear about a mark finishing, which is rare;
   * everything else is the animation loop's business.
   */
  useEffect(() => {
    let wasSettling = -1
    const stop = presence.subscribe(() => {
      pumpRef.current()
      const settling = presence.settlingIds.length
      if (settling !== wasSettling) {
        wasSettling = settling
        tick((n) => n + 1)
      }
    })
    pumpRef.current()
    return () => {
      stop()
      if (fxFrameRef.current) cancelAnimationFrame(fxFrameRef.current)
    }
  }, [])

  useEffect(() => {
    drawFx()
  }, [drawFx, scene])

  /* ---------------- ui: selection and guides ---------------- */

  const drawUi = useCallback(() => {
    const ctx = fit(uiRef.current)
    if (!ctx) return
    const ink = themeInk()
    const sx = size.w / CANVAS_W
    const sy = size.h / CANVAS_H

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.scale(sx, sy)

    // Guides for the pass the human is on. The one they are about to trace is
    // drawn plainly; the rest of the pass waits behind it. What they actually
    // paint is their own line, not the guide: this shows where a mark goes, it
    // does not make the mark.
    const step = duet && duet.index < duet.score.steps.length
      ? duet.score.steps[duet.index]
      : null
    if (step?.by === 'human' && step.guides) {
      ctx.save()
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      for (let i = duet!.traced; i < step.guides.length; i++) {
        const upNext = i === duet!.traced
        ctx.strokeStyle = ink.accent
        ctx.globalAlpha = upNext ? 0.75 : 0.24
        ctx.lineWidth = upNext ? 2 : 1.4
        ctx.setLineDash(upNext ? [10, 7] : [4, 7])
        ctx.lineDashOffset = upNext ? -(performance.now() / 60) % 17 : 0
        for (const run of sampleSubpaths(step.guides[i], 8)) {
          if (run.length < 2) continue
          ctx.beginPath()
          ctx.moveTo(run[0].x, run[0].y)
          for (const p of run.slice(1)) ctx.lineTo(p.x, p.y)
          ctx.stroke()
        }
      }
      ctx.restore()
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
        if (stroke && presence.isSettled(id)) {
          outline(ctx, stroke, ink.agent, 2.6, fade * (0.28 + pulse * 0.36))
        }
      }
    }
  }, [duet, fit, scene, size, ui.selection])

  useEffect(() => {
    drawUi()
  })

  // The guide's dashes crawl, so a line waiting to be traced reads as an
  // instruction rather than as part of the painting.
  useEffect(() => {
    const step = duet && duet.index < duet.score.steps.length
      ? duet.score.steps[duet.index]
      : null
    if (step?.by !== 'human') return
    let raf = 0
    const step2 = () => {
      drawUi()
      raf = requestAnimationFrame(step2)
    }
    raf = requestAnimationFrame(step2)
    return () => cancelAnimationFrame(raf)
  }, [drawUi, duet])

  useEffect(() => {
    if (ui.recentAgent.length === 0) return
    flashRef.current = { ids: ui.recentAgent, at: performance.now() }
    let raf = 0
    const step = () => {
      const flash = flashRef.current
      if (!flash) return
      drawUi()
      if (performance.now() - flash.at > FLASH_MS) {
        flashRef.current = null
        studio.clearRecentAgent()
        drawUi()
        return
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [drawUi, ui.recentAgent])

  /* ---------------- cursor: the two hands ---------------- */

  const drawCursors = useCallback(() => {
    const ctx = fit(cursorRef.current)
    if (!ctx) return
    const ink = themeInk()
    const sx = size.w / CANVAS_W
    const sy = size.h / CANVAS_H

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    const human = presence.cursor('human')
    const mode = studio.getUi().mode
    const brush = studio.getUi().brush

    // The brush footprint, in paper units, so the size of the mark is known
    // before it is made.
    if (human.visible && mode === 'paint') {
      const r = (BRUSHES[brush.kind].baseWidth * (0.34 + brush.pressure * 0.92)) / 2
      ctx.save()
      ctx.scale(sx, sy)
      ctx.globalAlpha = human.painting ? 0.45 : 0.28
      ctx.strokeStyle = ink.guide
      ctx.lineWidth = 1 / ((sx + sy) / 2)
      ctx.beginPath()
      ctx.arc(human.x, human.y, Math.max(2, r), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    const agent = presence.cursor('agent')
    if (agent.visible) {
      drawCursor(ctx, agent.x * sx, agent.y * sy, ink.agent, 'Agent', 'Agent is painting', agent.painting, sx)
    }
    if (human.visible) {
      drawCursor(ctx, human.x * sx, human.y * sy, ink.accent, 'You', 'You are painting', human.painting, sx)
    }
  }, [fit, size])

  const cursorRef2 = useRef(drawCursors)
  cursorRef2.current = drawCursors

  // Straight off presence, never through React, so the cursor lands in the same
  // task as the pointer event that moved it.
  useEffect(() => {
    cursorRef2.current()
    return presence.subscribe(() => cursorRef2.current())
  }, [])

  useEffect(() => {
    drawCursors()
  }, [drawCursors])

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
      pumpFx()
    },
    [pumpFx, scene, toSheet, ui.mode, ui.selection],
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
      pumpFx()
    },
    [pumpFx, toSheet],
  )

  const finish = useCallback(() => {
    dragRef.current = null
    const drawing = drawingRef.current
    drawingRef.current = null
    const at = presence.cursor('human')
    presence.setHuman(at.x, at.y, false)

    if (drawing) {
      const points = decimate(drawing.points, 2.5)
      if (points.length >= 2) {
        const brush = studio.getUi().brush
        studio.paint(
          { path: pointsToPath(points) + (brush.fill ? ' Z' : ''), fill: brush.fill },
          'human',
        )
      }
    }
    drawFx()
  }, [drawFx])

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
        <canvas ref={fxRef} className="sheet-layer" />
        <canvas ref={uiRef} className="sheet-layer" />
        <canvas
          ref={cursorRef}
          className="sheet-layer sheet-layer--interactive"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onPointerEnter={(e) => {
            const pt = toSheet(e)
            presence.setHuman(pt.x, pt.y, false)
          }}
          onPointerLeave={() => presence.hideHuman()}
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

  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  const text = painting ? busyLabel : label
  const w = ctx.measureText(text).width + 12
  const h = 17

  ctx.beginPath()
  ctx.roundRect(13, 13, w, h, 8)
  ctx.fillStyle = colour
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 19, 13 + h / 2 + 0.5)
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
