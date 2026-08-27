'use client'

export type Theme = 'light' | 'dark'

const KEY = 'sable.theme'

/** What the document is showing right now, following the system when unset. */
export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  const set = document.documentElement.getAttribute('data-theme')
  if (set === 'light' || set === 'dark') return set
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private browsing. The choice simply will not persist.
  }
}
