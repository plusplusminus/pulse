export interface Marker {
  id: string
  /** X as a percentage of viewport width. */
  xPercent: number
  /** Y in document pixels, or viewport pixels when `isFixed`. */
  y: number
  /** Anchored to a fixed/sticky element: never subtract scrollY. */
  isFixed: boolean
}

/** Numbered pins for committed picks, rendered in the widget's shadow root (viewport-fixed). */
export class PickMarkers {
  private container: HTMLElement
  private markers: Marker[] = []
  private pending: Marker | null = null
  private onViewportChange = () => this.render()

  constructor(private shadow: ShadowRoot) {
    this.container = document.createElement('div')
    this.container.className = 'pulse-markers'
    this.container.style.display = 'none'
    this.shadow.appendChild(this.container)
    window.addEventListener('scroll', this.onViewportChange, true)
    window.addEventListener('resize', this.onViewportChange)
  }

  set(markers: Marker[]): void {
    this.markers = [...markers]
    this.render()
  }

  add(marker: Marker): void {
    this.markers.push(marker)
    this.pending = null
    this.render()
  }

  remove(id: string): void {
    this.markers = this.markers.filter((m) => m.id !== id)
    this.render()
  }

  setPending(marker: Marker | null): void {
    this.pending = marker
    this.render()
  }

  clear(): void {
    this.markers = []
    this.pending = null
    this.render()
  }

  show(): void {
    this.container.style.display = ''
    this.render()
  }

  hide(): void {
    this.container.style.display = 'none'
  }

  destroy(): void {
    window.removeEventListener('scroll', this.onViewportChange, true)
    window.removeEventListener('resize', this.onViewportChange)
    this.container.remove()
  }

  private render(): void {
    this.container.textContent = ''
    const all = this.pending ? [...this.markers, this.pending] : this.markers
    all.forEach((m, i) => {
      const pin = document.createElement('div')
      pin.className = `pulse-marker${m === this.pending ? ' pulse-marker--pending' : ''}`
      pin.textContent = String(i + 1)
      pin.style.left = `${(m.xPercent * window.innerWidth) / 100}px`
      pin.style.top = `${m.isFixed ? m.y : m.y - window.scrollY}px`
      this.container.appendChild(pin)
    })
  }
}
