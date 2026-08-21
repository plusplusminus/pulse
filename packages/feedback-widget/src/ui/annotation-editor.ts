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

export type EditorTool = 'select' | AnnotationKind

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

type Drag =
  | { mode: 'draw'; start: Point; current: Point }
  | { mode: 'move'; start: Point; current: Point; index: number; origin: ScreenshotAnnotation }

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

  private tool: EditorTool = 'highlight'
  private color: AnnotationColor = ANNOTATION_COLORS[0]
  /** Logical stroke width; multiplied by the capture's scale when a mark is made. */
  private stroke = 3
  private selected: number | null = null
  private drag: Drag | null = null
  /** image px per CSS px — a 2x capture draws 2x strokes so marks stay legible. */
  private scale = 1

  private onPointerDown = (e: PointerEvent) => this.beginDrag(e)
  private onPointerMove = (e: PointerEvent) => this.extendDrag(e)
  private onPointerUp = (e: PointerEvent) => this.endDrag(e)
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e)

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
    }
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
    toolbar.appendChild(this.renderHistoryControls())
    toolbar.appendChild(divider())
    toolbar.appendChild(this.renderActions())

    return toolbar
  }

  protected tools(): Array<{ id: EditorTool; label: string; icon: string | readonly string[] }> {
    return [
      { id: 'select', label: 'Select', icon: EDITOR_ICONS.select },
      { id: 'highlight', label: 'Highlight', icon: EDITOR_ICONS.highlight },
      { id: 'hide', label: 'Hide', icon: EDITOR_ICONS.hide },
    ]
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
    setDisabled(toolbar, 'undo', this.undoStack.length === 0)
    setDisabled(toolbar, 'redo', this.redoStack.length === 0)
    setDisabled(toolbar, 'delete', this.selected === null)
    setDisabled(toolbar, 'clear', this.annotations.length === 0 && !this.crop)
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
    this.canvas?.setPointerCapture(e.pointerId)
    this.measureScale()
    const point = this.toImagePoint(e)

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

    this.drag = { mode: 'draw', start: point, current: point }
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

    const mark = this.buildMark(drag.start, drag.current)
    if (mark) {
      this.pushHistory()
      this.annotations.push(mark)
    }
    this.afterMutation()
  }

  /** The mark a completed drag produces, or null when the drag was a stray click. */
  protected buildMark(start: Point, end: Point): ScreenshotAnnotation | null {
    if (this.tool === 'select') return null
    const rect = normaliseRect(start, end)
    if (rect.w < MIN_RECT || rect.h < MIN_RECT) return null
    if (this.tool === 'highlight') return { kind: 'highlight', ...rect }
    if (this.tool === 'hide') return { kind: 'hide', ...rect }
    return null
  }

  /** The mark shown mid-drag, before it is committed. */
  protected previewMark(start: Point, end: Point): ScreenshotAnnotation | null {
    return this.buildMark(start, end)
  }

  // -- Rendering ----------------------------------------------------------

  protected redraw(): void {
    const canvas = this.canvas
    const ctx = this.ctx
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const drag = this.drag
    const pending =
      drag && drag.mode === 'draw' ? this.previewMark(drag.start, drag.current) : null

    paintAnnotations(ctx, pending ? [...this.annotations, pending] : this.annotations, canvas)
    this.paintChrome(ctx)
  }

  /** Editor-only decoration: never part of the export. */
  protected paintChrome(ctx: CanvasRenderingContext2D): void {
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

  // -- Export -------------------------------------------------------------

  private cancel(): void {
    this.hide()
    this.config.onCancel()
  }

  private async save(): Promise<void> {
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
  highlight: ['M2 2.5h12v11H2z', 'M5.5 6h5v4h-5z'],
  hide: 'M2.5 4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4Z',
  undo: 'M6 4.5L3 7.5l3 3M3 7.5h6.5a3.5 3.5 0 0 1 0 7H7',
  redo: 'M10 4.5l3 3-3 3M13 7.5H6.5a3.5 3.5 0 0 0 0 7H9',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8',
  clear: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
} as const

function cloneAnnotation<T extends ScreenshotAnnotation>(a: T): T {
  return a.kind === 'pen' ? { ...a, points: [...a.points] } : { ...a }
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
