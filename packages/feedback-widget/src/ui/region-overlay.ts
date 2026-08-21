import { Marquee } from './marquee'
import { PickStatus } from './pick-status'
import { formatRegionSize } from '../capture/region'
import type { DragRect } from '../capture/pick-mode'

/** Height of the readout pill, used to decide whether it still fits below the rect. */
const READOUT_HEIGHT = 22
const GAP = 6

/**
 * What region capture puts on the host page (PULSE-404): a dim, the rectangle,
 * and a live size readout.
 *
 * The rectangle is `Marquee` — the same element the picker sweeps out — wearing
 * a modifier that swaps its fill for a huge shadow. That shadow IS the dim once
 * a drag starts, which is why the standalone dim hides on the first move: two
 * of them would stack into an opaque page.
 */
export class RegionOverlay {
  private dim: HTMLElement
  private marquee: Marquee
  private readout: HTMLElement
  /** The pill pick mode already uses for its transient hints. */
  private status: PickStatus

  constructor(shadow: ShadowRoot) {
    this.status = new PickStatus(shadow)
    this.dim = document.createElement('div')
    this.dim.className = 'pulse-region-dim'
    this.dim.style.display = 'none'
    shadow.appendChild(this.dim)

    this.marquee = new Marquee(shadow, 'pulse-marquee pulse-marquee--cut')

    this.readout = document.createElement('div')
    this.readout.className = 'pulse-region-size'
    this.readout.style.display = 'none'
    shadow.appendChild(this.readout)
  }

  /** Armed but nothing drawn yet: the whole page is dim and the cursor is a crosshair. */
  show(hint: string): void {
    this.dim.style.display = ''
    this.status.show(hint)
  }

  setRect(rect: DragRect): void {
    this.dim.style.display = 'none'
    // Once a rect exists the readout says everything the hint did, and the pill
    // sits exactly where a reporter framing the top of the page wants to drag.
    this.status.hide()
    this.marquee.set(rect)
    this.readout.textContent = formatRegionSize(rect)
    this.readout.style.display = ''
    this.readout.style.left = `${Math.round(rect.x)}px`
    this.readout.style.top = `${Math.round(this.readoutTop(rect))}px`
  }

  /** Below the rect, or tucked just inside it when the drag reached the bottom edge. */
  private readoutTop(rect: DragRect): number {
    const below = rect.y + rect.height + GAP
    const limit = (window.innerHeight || 0) - READOUT_HEIGHT - GAP
    return limit > 0 && below > limit ? Math.max(rect.y + GAP, limit) : below
  }

  hide(): void {
    this.dim.style.display = 'none'
    this.marquee.hide()
    this.readout.style.display = 'none'
    this.status.hide()
  }

  destroy(): void {
    this.dim.remove()
    this.marquee.destroy()
    this.readout.remove()
    this.status.destroy()
  }
}
