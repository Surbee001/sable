'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { pointsToPath, resample, sampleSubpaths, type Point } from '@/lib/geometry'
import { hitTest, selectionOutline } from '@/lib/hit'
import { presence, WET } from '@/lib/presence'
import { studio } from '@/lib/store'
import { useStudio } from '@/lib/useStudio'
import { BRUSHES, CANVAS_H, CANVAS_W, PAPERS, type Stroke } from '@/lib/types'
import { paintOrder, renderScene, renderStroke } from '@/lib/watercolor'

const MAX_DPR = 2
/** Movement below this reads as a click, not a drag. */
const CLICK_SLOP = 3
const FLASH_MS = 2600
/**
 * How far each raw pointer sample pulls the brush towards it, 0..1.
 *
 * Low enough to take the tremor and the digitiser's stair-stepping out of the
 * line, high enough that the brush still arrives where the hand is rather than
 * trailing behind it. Below about 0.3 the lag is visible as the cursor pulling
 * away from its own mark.
 */
const INPUT_SMOOTHING = 0.45
/** Closest two recorded samples may sit, in sheet units. */
const MIN_SAMPLE = 1.2
/**
 * Arc-length spacing of the committed path, in sheet units.
 *
 * One cubic per sample, so this trades file size against how faithfully a
 * long stroke keeps its curves. Fine enough that the renderer's own sampling
 * is the limit rather than this.
 */
