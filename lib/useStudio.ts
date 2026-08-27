'use client'

import { useSyncExternalStore } from 'react'
import { studio, type StudioSnapshot } from './store'

/**
 * The whole studio, live.
 *
 * `useSyncExternalStore` rather than React state because the WebMCP tool
 * handlers mutate the document from outside React entirely, because the browser calls
 * them directly. This is the seam where an agent's edit becomes a re-render.
 */
export function useStudio(): StudioSnapshot {
  return useSyncExternalStore(studio.subscribe, studio.getSnapshot, studio.getSnapshot)
}
