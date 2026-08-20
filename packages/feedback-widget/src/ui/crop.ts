/**
 * Full-page overlay that lets the user drag-select an area of the page.
 * Returns the selected bounding rect so the screenshot can be cropped to it.
 */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export class AreaSelector {
  private overlay: HTMLElement | null = null
  private selection: HTMLElement | null = null
  private isDragging = false
  private startX = 0
  private startY = 0
  private currentX = 0
  private currentY = 0
  private resolve: ((rect: CropRect | null) => void) | null = null

  private boundMouseDown = (e: MouseEvent) => this.onMouseDown(e)
  private boundMouseMove = (e: MouseEvent) => this.onMouseMove(e)
  private boundMouseUp = () => this.onMouseUp()
  private boundKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.cancel()
  }

  /**
   * Show the overlay and wait for user to select an area.
   * Returns the selected rect in viewport coordinates, or null if cancelled.
   */
  select(): Promise<CropRect | null> {
    return new Promise((resolve) => {
      this.resolve = resolve
      this.show()
    })
  }

  private show(): void {
    // Full-page overlay (rendered on the actual page, not in shadow DOM)
    this.overlay = document.createElement('div')
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      cursor: crosshair;
      background: rgba(0, 0, 0, 0.15);
    `

    // Instruction tooltip
    const tooltip = document.createElement('div')
    tooltip.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 8px 16px;
      border-radius: 8px;
      font: 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      pointer-events: none;
      z-index: 2147483647;
    `
    tooltip.textContent = 'Drag to select an area · Press Esc to cancel'
    this.overlay.appendChild(tooltip)

    // Selection rectangle (shown during drag)
    this.selection = document.createElement('div')
    this.selection.style.cssText = `
      position: fixed;
      border: 2px dashed #5e6ad2;
      background: rgba(94, 106, 210, 0.08);
      pointer-events: none;
      display: none;
      z-index: 2147483647;
    `
    this.overlay.appendChild(this.selection)

    this.overlay.addEventListener('mousedown', this.boundMouseDown)
    document.addEventListener('mousemove', this.boundMouseMove)
    document.addEventListener('mouseup', this.boundMouseUp)
    document.addEventListener('keydown', this.boundKeyDown)

    document.body.appendChild(this.overlay)
  }

  private onMouseDown(e: MouseEvent): void {
    e.preventDefault()
    this.isDragging = true
    this.startX = e.clientX
    this.startY = e.clientY
    this.currentX = e.clientX
    this.currentY = e.clientY
    if (this.selection) {
      this.selection.style.display = 'block'
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isDragging || !this.selection) return
    this.currentX = e.clientX
    this.currentY = e.clientY

    const rect = this.getRect()
    this.selection.style.left = `${rect.x}px`
    this.selection.style.top = `${rect.y}px`
    this.selection.style.width = `${rect.width}px`
    this.selection.style.height = `${rect.height}px`
  }

  private onMouseUp(): void {
    if (!this.isDragging) return
    this.isDragging = false

    const rect = this.getRect()
    this.cleanup()

    if (rect.width > 10 && rect.height > 10) {
      this.resolve?.(rect)
    } else {
      // Too small — treat as a click, cancel
      this.resolve?.(null)
    }
  }

  private cancel(): void {
    this.isDragging = false
    this.cleanup()
    this.resolve?.(null)
  }

  private getRect(): CropRect {
    return {
      x: Math.min(this.startX, this.currentX),
      y: Math.min(this.startY, this.currentY),
      width: Math.abs(this.currentX - this.startX),
      height: Math.abs(this.currentY - this.startY),
    }
  }

  private cleanup(): void {
    document.removeEventListener('mousemove', this.boundMouseMove)
    document.removeEventListener('mouseup', this.boundMouseUp)
    document.removeEventListener('keydown', this.boundKeyDown)
    this.overlay?.remove()
    this.overlay = null
    this.selection = null
  }
}
