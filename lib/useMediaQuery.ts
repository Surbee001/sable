'use client'

import { useEffect, useState } from 'react'

/**
 * The narrow layout is a different arrangement, not the same one squeezed, so
 * it is chosen in JavaScript rather than by hiding a duplicate tree in CSS.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
