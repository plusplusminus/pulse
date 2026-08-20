import type { AnnotationKind, ScreenshotAnnotation } from '../types'

/** Export/preview appearance, shared so the editor is WYSIWYG. */
const HIGHLIGHT_STROKE = '#5e6ad2'
const HIGHLIGHT_WIDTH = 3
const DIM_FILL = 'rgba(0, 0, 0, 0.45)'
const HIDE_FILL = '#000000'
/** Rects smaller than this (in image pixels) are treated as a stray click. */
const MIN_RECT = 4

export interface Point {
  x: number
  y: number
}

export function normaliseRect(a: Point, b: Point, kind: AnnotationKind): ScreenshotAnnotation {
  return {
    kind,
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    w: Math.round(Math.abs(b.x - a.x)),
    h: Math.round(Math.abs(b.y - a.y)),
  }
}

/**
 * Paints the annotation layer at the bitmap's native resolution. Highlights dim
 * everything outside them (one even-odd fill for the whole set) and get a 3 px
 * outline; hides are solid fills. Used for both the live preview and the export,
 * so what the user sees is what ships.
 */
export function paintAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: readonly ScreenshotAnnotation[],
  size: { width: number; height: number }
): void {
  const highlights = annotations.filter((a) => a.kind === 'highlight')

  if (highlights.length > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, size.width, size.height)
    for (const r of highlights) ctx.rect(r.x, r.y, r.w, r.h)
    ctx.fillStyle = DIM_FILL
    ctx.fill('evenodd')
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = HIGHLIGHT_STROKE
    ctx.lineWidth = HIGHLIGHT_WIDTH
    for (const r of highlights) {
      ctx.strokeRect(r.x, r.y, r.w, r.h)
    }
    ctx.restore()
  }

  ctx.save()
  ctx.fillStyle = HIDE_FILL
  for (const r of annotations) {
    if (r.kind === 'hide') ctx.fillRect(r.x, r.y, r.w, r.h)
  }
  ctx.restore()
}

const TOOLS: Array<{ kind: AnnotationKind; label: string; icon: string }> = [
  { kind: 'highlight', label: 'Highlight', icon: 'M3 3h14v14H3zM7 7h6v6H7z' },
  { kind: 'hide', label: 'Hide', icon: 'M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z' },
]

/**
 * Screenshot annotation overlay. The captured bitmap is never resampled: both
 * canvases are sized to its natural pixels and scaled down with CSS only, so the
 * exported PNG matches the capture exactly and rects stay valid across resizes.
 */
export class AnnotationCanvas {
  private container: HTMLElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private bgCanvas: HTMLCanvasElement | null = null
  private annotations: ScreenshotAnnotation[] = []
  private tool: AnnotationKind = 'highlight'
  private start: Point | null = null
  private current: Point | null = null
  private image: HTMLImageElement | null = null

  private onPointerDown = (e: PointerEvent) => this.beginRect(e)
  private onPointerMove = (e: PointerEvent) => this.extendRect(e)
  private onPointerUp = (e: PointerEvent) => this.endRect(e)

  constructor(
    private shadowRoot: ShadowRoot,
    private config: {
      onSave: (blob: Blob, annotations: ScreenshotAnnotation[]) => void
      onCancel: () => void
    }
  ) {}

  async show(screenshotBlob: Blob, existing: ScreenshotAnnotation[] = []): Promise<void> {
    this.annotations = existing.map((a) => ({ ...a }))
    this.image = await loadImage(screenshotBlob)
    const width = this.image.naturalWidth
    const height = this.image.naturalHeight

    this.container = document.createElement('div')
    this.container.className = 'pulse-annotation'
    this.container.appendChild(this.renderToolbar())

    const wrap = document.createElement('div')
    wrap.className = 'pulse-annotation__canvas-wrap'
    // CSS-only downscale: intrinsic ratio keeps the two canvases aligned.
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
    this.redraw()
  }

  hide(): void {
    this.cleanup()
  }

  destroy(): void {
    this.cleanup()
  }

  getAnnotations(): ScreenshotAnnotation[] {
    return this.annotations.map((a) => ({ ...a }))
  }

