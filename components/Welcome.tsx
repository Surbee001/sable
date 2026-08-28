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
          A watercolour studio you and an AI agent share. Every mark stays an object either of
          you can pick up and change, the paint is simulated rather than generated, and the
          page hands the agent real tools instead of making it guess.
        </p>
        <button type="button" className="btn btn--solid btn--start" onClick={dismiss}>
          Start painting
        </button>
      </div>
    </div>
  )
}
