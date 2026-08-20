/** Transient hint pill shown while Cmd+Shift multi-select is active (PULSE-331). */
export class PickStatus {
  private element: HTMLElement

  constructor(shadow: ShadowRoot) {
    this.element = document.createElement('div')
    this.element.className = 'pulse-pick-status'
    this.element.style.display = 'none'
    shadow.appendChild(this.element)
  }

  show(text: string): void {
    this.element.textContent = text
    this.element.style.display = ''
  }

  hide(): void {
    this.element.style.display = 'none'
  }

  destroy(): void {
    this.element.remove()
  }
}