const COMMIT_SAMPLE = 3.5

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
  const groundRef = useRef('')
  const drawingRef = useRef<{ points: Point[]; raw: Point | null } | null>(null)
  const dragRef = useRef<{ last: Point; moved: number; ids: string[] } | null>(null)
  const flashRef = useRef<{ ids: string[]; at: number } | null>(null)
  const fxFrameRef = useRef(0)
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

    /**
     * Everything under the marks, as a string.
     *
     * Appending only the new strokes is what keeps painting fast, but the test
     * for whether that is safe was only ever about the strokes. Change the
     * paper, or a layer's wetness, and the marks are identical, so it decided
     * there was nothing to do and the sheet kept its old ground until the next
     * stroke forced a full redraw. Choosing rough paper and watching nothing
     * happen is a bug you can see.
     */
    const ground = `${scene.paper}|${scene.layers
      .map((l) => `${l.id}:${l.visible ? 1 : 0}:${l.wetness}`)
      .join(',')}`
    const groundChanged = ground !== groundRef.current
    groundRef.current = ground

    const isAppend =
      !groundChanged &&
      prev !== null &&
      order.length >= prev.length &&
      prev.every((s, i) => order[i] === s)

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
    // Straight off the store rather than the last rendered snapshot. The two
    // agree except in the moment that matters most: between a mark being
    // committed and React committing the render that carries it, where the
    // preview has already been dropped and the snapshot does not have the
    // stroke yet, so the mark would blink out for a frame on lift.
    const current = studio.getScene()
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
          { ...stroke, path: '' },
          {
            wetness: layerOf.get(stroke.layerId)?.wetness ?? 0,
            tooth,
            settle: WET,
            // Same reasoning as the human's mark below: these are already
            // points, and re-deriving them through the DOM every frame is what
            // made a long stroke get heavier the longer it went on.
            centre: [
              live.fill && live.points.length > 2
                ? [...live.points, live.points[0]]
                : live.points,
            ],
            preview: true,
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
          // Only ever read back by the renderer, which is taking the points
          // below instead. Building the real path data here would put the whole
          // per-frame round trip back.
          path: '',
          pigment: brush.pigment,
          water: brush.water,
          pressure: brush.pressure,
          opacity: brush.opacity,
          fill: brush.fill,
          seed: 7,
          author: 'human',
          createdAt: 0,
        },
        {
          wetness: layer?.wetness ?? 0,
          tooth,
          settle: WET,
          centre: [
            brush.fill && drawing.points.length > 2
              ? [...drawing.points, drawing.points[0]]
              : drawing.points,
          ],
          preview: true,
        },
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
      // Zeroed, not just cancelled. The id is also the "a frame is already
      // booked" flag that pumpFx checks before scheduling, so leaving a stale
      // one behind wedges the pump shut: under StrictMode this effect mounts,
      // tears down and mounts again, and the second pumpFx saw a live-looking
      // id for a frame that had already been cancelled and returned without
      // booking anything. Nothing then repainted fx except the one-shot on a
      // scene change, so a mark stayed invisible until the brush lifted and
      // only got its wetting-in when the *next* mark landed.
      if (fxFrameRef.current) cancelAnimationFrame(fxFrameRef.current)
      fxFrameRef.current = 0
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

  const toClientSheet = useCallback(
    (clientX: number, clientY: number, el: Element): Point => {
      const rect = el.getBoundingClientRect()
      return {
        x: ((clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((clientY - rect.top) / rect.height) * CANVAS_H,
      }
    },
    [],
  )

  const toSheet = useCallback(
    (e: React.PointerEvent): Point => toClientSheet(e.clientX, e.clientY, e.currentTarget),
    [toClientSheet],
  )

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

      drawingRef.current = { points: [pt], raw: pt }
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

      /**
       * Every position the pointer actually visited, not just the one the
       * browser delivered on this frame.
       *
       * A 120Hz trackpad or a tablet reports far faster than the display
       * refreshes, and the extra samples are held back and handed over in a
       * batch. Reading only the event itself throws them away, which turns a
       * fast curve into a handful of long chords: the corners the hand never
       * made. This is where a fast stroke stops being polygonal.
       */
      const native = e.nativeEvent
      const batch =
        typeof native.getCoalescedEvents === 'function'
          ? native.getCoalescedEvents()
          : []
      const moves: Point[] = batch.length
        ? batch.map((m) => toClientSheet(m.clientX, m.clientY, e.currentTarget))
        : [pt]

      for (const raw of moves) {
        // One pole of exponential smoothing. The hand shakes, and a digitiser
        // quantises what is left, so the raw track has a wobble on it at a
        // finer scale than any brush mark. Catmull-Rom interpolates every point
        // it is given exactly, so without this the wobble is not just kept, it
        // is overshot into visible kinks.
        const prior = drawing.raw
        const smoothed = prior
          ? {
              x: prior.x + (raw.x - prior.x) * INPUT_SMOOTHING,
              y: prior.y + (raw.y - prior.y) * INPUT_SMOOTHING,
            }
          : raw
        drawing.raw = smoothed

        const last = drawing.points[drawing.points.length - 1]
        if (Math.hypot(smoothed.x - last.x, smoothed.y - last.y) < MIN_SAMPLE) continue
        drawing.points.push(smoothed)
      }
      pumpFx()
    },
    [pumpFx, toClientSheet, toSheet],
  )

  const finish = useCallback(() => {
    dragRef.current = null
    const drawing = drawingRef.current
    drawingRef.current = null
    const at = presence.cursor('human')
    presence.setHuman(at.x, at.y, false)

    if (drawing) {
      /**
       * Even arc-length samples, not "whatever was far enough apart".
       *
       * The stored path is Catmull-Rom through these points, and Catmull-Rom
       * passes through every one of them exactly: its tangent at a point comes
       * straight from that point's neighbours. Unevenly spaced samples
       * therefore give unevenly weighted tangents, which is what put kinks in a
       * curve the hand drew cleanly. Spacing them evenly is what makes the
       * committed mark match the one that was on screen a frame earlier.
       */
      const points = resample(drawing.points, COMMIT_SAMPLE)
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
          role="application"
          aria-label={
            ui.mode === 'paint'
              ? 'Painting surface, 1000 by 700 units. Press and drag across it to lay a mark ' +
                'with the loaded brush. Clicking without dragging does nothing.'
              : 'Painting surface, 1000 by 700 units. Click a mark to select it, drag to move it.'
          }
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
