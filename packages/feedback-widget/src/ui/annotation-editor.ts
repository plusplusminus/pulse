/**
 * The screenshot editor (PULSE-401).
 *
 * Ships as its own IIFE artefact (`annotation-editor.global.js`) fetched on the
 * first click of Annotate — see `ui/annotation.ts` for the loader. Nothing in
 * the embed may import this file: the embed is an iife bundle and iife cannot
 * code-split, so a single import would inline the whole editor into a script
 * that loads on every page view of every client site.
 *
 * The bitmap is never resampled. Both canvases are sized to its natural pixels
 * and scaled down with CSS only, so the exported PNG matches the capture
 * exactly and every mark stays valid across a resize.
 */
import type {
  AnnotationColor,
  AnnotationEditorState,
  AnnotationKind,
  AnnotationRect,
  CropRect,
  ScreenshotAnnotation,
} from '../types'
import { ANNOTATION_COLORS } from '../types'
import { icon } from './icon'
import {
  ANNOTATION_FONT_STACK,
  LINE_HEIGHT,
  annotationBounds,
  hitTest,
  paintAnnotations,
  translateAnnotation,
  type Point,
} from './annotation-paint'
import { editorStyles } from './annotation-editor-styles'

/** Rects smaller than this (in image pixels) are treated as a stray click. */
const MIN_RECT = 4
/** Deep enough for a real editing session, bounded so a long one cannot grow without limit. */
const MAX_HISTORY = 60
/** Grab radius for selection, in image pixels before DPR scaling. */
const HIT_TOLERANCE = 6
/** Corner-handle grab radius and drawn size, before DPR scaling. */
const HANDLE = 9
/** A crop smaller than this is a mis-drag, not an intent. */
const MIN_CROP = 16
/** A drag shorter than this was a click, not an arrow. */
const MIN_ARROW = 8
/**
 * Pen samples closer together than this add nothing a viewer can see and cost
 * two numbers each in the stored row, so they are dropped as they arrive.
 */
const MIN_PEN_STEP = 2
/** Logical stroke widths, scaled to image pixels when a mark is made. */
export const STROKE_WIDTHS = [2, 4, 7] as const
/** Logical font sizes, scaled to image pixels when a label is placed. */
export const TEXT_SIZES = [16, 24, 36] as const
/** Tools that draw with the current colour; the rest have a fixed appearance. */
const COLORED_TOOLS: ReadonlySet<EditorTool> = new Set([
  'arrow',
  'rect',
  'ellipse',
  'pen',
  'text',
])
/** Tools that draw with the current stroke width. */
const STROKE_TOOLS: ReadonlySet<EditorTool> = new Set(['arrow', 'rect', 'ellipse', 'pen'])

export type EditorTool = 'select' | 'crop' | AnnotationKind

export interface AnnotationEditorConfig {
  /**
   * `annotations` match the exported blob exactly — a crop has already been
   * applied to both. `state` is the editor's own round-trip state, in the
   * ORIGINAL capture's space, and is opaque to the caller.
   */
  onSave: (
    blob: Blob,
    annotations: ScreenshotAnnotation[],
    state: AnnotationEditorState
  ) => void
  onCancel: () => void
}

interface Snapshot {
  annotations: ScreenshotAnnotation[]
  crop: CropRect | null
}

type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'move' | 'new'

type Drag =
  | { mode: 'draw'; start: Point; current: Point; points: number[] }
  | { mode: 'move'; start: Point; current: Point; index: number; origin: ScreenshotAnnotation }
  | {
      mode: 'crop'
      start: Point
      current: Point
      handle: CropHandle
      origin: CropRect | null
    }

export function normaliseRect(a: Point, b: Point): AnnotationRect {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    w: Math.round(Math.abs(b.x - a.x)),
    h: Math.round(Math.abs(b.y - a.y)),
  }
}

export class AnnotationEditor {
  private container: HTMLElement | null = null
  private styleEl: HTMLStyleElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private bgCanvas: HTMLCanvasElement | null = null
  private toolbar: HTMLElement | null = null
  private image: HTMLImageElement | null = null

  private annotations: ScreenshotAnnotation[] = []
  private crop: CropRect | null = null
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []

  // Arrow, not highlight: pointing at the broken thing is the single most
  // common mark in a bug report, so it is what the editor opens on.
  private tool: EditorTool = 'arrow'
  private color: AnnotationColor = ANNOTATION_COLORS[0]
  /** Logical stroke width; multiplied by the capture's scale when a mark is made. */
  private stroke: number = STROKE_WIDTHS[1]
  private textSize: number = TEXT_SIZES[1]
  /** The live in-shadow input, while a label is being typed. */
  private textInput: HTMLTextAreaElement | null = null
  /** Index being re-edited, or null when the input is placing a new label. */
  private editingIndex: number | null = null
  /** Where a NEW label will land; ignored when re-editing an existing one. */
  private pendingTextOrigin: Point = { x: 0, y: 0 }
  private selected: number | null = null
  private drag: Drag | null = null
  /** image px per CSS px — a 2x capture draws 2x strokes so marks stay legible. */
  private scale = 1

