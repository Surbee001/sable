/**
 * A real watercolourist's palette. The properties are not decorative. Each one
 * feeds the renderer. Granulating pigments settle into the paper tooth, staining
 * pigments hold a hard edge, and low-density pigments stay translucent no matter
 * how many layers you put down.
 */

export interface Pigment {
  id: string
  name: string
  /** Masstone, used as the multiply colour. */
  hex: string
  /** 0..1. How much the pigment separates into the paper's tooth. */
  granulation: number
  /** 0..1. Staining pigments keep crisp edges; non-staining ones bloom. */
  staining: number
  /** 0..1. Density. Low means it stays a tint even when loaded. */
  density: number
  family: 'red' | 'yellow' | 'blue' | 'green' | 'earth' | 'neutral'
}

/**
 * Every pigment needs a matching `.pig-<id>` class in app/globals.css, which is
 * where its colour is actually painted. Keeping colour out of the markup is why
 * the hex lives in both places.
 */
export const PIGMENTS: Pigment[] = [
  // Reds
  { id: 'quinacridone-rose', name: 'Quinacridone Rose', hex: '#c9256b', granulation: 0.05, staining: 0.85, density: 0.72, family: 'red' },
  { id: 'permanent-rose',    name: 'Permanent Rose',    hex: '#d4457e', granulation: 0.05, staining: 0.7,  density: 0.62, family: 'red' },
  { id: 'alizarin-crimson',  name: 'Alizarin Crimson',  hex: '#9e1b32', granulation: 0.1,  staining: 0.8,  density: 0.78, family: 'red' },
  { id: 'cadmium-red',       name: 'Cadmium Red',       hex: '#d93a1f', granulation: 0.25, staining: 0.3,  density: 0.88, family: 'red' },
  { id: 'peach',             name: 'Peach Blossom',     hex: '#f0937a', granulation: 0.08, staining: 0.35, density: 0.4,  family: 'red' },

  // Yellows
  { id: 'cadmium-yellow',    name: 'Cadmium Yellow',    hex: '#f6b800', granulation: 0.2,  staining: 0.25, density: 0.82, family: 'yellow' },
  { id: 'aureolin',          name: 'Aureolin',          hex: '#f5cf3d', granulation: 0.05, staining: 0.4,  density: 0.5,  family: 'yellow' },
  { id: 'naples-yellow',     name: 'Naples Yellow',     hex: '#efd9a3', granulation: 0.3,  staining: 0.15, density: 0.45, family: 'yellow' },
  { id: 'yellow-ochre',      name: 'Yellow Ochre',      hex: '#c68f36', granulation: 0.55, staining: 0.25, density: 0.7,  family: 'earth' },

  // Blues
  { id: 'ultramarine',       name: 'French Ultramarine',hex: '#2a4a9c', granulation: 0.9,  staining: 0.3,  density: 0.8,  family: 'blue' },
  { id: 'cerulean',          name: 'Cerulean Blue',     hex: '#3f8fc4', granulation: 0.85, staining: 0.2,  density: 0.66, family: 'blue' },
  { id: 'phthalo-blue',      name: 'Phthalo Blue',      hex: '#0d5c8c', granulation: 0.03, staining: 0.95, density: 0.9,  family: 'blue' },
  { id: 'cobalt',            name: 'Cobalt Blue',       hex: '#2f63b5', granulation: 0.6,  staining: 0.25, density: 0.68, family: 'blue' },
  { id: 'indigo',            name: 'Indigo',            hex: '#22364f', granulation: 0.5,  staining: 0.6,  density: 0.85, family: 'blue' },

  // Greens
  { id: 'sap-green',         name: 'Sap Green',         hex: '#5a7a2b', granulation: 0.15, staining: 0.55, density: 0.7,  family: 'green' },
  { id: 'viridian',          name: 'Viridian',          hex: '#1f7a63', granulation: 0.7,  staining: 0.3,  density: 0.62, family: 'green' },
  { id: 'olive-green',       name: 'Olive Green',       hex: '#6e7331', granulation: 0.3,  staining: 0.45, density: 0.66, family: 'green' },

  // Earths
  { id: 'burnt-sienna',      name: 'Burnt Sienna',      hex: '#a4502a', granulation: 0.75, staining: 0.35, density: 0.75, family: 'earth' },
  { id: 'raw-umber',         name: 'Raw Umber',         hex: '#7a5c33', granulation: 0.65, staining: 0.3,  density: 0.72, family: 'earth' },
  { id: 'sepia',             name: 'Sepia',             hex: '#5b4028', granulation: 0.45, staining: 0.5,  density: 0.8,  family: 'earth' },

  // Neutrals
  { id: 'paynes-grey',       name: "Payne's Grey",      hex: '#3d4d5c', granulation: 0.55, staining: 0.45, density: 0.75, family: 'neutral' },
  { id: 'neutral-tint',      name: 'Neutral Tint',      hex: '#4a4a52', granulation: 0.35, staining: 0.55, density: 0.78, family: 'neutral' },
  { id: 'lamp-black',        name: 'Lamp Black',        hex: '#26262b', granulation: 0.3,  staining: 0.6,  density: 0.9,  family: 'neutral' },
]

const BY_ID = new Map(PIGMENTS.map((p) => [p.id, p]))

export function getPigment(id: string): Pigment {
  return BY_ID.get(id) ?? PIGMENTS[0]
}

