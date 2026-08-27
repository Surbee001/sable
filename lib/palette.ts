/**
 * A real watercolourist's palette. The properties are not decorative — each one
 * feeds the renderer. Granulating pigments settle into the paper tooth, staining
 * pigments hold a hard edge, and low-density pigments stay translucent no matter
 * how many layers you put down.
 */

export interface Pigment {
  id: string
  name: string
  /** Masstone, used as the multiply colour. */
  hex: string
  /** 0..1 — how much the pigment separates into the paper's tooth. */
  granulation: number
  /** 0..1 — staining pigments keep crisp edges; non-staining ones bloom. */
  staining: number
  /** 0..1 — density. Low means it stays a tint even when loaded. */
  density: number
  family: 'red' | 'yellow' | 'blue' | 'green' | 'earth' | 'neutral'
}

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
