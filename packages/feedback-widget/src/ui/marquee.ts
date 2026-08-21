import type { DragRect } from '../capture/pick-mode'

/**
 * The drag rectangle drawn while the user sweeps out an area (PULSE-350).
 *
 * `className` exists so region capture (PULSE-404) can wear the same rectangle
 * with a cut-out shadow instead of a fill, rather than shipping a second
 * marquee that would then drift from this one.
 */
export class Marquee {
  private element: HTMLElement

  constructor(shadow: ShadowRoot, className = 'pulse-marquee') {
    this.element = document.createElement('div')
    this.element.className = className
    this.element.style.display = 'none'
    shadow.appendChild(this.element)
  }

  set(rect: DragRect): void {
    this.element.style.display = ''
    this.element.style.left = `${rect.x}px`
    this.element.style.top = `${rect.y}px`
    this.element.style.width = `${rect.width}px`
    this.element.style.height = `${rect.height}px`
  }

  hide(): void {
    this.element.style.display = 'none'
  }

  destroy(): void {
    this.element.remove()
  }
}
