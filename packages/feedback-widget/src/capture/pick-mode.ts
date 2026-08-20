import { deepElementFromPoint, identifyElement } from './element-pick'

/** Squared pixel distance after which a mousedown+move counts as a drag, not a click. */
export const DRAG_THRESHOLD = 8
const DRAG_THRESHOLD_SQ = DRAG_THRESHOLD * DRAG_THRESHOLD

/** mousedown is NOT preventDefault'd on these so the user can still select text before picking. */
export const TEXT_TAGS = new Set(['P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'CODE', 'MARK', 'LABEL', 'LI', 'BLOCKQUOTE'])

export function isTextTarget(el: Element | null): boolean {
  if (!el) return false
  if (TEXT_TAGS.has(el.tagName)) return true
  return (el as HTMLElement).isContentEditable === true
}

export interface Point {
  x: number
  y: number
}

export interface DragRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PickerEvents {
  /** A click (not a drag) landed on a host-page element. */
  onPick: (target: Element, point: Point, event: MouseEvent) => void
  /** Drag started (moved past the threshold) from `start`. */
  onDragStart?: (start: Point) => void
  onDragMove?: (rect: DragRect, event: MouseEvent) => void
  /** Drag released. The next click event is swallowed by the picker. */
  onDragEnd?: (rect: DragRect, event: MouseEvent) => void
  /** Meta/Ctrl+Shift became held during pick mode (multi-select armed). */
  onModifierEnter?: () => void
  /** Modifier-aware click while Meta/Ctrl+Shift are held (multi-select); return true to consume. */
  onModifierClick?: (target: Element, point: Point, event: MouseEvent) => boolean
  /** Either modifier went up after a multi-select interaction started. */
  onModifierRelease?: (event: KeyboardEvent) => void
}

export function dragRect(a: Point, b: Point): DragRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

export function isMultiSelectModifier(e: MouseEvent | KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey
}

/**
 * Pick mode on the host page. Listens in the capture phase on `document` so host
 * handlers never see the interaction, renders a pointer-events:none hover
 * overlay inside the widget's shadow root, and discriminates drags from clicks.
 */
export class ElementPicker {
  private active = false
  private paused = false
  private overlay: HTMLElement | null = null
  private label: HTMLElement | null = null
  private cursorStyle: HTMLStyleElement | null = null
  private hovered: Element | null = null
  private downPoint: Point | null = null
  private isDragging = false
  private justFinishedDrag = false
  private multiActive = false

  private onMouseMove = (e: MouseEvent) => this.handleMouseMove(e)
  private onMouseDown = (e: MouseEvent) => this.handleMouseDown(e)
  private onMouseUp = (e: MouseEvent) => this.handleMouseUp(e)
  private onClick = (e: MouseEvent) => this.handleClick(e)
  private onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e)
  private onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e)
  private onScroll = () => this.refreshOverlay()

  constructor(
    private shadow: ShadowRoot,
    private host: HTMLElement,
    private events: PickerEvents
  ) {}

  get isActive(): boolean {
    return this.active
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.paused = false
    this.overlay = document.createElement('div')
    this.overlay.className = 'pulse-pick-overlay'
    this.label = document.createElement('div')
    this.label.className = 'pulse-pick-label'
    this.overlay.appendChild(this.label)
    this.shadow.appendChild(this.overlay)

    this.cursorStyle = document.createElement('style')
    this.cursorStyle.setAttribute('data-pulse', 'pick-cursor')
    this.cursorStyle.textContent = 'html, html * { cursor: crosshair !important; }'
    document.head.appendChild(this.cursorStyle)

    document.addEventListener('mousemove', this.onMouseMove, true)
    document.addEventListener('mousedown', this.onMouseDown, true)
    document.addEventListener('mouseup', this.onMouseUp, true)
    document.addEventListener('click', this.onClick, true)
    document.addEventListener('keydown', this.onKeyDown, true)
    document.addEventListener('keyup', this.onKeyUp, true)
    window.addEventListener('scroll', this.onScroll, true)
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    document.removeEventListener('mousemove', this.onMouseMove, true)
    document.removeEventListener('mousedown', this.onMouseDown, true)
    document.removeEventListener('mouseup', this.onMouseUp, true)
    document.removeEventListener('click', this.onClick, true)
    document.removeEventListener('keydown', this.onKeyDown, true)
    document.removeEventListener('keyup', this.onKeyUp, true)
    window.removeEventListener('scroll', this.onScroll, true)
    this.overlay?.remove()
    this.overlay = null
    this.label = null
    this.cursorStyle?.remove()
    this.cursorStyle = null
    this.hovered = null
    this.downPoint = null
    this.isDragging = false
    this.justFinishedDrag = false
    this.multiActive = false
  }

  /** Keep listeners but ignore the page (e.g. while the comment popup is open). */
  pause(): void {
    this.paused = true
    this.hideOverlay()
    this.cursorStyle?.remove()
  }

  resume(): void {
    this.paused = false
    if (this.cursorStyle && !this.cursorStyle.isConnected) document.head.appendChild(this.cursorStyle)
  }

  /** Events originating inside the widget's own shadow root are not picks. */
  private isOwn(e: Event): boolean {
    return e.composedPath().includes(this.host)
  }

  private elementAt(x: number, y: number): Element | null {
    const el = deepElementFromPoint(x, y)
    if (!el || el === this.host || this.host.contains(el)) return null
    if (el === document.documentElement || el === document.body) return null
    return el
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.paused || this.isOwn(e)) return
    const point = { x: e.clientX, y: e.clientY }

    if (this.downPoint) {
      const dx = point.x - this.downPoint.x
      const dy = point.y - this.downPoint.y
      if (!this.isDragging && dx * dx + dy * dy > DRAG_THRESHOLD_SQ) {
        this.isDragging = true
        this.hideOverlay()
        this.events.onDragStart?.(this.downPoint)
      }
      if (this.isDragging) {
        this.events.onDragMove?.(dragRect(this.downPoint, point), e)
        return
      }
    }

    this.hovered = this.elementAt(point.x, point.y)
    this.refreshOverlay()
  }

  private handleMouseDown(e: MouseEvent): void {
    if (this.paused || this.isOwn(e)) return
    e.stopPropagation()
    const target = this.elementAt(e.clientX, e.clientY)
    // Text tags keep native selection; everything else must not start a host drag/focus.
    if (!isTextTarget(target)) e.preventDefault()
    this.downPoint = { x: e.clientX, y: e.clientY }
    this.isDragging = false
  }

  private handleMouseUp(e: MouseEvent): void {
    if (this.paused || this.isOwn(e)) return
    e.stopPropagation()
    if (this.isDragging && this.downPoint) {
      this.justFinishedDrag = true
      const rect = dragRect(this.downPoint, { x: e.clientX, y: e.clientY })
      this.isDragging = false
      this.downPoint = null
      this.events.onDragEnd?.(rect, e)
      return
    }
    this.downPoint = null
  }

  private handleClick(e: MouseEvent): void {
    if (this.paused || this.isOwn(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (this.justFinishedDrag) {
      this.justFinishedDrag = false
      return
    }
    const point = { x: e.clientX, y: e.clientY }
    const target = this.elementAt(point.x, point.y)
    if (!target) return
    if (isMultiSelectModifier(e) && this.events.onModifierClick?.(target, point, e)) {
      // A consumed modifier click arms release-to-commit even without a keydown
      // (the user may have been holding the keys before pick mode started).
      this.multiActive = true
      return
    }
    this.events.onPick(target, point, e)
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.paused || this.multiActive) return
    if (!isMultiSelectModifier(e)) return
    this.multiActive = true
    this.events.onModifierEnter?.()
  }

  /** Either modifier going up commits — matches the "release to commit" model. */
  private handleKeyUp(e: KeyboardEvent): void {
    if (this.paused || !this.multiActive) return
    if (e.key !== 'Meta' && e.key !== 'Control' && e.key !== 'Shift') return
    this.multiActive = false
    this.events.onModifierRelease?.(e)
  }

  private hideOverlay(): void {
    if (this.overlay) this.overlay.style.display = 'none'
  }

  private refreshOverlay(): void {
    if (!this.overlay || !this.label) return
    const el = this.hovered
    if (!el || !el.isConnected) {
      this.hideOverlay()
      return
    }
    const r = el.getBoundingClientRect()
    this.overlay.style.display = 'block'
    this.overlay.style.left = `${r.left}px`
    this.overlay.style.top = `${r.top}px`
    this.overlay.style.width = `${r.width}px`
    this.overlay.style.height = `${r.height}px`
    this.label.textContent = identifyElement(el).name
    // Flip the label below the box when the element touches the top of the viewport.
    this.label.classList.toggle('pulse-pick-label--below', r.top < 24)
  }
}
