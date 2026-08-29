/**
 * Sable's document model.
 *
 * The whole premise of this project: a painting is not a bitmap, it is a list of
 * structured strokes that either a human or an agent can address, inspect and
 * revise. Everything below is JSON-serialisable so that a WebMCP tool call and a
 * mouse drag produce exactly the same kind of object.
 */

/** Logical painting space. All stroke coordinates live here, uniform units. */
export const CANVAS_W = 1000
export const CANVAS_H = 700

/**
 * How developed a mark looks the instant it is laid down, 0 to 1.
 *
 * The brush is on the paper and the paint is visibly there, so this is not
 * zero. Starting the drying animation from zero meant a stroke you had just
 * watched yourself draw dropped almost out of sight the moment you lifted the
 * brush, then built back up, which reads as the mark appearing after the fact
 * rather than under your hand. The preview and the first frame of drying have
 * to be the same picture.
 *
 * It lives here rather than with the settle clock because the renderer needs it
 * too: this is the point at which the preview hands the mark over, so anything
 * the preview does not draw has to start from nothing here rather than from
 * whatever fraction the settle happens to be at.
 */
export const WET = 0.55

export type Author = 'human' | 'agent'

/** Brush geometry. Each kind has a different width profile along the stroke. */
export type BrushKind = 'round' | 'flat' | 'liner' | 'mop' | 'dry'

export interface BrushSpec {
  kind: BrushKind
  label: string
  /** Base width in logical units at pressure 1. */
  baseWidth: number
  /** How much the stroke tapers at its ends: 0 = blunt, 1 = fine point. */
  taper: number
  /** Extra edge irregularity. A dry brush skips, a mop pools smoothly. */
  chatter: number
  hint: string
}

export const BRUSHES: Record<BrushKind, BrushSpec> = {
  round: {
    kind: 'round',
    label: 'Round',
    baseWidth: 26,
    taper: 0.85,
    chatter: 0.18,
    hint: 'All-purpose sable round. Tapers to a point, for petals, leaves and general shapes.',
  },
  flat: {
    kind: 'flat',
    label: 'Flat',
    baseWidth: 46,
    taper: 0.12,
    chatter: 0.22,
    hint: 'Square-edged wash brush. Blunt ends, for skies, architecture and broad flat planes.',
  },
  liner: {
    kind: 'liner',
    label: 'Liner',
    baseWidth: 7,
    taper: 0.95,
    chatter: 0.3,
    hint: 'Fine rigger. Stems, veins, whiskers, calligraphic detail.',
  },
  mop: {
    kind: 'mop',
    label: 'Mop',
    baseWidth: 92,
    taper: 0.3,
    chatter: 0.1,
    hint: 'Big soft squirrel mop. Loose atmospheric washes and skies.',
  },
  dry: {
    kind: 'dry',
    label: 'Dry brush',
    baseWidth: 34,
    taper: 0.5,
    chatter: 0.85,
    hint: 'Barely-loaded brush. Broken, scratchy texture, for bark, rock and sparkle on water.',
  },
}

export interface Stroke {
  id: string
  layerId: string
  kind: BrushKind
  /**
   * SVG path data in logical space (0..1000 x, 0..700 y).
   * Full SVG grammar: M, L, C, Q, S, T, A, Z. Sampled natively by the browser.
   */
  path: string
  /** Pigment id, see palette.ts */
  pigment: string
  /** 0..1. How wet the brush was. Drives bleed, spread and soft edges. */
  water: number
  /** 0..1. Brush pressure, which scales the width of the mark. */
  pressure: number
  /** 0..1. Pigment load. Low is a pale tint, high is saturated. */
  opacity: number
  /**
   * How the path is interpreted.
   *   false: a centreline the brush travels along (a stem, a contour, a line)
   *   true:  a closed region flooded with a wash (a petal, a leaf, a sky)
   * This distinction matters more than it looks: it is the difference between
   * an agent drawing the outline of a flower and an agent painting one.
   */
  fill?: boolean
  /** Deterministic randomness so a re-render is always identical. */
  seed: number
  author: Author
  createdAt: number
  /** Optional intent note. The agent explains itself; it shows in the log. */
  note?: string
}

export interface Layer {
  id: string
  name: string
  visible: boolean
  /** 0..1. How wet the paper was when this layer was painted. Wet paper bleeds. */
  wetness: number
  opacity: number
}

export interface Scene {
  title: string
  layers: Layer[]
  strokes: Stroke[]
  /** Paper tone, drives the base wash of the sheet. */
  paper: PaperKind
}

export type PaperKind = 'cold-press' | 'hot-press' | 'rough' | 'toned'

export interface PaperSpec {
  kind: PaperKind
  label: string
  /** Base sheet colour. */
  base: string
  /** Tooth depth, meaning how strongly the grain bites pigment. */
  tooth: number
  grain: number
  hint: string
}

export const PAPERS: Record<PaperKind, PaperSpec> = {
  'cold-press': {
    kind: 'cold-press',
    label: 'Cold press',
    base: '#faf6ee',
    tooth: 0.5,
    grain: 0.55,
    hint: 'The default. Moderate tooth, holds granulation without fighting detail.',
  },
  'hot-press': {
    kind: 'hot-press',
    label: 'Hot press',
    base: '#fbf9f4',
    tooth: 0.16,
    grain: 0.2,
    hint: 'Smooth plate surface. Crisp edges, minimal granulation, botanical detail.',
  },
  rough: {
    kind: 'rough',
    label: 'Rough',
    base: '#f7f2e6',
    tooth: 1.0,
    grain: 1.0,
    hint: 'Heavy tooth. Pigment pools in the valleys, so it is dramatic and sparkly.',
  },
  toned: {
    kind: 'toned',
    label: 'Toned',
    base: '#efe6d4',
    tooth: 0.62,
    grain: 0.6,
    hint: 'Warm buff sheet. A mid-tone ground, so you can work light against dark.',
  },
}
