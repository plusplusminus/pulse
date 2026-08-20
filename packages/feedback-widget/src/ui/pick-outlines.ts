/**
 * Dashed outlines over every element in the pending multi-select set (PULSE-331).
 * Viewport-fixed and pointer-events:none, so the page underneath stays clickable;
 * re-rendered on scroll/resize because the rects are read live off the elements.
 */
export class PickOutlines {
  private container: HTMLElement
  private elements: Element[] = []
  private onViewportChange = () => this.render()

  constructor(shadow: ShadowRoot) {
    this.container = document.createElement('div')
    this.container.className = 'pulse-outlines'
    shadow.appendChild(this.container)
    window.addEventListener('scroll', this.onViewportChange, true)
    window.addEventListener('resize', this.onViewportChange)
  }

  set(elements: Element[]): void {
    this.elements = [...elements]
    this.render()
  }

  clear(): void {
    this.elements = []
    this.render()
  }

  destroy(): void {
    window.removeEventListener('scroll', this.onViewportChange, true)
    window.removeEventListener('resize', this.onViewportChange)
    this.container.remove()
  }

  private render(): void {
    this.container.textContent = ''
    this.elements.forEach((el, i) => {
      if (!el.isConnected) return
      const r = el.getBoundingClientRect()
      const box = document.createElement('div')
      box.className = 'pulse-outline'
      box.style.left = `${r.left}px`
      box.style.top = `${r.top}px`
      box.style.width = `${r.width}px`
      box.style.height = `${r.height}px`
      const badge = document.createElement('span')
      badge.className = 'pulse-outline__badge'
      badge.textContent = String(i + 1)
      box.appendChild(badge)
      this.container.appendChild(box)
    })
  }
}
