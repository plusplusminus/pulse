import { DRAG_THRESHOLD, dragRect, type DragRect, type Point } from './pick-mode'
import { clampRegion, isRegionTooSmall, viewportSize } from './region'
import { crosshairCursor } from '../ui/cursor'
import { RegionOverlay } from '../ui/region-overlay'

const DRAG_THRESHOLD_SQ = DRAG_THRESHOLD * DRAG_THRESHOLD

/** Sits above the fold so it never covers the region the reporter is framing. */
export const REGION_HINT = 'Drag to select a region — Esc to cancel'

export interface RegionEvents {
  /** A deliberate drag was released. The rect is viewport CSS pixels, clamped. */
  onSelect: (rect: DragRect) => void
  /** A click with no drag, or a drag too small to mean anything. */
  onCancel: () => void
}

/**
 * Framing a region before capture (PULSE-404).
 *
 * Deliberately NOT `ElementPicker` with a flag: every one of the picker's jobs
 * — hover outlines, element identification, text-selection preservation,
 * multi-select modifiers — is wrong here, and threading a mode flag through six
 * handlers to switch them all off is more code than this. What IS shared is
 * everything that would otherwise drift: the drag geometry (`dragRect`,
 * `DRAG_THRESHOLD`), the crosshair, the rectangle, and the stray-click
 * threshold.
 *
 * Escape is not handled here on purpose — the widget owns the one global
 * Escape handler and backs modes out in order.
 */
export class RegionSelector {
  private active = false
  private overlay: RegionOverlay | null = null
  private cursorStyle: HTMLStyleElement | null = null
  private downPoint: Point | null = null
  private dragging = false

  private onMouseDown = (e: MouseEvent) => this.handleMouseDown(e)
  private onMouseMove = (e: MouseEvent) => this.handleMouseMove(e)
  private onMouseUp = (e: MouseEvent) => this.handleMouseUp(e)
  private onClick = (e: MouseEvent) => this.swallow(e)

  constructor(
    private shadow: ShadowRoot,
    private host: HTMLElement,
    private events: RegionEvents
  ) {}

  get isActive(): boolean {
    return this.active
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.overlay = new RegionOverlay(this.shadow)
    this.overlay.show(REGION_HINT)
    this.cursorStyle = crosshairCursor()

    // Capture phase on document: the host page's own handlers never see any of
    // this, so framing a region cannot navigate away or open a modal.
    document.addEventListener('mousedown', this.onMouseDown, true)
    document.addEventListener('mousemove', this.onMouseMove, true)
    document.addEventListener('mouseup', this.onMouseUp, true)
    document.addEventListener('click', this.onClick, true)
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    document.removeEventListener('mousedown', this.onMouseDown, true)
    document.removeEventListener('mousemove', this.onMouseMove, true)
    document.removeEventListener('mouseup', this.onMouseUp, true)
    document.removeEventListener('click', this.onClick, true)
    this.overlay?.destroy()
    this.overlay = null
    this.cursorStyle?.remove()
    this.cursorStyle = null
    this.downPoint = null
    this.dragging = false
  }

  destroy(): void {
    this.stop()
  }

  /** Events from inside the widget's own shadow root are not part of the drag. */
  private isOwn(e: Event): boolean {
    return e.composedPath?.().includes(this.host) ?? false
  }

  private handleMouseDown(e: MouseEvent): void {
    if (this.isOwn(e)) return
    e.preventDefault()
    e.stopPropagation()
    this.downPoint = { x: e.clientX, y: e.clientY }
    this.dragging = false
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.downPoint || this.isOwn(e)) return
    e.preventDefault()
    e.stopPropagation()
    const point = { x: e.clientX, y: e.clientY }
    const dx = point.x - this.downPoint.x
    const dy = point.y - this.downPoint.y
    if (!this.dragging && dx * dx + dy * dy <= DRAG_THRESHOLD_SQ) return
    this.dragging = true
    this.overlay?.setRect(clampRegion(dragRect(this.downPoint, point), viewportSize()))
  }

  private handleMouseUp(e: MouseEvent): void {
    if (this.isOwn(e)) return
    e.preventDefault()
    e.stopPropagation()
    const start = this.downPoint
    this.downPoint = null
    const wasDragging = this.dragging
    this.dragging = false
    if (!start) return

    const rect = clampRegion(dragRect(start, { x: e.clientX, y: e.clientY }), viewportSize())
    // A click, or a twitch, means "I did not mean to do that" — never a
    // zero-size capture the reporter then has to notice and delete.
    if (!wasDragging || isRegionTooSmall(rect)) {
      this.events.onCancel()
      return
    }
    this.events.onSelect(rect)
  }

  /** The click that follows the drag would otherwise land on the host page. */
  private swallow(e: MouseEvent): void {
    if (this.isOwn(e)) return
    e.preventDefault()
    e.stopPropagation()
  }
}