  private onPointerDown = (e: PointerEvent) => this.beginDrag(e)
  private onPointerMove = (e: PointerEvent) => this.extendDrag(e)
  private onPointerUp = (e: PointerEvent) => this.endDrag(e)
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e)
  private onDoubleClick = (e: MouseEvent) => this.editTextUnder(e)

  constructor(
    private shadowRoot: ShadowRoot,
    private config: AnnotationEditorConfig,
    private theme: 'light' | 'dark' = 'light'
  ) {}

  async show(screenshotBlob: Blob, state?: AnnotationEditorState | null): Promise<void> {
    this.annotations = (state?.annotations ?? []).map(cloneAnnotation)
    this.crop = state?.crop ? { ...state.crop } : null
    this.undoStack = []
    this.redoStack = []
    this.selected = null

    this.image = await loadImage(screenshotBlob)
    const width = this.image.naturalWidth
    const height = this.image.naturalHeight

    this.styleEl = document.createElement('style')
    this.styleEl.textContent = editorStyles(this.theme)
    this.shadowRoot.appendChild(this.styleEl)

    this.container = document.createElement('div')
    this.container.className = 'pulse-annotation'
    this.toolbar = this.renderToolbar()
    this.container.appendChild(this.toolbar)

    const wrap = document.createElement('div')
    wrap.className = 'pulse-annotation__canvas-wrap'
    // CSS-only downscale: the intrinsic ratio keeps the two canvases aligned.
    wrap.style.aspectRatio = `${width} / ${height}`

    this.bgCanvas = document.createElement('canvas')
    this.bgCanvas.width = width
    this.bgCanvas.height = height
    this.bgCanvas.getContext('2d')?.drawImage(this.image, 0, 0)
    wrap.appendChild(this.bgCanvas)

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'pulse-annotation__layer'
    this.canvas.width = width
    this.canvas.height = height
    this.ctx = this.canvas.getContext('2d')
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
    this.canvas.addEventListener('dblclick', this.onDoubleClick)
    wrap.appendChild(this.canvas)

    this.container.appendChild(wrap)
    this.shadowRoot.appendChild(this.container)

    window.addEventListener('keydown', this.onKeyDown, true)

    this.measureScale()
    this.syncToolbarState()
    this.redraw()
  }

  hide(): void {
    this.cleanup()
  }

  destroy(): void {
    this.cleanup()
  }

  getAnnotations(): ScreenshotAnnotation[] {
    return this.annotations.map(cloneAnnotation)
  }

  getState(): AnnotationEditorState {
    return { annotations: this.getAnnotations(), crop: this.crop ? { ...this.crop } : null }
  }

  private cleanup(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onPointerDown)
      this.canvas.removeEventListener('pointermove', this.onPointerMove)
      this.canvas.removeEventListener('pointerup', this.onPointerUp)
      this.canvas.removeEventListener('pointercancel', this.onPointerUp)
      this.canvas.removeEventListener('dblclick', this.onDoubleClick)
    }
    this.textInput?.remove()
    this.textInput = null
    this.editingIndex = null
    window.removeEventListener('keydown', this.onKeyDown, true)
    this.container?.remove()
    this.styleEl?.remove()
    this.container = null
    this.styleEl = null
    this.toolbar = null
    this.canvas = null
    this.ctx = null
    this.bgCanvas = null
    this.image = null
    this.annotations = []
    this.crop = null
    this.undoStack = []
    this.redoStack = []
    this.selected = null
    this.drag = null
  }

  // -- History ------------------------------------------------------------

  /**
   * Called BEFORE every mutation. The stack is bounded, and it lives on the
   * editor instance — the widget builds a new editor per capture, so history
   * can never leak from one screenshot into the next.
   */
  private pushHistory(): void {
    this.undoStack.push(this.snapshot())
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    this.redoStack = []
  }

  private snapshot(): Snapshot {
    return {
      annotations: this.annotations.map(cloneAnnotation),
      crop: this.crop ? { ...this.crop } : null,
    }
  }

  private restore(s: Snapshot): void {
    this.annotations = s.annotations.map(cloneAnnotation)
    this.crop = s.crop ? { ...s.crop } : null
    this.selected = null
  }

  undo(): void {
    const previous = this.undoStack.pop()
    if (!previous) return
    this.redoStack.push(this.snapshot())
    this.restore(previous)
    this.afterMutation()
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.snapshot())
    this.restore(next)
    this.afterMutation()
  }

  private afterMutation(): void {
    this.redraw()
    this.syncToolbarState()
  }

  private deleteSelected(): void {
    if (this.selected === null) return
    this.pushHistory()
    this.annotations.splice(this.selected, 1)
    this.selected = null
    this.afterMutation()
  }

  /** Non-destructive: the bitmap was never cut, so the full frame just comes back. */
  private resetCrop(): void {
    if (!this.crop) return
    this.pushHistory()
    this.crop = null
    this.afterMutation()
  }

  private clearAll(): void {
    if (this.annotations.length === 0 && !this.crop) return
    this.pushHistory()
    this.annotations = []
    this.crop = null
    this.selected = null
    this.afterMutation()
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.container) return
    const key = e.key.toLowerCase()
    const mod = e.metaKey || e.ctrlKey

    // While a label is being typed the textarea owns its keys: undo, delete and
    // backspace all mean something inside a text field. Only the two ways of
    // finishing are intercepted, and both keep what was typed — losing a
    // half-written label to a stray Escape is the worse failure.
    if (this.textInput) {
      if (key === 'escape' || (mod && key === 'enter')) {
        e.preventDefault()
        e.stopPropagation()
        this.commitText()
      }
      return
    }

    if (mod && key === 'z') {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) this.redo()
      else this.undo()
      return
    }
    if (mod && key === 'y') {
      e.preventDefault()
      e.stopPropagation()
      this.redo()
      return
    }
    if (key === 'delete' || key === 'backspace') {
      if (this.selected === null) return
      e.preventDefault()
      e.stopPropagation()
      this.deleteSelected()
      return
    }
    if (key === 'escape') {
      e.preventDefault()
      e.stopPropagation()
      if (this.selected !== null) {
        this.selected = null
        this.afterMutation()
      } else {
        this.cancel()
      }
    }
  }

  // -- Toolbar ------------------------------------------------------------

  private renderToolbar(): HTMLElement {
    const toolbar = document.createElement('div')
    toolbar.className = 'pulse-annotation__toolbar'
    toolbar.setAttribute('role', 'toolbar')
    toolbar.setAttribute('aria-label', 'Screenshot editor')

    for (const t of this.tools()) {
      const btn = toolButton(t.icon, t.label)
      btn.dataset.tool = t.id
      btn.addEventListener('click', () => this.selectTool(t.id))
      toolbar.appendChild(btn)
    }

    toolbar.appendChild(divider())
    toolbar.appendChild(this.renderStyleControls())
    toolbar.appendChild(divider())
    toolbar.appendChild(this.renderHistoryControls())
    toolbar.appendChild(divider())
    toolbar.appendChild(this.renderActions())

    return toolbar
  }

  protected tools(): Array<{ id: EditorTool; label: string; icon: string | readonly string[] }> {
    return [
      { id: 'select', label: 'Select', icon: EDITOR_ICONS.select },
      { id: 'arrow', label: 'Arrow', icon: EDITOR_ICONS.arrow },
      { id: 'rect', label: 'Rectangle', icon: EDITOR_ICONS.rect },
      { id: 'ellipse', label: 'Ellipse', icon: EDITOR_ICONS.ellipse },
      { id: 'pen', label: 'Pen', icon: EDITOR_ICONS.pen },
      { id: 'text', label: 'Text', icon: EDITOR_ICONS.text },
      { id: 'crop', label: 'Crop', icon: EDITOR_ICONS.crop },
      { id: 'highlight', label: 'Highlight', icon: EDITOR_ICONS.highlight },
      { id: 'hide', label: 'Hide', icon: EDITOR_ICONS.hide },
    ]
  }

  /**
   * Colour and stroke, shown only for the tools they affect. Highlight and hide
   * have a fixed appearance, so offering them a colour would be a lie.
   */
  private renderStyleControls(): HTMLElement {
    const group = document.createElement('div')
    group.className = 'pulse-annotation__group pulse-annotation__style-group'

    for (const color of ANNOTATION_COLORS) {
      const btn = document.createElement('button')
      btn.className = 'pulse-annotation__swatch'
      btn.type = 'button'
      btn.dataset.color = color
      btn.style.setProperty('--pulse-swatch', color)
      btn.title = color
      btn.setAttribute('aria-label', `Colour ${color}`)
      btn.addEventListener('click', () => {
        this.color = color
        this.applyStyleToSelection()
        this.syncToolbarState()
      })
      group.appendChild(btn)
    }

    const strokes = document.createElement('div')
    strokes.className = 'pulse-annotation__group pulse-annotation__stroke-group'
    for (const width of STROKE_WIDTHS) {
      const btn = document.createElement('button')
      btn.className = 'pulse-annotation__stroke'
      btn.type = 'button'
      btn.dataset.stroke = String(width)
      btn.title = `Stroke ${width}`
      btn.setAttribute('aria-label', `Stroke width ${width}`)
      btn.appendChild(dot(width))
      btn.addEventListener('click', () => {
        this.stroke = width
        this.applyStyleToSelection()
        this.syncToolbarState()
      })
      strokes.appendChild(btn)
    }
    group.appendChild(strokes)

    const sizes = document.createElement('div')
    sizes.className = 'pulse-annotation__group pulse-annotation__size-group'
    for (const size of TEXT_SIZES) {
      const btn = document.createElement('button')
      btn.className = 'pulse-annotation__size'
      btn.type = 'button'
      btn.dataset.size = String(size)
      btn.title = `Text size ${size}`
      btn.setAttribute('aria-label', `Text size ${size}`)
      btn.textContent = 'A'
      btn.style.fontSize = `${10 + (size - TEXT_SIZES[0]) * 0.28}px`
      btn.addEventListener('click', () => {
        this.textSize = size
        this.applyStyleToSelection()
        this.syncToolbarState()
      })
      sizes.appendChild(btn)
    }
    group.appendChild(sizes)

    return group
  }

  private selectionKind(): ScreenshotAnnotation['kind'] | null {
    if (this.selected === null) return null
    return this.annotations[this.selected]?.kind ?? null
  }

  /**
   * Restyling the selected mark is what people expect from a toolbar that also
   * sets the next mark's style — otherwise picking a colour with something
   * selected appears to do nothing.
   */
  private applyStyleToSelection(): void {
    if (this.selected === null) return
    const mark = this.annotations[this.selected]
    if (!mark || !('color' in mark)) return
    this.pushHistory()
    this.annotations[this.selected] =
      mark.kind === 'text'
        ? { ...mark, color: this.color, fontSize: this.textSizeInImagePixels() }
        : { ...mark, color: this.color, strokeWidth: this.strokeInImagePixels() }
    this.redraw()
  }

  private renderHistoryControls(): HTMLElement {
    const group = document.createElement('div')
    group.className = 'pulse-annotation__group'

    const undoBtn = toolButton(EDITOR_ICONS.undo, 'Undo')
    undoBtn.dataset.action = 'undo'
    undoBtn.addEventListener('click', () => this.undo())
    group.appendChild(undoBtn)

    const redoBtn = toolButton(EDITOR_ICONS.redo, 'Redo')
    redoBtn.dataset.action = 'redo'
    redoBtn.addEventListener('click', () => this.redo())
    group.appendChild(redoBtn)

    const deleteBtn = toolButton(EDITOR_ICONS.trash, 'Delete selected')
    deleteBtn.dataset.action = 'delete'
    deleteBtn.addEventListener('click', () => this.deleteSelected())
    group.appendChild(deleteBtn)

    const cropReset = toolButton(EDITOR_ICONS.cropReset, 'Reset crop')
    cropReset.dataset.action = 'crop-reset'
    cropReset.addEventListener('click', () => this.resetCrop())
    group.appendChild(cropReset)

    const clearBtn = toolButton(EDITOR_ICONS.clear, 'Clear all')
    clearBtn.dataset.action = 'clear'
    clearBtn.addEventListener('click', () => this.clearAll())
    group.appendChild(clearBtn)

    return group
  }

  private renderActions(): HTMLElement {
    const group = document.createElement('div')
    group.className = 'pulse-annotation__group'

    const cancel = document.createElement('button')
    cancel.className = 'pulse-annotation__action-btn'
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => this.cancel())
    group.appendChild(cancel)

    const save = document.createElement('button')
    save.className = 'pulse-annotation__action-btn pulse-annotation__action-btn--primary'
    save.type = 'button'
    save.textContent = 'Save'
    save.addEventListener('click', () => void this.save())
    group.appendChild(save)

    return group
  }

  protected selectTool(id: EditorTool): void {
    this.tool = id
    if (id !== 'select') this.selected = null
    this.syncToolbarState()
    this.redraw()
  }

  protected syncToolbarState(): void {
    const toolbar = this.toolbar
    if (!toolbar) return
    for (const btn of toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const active = btn.dataset.tool === this.tool
      btn.classList.toggle('pulse-annotation__tool-btn--active', active)
      btn.setAttribute('aria-pressed', String(active))
    }
    for (const btn of toolbar.querySelectorAll<HTMLButtonElement>('[data-color]')) {
      btn.classList.toggle('pulse-annotation__swatch--active', btn.dataset.color === this.color)
      btn.setAttribute('aria-pressed', String(btn.dataset.color === this.color))
    }
    for (const btn of toolbar.querySelectorAll<HTMLButtonElement>('[data-stroke]')) {
      const active = btn.dataset.stroke === String(this.stroke)
      btn.classList.toggle('pulse-annotation__stroke--active', active)
      btn.setAttribute('aria-pressed', String(active))
    }
    for (const btn of toolbar.querySelectorAll<HTMLButtonElement>('[data-size]')) {
      const active = btn.dataset.size === String(this.textSize)
      btn.classList.toggle('pulse-annotation__size--active', active)
      btn.setAttribute('aria-pressed', String(active))
    }

    // Each control is visible when the active tool uses it, and also whenever a
    // mark that uses it is selected — otherwise selecting a mark would be the
    // one state in which its own style could not be changed.
    const kind = this.selectionKind()
    const coloured = COLORED_TOOLS.has(this.tool) || (kind !== null && kind !== 'highlight' && kind !== 'hide')
    const stroked = STROKE_TOOLS.has(this.tool) || (kind !== null && kind !== 'text' && coloured)
    const sized = this.tool === 'text' || kind === 'text'
    setHidden(toolbar, '.pulse-annotation__style-group', !coloured)
    setHidden(toolbar, '.pulse-annotation__stroke-group', !stroked)
    setHidden(toolbar, '.pulse-annotation__size-group', !sized)

    setDisabled(toolbar, 'undo', this.undoStack.length === 0)
    setDisabled(toolbar, 'redo', this.redoStack.length === 0)
    setDisabled(toolbar, 'delete', this.selected === null)
    setDisabled(toolbar, 'clear', this.annotations.length === 0 && !this.crop)
    setDisabled(toolbar, 'crop-reset', !this.crop)
    const wrap = this.container?.querySelector<HTMLElement>('.pulse-annotation__canvas-wrap')
    wrap?.classList.toggle('pulse-annotation__canvas-wrap--select', this.tool === 'select')
  }

  // -- Pointer input ------------------------------------------------------

  /**
   * image px per CSS px. Strokes and type are stored in image pixels, so this is
   * what keeps a mark the same apparent size on a 1x and a 2x capture.
   */
  private measureScale(): void {
    const canvas = this.canvas
    if (!canvas) return
    const box = canvas.getBoundingClientRect()
    this.scale = box.width > 0 ? canvas.width / box.width : 1
  }

  /** Client point -> image-pixel point, undoing the CSS downscale. */
  private toImagePoint(e: PointerEvent): Point {
    const canvas = this.canvas
    if (!canvas) return { x: 0, y: 0 }
    const box = canvas.getBoundingClientRect()
    const scaleX = box.width === 0 ? 1 : canvas.width / box.width
    const scaleY = box.height === 0 ? 1 : canvas.height / box.height
    return { x: (e.clientX - box.left) * scaleX, y: (e.clientY - box.top) * scaleY }
  }

  private beginDrag(e: PointerEvent): void {
    this.measureScale()
    const point = this.toImagePoint(e)

    // A click anywhere commits whatever is being typed, so a label is never
    // lost by clicking away from it. With the text tool still active the click
    // then opens the next label, so several can be placed without going back to
    // the toolbar between them.
    if (this.textInput) this.commitText()

    if (this.tool === 'text') {
      this.openTextInput(point, null)
      return
    }

    this.canvas?.setPointerCapture(e.pointerId)

    if (this.tool === 'crop') {
      this.drag = {
        mode: 'crop',
        start: point,
        current: point,
        handle: this.cropHandleAt(point),
        origin: this.crop ? { ...this.crop } : null,
      }
      this.pushHistory()
      this.selected = null
      this.afterMutation()
      return
    }

    if (this.tool === 'select') {
      const index = hitTest(this.annotations, point, HIT_TOLERANCE * this.scale, this.ctx ?? undefined)
      this.selected = index
      if (index !== null) {
        this.pushHistory()
        this.drag = {
          mode: 'move',
          start: point,
          current: point,
          index,
          origin: cloneAnnotation(this.annotations[index]),
        }
      }
      this.afterMutation()
      return
    }

    this.drag = { mode: 'draw', start: point, current: point, points: [point.x, point.y] }
  }

  private extendDrag(e: PointerEvent): void {
    const drag = this.drag
    if (!drag) return
    drag.current = this.toImagePoint(e)

    if (drag.mode === 'move') {
      this.annotations[drag.index] = translateAnnotation(
        drag.origin,
        drag.current.x - drag.start.x,
        drag.current.y - drag.start.y
      )
    } else if (drag.mode === 'crop') {
      this.crop = this.cropFromDrag(drag)
    } else if (this.tool === 'pen') {
      this.appendPenPoint(drag)
    }
    this.redraw()
  }

  private endDrag(e: PointerEvent): void {
    const drag = this.drag
    if (!drag) return
    drag.current = this.toImagePoint(e)
    this.drag = null

    if (drag.mode === 'move') {
      this.annotations[drag.index] = translateAnnotation(
        drag.origin,
        drag.current.x - drag.start.x,
        drag.current.y - drag.start.y
      )
      this.afterMutation()
      return
    }

    if (drag.mode === 'crop') {
      const next = this.cropFromDrag(drag)
      // A mis-drag restores whatever the crop was, rather than cropping to a sliver.
      this.crop =
        next && next.w >= MIN_CROP * this.scale && next.h >= MIN_CROP * this.scale
          ? next
          : drag.origin
      this.afterMutation()
      return
    }

    if (drag.mode === 'draw' && this.tool === 'pen') this.appendPenPoint(drag)
    const mark = this.buildMark(drag)
    if (mark) {
      this.pushHistory()
      this.annotations.push(mark)
    }
    this.afterMutation()
  }

  private imageSize(): { w: number; h: number } {
    return { w: this.canvas?.width ?? 0, h: this.canvas?.height ?? 0 }
  }

  /** Which part of the existing crop the pointer grabbed, if any. */
  private cropHandleAt(p: Point): CropHandle {
    const crop = this.crop
    if (!crop) return 'new'
    const grab = HANDLE * this.scale
    const near = (x: number, y: number) => Math.abs(p.x - x) <= grab && Math.abs(p.y - y) <= grab
    if (near(crop.x, crop.y)) return 'nw'
    if (near(crop.x + crop.w, crop.y)) return 'ne'
    if (near(crop.x, crop.y + crop.h)) return 'sw'
    if (near(crop.x + crop.w, crop.y + crop.h)) return 'se'
    if (
      p.x >= crop.x &&
      p.x <= crop.x + crop.w &&
      p.y >= crop.y &&
      p.y <= crop.y + crop.h
    ) {
      return 'move'
    }
    return 'new'
  }

  /** The crop a drag describes, always clamped inside the bitmap. */
  private cropFromDrag(drag: Extract<Drag, { mode: 'crop' }>): CropRect | null {
    const size = this.imageSize()
    const origin = drag.origin
    const dx = drag.current.x - drag.start.x
    const dy = drag.current.y - drag.start.y

    if (drag.handle === 'new' || !origin) {
      const r = normaliseRect(drag.start, drag.current)
      return clampCrop(r, size)
    }

    if (drag.handle === 'move') {
      const w = origin.w
      const h = origin.h
      return {
        x: Math.round(Math.max(0, Math.min(origin.x + dx, size.w - w))),
        y: Math.round(Math.max(0, Math.min(origin.y + dy, size.h - h))),
        w,
        h,
      }
    }

    // A corner drag moves that corner and leaves the opposite one anchored.
    const left = drag.handle === 'nw' || drag.handle === 'sw' ? origin.x + dx : origin.x
    const top = drag.handle === 'nw' || drag.handle === 'ne' ? origin.y + dy : origin.y
    const right = drag.handle === 'ne' || drag.handle === 'se' ? origin.x + origin.w + dx : origin.x + origin.w
    const bottom =
      drag.handle === 'sw' || drag.handle === 'se' ? origin.y + origin.h + dy : origin.y + origin.h

    return clampCrop(normaliseRect({ x: left, y: top }, { x: right, y: bottom }), size)
  }

  protected textSizeInImagePixels(): number {
    return Math.max(1, Math.round(this.textSize * this.scale))
  }

  /**
   * The label editor: a textarea in the shadow root, positioned over the canvas
   * and sized so the on-screen type matches what will be baked into the export.
   *
   * Every typographic property is set explicitly. A host page's `body {
   * font-family }` must never reach it — the widget runs on sites whose type
   * choices vary wildly, and an inherited face would make the label disagree
   * with the canvas, which sets `ctx.font` itself.
   */
  private openTextInput(at: Point, index: number | null): void {
    const wrap = this.container?.querySelector<HTMLElement>('.pulse-annotation__canvas-wrap')
    const canvas = this.canvas
    if (!wrap || !canvas) return

    const existing = index === null ? null : this.annotations[index]
    const mark = existing && existing.kind === 'text' ? existing : null
    if (mark) {
      this.color = mark.color
      // Re-editing keeps the label's own size rather than snapping to the toolbar.
      this.textSize = Math.max(1, Math.round(mark.fontSize / this.scale))
    }

    const fontSize = mark ? mark.fontSize : this.textSizeInImagePixels()
    const origin = mark ? { x: mark.x, y: mark.y } : at

    this.pendingTextOrigin = origin

    const input = document.createElement('textarea')
    input.className = 'pulse-annotation__text-input'
    input.rows = 1
    input.spellcheck = false
    input.value = mark?.text ?? ''
    input.setAttribute('aria-label', 'Annotation label')
    // CSS pixels, from image pixels: the canvas is the same box, scaled down.
    input.style.left = `${origin.x / this.scale}px`
    input.style.top = `${origin.y / this.scale}px`
    input.style.fontFamily = ANNOTATION_FONT_STACK
    input.style.fontSize = `${fontSize / this.scale}px`
    input.style.lineHeight = String(LINE_HEIGHT)
    input.style.color = mark ? mark.color : this.color
    input.addEventListener('input', () => autoGrow(input))

    wrap.appendChild(input)
    this.textInput = input
    this.editingIndex = index
    autoGrow(input)
    input.focus()
    // Placing the caret at the end reads better than selecting the whole label.
    input.setSelectionRange(input.value.length, input.value.length)

    this.selected = null
    this.redraw()
    this.syncToolbarState()
  }

  /**
   * Writes the typed label back. An empty label is not a mark: placing one and
   * typing nothing leaves nothing behind, and emptying an existing one deletes it.
   */
  private commitText(): void {
    const input = this.textInput
    if (!input) return
    const index = this.editingIndex
    const text = input.value.replace(/\s+$/, '')

    input.remove()
    this.textInput = null
    this.editingIndex = null

    const previous = index === null ? null : this.annotations[index]
    const wasText = previous && previous.kind === 'text' ? previous : null

    if (text.length === 0) {
      if (index !== null && wasText) {
        this.pushHistory()
        this.annotations.splice(index, 1)
      }
      this.afterMutation()
      return
    }
    if (wasText && wasText.text === text) {
      this.afterMutation()
      return
    }

    this.pushHistory()
    const placed: ScreenshotAnnotation = {
      kind: 'text',
      x: Math.round(wasText ? wasText.x : this.pendingTextOrigin.x),
      y: Math.round(wasText ? wasText.y : this.pendingTextOrigin.y),
      text,
      color: this.color,
      fontSize: wasText ? wasText.fontSize : this.textSizeInImagePixels(),
    }
    if (index !== null && wasText) this.annotations[index] = placed
    else this.annotations.push(placed)
    this.afterMutation()
  }

  /** Re-opens the label under a double-click, so a typo is fixable in place. */
  private editTextUnder(e: MouseEvent): void {
    if (this.textInput) return
    this.measureScale()
    const point = this.toImagePoint(e as unknown as PointerEvent)
    const index = hitTest(this.annotations, point, HIT_TOLERANCE * this.scale, this.ctx ?? undefined)
    if (index === null || this.annotations[index].kind !== 'text') return
    this.openTextInput(point, index)
  }

  /** Samples the pointer path, dropping steps too small for anyone to see. */
  private appendPenPoint(drag: Extract<Drag, { mode: 'draw' }>): void {
    const lastX = drag.points[drag.points.length - 2]
    const lastY = drag.points[drag.points.length - 1]
    const step = MIN_PEN_STEP * this.scale
    if (Math.hypot(drag.current.x - lastX, drag.current.y - lastY) < step) return
    drag.points.push(drag.current.x, drag.current.y)
  }

  /** Stroke widths are stored in image pixels, so a 2x capture gets a 2x stroke. */
  protected strokeInImagePixels(): number {
    return Math.max(1, Math.round(this.stroke * this.scale))
  }

  /** The mark a completed drag produces, or null when the drag was a stray click. */
  protected buildMark(drag: Extract<Drag, { mode: 'draw' }>): ScreenshotAnnotation | null {
    const { start, current: end } = drag
    const style = { color: this.color, strokeWidth: this.strokeInImagePixels() }

    switch (this.tool) {
      case 'select':
      case 'text':
        return null
      case 'arrow': {
        if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_ARROW * this.scale) return null
        return {
          kind: 'arrow',
          x1: Math.round(start.x),
          y1: Math.round(start.y),
          x2: Math.round(end.x),
          y2: Math.round(end.y),
          ...style,
        }
      }
      case 'pen': {
        if (drag.points.length < 4) return null
        return { kind: 'pen', points: drag.points.map((v) => Math.round(v)), ...style }
      }
      default: {
        const rect = normaliseRect(start, end)
        if (rect.w < MIN_RECT || rect.h < MIN_RECT) return null
        if (this.tool === 'highlight') return { kind: 'highlight', ...rect }
        if (this.tool === 'hide') return { kind: 'hide', ...rect }
        if (this.tool === 'rect') return { kind: 'rect', ...rect, ...style }
        return { kind: 'ellipse', ...rect, ...style }
      }
    }
  }

  /**
   * The mark shown mid-drag. Unlike the committed mark it is never rejected for
   * being small — a preview that blinks out below a threshold reads as a bug.
   */
  protected previewMark(drag: Extract<Drag, { mode: 'draw' }>): ScreenshotAnnotation | null {
    const built = this.buildMark(drag)
    if (built) return built
    const { start, current: end } = drag
    const style = { color: this.color, strokeWidth: this.strokeInImagePixels() }
    if (this.tool === 'arrow') {
      return {
        kind: 'arrow',
        x1: Math.round(start.x),
        y1: Math.round(start.y),
        x2: Math.round(end.x),
        y2: Math.round(end.y),
        ...style,
      }
    }
    if (this.tool === 'pen' && drag.points.length >= 2) {
      return { kind: 'pen', points: drag.points.map((v) => Math.round(v)), ...style }
    }
    return null
  }

  // -- Rendering ----------------------------------------------------------

  protected redraw(): void {
    const canvas = this.canvas
    const ctx = this.ctx
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const drag = this.drag
    const pending = drag && drag.mode === 'draw' ? this.previewMark(drag) : null
    // The label being typed lives in the textarea; painting it too would double it.
    const committed =
      this.editingIndex === null
        ? this.annotations
        : this.annotations.filter((_, i) => i !== this.editingIndex)

    paintAnnotations(ctx, pending ? [...committed, pending] : committed, canvas)
    this.paintChrome(ctx)
  }

  /** Editor-only decoration: never part of the export. */
  protected paintChrome(ctx: CanvasRenderingContext2D): void {
    this.paintCropChrome(ctx)
    if (this.selected === null) return
    const mark = this.annotations[this.selected]
    if (!mark) return
    const b = annotationBounds(mark, ctx)
    const pad = 4 * this.scale
    ctx.save()
    ctx.strokeStyle = '#5e6ad2'
    ctx.lineWidth = Math.max(1.5 * this.scale, 1)
    ctx.setLineDash([6 * this.scale, 4 * this.scale])
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2)
    ctx.restore()
  }

  /**
   * The crop, shown as everything outside it dimmed plus corner handles. Drawn
   * on the overlay canvas only — the export cuts the bitmap instead.
   */
  private paintCropChrome(ctx: CanvasRenderingContext2D): void {
    const crop = this.crop
    const size = this.imageSize()
    if (!crop) return

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, size.w, size.h)
    ctx.rect(crop.x, crop.y, crop.w, crop.h)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fill('evenodd')
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1.5 * this.scale, 1)
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h)

    const h = HANDLE * this.scale
    ctx.fillStyle = '#ffffff'
    for (const [cx, cy] of [
      [crop.x, crop.y],
      [crop.x + crop.w, crop.y],
      [crop.x, crop.y + crop.h],
      [crop.x + crop.w, crop.y + crop.h],
    ]) {
      ctx.fillRect(cx - h / 2, cy - h / 2, h, h)
    }
    ctx.restore()
  }

  // -- Export -------------------------------------------------------------

  private cancel(): void {
    this.hide()
    this.config.onCancel()
  }

  private async save(): Promise<void> {
    // Saving with a label still being typed must keep it.
    this.commitText()
    const state = this.getState()
    const region = this.exportRegion()
    // What the admin renders must match the exported PNG, so persisted marks are
    // in the CROPPED image's space; `state` keeps the originals for a re-edit.
    const exported = this.annotations.map((a) => translateAnnotation(a, -region.x, -region.y))
    const blob = await this.exportImage()
    this.hide()
    if (blob) this.config.onSave(blob, exported, state)
    else this.config.onCancel()
  }

  protected exportRegion(): CropRect {
    const image = this.image
    if (this.crop) return this.crop
    return { x: 0, y: 0, w: image?.naturalWidth ?? 0, h: image?.naturalHeight ?? 0 }
  }

  /** Flattens the marks onto the untouched bitmap at its native resolution. */
  private async exportImage(): Promise<Blob | null> {
    const image = this.image
    if (!image) return null
    const region = this.exportRegion()
    const out = document.createElement('canvas')
    out.width = region.w
    out.height = region.h
    const ctx = out.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(image, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h)
    // Marks stay in ORIGINAL image coordinates; the translate is what applies
    // the crop, so a crop never has to rewrite any annotation.
    ctx.save()
    ctx.translate(-region.x, -region.y)
    paintAnnotations(ctx, this.annotations, {
      x: region.x,
      y: region.y,
      width: region.w,
      height: region.h,
    })
    ctx.restore()

    return new Promise<Blob | null>((resolve) => {
      out.toBlob((blob) => resolve(blob), 'image/png')
    })
  }
}