/**
 * Tolerant lookup so an agent can say "ultramarine" or "French Ultramarine"
 * or even "blue" and land somewhere sensible instead of erroring out.
 */
export function resolvePigment(query: string): Pigment | null {
  if (!query) return null
  const q = query.trim().toLowerCase()
  const direct = BY_ID.get(q)
  if (direct) return direct

  const slug = q.replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')
  const bySlug = BY_ID.get(slug)
  if (bySlug) return bySlug

  const byName = PIGMENTS.find((p) => p.name.toLowerCase() === q)
  if (byName) return byName

  const partial = PIGMENTS.find(
    (p) => p.name.toLowerCase().includes(q) || p.id.includes(slug),
  )
  if (partial) return partial

  const byFamily = PIGMENTS.find((p) => p.family === q)
  if (byFamily) return byFamily

  return null
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/* ------------------------------------------------------------------ *
 * Limited palettes
 *
 * The single biggest difference between a painting that reads as considered
 * and one that reads as generated is how many pigments are in it. A painter
 * reaches for three or four and mixes everything from them, so the picture
 * holds together whether or not any one passage is well judged. An agent given
 * twenty-three pigments and no guidance will use twelve.
 * ------------------------------------------------------------------ */

export type PigmentRole = 'dominant' | 'secondary' | 'accent' | 'dark'

export interface PaletteScheme {
  id: string
  name: string
  mood: string
  roles: Array<{ role: PigmentRole; pigment: string }>
  note: string
}

export const SCHEMES: PaletteScheme[] = [
  {
    id: 'transparent-triad',
    name: 'Transparent triad',
    mood: 'sunlit, clean, luminous',
    roles: [
      { role: 'dominant', pigment: 'aureolin' },
      { role: 'secondary', pigment: 'permanent-rose' },
      { role: 'accent', pigment: 'cobalt' },
      { role: 'dark', pigment: 'indigo' },
    ],
    note: 'The classic three transparent primaries. Everything can be mixed from them by overlaying, and nothing ever goes muddy. Best for light-filled subjects.',
  },
  {
    id: 'earth-triad',
    name: 'Earth triad',
    mood: 'warm, grounded, timeless',
    roles: [
      { role: 'dominant', pigment: 'yellow-ochre' },
      { role: 'secondary', pigment: 'burnt-sienna' },
      { role: 'accent', pigment: 'ultramarine' },
      { role: 'dark', pigment: 'sepia' },
    ],
    note: 'Ultramarine and burnt sienna make every grey you will ever need, and both granulate, so washes have texture without any extra work.',
  },
  {
    id: 'botanical',
    name: 'Botanical',
    mood: 'fresh, precise, a specimen on white',
    roles: [
      { role: 'dominant', pigment: 'sap-green' },
      { role: 'secondary', pigment: 'quinacridone-rose' },
      { role: 'accent', pigment: 'aureolin' },
      { role: 'dark', pigment: 'sepia' },
    ],
    note: 'Staining pigments that hold a crisp edge. Leave plenty of white paper: a botanical study is mostly untouched sheet.',
  },
  {
    id: 'grey-day',
    name: 'Grey day',
    mood: 'soft, atmospheric, low contrast',
    roles: [
      { role: 'dominant', pigment: 'cerulean' },
      { role: 'secondary', pigment: 'raw-umber' },
      { role: 'accent', pigment: 'naples-yellow' },
      { role: 'dark', pigment: 'paynes-grey' },
    ],
    note: 'Everything granulates. Keep the water high and let shapes bleed into one another; hard edges will look wrong here.',
  },
  {
    id: 'autumn',
    name: 'Autumn',
    mood: 'rich, warm, turning',
    roles: [
      { role: 'dominant', pigment: 'burnt-sienna' },
      { role: 'secondary', pigment: 'olive-green' },
      { role: 'accent', pigment: 'cadmium-yellow' },
      { role: 'dark', pigment: 'indigo' },
    ],
    note: 'Warm dominant against one cool dark. Put the indigo only where you want the eye to stop.',
  },
  {
    id: 'nocturne',
    name: 'Nocturne',
    mood: 'deep, quiet, after dark',
    roles: [
      { role: 'dominant', pigment: 'indigo' },
      { role: 'secondary', pigment: 'phthalo-blue' },
      { role: 'accent', pigment: 'burnt-sienna' },
      { role: 'dark', pigment: 'lamp-black' },
    ],
    note: 'Works on toned paper. The few warm notes carry the whole picture, so use very few of them.',
  },
  {
    id: 'blossom',
    name: 'Blossom',
    mood: 'delicate, high key, spring',
    roles: [
      { role: 'dominant', pigment: 'peach' },
      { role: 'secondary', pigment: 'quinacridone-rose' },
      { role: 'accent', pigment: 'sap-green' },
      { role: 'dark', pigment: 'alizarin-crimson' },
    ],
    note: 'Keep the pigment load low, mostly under 0.5, and let the paper do the lightening rather than reaching for a paler colour.',
  },
]

export function findScheme(query: string): PaletteScheme | null {
  if (!query) return null
  const q = query.trim().toLowerCase()
  return (
    SCHEMES.find((s) => s.id === q) ??
    SCHEMES.find((s) => s.name.toLowerCase() === q) ??
    SCHEMES.find((s) => s.name.toLowerCase().includes(q) || s.mood.includes(q)) ??
    null
  )
}
