import { boundsOf, sampleSubpaths, type Bounds } from './geometry'
import { getPigment } from './palette'
import { CANVAS_H, CANVAS_W, type MediumEvent, type Scene, type Stroke } from './types'
import { renderScene } from './watercolor'
import { wetField, type WetPatch } from './wetfield'

/**
 * What the paint did, as opposed to what it was told.
 *
 * This is the argument the whole app is built on, finally said out loud. From
 * the README: watercolour is not controlled by specifying an outcome, it is
 * controlled by choosing how much water is on the brush and living with where
 * it goes. That is true of the simulation too: a wash here really does creep
 * past its path, really does pull a rim, really does backrun if it was wet
 * enough and the seed falls that way, and until now not one word of it ever
 * reached the agent painting.
 *
 * Which meant the agent was not painting in watercolour. It was specifying
 * shapes and receiving a JPEG, and the medium was something that happened to
 * its instructions in between. It could not answer a bloom because it did not
 * know one had opened. It could not use a soft edge because it did not know
 * which side had gone soft. Every pass started over from a photograph.
 *
 * A painter does not work that way. You put a wash down, you watch what the
 * water does with it, and the next mark is a reply to that. The picture is
 * built out of those replies. So: after every pass, the paint says what it did,
 * and the agent gets to answer.
 *
 * Nothing here recomputes the simulation. The renderer emits these as it draws,
 * so the report is the same arithmetic that made the pixels rather than a
 * second implementation of it that would drift.
 */

export interface MediumReport {
  /** One line per thing the paint did, in the order it matters. */
  lines: string[]
  /** Where the sheet is still workable, and for how long. */
  open: WetPatch[]
  /** Machine-readable, for an agent that would rather branch than read. */
  events: Array<{ strokeId: string; kind: string; x?: number; y?: number; amount?: number }>
}

const PLACES = [
  ['the top left', 'the top', 'the top right'],
  ['the left', 'the middle', 'the right'],
  ['the bottom left', 'the bottom', 'the bottom right'],
]

function placeOf(x: number, y: number): string {
  const col = Math.max(0, Math.min(2, Math.floor((x / CANVAS_W) * 3)))
  const row = Math.max(0, Math.min(2, Math.floor((y / CANVAS_H) * 3)))
  return PLACES[row][col]
}

/** Which way one point lies from a shape's middle, in words. */
function sideOf(b: Bounds, x: number, y: number): string {
  const dx = x - (b.x + b.w / 2)
  const dy = y - (b.y + b.h / 2)
  const vertical = Math.abs(dy) > b.h * 0.18 ? (dy < 0 ? 'top' : 'bottom') : ''
  const horizontal = Math.abs(dx) > b.w * 0.18 ? (dx < 0 ? 'left' : 'right') : ''
  if (vertical && horizontal) return `${vertical} ${horizontal}`
  return vertical || horizontal || 'middle'
}

/** How to refer to a mark in a sentence. Its own note if it has one. */
function nameOf(stroke: Stroke): string {
  if (stroke.note) {
    const trimmed = stroke.note.trim().replace(/\.$/, '').toLowerCase()
    if (trimmed.length > 0 && trimmed.length <= 44) {
      // Notes are written by whoever painted the mark and are not always bare
      // nouns. "the sky" already has its article, and "under the muzzle" is a
      // phrase that takes none at all; prefixing either produces "the the sky"
      // and "the under the muzzle".
      const owned = /^(the|a|an|its|his|her|their|my|one|some|two|three) /
      const phrase = /^(under|over|above|below|behind|beside|along|across|through|where|between|into|onto|off|down|up|near|around) /
      if (owned.test(trimmed) || phrase.test(trimmed)) return trimmed
      return `the ${trimmed}`
    }
  }
  const pigment = getPigment(stroke.pigment).name
  return stroke.fill ? `the ${pigment} wash` : `the ${pigment} mark`
}

function boundsFor(stroke: Stroke): Bounds {
  return boundsOf(sampleSubpaths(stroke.path, 8).flat())
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

/**
 * Render the scene once with the observer attached and collect what it says.
 *
 * Offscreen and small: this is being read, not looked at, and the effects being
 * reported are all decided in sheet units before anything is rasterised.
 */
function collect(scene: Scene): Map<string, MediumEvent[]> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = Math.round((400 * CANVAS_H) / CANVAS_W)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable in this browser')

  const byStroke = new Map<string, MediumEvent[]>()
  renderScene(ctx, scene, canvas.width, canvas.height, (id, event) => {
    const list = byStroke.get(id)
    if (list) list.push(event)
    else byStroke.set(id, [event])
  })
  return byStroke
}