export function createAnnotationEditor(
  shadowRoot: ShadowRoot,
  config: AnnotationEditorConfig,
  theme: 'light' | 'dark' = 'light'
): AnnotationEditor {
  return new AnnotationEditor(shadowRoot, config, theme)
}

// -- Helpers ---------------------------------------------------------------

export const EDITOR_ICONS = {
  select: 'M3 2.5l9.5 5-4 1.2-1.2 4L3 2.5Z',
  arrow: 'M3 13L12.5 3.5M12.5 3.5H7M12.5 3.5V9',
  rect: 'M2.5 4h11v8h-11z',
  ellipse: 'M8 3.2c3 0 5.3 2.1 5.3 4.8S11 12.8 8 12.8 2.7 10.7 2.7 8 5 3.2 8 3.2Z',
  pen: 'M11.5 2.5a1.5 1.5 0 0 1 2 2L6 12l-3 1 1-3 7.5-7.5Z',
  text: 'M3 4V3h10v1M8 3v10M6 13h4',
  crop: 'M4.5 1.5v10h10M1.5 4.5h10v10',
  cropReset: ['M4.5 1.5v10h10M1.5 4.5h10v10', 'M2 14L14 2'],
  highlight: ['M2 2.5h12v11H2z', 'M5.5 6h5v4h-5z'],
  hide: 'M2.5 4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4Z',
  undo: 'M6 4.5L3 7.5l3 3M3 7.5h6.5a3.5 3.5 0 0 1 0 7H7',
  redo: 'M10 4.5l3 3-3 3M13 7.5H6.5a3.5 3.5 0 0 0 0 7H9',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8',
  clear: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
} as const

