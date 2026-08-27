'use client'

import { useEffect, useState } from 'react'

const KEY = 'sable.welcomed'

/**
 * What this is, before you touch it.
 *
 * Someone arriving at the link has no reason to guess that the picture in front
 * of them is made of objects rather than pixels, or that the toolbox on the
 * right belongs to something that is not in the room. Three short points, then
 * out of the way.
 */
export function Welcome() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true)
    } catch {
      setOpen(true)
    }
  }, [])

  const dismiss = () => {
    setOpen(false)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // Nothing important is lost if this cannot be remembered.
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div className="veil" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome">
        <span className="welcome-eyebrow">Built for the WebMCP Challenge</span>
        <h1 className="welcome-title" id="welcome-title">
          Sable
        </h1>
        <p className="welcome-lede">
          A watercolour studio that you and an AI agent share. Both of you hold a brush,
          and both of you can revise what the other painted.
        </p>

        <div className="welcome-body">
          <div className="welcome-point">
            <span className="welcome-num">1</span>
            <p>
              <strong>The painting is not a picture, it is a document.</strong> When you
              make an image with a model, the only way to take part is the prompt. If one
              petal is wrong you go back and roll the dice on all of it. Here every mark
              stays an object with a pigment, a water level, a brush and a path. Click
              anything the agent painted and take it apart.
            </p>
          </div>

          <div className="welcome-point">
            <span className="welcome-num">2</span>
            <p>
              <strong>The page hands the agent real tools.</strong> Through WebMCP this
              canvas publishes what can be done to it, and the toolbox changes as you
              work. Select a mark and the agent gains a tool for revising that exact
              mark, so when you say &ldquo;make this one wetter&rdquo; it already knows
              what you mean.
            </p>
          </div>

          <div className="welcome-point">
            <span className="welcome-num">3</span>
            <p>
              <strong>The paint is simulated, not generated.</strong> No image model is
              involved. Edges darken as a wash dries, heavy pigments settle into the
              tooth of the paper, and too much water blooms.
            </p>
          </div>
        </div>

        <div className="welcome-foot">
          <button type="button" className="btn btn--solid btn--start" onClick={dismiss}>
            Start painting
          </button>
          <span className="note">
            Press V and click any mark to see what it is made of.
          </span>
        </div>
      </div>
    </div>
  )
}
