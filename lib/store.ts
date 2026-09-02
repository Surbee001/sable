import { boundsOf, sampleSubpaths, translatePath } from './geometry'
import { wetField } from './wetfield'
import { KAWA, type DuetPart, type DuetScore } from './duet'
import { presence } from './presence'
import {
  BRUSHES,
  CANVAS_H,
  CANVAS_W,
  type Author,
  type BrushKind,
  type Layer,
  type PaperKind,
  type Scene,
  type Stroke,
} from './types'

/* ------------------------------------------------------------------ *
 * Activity
 * ------------------------------------------------------------------ */

export type ActivityKind =
  | 'paint'
  | 'edit'
  | 'erase'
  | 'move'
  | 'layer'
  | 'paper'
  | 'history'
  | 'note'

export interface Activity {
  id: string
  at: number
  author: Author
  kind: ActivityKind
  summary: string
  strokeIds: string[]
  note?: string
}

/* ------------------------------------------------------------------ *
 * UI state
 * ------------------------------------------------------------------ */

export interface BrushSettings {
  kind: BrushKind
  pigment: string
  water: number
  pressure: number
  opacity: number
  fill: boolean
}

export type Mode = 'paint' | 'select'

export interface UiState {
  mode: Mode
  activeLayerId: string
  selection: string[]
  brush: BrushSettings
  /** Highlight which strokes each author is responsible for. */
  showAuthorship: boolean
  /** Strokes the agent touched most recently, for the flash-on-change effect. */
  recentAgent: string[]
  /**
   * How many marks of the painting to show, in the order they were made.
   *
   * Null means all of them, which is every state except a replay. The painting
   * is a list of decisions in the order they were taken, so playing it back is
   * a slice rather than a recording: nothing has to be captured while the work
   * happens, and a document that arrives from a link replays exactly as well as
   * one painted in the room.
   */
  replay: number | null
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

/**
 * Where a duet has got to.
 *
 * No index, because there is no queue. The state of a shared board is only ever
 * three things: what is finished, what somebody has their hand on, and who that
 * somebody is. Everything else is free, and either painter may take it.
 */
export interface DuetState {
  score: DuetScore
  /** Bumped every time a score is opened, so a restart of the same one is a new board. */
  run: number
  /** Part id to the painter currently holding it. */
  held: Record<string, Author>
  /** Part ids that are finished. */
  done: string[]
  /** The part the human has in hand, if any. Drives the guides and the brush. */
  mine: string | null
  /** How many of that part's guides they have traced. */
  traced: number
}

export interface StudioSnapshot {
  scene: Scene
  ui: UiState
  activity: Activity[]
  duet: DuetState | null
  canUndo: boolean
  canRedo: boolean
}

export interface PaintInput {
  path: string
  kind?: BrushKind
  pigment?: string
  water?: number
  pressure?: number
  opacity?: number
  fill?: boolean
  width?: number
  lift?: boolean
  grade?: Stroke['grade']
  spatter?: Stroke['spatter']
  charge?: Stroke['charge']
  softToward?: number
  layerId?: string
  note?: string
  seed?: number
  /**
   * The wetness of the paper this mark landed on, if the caller already read it.
   *
   * The hand needs this: it reads the sheet when the brush goes down and draws
   * the preview against that, so the value has to survive to the commit rather
   * than being read a second time from a field that has been drying in the
   * meantime. Same argument as `seed`. Left out, it is read here.
   */
  ground?: number
}

export type StrokePatch = Partial<
  Pick<
    Stroke,
    | 'path' | 'kind' | 'pigment' | 'water' | 'pressure' | 'opacity' | 'fill' | 'layerId'
    | 'note' | 'width' | 'lift' | 'grade' | 'softToward' | 'spatter' | 'charge'
  >
>

const HISTORY_LIMIT = 80
const ACTIVITY_LIMIT = 200

let counter = 0
function uid(prefix: string): string {
  counter += 1
  return `${prefix}_${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

function blankScene(): Scene {
  return {
    title: 'Untitled study',
    paper: 'cold-press',
    layers: [
      { id: 'bg', name: 'Ground', visible: true, wetness: 0.6, opacity: 1 },
      { id: 'mid', name: 'Body', visible: true, wetness: 0.25, opacity: 1 },
      { id: 'top', name: 'Detail', visible: true, wetness: 0, opacity: 1 },
    ],
    strokes: [],
  }
}

/**
 * The studio document.
 *
 * Deliberately a plain observable object rather than React state: the WebMCP
 * tool handlers are called by the browser from outside React entirely, and they
 * mutate through exactly the same commands the mouse does. One command path
 * means one undo stack, and it means an agent can never reach a state the UI
 * could not have produced.
 */
class Studio {
  private scene: Scene = blankScene()
  private ui: UiState = {
    mode: 'paint',
    activeLayerId: 'mid',
    selection: [],
    brush: {
      kind: 'round',
      pigment: 'ultramarine',
      water: 0.55,
      pressure: 0.7,
      opacity: 0.7,
      fill: false,
    },
    showAuthorship: false,
    recentAgent: [],
    replay: null,
  }
  private activity: Activity[] = []
  private duet: DuetState | null = null
  private duetRun = 0
  private past: Scene[] = []
  private future: Scene[] = []
  private listeners = new Set<() => void>()
  private snapshot: StudioSnapshot = this.build()

  /* -------------------- subscription -------------------- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): StudioSnapshot => this.snapshot

  private build(): StudioSnapshot {
    return {
      scene: this.scene,
      ui: this.ui,
      activity: this.activity,
      duet: this.duet,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    }
  }

  private emit(): void {
    this.snapshot = this.build()
    for (const fn of this.listeners) fn()
  }

  /** Snapshot the document so this change can be undone. */
  private checkpoint(): void {
    this.past.push(this.scene)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
  }

  private log(
    author: Author,
    kind: ActivityKind,
    summary: string,
    strokeIds: string[] = [],
    note?: string,
  ): void {
    this.activity = [
      { id: uid('act'), at: Date.now(), author, kind, summary, strokeIds, note },
      ...this.activity,
    ].slice(0, ACTIVITY_LIMIT)

    if (author === 'agent' && strokeIds.length) {
      this.ui = { ...this.ui, recentAgent: strokeIds }
    }
  }

  /* -------------------- reads -------------------- */

  getScene = (): Scene => this.scene
  getUi = (): UiState => this.ui

  getStroke = (id: string): Stroke | undefined =>
    this.scene.strokes.find((s) => s.id === id)

  getLayer = (id: string): Layer | undefined =>
    this.scene.layers.find((l) => l.id === id)

  /** Resolve a layer by id or by name, case-insensitively. Agents use names. */
  resolveLayer = (ref: string | undefined): Layer | undefined => {
    if (!ref) return undefined
    const q = ref.trim().toLowerCase()
    return (
      this.scene.layers.find((l) => l.id.toLowerCase() === q) ??
      this.scene.layers.find((l) => l.name.toLowerCase() === q)
    )
  }

  /* -------------------- painting -------------------- */

  paint(input: PaintInput, author: Author): Stroke {
    const layer =
      this.resolveLayer(input.layerId) ??
      this.getLayer(this.ui.activeLayerId) ??
      this.scene.layers[0]

    const brush = this.ui.brush
    const stroke: Stroke = {
      id: uid('stroke'),
      layerId: layer.id,
      kind: input.kind ?? brush.kind,
      path: input.path,
      pigment: input.pigment ?? brush.pigment,
      water: clamp01(input.water ?? brush.water),
      pressure: clamp01(input.pressure ?? brush.pressure),
      opacity: clamp01(input.opacity ?? brush.opacity),
      fill: input.fill ?? false,
      seed: input.seed ?? Math.floor(Math.random() * 1e9),
      author,
      createdAt: Date.now() + counter,
      note: input.note,
    }

    this.checkpoint()
    this.scene = { ...this.scene, strokes: [...this.scene.strokes, stroke] }
    if (author === 'agent') presence.announce([stroke])
    else presence.beginSettle([{ id: stroke.id, water: stroke.water }])
    this.log(
      author,
      'paint',
      `${BRUSHES[stroke.kind].label}${stroke.fill ? ' wash' : ' stroke'} on ${layer.name}`,
      [stroke.id],
      input.note,
    )
    if (author === 'human') this.tallyDuet()
    this.emit()
    return stroke
  }

  /** Paint several strokes as one undoable action, the way an agent lays in a pass. */
  paintMany(inputs: PaintInput[], author: Author, summary?: string): Stroke[] {
    if (inputs.length === 0) return []
    this.checkpoint()

    const made: Stroke[] = []
    for (const input of inputs) {
      const layer =
        this.resolveLayer(input.layerId) ??
        this.getLayer(this.ui.activeLayerId) ??
        this.scene.layers[0]
      const brush = this.ui.brush
      const water = clamp01(input.water ?? brush.water)

      /**
       * Read the paper, then wet it.
       *
       * In that order, and inside the loop rather than around it, so that a
       * pass which lays a wash and then drops a mark into it works the way it
       * would on paper: the second mark finds the first one's water still
       * there. Reading the whole batch up front would have every mark in a pass
       * land on the sheet as it was before any of them.
       */
      const points = sampleSubpaths(input.path, 8).flat()
      const footprint = boundsOf(points)
      const ground = input.ground ?? wetField.wetnessUnder(footprint)
      if (input.fill) {
        wetField.deposit(footprint, water)
      } else {
        const kind = input.kind ?? this.ui.brush.kind
        const pressure = clamp01(input.pressure ?? this.ui.brush.pressure)
        wetField.depositAlong(points, (BRUSHES[kind].baseWidth * pressure) / 2, water)
      }

      made.push({
        id: uid('stroke'),
        layerId: layer.id,
        kind: input.kind ?? brush.kind,
        path: input.path,
        pigment: input.pigment ?? brush.pigment,
        water,
        pressure: clamp01(input.pressure ?? brush.pressure),
        opacity: clamp01(input.opacity ?? brush.opacity),
        fill: input.fill ?? false,
        width: input.width,
        lift: input.lift,
        grade: input.grade,
        spatter: input.spatter,
        charge: input.charge,
        softToward: input.softToward,
        ground,
        seed: input.seed ?? Math.floor(Math.random() * 1e9),
        author,
        createdAt: Date.now() + counter,
        note: input.note,
      })
      counter += 1
    }

    this.scene = { ...this.scene, strokes: [...this.scene.strokes, ...made] }
    if (author === 'agent') presence.announce(made)
    else presence.beginSettle(made.map((m) => ({ id: m.id, water: m.water })))
    this.log(
      author,
      'paint',
      summary ?? `${made.length} strokes`,
      made.map((s) => s.id),
      inputs[0]?.note,
    )
    this.emit()
    return made
  }

  update(id: string, patch: StrokePatch, author: Author, summary?: string): Stroke | null {
    const existing = this.getStroke(id)
    if (!existing) return null

    const next: Stroke = {
      ...existing,
      ...patch,
      water: patch.water !== undefined ? clamp01(patch.water) : existing.water,
      pressure: patch.pressure !== undefined ? clamp01(patch.pressure) : existing.pressure,
      opacity: patch.opacity !== undefined ? clamp01(patch.opacity) : existing.opacity,
    }

    this.checkpoint()
    this.scene = {
      ...this.scene,
      strokes: this.scene.strokes.map((s) => (s.id === id ? next : s)),
    }
    this.log(
      author,
      'edit',
      summary ?? `Revised ${describeStroke(next)}`,
      [id],
      patch.note,
    )
    this.emit()
    return next
  }

  /** Apply the same patch to many strokes in one action. */
  updateMany(
    ids: string[],
    patch: StrokePatch,
    author: Author,
    summary?: string,
  ): Stroke[] {
    const set = new Set(ids)
    const touched = this.scene.strokes.filter((s) => set.has(s.id))
    if (touched.length === 0) return []

    this.checkpoint()
    this.scene = {
      ...this.scene,
      strokes: this.scene.strokes.map((s) =>
        set.has(s.id)
          ? {
              ...s,
              ...patch,
              water: patch.water !== undefined ? clamp01(patch.water) : s.water,
              pressure:
                patch.pressure !== undefined ? clamp01(patch.pressure) : s.pressure,
              opacity: patch.opacity !== undefined ? clamp01(patch.opacity) : s.opacity,
            }
          : s,
      ),
    }
    this.log(author, 'edit', summary ?? `Revised ${touched.length} strokes`, ids)
    this.emit()
    return this.scene.strokes.filter((s) => set.has(s.id))
  }

  move(ids: string[], dx: number, dy: number, author: Author): number {
    const set = new Set(ids)
    const touched = this.scene.strokes.filter((s) => set.has(s.id))
    if (touched.length === 0) return 0

    this.checkpoint()
    this.scene = {
      ...this.scene,
      strokes: this.scene.strokes.map((s) =>
        set.has(s.id) ? { ...s, path: translatePath(s.path, dx, dy) } : s,
      ),
    }
    this.log(
      author,
      'move',
      `Moved ${touched.length === 1 ? describeStroke(touched[0]) : `${touched.length} strokes`} by ${Math.round(dx)}, ${Math.round(dy)}`,
      ids,
    )
    this.emit()
    return touched.length
  }

  erase(ids: string[], author: Author): number {
    const set = new Set(ids)
    const going = this.scene.strokes.filter((s) => set.has(s.id))
    if (going.length === 0) return 0

    this.checkpoint()
    this.scene = {
      ...this.scene,
      strokes: this.scene.strokes.filter((s) => !set.has(s.id)),
    }
    this.ui = {
      ...this.ui,
      selection: this.ui.selection.filter((id) => !set.has(id)),
    }
    this.log(
      author,
      'erase',
      `Lifted ${going.length === 1 ? describeStroke(going[0]) : `${going.length} strokes`}`,
      ids,
    )
    this.emit()
    return going.length
  }

  /** Reorder within the paint order. Later strokes sit on top. */
  restack(id: string, to: 'front' | 'back', author: Author): boolean {
    const stroke = this.getStroke(id)
    if (!stroke) return false
    const times = this.scene.strokes.map((s) => s.createdAt)
    const at = to === 'front' ? Math.max(...times) + 1 : Math.min(...times) - 1

    this.checkpoint()
    this.scene = {
      ...this.scene,
      strokes: this.scene.strokes.map((s) =>
        s.id === id ? { ...s, createdAt: at } : s,
      ),
    }
    this.log(author, 'edit', `Brought ${describeStroke(stroke)} to ${to}`, [id])
    this.emit()
    return true
  }

  /* -------------------- layers & sheet -------------------- */

  addLayer(name: string, wetness: number, author: Author): Layer {
    const layer: Layer = {
      id: uid('layer'),
      name: name || `Layer ${this.scene.layers.length + 1}`,
      visible: true,
      wetness: clamp01(wetness),
      opacity: 1,
    }
    this.checkpoint()
    this.scene = { ...this.scene, layers: [...this.scene.layers, layer] }
    this.log(author, 'layer', `Taped down a new layer: ${layer.name}`)
    this.emit()
    return layer
  }

  updateLayer(id: string, patch: Partial<Layer>, author: Author): Layer | null {
    const layer = this.getLayer(id)
    if (!layer) return null
    const next = { ...layer, ...patch }
    this.checkpoint()
    this.scene = {
      ...this.scene,
      layers: this.scene.layers.map((l) => (l.id === id ? next : l)),
    }
    this.log(author, 'layer', `${next.name} updated`)
    this.emit()
    return next
  }

  setPaper(paper: PaperKind, author: Author): void {
    this.checkpoint()
    this.scene = { ...this.scene, paper }
    this.log(author, 'paper', `Switched to ${paper} paper`)
    this.emit()
  }

  setTitle(title: string, author: Author): void {
    this.scene = { ...this.scene, title }
    this.log(author, 'note', `Titled "${title}"`)
    this.emit()
  }

  clear(author: Author): void {
    this.checkpoint()
    this.scene = { ...this.scene, strokes: [] }
    this.ui = { ...this.ui, selection: [] }
    wetField.reset()
    this.log(author, 'erase', 'Took every mark off the sheet')
    this.emit()
  }

  newSheet(author: Author): void {
    this.checkpoint()
    this.scene = blankScene()
    this.ui = { ...this.ui, selection: [], activeLayerId: 'mid' }
    wetField.reset()
    this.log(author, 'note', 'Taped down a fresh sheet')
    this.emit()
  }

  /* -------------------- history -------------------- */

  undo(author: Author = 'human'): boolean {
    const prev = this.past.pop()
    if (!prev) return false
    this.future.push(this.scene)
    this.scene = prev
    this.log(author, 'history', 'Undo')
    this.emit()
    return true
  }

  redo(author: Author = 'human'): boolean {
    const next = this.future.pop()
    if (!next) return false
    this.past.push(this.scene)
    this.scene = next
    this.log(author, 'history', 'Redo')
    this.emit()
    return true
  }

  /* -------------------- ui -------------------- */

  select(ids: string[]): void {
    this.ui = { ...this.ui, selection: ids }
    this.emit()
  }

  setActiveLayer(id: string): void {
    this.ui = { ...this.ui, activeLayerId: id }
    this.emit()
  }

  setBrush(patch: Partial<BrushSettings>): void {
    this.ui = { ...this.ui, brush: { ...this.ui.brush, ...patch } }
    this.emit()
  }

  setMode(mode: Mode): void {
    this.ui = { ...this.ui, mode, selection: mode === 'paint' ? [] : this.ui.selection }
    this.emit()
  }

  /* -------------------- the duet -------------------- */

  getDuet = (): DuetState | null => this.duet

  findPart(id: string): DuetPart | null {
    if (!this.duet) return null
    const q = id.trim().toLowerCase()
    return (
      this.duet.score.parts.find((p) => p.id === q) ??
      this.duet.score.parts.find((p) => p.title.toLowerCase() === q) ??
      null
    )
  }

  /** The part the human has in hand, which is what the guides are drawn from. */
  myPart(): DuetPart | null {
    if (!this.duet?.mine) return null
    return this.findPart(this.duet.mine)
  }

  /** What is standing in front of a part, in the sense of unfinished groundwork. */
  blockedBy(part: DuetPart): DuetPart[] {
    if (!this.duet || !part.after) return []
    const done = new Set(this.duet.done)
    return part.after
      .filter((id) => !done.has(id))
      .map((id) => this.findPart(id))
      .filter((p): p is DuetPart => p !== null)
  }

  /**
   * Parts nobody is holding and nobody has finished.
   *
   * `by` never filters this. A part suggested for one painter is still open to
   * the other, and a duet where the software decides who is allowed to paint
   * what is the thing this stopped being.
   */
  freeParts(): DuetPart[] {
    if (!this.duet) return []
    const duet = this.duet
    const done = new Set(duet.done)
    return duet.score.parts.filter((p) => !done.has(p.id) && !duet.held[p.id])
  }

  startDuet(score: DuetScore = KAWA): void {
    this.checkpoint()
    this.scene = {
      title: score.title,
      paper: score.paper,
      layers: [
        { id: 'bg', name: 'Ground', visible: true, wetness: 0.7, opacity: 1 },
        { id: 'mid', name: 'Body', visible: true, wetness: 0.3, opacity: 1 },
        { id: 'top', name: 'Detail', visible: true, wetness: 0, opacity: 1 },
      ],
      strokes: [],
    }
    this.ui = { ...this.ui, selection: [], mode: 'paint' }
    this.duetRun += 1
    this.duet = { score, run: this.duetRun, held: {}, done: [], mine: null, traced: 0 }
    this.log('human', 'note', `Started ${score.title}`)
    this.emit()
  }

  endDuet(): void {
    if (!this.duet) return
    this.duet = null
    this.emit()
  }

  /**
   * Put a hand on a part.
   *
   * The only coordination in the whole score. It fails on a part somebody else
   * is already holding, and on nothing else: dependencies advise, they do not
   * refuse, because a painter who wants to draw the branches before the trunk
   * is making a choice rather than a mistake.
   */
  takePart(id: string, author: Author): { ok: boolean; part: DuetPart | null; why: string } {
    const part = this.findPart(id)
    if (!this.duet || !part) return { ok: false, part: null, why: `There is no part called "${id}".` }
    if (this.duet.done.includes(part.id)) {
      return { ok: false, part, why: `"${part.title}" is already painted.` }
    }
    const holder = this.duet.held[part.id]
    if (holder && holder !== author) {
      return { ok: false, part, why: `The ${holder} has "${part.title}" in hand. Take another one.` }
    }

    this.duet = {
      ...this.duet,
      held: { ...this.duet.held, [part.id]: author },
      mine: author === 'human' ? part.id : this.duet.mine,
      traced: author === 'human' ? 0 : this.duet.traced,
    }
    if (author === 'human') this.applyLoadout(part)
    this.log(author, 'note', `Took ${part.title.toLowerCase()}`)
    this.emit()
    return { ok: true, part, why: '' }
  }

  /** Let go of a part without finishing it, so the other painter can have it. */
  releasePart(id: string, author: Author): boolean {
    const part = this.findPart(id)
    if (!this.duet || !part || this.duet.held[part.id] !== author) return false
    const held = { ...this.duet.held }
    delete held[part.id]
    this.duet = {
      ...this.duet,
      held,
      mine: this.duet.mine === part.id ? null : this.duet.mine,
      traced: this.duet.mine === part.id ? 0 : this.duet.traced,
    }
    this.log(author, 'note', `Put ${part.title.toLowerCase()} back`)
    this.emit()
    return true
  }

  /** Call a part painted. Both painters use this and it is not reversible. */
  finishPart(id: string, author: Author): DuetPart | null {
    const part = this.findPart(id)
    if (!this.duet || !part || this.duet.done.includes(part.id)) return null
    const held = { ...this.duet.held }
    delete held[part.id]
    this.duet = {
      ...this.duet,
      held,
      done: [...this.duet.done, part.id],
      mine: this.duet.mine === part.id ? null : this.duet.mine,
      traced: this.duet.mine === part.id ? 0 : this.duet.traced,
    }
    this.log(author, 'note', `Finished ${part.title.toLowerCase()}`)
    this.emit()
    return part
  }

  /** True once every part is off the board. */
  duetFinished(): boolean {
    return !!this.duet && this.duet.done.length >= this.duet.score.parts.length
  }

  /** Load the human's brush for the part they have just picked up. */
  private applyLoadout(part: DuetPart): void {
    if (!part.loadout) return
    const { layer, ...brush } = part.loadout
    const target = this.resolveLayer(layer)
    this.ui = {
      ...this.ui,
      brush: { ...this.ui.brush, ...brush },
      activeLayerId: target?.id ?? this.ui.activeLayerId,
    }
  }

  /**
   * One traced guide per stroke. The mark itself is whatever the human actually
   * drew, not the guide: this is their hand in the painting, not a stencil.
   *
   * Only counts while they are holding something. Painting on a duet sheet
   * without having taken a part is ordinary painting, and it stays allowed.
   */
  private tallyDuet(): void {
    const part = this.myPart()
    if (!this.duet || !part) return
    const needed = part.guides?.length ?? 0
    const traced = this.duet.traced + 1
    if (needed > 0 && traced >= needed) {
      this.finishPart(part.id, 'human')
    } else {
      this.duet = { ...this.duet, traced }
    }
  }

  /** A line from the agent addressed to the human, with no mark attached. */
  noteFromAgent(note: string): void {
    this.log('agent', 'note', note)
    this.emit()
  }

  /* -------------------- replay -------------------- */

  /** Marks in the order they were laid down, across every layer. */
  chronological(): Stroke[] {
    return [...this.scene.strokes].sort((a, b) => a.createdAt - b.createdAt)
  }

  setReplay(upTo: number | null): void {
    if (this.ui.replay === upTo) return
    this.ui = { ...this.ui, replay: upTo }
    this.emit()
  }

  /* -------------------- loading a whole document -------------------- */

  /**
   * Replace the sheet with one that arrived from somewhere else.
   *
   * A restored session, a shared link, or an agent handing over a document it
   * built. Undoable like anything else, because a link that silently destroys
   * what you were painting is a worse thing than a link that does not work.
   */
  loadScene(scene: Scene, author: Author, summary = 'Opened a painting'): void {
    this.checkpoint()
    this.scene = {
      title: scene.title || 'Untitled study',
      paper: scene.paper,
      layers: scene.layers.length ? scene.layers : blankScene().layers,
      strokes: scene.strokes,
    }
    this.ui = { ...this.ui, selection: [], replay: null }
    this.duet = null
    wetField.reset()
    // Anything the agent was in the middle of revealing belongs to the sheet
    // that just went away, so let it land rather than animating it over this one.
    presence.flush()
    this.log(author, 'note', summary, [])
    this.emit()
  }

  setShowAuthorship(on: boolean): void {
    this.ui = { ...this.ui, showAuthorship: on }
    this.emit()
  }

  clearRecentAgent(): void {
    if (this.ui.recentAgent.length === 0) return
    this.ui = { ...this.ui, recentAgent: [] }
    this.emit()
  }
}

export function describeStroke(s: Stroke): string {
  return `${BRUSHES[s.kind].label.toLowerCase()} ${s.fill ? 'wash' : 'stroke'}`
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))
}

export const studio = new Studio()
export { CANVAS_H, CANVAS_W }