/** Keeps the textarea exactly as tall as its content, so it never scrolls. */
function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = 'auto'
  input.style.height = `${input.scrollHeight}px`
  // Widen with the longest line rather than wrapping at an arbitrary width.
  const longest = input.value.split('\n').reduce((n, l) => Math.max(n, l.length), 0)
  input.style.width = `${Math.max(longest + 1, 8)}ch`
}

/** A filled circle sized to the stroke it selects, so the buttons read at a glance. */
function dot(width: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  const circle = document.createElementNS(NS, 'circle')
  circle.setAttribute('cx', '8')
  circle.setAttribute('cy', '8')
  circle.setAttribute('r', String(1.5 + width * 0.6))
  circle.setAttribute('fill', 'currentColor')
  svg.appendChild(circle)
  return svg
}

function cloneAnnotation<T extends ScreenshotAnnotation>(a: T): T {
  return a.kind === 'pen' ? { ...a, points: [...a.points] } : { ...a }
}

/** Keeps a crop inside the bitmap; a region outside it would export blank pixels. */
function clampCrop(r: AnnotationRect, size: { w: number; h: number }): CropRect {
  const x = Math.max(0, Math.min(r.x, size.w))
  const y = Math.max(0, Math.min(r.y, size.h))
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(Math.min(r.w, size.w - x)),
    h: Math.round(Math.min(r.h, size.h - y)),
  }
}

function setHidden(toolbar: HTMLElement, selector: string, hidden: boolean): void {
  const el = toolbar.querySelector<HTMLElement>(selector)
  if (el) el.hidden = hidden
}

function setDisabled(toolbar: HTMLElement, action: string, disabled: boolean): void {
  const btn = toolbar.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
  if (btn) btn.disabled = disabled
}

export function toolButton(
  iconPath: string | readonly string[],
  label: string
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = 'pulse-annotation__tool-btn'
  btn.type = 'button'
  btn.title = label
  btn.setAttribute('aria-label', label)
  btn.appendChild(icon(iconPath))
  return btn
}

export function divider(): HTMLElement {
  const div = document.createElement('div')
  div.className = 'pulse-annotation__divider'
  return div
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load screenshot'))
    }
    img.src = url
  })
}
