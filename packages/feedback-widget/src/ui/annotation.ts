export type AnnotationTool = 'draw' | 'highlight' | 'redact'

interface DrawAnnotation {
  tool: 'draw'
  points: Array<{ x: number; y: number }>
}

interface RectAnnotation {
  tool: 'highlight' | 'redact'
  rect: { x: number; y: number; width: number; height: number }
}

type Annotation = DrawAnnotation | RectAnnotation

const MAX_CANVAS_WIDTH = 600

export class AnnotationCanvas {
  private container: HTMLElement | null = null
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private bgCanvas!: HTMLCanvasElement
  private bgCtx!: CanvasRenderingContext2D
  private annotations: Annotation[] = []
  private currentTool: AnnotationTool = 'draw'
  private isDrawing = false
  private currentDrawPoints: Array<{ x: number; y: number }> = []
  private startPoint: { x: number; y: number } | null = null
  private lastPoint: { x: number; y: number } | null = null
  private image: HTMLImageElement | null = null

  private boundMouseDown = (e: MouseEvent) => this.startDraw(e)
  private boundMouseMove = (e: MouseEvent) => this.continueDraw(e)
  private boundMouseUp = () => this.endDraw()

  constructor(
    private _shadowRoot: ShadowRoot,
    private config: {
      onSave: (blob: Blob) => void
      onCancel: () => void
    }
  ) {}

  async show(screenshotBlob: Blob): Promise<void> {
    this.annotations = []
    this.image = await this.loadImage(screenshotBlob)

    const scale = Math.min(1, MAX_CANVAS_WIDTH / this.image.naturalWidth)
    const width = Math.round(this.image.naturalWidth * scale)
    const height = Math.round(this.image.naturalHeight * scale)

    this.container = document.createElement('div')
    this.container.className = 'pulse-annotation'

    const toolbar = this.renderToolbar()
    this.container.appendChild(toolbar)

    const canvasWrap = document.createElement('div')
    canvasWrap.className = 'pulse-annotation__canvas-wrap'

    this.bgCanvas = document.createElement('canvas')
    this.bgCanvas.width = width
    this.bgCanvas.height = height
    this.bgCtx = this.bgCanvas.getContext('2d')!
    this.bgCtx.drawImage(this.image, 0, 0, width, height)
    canvasWrap.appendChild(this.bgCanvas)

    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    this.ctx = this.canvas.getContext('2d')!
    canvasWrap.appendChild(this.canvas)

    this.canvas.addEventListener('mousedown', this.boundMouseDown)
    this.canvas.addEventListener('mousemove', this.boundMouseMove)
    this.canvas.addEventListener('mouseup', this.boundMouseUp)

    this.container.appendChild(canvasWrap)
    this._shadowRoot.appendChild(this.container)
  }

  hide(): void {
    this.cleanup()
  }

  destroy(): void {
    this.cleanup()
  }

