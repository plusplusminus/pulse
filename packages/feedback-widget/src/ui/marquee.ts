import type { DragRect } from '../capture/pick-mode'

/** The drag rectangle drawn while the user sweeps out an area (PULSE-350). */
export class Marquee {
  private element: HTMLElement

  constructor(shadow: ShadowRoot) {
    this.element = document.createElement('div')
    this.element.className = 'pulse-marquee'
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
