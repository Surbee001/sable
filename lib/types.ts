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
export type BrushKind = 'round' | 'flat' | 'liner' | 'mop'

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
  /**
   * Width of the mark in sheet units, overriding the brush's own.
   *
   * The brushes are five fixed sizes, and pressure only slides a mark between
   * roughly a third and a full one of them. That is a rack of brushes, not a
   * brush: everything between a 7-unit liner and a 92-unit mop had to be
   * approximated by whichever of the five was least wrong. Naming the width
   * outright is what lets one line taper from a trunk to a twig, and it costs
   * the brush nothing else, because the taper, the chatter and the profile are still
   * the kind's own. Ignored on a fill, where the path is the shape.
   */
  width?: number
  /**
   * Take pigment off instead of putting it on.
   *
   * The medium was purely additive: every mark could only ever darken what was
   * under it. Real watercolour has the other direction too: a thirsty brush or
   * a damp sponge pulls colour back out of a passage, and it is how mist is
   * made, how a cloud gets its light side, and how a highlight is recovered
   * from a wash that has already closed over it.
   */
  lift?: boolean
  /**
   * A wash that changes across itself.
   *
   * One flat colour over a large area is the clearest tell that a wash was
   * computed. Real ones are graded, stronger at the top of a sky than at the
   * horizon, or variegated, with a second pigment dropped in at one end and
   * allowed to mingle. Both are the same thing said twice: the wash is
   * different at one end from the other.
   */
  grade?: {
    /** Direction the change runs, in degrees. 0 points right, 90 points down. */
    angle?: number
    /** A second pigment to run toward. Omit to fade the first one instead. */
    pigment?: string
    /** How much weaker the far end is, 0 none, 1 to nothing. */
    fade?: number
  }
  /**
   * Flick pigment off the brush instead of drawing with it.
   *
   * Nothing else in the studio makes anything granular. Every mark is a
   * continuous shape with a continuous edge, and a picture built only out of
   * those has a smoothness to it that no real watercolour has: shingle, gravel,
   * the outer leaves of a tree, the sparkle on broken water and the grit at the
   * front of a landscape are all made by loading a brush and knocking it, not
   * by painting each speck.
   */
  spatter?: {
    /** Roughly how many specks per ten thousand square units. Default 40. */
    density?: number
    /** Average speck radius in sheet units. Default 3. */
    size?: number
  }
  /**
   * A second colour dropped into this wash while it was still flowing.
   *
   * Not the same as painting a second mark on top. A charged wash is one wash:
   * the colours meet in the water and settle into each other with no boundary
   * anywhere, which is how a sky goes warm in one corner without anything in it
   * looking like a shape. Painting it as a separate mark gives you two washes
   * and an edge between them, however soft you make it.
   */
  charge?: Array<{
    pigment: string
    x: number
    y: number
    /** How far it travels, as a fraction of the mark. Default 0.34. */
    spread?: number
    strength?: number
  }>
  /**
   * Which way the mark's soft side faces, in degrees.
   *
   * A wash does not meet the paper the same way all the way round, and until
   * now which side dissolved was decided by the seed. That is the wrong owner
   * for it: lost and found edges are how a painter says where the light is and
   * which way a form turns, and they only work when the soft sides of
   * neighbouring shapes agree. Omit to keep the seed's choice.
   */
  softToward?: number
  /**
   * How wet the paper was where this mark landed, 0..1.
   *
   * Frozen at the moment the brush touched, not looked up when drawing. The
   * renderer has to stay deterministic (same seed, same painting, whenever it
   * is re-rendered) so it can never ask the wet field what the sheet is doing
   * now. What the sheet was doing then is a permanent fact about this mark.
   */
  ground?: number
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

/**
 * Something the paint did that nobody asked for.
 *
 * Everything in this list is already simulated. A wash already creeps past the
 * shape it was given, already pulls a dark rim as it dries, already drops its
 * heavy particles into the tooth, already backruns if it was wet enough and the
 * dice fall that way. None of it was ever reported, so an agent painting here
 * had no way to know any of it had happened, and no way to answer it. It got a
 * picture back and had to re-derive the medium from a JPEG every time.
 *
 * Emitted by the renderer as it draws, rather than recomputed afterwards from
 * the same formulas, because a second copy of those formulas would be wrong
 * within a week and this has to be exactly what happened.
 */
export interface MediumEvent {
  kind: 'spread' | 'bloom' | 'rim' | 'granulation' | 'lost-edge' | 'separation'
  /** Sheet coordinates, where the event has a place.  */
  x?: number
  y?: number
  /** Sheet units, where the event has a size. */
  amount?: number
  /** Anything else worth carrying, per kind. */
  detail?: string
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
