export class TriggerButton {
  private element: HTMLButtonElement

  constructor(
    private shadowRoot: ShadowRoot,
    private config: {
      text: string
      position: 'bottom-right' | 'bottom-left'
      onClick: () => void
    }
  ) {
    this.element = this.render()
    this.shadowRoot.appendChild(this.element)
  }

  private render(): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = `pulse-trigger pulse-trigger--${this.config.position === 'bottom-left' ? 'left' : 'right'}`
    btn.setAttribute('aria-label', this.config.text)
    btn.setAttribute('tabindex', '0')
    btn.addEventListener('click', this.config.onClick)

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5.5L3 13.5V11H3a1 1 0 0 1-1-1V3Z')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.5')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
    btn.appendChild(svg)

    const span = document.createElement('span')
    span.textContent = this.config.text
    btn.appendChild(span)

    return btn
  }

  show(): void {
    this.element.style.display = ''
  }

  hide(): void {
    this.element.style.display = 'none'
  }

  destroy(): void {
    this.element.removeEventListener('click', this.config.onClick)
    this.element.remove()
  }
}