  private cleanup(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('mousedown', this.boundMouseDown)
      this.canvas.removeEventListener('mousemove', this.boundMouseMove)
      this.canvas.removeEventListener('mouseup', this.boundMouseUp)
    }
    this.container?.remove()
    this.container = null
    this.image = null
    this.annotations = []
  }

  private renderToolbar(): HTMLElement {
    const toolbar = document.createElement('div')
    toolbar.className = 'pulse-annotation__toolbar'

    const tools: Array<{ tool: AnnotationTool; label: string; icon: string }> = [
      { tool: 'draw', label: 'Draw', icon: 'M3 13.5l8.5-8.5a1.5 1.5 0 0 1 2 0l1.5 1.5a1.5 1.5 0 0 1 0 2L6.5 17H3v-3.5Z' },
      { tool: 'highlight', label: 'Highlight', icon: 'M3 3h10v10H3zM7 13v3M13 7h3' },
      { tool: 'redact', label: 'Redact', icon: 'M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z' },
    ]

    for (const t of tools) {
      const btn = this.createToolButton(
        t.icon,
        t.label,
        `pulse-annotation__tool-btn${this.currentTool === t.tool ? ' pulse-annotation__tool-btn--active' : ''}`
      )
      btn.addEventListener('click', () => {
        this.currentTool = t.tool
        this.refreshToolbar(toolbar, tools)
      })
      toolbar.appendChild(btn)
    }

    toolbar.appendChild(this.createDivider())

    const undoBtn = this.createToolButton('M3 10h7a4 4 0 0 1 0 8H7', 'Undo', 'pulse-annotation__tool-btn')
    undoBtn.addEventListener('click', () => this.undo())
    toolbar.appendChild(undoBtn)

    const clearBtn = this.createToolButton('M4 4l12 12M16 4L4 16', 'Clear', 'pulse-annotation__tool-btn')
    clearBtn.addEventListener('click', () => this.clearAll())
    toolbar.appendChild(clearBtn)

    toolbar.appendChild(this.createDivider())

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'pulse-annotation__action-btn'
    cancelBtn.type = 'button'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', () => {
      this.hide()
      this.config.onCancel()
    })
    toolbar.appendChild(cancelBtn)

    const saveBtn = document.createElement('button')
    saveBtn.className = 'pulse-annotation__action-btn pulse-annotation__action-btn--primary'
    saveBtn.type = 'button'
    saveBtn.textContent = 'Save'
    saveBtn.addEventListener('click', async () => {
      const blob = await this.exportImage()
      this.hide()
      this.config.onSave(blob)
    })
    toolbar.appendChild(saveBtn)

    return toolbar
  }

  private refreshToolbar(
    toolbar: HTMLElement,
    tools: Array<{ tool: AnnotationTool; label: string; icon: string }>
  ): void {
    const btns = toolbar.querySelectorAll('.pulse-annotation__tool-btn')
    tools.forEach((t, i) => {
      const btn = btns[i]
      if (btn) {
        if (this.currentTool === t.tool) {
          btn.classList.add('pulse-annotation__tool-btn--active')
        } else {
          btn.classList.remove('pulse-annotation__tool-btn--active')
        }
      }
    })
  }

  private createToolButton(iconPath: string, label: string, className: string): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = className
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

  private createDivider(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'pulse-annotation__divider'
    return div
  }

  private getCanvasPoint(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  private startDraw(e: MouseEvent): void {
    this.isDrawing = true
    const point = this.getCanvasPoint(e)
    this.startPoint = point
    this.lastPoint = point

    if (this.currentTool === 'draw') {
      this.currentDrawPoints = [point]
    }
  }

  private continueDraw(e: MouseEvent): void {
    if (!this.isDrawing || !this.startPoint) return
    const point = this.getCanvasPoint(e)
    this.lastPoint = point

    if (this.currentTool === 'draw') {
      this.currentDrawPoints.push(point)
      this.redraw()
      this.drawFreehand(this.currentDrawPoints)
    } else {
      this.redraw()
      const rect = this.makeRect(this.startPoint, point)
      this.drawRect(rect, this.currentTool)
    }
  }

  private endDraw(): void {
    if (!this.isDrawing || !this.startPoint) return
    this.isDrawing = false

    if (this.currentTool === 'draw') {
      if (this.currentDrawPoints.length > 1) {
        this.annotations.push({ tool: 'draw', points: [...this.currentDrawPoints] })
      }
    } else if (this.lastPoint) {
      const rect = this.makeRect(this.startPoint, this.lastPoint)
      if (rect.width > 2 && rect.height > 2) {
        this.annotations.push({ tool: this.currentTool, rect })
      }
    }

    this.currentDrawPoints = []
    this.startPoint = null
    this.lastPoint = null
    this.redraw()
  }

  private makeRect(a: { x: number; y: number }, b: { x: number; y: number }) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    }
  }

  private drawFreehand(points: Array<{ x: number; y: number }>): void {
    if (points.length < 2) return
    this.ctx.beginPath()
    this.ctx.strokeStyle = '#FF0000'
    this.ctx.lineWidth = 3
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'
    this.ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y)
    }
    this.ctx.stroke()
  }

  private drawRect(rect: { x: number; y: number; width: number; height: number }, tool: 'highlight' | 'redact'): void {
    if (tool === 'highlight') {
      this.ctx.fillStyle = 'rgba(255, 255, 0, 0.3)'
    } else {
      this.ctx.fillStyle = '#000000'
    }
    this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  }

  private redraw(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    for (const ann of this.annotations) {
      if (ann.tool === 'draw') {
        this.drawFreehand(ann.points)
      } else {
        this.drawRect(ann.rect, ann.tool)
      }
    }
  }

  private undo(): void {
    this.annotations.pop()
    this.redraw()
  }

  private clearAll(): void {
    this.annotations = []
    this.redraw()
  }

  private async exportImage(): Promise<Blob> {
    const offscreen = document.createElement('canvas')
    offscreen.width = this.bgCanvas.width
    offscreen.height = this.bgCanvas.height
    const offCtx = offscreen.getContext('2d')!
    offCtx.drawImage(this.bgCanvas, 0, 0)
    offCtx.drawImage(this.canvas, 0, 0)

    return new Promise<Blob>((resolve, reject) => {
      offscreen.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to export annotated image'))
      }, 'image/png')
    })
  }

  private loadImage(blob: Blob): Promise<HTMLImageElement> {
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
}
