import type { DragRect } from './pick-mode'

/**
 * Narrow candidate list: the leaf-ish elements a user means when they drag a box
 * over a region. Deliberately excludes containers — those only ever show up as
 * dominated parents, which the dominance filter drops anyway.
 */
export const AREA_SELECTORS =
  'button, a, input, img, p, h1, h2, h3, h4, h5, h6, li, label, td, th'

/** Below this (in CSS px, either axis) a marquee over nothing is a stray click. */
export const MIN_AREA_SIZE = 20

export function rectsIntersect(a: DragRect, b: DragRect): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  )
}

/**
 * Drop every element that contains another match: dragging over a `<section>`
 * full of buttons should yield the buttons, not the section.
 */
export function applyDominanceFilter(elements: Element[]): Element[] {
  return elements.filter((el) => !elements.some((other) => other !== el && el.contains(other)))
}

/** Snapshot taken once per drag — the page does not change mid-marquee. */
export function collectAreaCandidates(exclude: Element | null): Element[] {
  const all = Array.from(document.querySelectorAll(AREA_SELECTORS))
  return exclude ? all.filter((el) => el !== exclude && !exclude.contains(el)) : all
}

/** Candidates intersecting the marquee, with dominated ancestors removed. */
export function findMarqueeElements(candidates: readonly Element[], marquee: DragRect): Element[] {
  const hits = candidates.filter((el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    return rectsIntersect(marquee, { x: r.left, y: r.top, width: r.width, height: r.height })
  })
  return applyDominanceFilter(hits)
}

export type MarqueeOutcome =
  | { kind: 'elements'; elements: Element[] }
  | { kind: 'area' }
  | { kind: 'none' }

/**
 * What a released marquee means: any intersecting element wins, otherwise a big
 * enough empty box becomes an area annotation, otherwise nothing happened.
 */
export function resolveMarquee(
  candidates: readonly Element[],
  marquee: DragRect
): MarqueeOutcome {
  const elements = findMarqueeElements(candidates, marquee)
  if (elements.length > 0) return { kind: 'elements', elements }
  if (marquee.width > MIN_AREA_SIZE && marquee.height > MIN_AREA_SIZE) return { kind: 'area' }
  return { kind: 'none' }
}
