import type { PickRect } from '../types'

/**
 * `3 elements: button "Save", input [email]+1 more` — first two names, then a
 * count of the rest. Matches the format the Linear renderer expects (PULSE-332).
 */
export function multiPickName(names: string[]): string {
  const shown = names.slice(0, 2).join(', ')
  const extra = names.length - 2
  return `${names.length} elements: ${shown}${extra > 0 ? `+${extra} more` : ''}`
}

/** Smallest rect containing all of `rects`. Empty input yields a zero rect. */
export function aggregateRect(rects: PickRect[]): PickRect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const r of rects) {
    left = Math.min(left, r.x)
    top = Math.min(top, r.y)
    right = Math.max(right, r.x + r.width)
    bottom = Math.max(bottom, r.y + r.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The pending element set built while Cmd+Shift is held. Clicking an element
 * already in the set removes it, so the user can correct a mis-click without
 * starting over. Order is insertion order: the first element supplies the
 * pick's metadata, the last one anchors the popup.
 */
export class MultiSelection {
  private elements: Element[] = []

  get size(): number {
    return this.elements.length
  }

  get items(): Element[] {
    return [...this.elements]
  }

  get first(): Element | null {
    return this.elements[0] ?? null
  }

  has(el: Element): boolean {
    return this.elements.includes(el)
  }

  /** Returns true when the element was added, false when it was removed. */
  toggle(el: Element): boolean {
    const i = this.elements.indexOf(el)
    if (i >= 0) {
      this.elements.splice(i, 1)
      return false
    }
    this.elements.push(el)
    return true
  }

  clear(): void {
    this.elements = []
  }
}
