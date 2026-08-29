import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Figtree } from 'next/font/google'
import './globals.css'

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Sable, a watercolour studio you and your agent share',
  description:
    'A watercolour canvas where the human and the AI agent both hold the brush. Every stroke stays a structured, editable object instead of a flattened bitmap.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e9e7e3' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1917' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

/**
 * Resolve the theme before first paint.
 *
 * Small enough to inline, and it has to run ahead of rendering: reading the
 * stored preference in an effect would show the wrong theme for a frame and
 * flash the whole studio.
 */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('sable.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={figtree.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