  private cleanup(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onPointerDown)
      this.canvas.removeEventListener('pointermove', this.onPointerMove)
      this.canvas.removeEventListener('pointerup', this.onPointerUp)
      this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    }
    this.container?.remove()
    this.container = null
    this.canvas = null
    this.ctx = null
    this.bgCanvas = null
    this.image = null
    this.annotations = []
    this.start = null
    this.current = null
  }

  private renderToolbar(): HTMLElement {
    const toolbar = document.createElement('div')
    toolbar.className = 'pulse-annotation__toolbar'

    for (const t of TOOLS) {
      const btn = toolButton(t.icon, t.label)
      btn.dataset.tool = t.kind
      btn.addEventListener('click', () => {
        this.tool = t.kind
        this.applyToolState(toolbar)
      })
      toolbar.appendChild(btn)
    }

    toolbar.appendChild(divider())

    const undoBtn = toolButton('M3 10h7a4 4 0 0 1 0 8H7', 'Undo')
    undoBtn.addEventListener('click', () => this.undo())
    toolbar.appendChild(undoBtn)

    const clearBtn = toolButton('M4 4l12 12M16 4L4 16', 'Clear')
    clearBtn.addEventListener('click', () => this.clearAll())
    toolbar.appendChild(clearBtn)

    toolbar.appendChild(divider())

    const cancel = document.createElement('button')
    cancel.className = 'pulse-annotation__action-btn'
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => {
      this.hide()
      this.config.onCancel()
    })
    toolbar.appendChild(cancel)

    const save = document.createElement('button')
    save.className = 'pulse-annotation__action-btn pulse-annotation__action-btn--primary'
    save.type = 'button'
    save.textContent = 'Save'
    save.addEventListener('click', () => void this.save())
    toolbar.appendChild(save)

    this.applyToolState(toolbar)
    return toolbar
  }

  private applyToolState(toolbar: HTMLElement): void {
    for (const btn of toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const active = btn.dataset.tool === this.tool
      btn.classList.toggle('pulse-annotation__tool-btn--active', active)
      btn.setAttribute('aria-pressed', String(active))
    }
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

  private beginRect(e: PointerEvent): void {
    this.canvas?.setPointerCapture(e.pointerId)
    this.start = this.toImagePoint(e)
    this.current = this.start
  }

  private extendRect(e: PointerEvent): void {
    if (!this.start) return
    this.current = this.toImagePoint(e)
    this.redraw()
  }

  private endRect(e: PointerEvent): void {
    if (!this.start) return
    const end = this.toImagePoint(e)
    const rect = normaliseRect(this.start, end, this.tool)
    this.start = null
    this.current = null
    if (rect.w >= MIN_RECT && rect.h >= MIN_RECT) this.annotations.push(rect)
    this.redraw()
  }

  private undo(): void {
    this.annotations.pop()
    this.redraw()
  }

  private clearAll(): void {
    this.annotations = []
    this.redraw()
  }

  private redraw(): void {
    const canvas = this.canvas
    const ctx = this.ctx
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const pending =
      this.start && this.current ? [normaliseRect(this.start, this.current, this.tool)] : []
    paintAnnotations(ctx, [...this.annotations, ...pending], canvas)
  }

  private async save(): Promise<void> {
    const annotations = this.getAnnotations()
    const blob = await this.exportImage()
    this.hide()
    if (blob) this.config.onSave(blob, annotations)
    else this.config.onCancel()
  }

  /** Flattens the rects onto the untouched bitmap at its native resolution. */
  private async exportImage(): Promise<Blob | null> {
    const image = this.image
    if (!image) return null
    const out = document.createElement('canvas')
    out.width = image.naturalWidth
    out.height = image.naturalHeight
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image, 0, 0)
    paintAnnotations(ctx, this.annotations, out)
    return new Promise<Blob | null>((resolve) => {
      out.toBlob((blob) => resolve(blob), 'image/png')
    })
  }
}

function toolButton(iconPath: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = 'pulse-annotation__tool-btn'
  btn.type = 'button'
  btn.title = label
  btn.setAttribute('aria-label', label)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('fill', 'none')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', iconPath)
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  btn.appendChild(svg)
  return btn
}

function divider(): HTMLElement {
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
