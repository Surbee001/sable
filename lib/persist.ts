import { studio } from './store'
import { BRUSHES, type Scene, type Stroke } from './types'

/**
 * Keeping the painting, and handing it to somebody else.
 *
 * The argument the whole studio makes is that a painting is a list of decisions
 * rather than a bitmap. It was an odd argument to make while reloading the tab
 * destroyed every one of them, and while the only thing you could take away
 * was a PNG, which is precisely the flattened, unrevisable object the project
 * exists to complain about.
 *
 * So two things live here. The sheet writes itself to local storage as you
 * work, and the whole document packs into a link. What travels is the strokes,
 * not an image of them: open somebody's link and every mark is still a mark,
 * with its pigment and its water and its path, and you can pick any of them up
 * and change it. That is the difference between sending a painting and sending
 * a photograph of one, and it is worth a URL to be able to show it.
 */

const KEY = 'sable.sheet.v2'
const SAVE_DEBOUNCE_MS = 700
/** Past this, a link stops being something you can paste into a message. */
export const SHARE_LIMIT = 60000

interface Saved {
  v: 2
  scene: Scene
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * A document arriving from a link or from storage is not trusted.
 *
 * It is JSON somebody else can write, and it goes straight into the renderer,
 * so every field is checked and anything unrecognised is dropped rather than
 * carried. The failure mode being guarded against is not malice so much as an
 * old link meeting a newer studio.
 */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clean(raw: unknown): Scene | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Record<string, unknown>
  const scene = (doc.v === 2 ? doc.scene : doc) as Record<string, unknown> | undefined
  if (!scene || typeof scene !== 'object') return null
  if (!Array.isArray(scene.strokes) || !Array.isArray(scene.layers)) return null

  const layers = (scene.layers as unknown[])
    .map((l) => {
      const layer = l as Record<string, unknown>
      if (typeof layer.id !== 'string') return null
      return {
        id: layer.id,
        name: typeof layer.name === 'string' ? layer.name : layer.id,
        visible: layer.visible !== false,
        wetness: num(layer.wetness, 0),
        opacity: num(layer.opacity, 1),
      }
    })
    .filter((l): l is Scene['layers'][number] => l !== null)
  if (layers.length === 0) return null

  const known = new Set(layers.map((l) => l.id))
  const strokes = (scene.strokes as unknown[])
    .map((s, i) => {
      const st = s as Record<string, unknown>
      if (typeof st.path !== 'string' || typeof st.pigment !== 'string') return null
      const stroke: Stroke = {
        id: typeof st.id === 'string' ? st.id : `stroke_in${i}`,
        layerId: known.has(st.layerId as string) ? (st.layerId as string) : layers[0].id,
        // A brush this studio no longer has falls back rather than reaching the
        // renderer as undefined. Sable dropped the dry brush, and a link written
        // before that is still a painting.
        kind:
          typeof st.kind === 'string' && st.kind in BRUSHES
            ? (st.kind as Stroke['kind'])
            : 'round',
        path: st.path,
        pigment: st.pigment,
        water: num(st.water, 0.5),
        pressure: num(st.pressure, 0.6),
        opacity: num(st.opacity, 0.6),
        fill: st.fill === true,
        seed: num(st.seed, 1),
        author: st.author === 'agent' ? 'agent' : 'human',
        createdAt: num(st.createdAt, i),
      }
      if (typeof st.width === 'number') stroke.width = st.width
      if (st.lift === true) stroke.lift = true
      if (typeof st.softToward === 'number') stroke.softToward = st.softToward
      if (typeof st.ground === 'number') stroke.ground = st.ground
      if (typeof st.note === 'string') stroke.note = st.note
      if (st.grade && typeof st.grade === 'object') stroke.grade = st.grade as Stroke['grade']
      if (st.spatter && typeof st.spatter === 'object') {
        stroke.spatter = st.spatter as Stroke['spatter']
      }
      if (Array.isArray(st.charge)) stroke.charge = st.charge as Stroke['charge']
      return stroke
    })
    .filter((s): s is Stroke => s !== null)

  return {
    title: typeof scene.title === 'string' ? scene.title : 'Untitled study',
    paper: (typeof scene.paper === 'string' ? scene.paper : 'cold-press') as Scene['paper'],
    layers,
    strokes,
  }
}

/* ------------------------------------------------------------------ *
 * Local storage
 * ------------------------------------------------------------------ */

export function restoreLocal(): Scene | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const scene = clean(JSON.parse(raw))
    return scene && scene.strokes.length > 0 ? scene : null
  } catch {
    return null
  }
}

export function forgetLocal(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing important is lost if this cannot be forgotten.
  }
}

/**
 * Write the sheet as it changes, on a timer rather than on every mark.
 *
 * A stroke fires the store several times as it settles, and serialising the
 * whole document on each of those would put a stringify in the middle of the
 * one interaction that has to stay smooth.
 */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const write = () => {
    timer = null
    try {
      const scene = studio.getScene()
      const doc: Saved = { v: 2, scene }
      localStorage.setItem(KEY, JSON.stringify(doc))
    } catch {
      // Storage full, or blocked. The painting is still on the screen.
    }
  }
  const unsubscribe = studio.subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(write, SAVE_DEBOUNCE_MS)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}

/* ------------------------------------------------------------------ *
 * Links
 * ------------------------------------------------------------------ */

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function through(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * The document as one token.
 *
 * Gzipped where the browser has the streams for it, which is most of the
 * difference: paths and pigment names repeat so heavily across a painting that
 * a study of a hundred marks compresses to well under a tenth of its JSON. The
 * uncompressed form is kept as a fallback and marked, so an old link still
 * opens in a browser that has neither.
 */
export async function encodeShare(scene: Scene): Promise<string> {
  const json = JSON.stringify({ v: 2, scene } satisfies Saved)
  const bytes = new TextEncoder().encode(json)
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
      return `g${toBase64Url(await through(stream as ReadableStream<Uint8Array>))}`
    } catch {
      // Fall through to the plain form.
    }
  }
  return `r${toBase64Url(bytes)}`
}

export async function decodeShare(token: string): Promise<Scene | null> {
  try {
    const body = token.slice(1)
    let bytes = fromBase64Url(body)
    if (token[0] === 'g') {
      if (typeof DecompressionStream !== 'function') return null
      const stream = new Blob([bytes as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'))
      bytes = await through(stream as ReadableStream<Uint8Array>)
    } else if (token[0] !== 'r') {
      return null
    }
    return clean(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

export async function shareLink(scene: Scene): Promise<{ url: string; over: boolean }> {
  const token = await encodeShare(scene)
  const base = `${location.origin}${location.pathname}`
  return { url: `${base}#p=${token}`, over: token.length > SHARE_LIMIT }
}

/** A painting handed to this tab in its own address bar. */
export function tokenInUrl(): string | null {
  if (typeof location === 'undefined') return null
  const match = /[#&]p=([A-Za-z0-9\-_]+)/.exec(location.hash)
  return match ? match[1] : null
}

/**
 * Take the token back out of the address bar once it has been opened.
 *
 * Otherwise every subsequent reload throws away whatever the visitor painted on
 * top of it and hands them the original again, which is the opposite of what a
 * shared document is for.
 */
export function clearTokenInUrl(): void {
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}`)
  } catch {
    // A browser that will not rewrite the bar still opened the painting.
  }
}