/**
 * What the medium did to a particular set of marks.
 *
 * Scoped to the marks just painted rather than to the whole sheet, because a
 * report that re-describes every wash in the picture on every pass is one an
 * agent will stop reading by the fourth call.
 */
export function reportOn(scene: Scene, ids: string[]): MediumReport {
  const wanted = new Set(ids)
  const byStroke = collect(scene)
  const strokes = new Map(scene.strokes.map((s) => [s.id, s]))

  const lines: string[] = []
  const events: MediumReport['events'] = []

  for (const id of ids) {
    const stroke = strokes.get(id)
    if (!stroke) continue
    const list = byStroke.get(id) ?? []
    const bounds = boundsFor(stroke)
    const name = nameOf(stroke)

    for (const event of list) {
      events.push({ strokeId: id, kind: event.kind, x: event.x, y: event.y, amount: event.amount })
    }

    const spread = list.find((e) => e.kind === 'spread')
    const lost = list.find((e) => e.kind === 'lost-edge')
    const blooms = list.filter((e) => e.kind === 'bloom')
    const gran = list.find((e) => e.kind === 'granulation')
    const rim = list.find((e) => e.kind === 'rim')

    // Creep and the lost edge belong in one sentence: they are the same event
    // seen twice, the water going somewhere and taking the edge with it.
    if (spread?.amount) {
      const where = lost?.x !== undefined && lost?.y !== undefined
        ? `, and went softest on its ${sideOf(bounds, lost.x, lost.y)}`
        : ''
      lines.push(
        `${capitalise(name)} finished about ${spread.amount} units outside the path you gave it${where}.`,
      )
    } else if (lost?.x !== undefined && lost?.y !== undefined) {
      lines.push(`${capitalise(name)} held its shape but went soft on its ${sideOf(bounds, lost.x, lost.y)}.`)
    }

    for (const bloom of blooms) {
      lines.push(
        `A cauliflower opened in ${name} at (${bloom.x}, ${bloom.y}), about ${bloom.amount} across. ` +
          'The water backran before the wash had set. It cannot be painted out, only worked with.',
      )
    }

    if (gran) {
      lines.push(
        `${capitalise(getPigment(stroke.pigment).name)} granulated in ${name}: the heavy particles have ` +
          'dropped into the tooth of the paper and mottled it. Glazing over this will not smooth it out.',
      )
    }

    if (rim?.amount !== undefined && rim.amount > 0.34) {
      lines.push(
        `${capitalise(name)} has pulled a hard dark rim as it dried. That edge is now the crispest thing ` +
          'in that passage, whether or not you wanted it to be.',
      )
    }

    // Fusion. Read from the ground the mark landed on rather than from any
    // geometry: this is the one thing the renderer cannot know, because by the
    // time it draws, the sheet is whatever it is.
    if ((stroke.ground ?? 0) > 0.22) {
      const into = scene.strokes.filter(
        (other) =>
          other.id !== id &&
          !wanted.has(other.id) &&
          other.createdAt < stroke.createdAt &&
          overlaps(bounds, boundsFor(other)),
      )
      const partner = into[into.length - 1]
      lines.push(
        partner
          ? `${capitalise(name)} landed on paper still wet from ${nameOf(partner)} and fused with it. ` +
            'There is no edge between them now, and there is no getting one back.'
          : `${capitalise(name)} landed on paper that was still damp, so it spread further and softer ` +
            'than the same mark would on a dry sheet.',
      )
    }
  }

  const open = wetField.openPatches()
  return { lines, open, events }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * The sheet's working state: what is still open and what has closed.
 *
 * Watercolour is the one medium where waiting is a decision, and an agent that
 * cannot tell a wet passage from a dry one is making that decision by accident
 * every time.
 */
export function describeOpen(patches: WetPatch[]): string {
  if (patches.length === 0) {
    return 'The sheet is dry everywhere. Anything laid down now will hold a hard edge, and nothing will fuse.'
  }
  const parts = patches
    .slice(0, 4)
    .map(
      (p) =>
        `${p.where} (${Math.round(p.x)},${Math.round(p.y)} to ${Math.round(p.x + p.w)},${Math.round(p.y + p.h)}), ` +
        `wetness ${p.wetness}, about ${p.secondsLeft}s left`,
    )
  return (
    `Still open: ${parts.join('; ')}. ` +
    'Paint into those now and the marks will fuse and soften; wait and they will not. ' +
    'Everywhere else is dry and will take a hard edge.'
  )
}
