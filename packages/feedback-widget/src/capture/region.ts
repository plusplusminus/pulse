import { MIN_AREA_SIZE } from './area-select'
import type { DragRect } from './pick-mode'

/**
 * Region geometry (PULSE-404). The drag itself is `pick-mode`'s `dragRect`;
 * everything here is what a released drag MEANS — is it deliberate, does it fit
 * the viewport, and which pixels of the captured bitmap does it name.
 */

/** Same threshold the pick marquee uses: under it, a drag was a stray click. */
export const MIN_REGION_SIZE = MIN_AREA_SIZE

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface Scale {
  x: number
  y: number
}

/** A click, or a twitch: not a region. Capturing it would yield a sliver. */
export function isRegionTooSmall(rect: DragRect): boolean {
  return rect.width < MIN_REGION_SIZE || rect.height < MIN_REGION_SIZE
}

/** A drag that left the window still only ever names on-screen pixels. */
export function clampRegion(rect: DragRect, viewport: Size): DragRect {
  const left = clamp(rect.x, 0, viewport.width)
  const top = clamp(rect.y, 0, viewport.height)
  const right = clamp(rect.x + rect.width, left, viewport.width)
  const bottom = clamp(rect.y + rect.height, top, viewport.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The live readout, in CSS pixels — what the reporter is framing, not the file size. */
export function formatRegionSize(rect: DragRect): string {
  return `${Math.round(rect.width)} × ${Math.round(rect.height)}`
}

/**
 * Derived from the bitmap rather than read off `devicePixelRatio`, so the crop
 * stays correct whatever resolution the engine actually captured at.
 */
export function regionScale(image: Size, viewport: Size): Scale {
  return {
    x: viewport.width > 0 ? image.width / viewport.width : 1,
    y: viewport.height > 0 ? image.height / viewport.height : 1,
  }
}

/**
 * CSS-pixel rect to image-pixel rect. Both EDGES are scaled and then
 * differenced, rather than scaling the width: a 400x300 selection at 2x is
 * exactly 800x600, not two independently rounded edges that land 799 apart.
 */
export function regionPixelRect(rect: DragRect, scale: Scale, image: Size): PixelRect {
  const left = clamp(Math.round(rect.x * scale.x), 0, image.width)
  const top = clamp(Math.round(rect.y * scale.y), 0, image.height)
  const right = clamp(Math.round((rect.x + rect.width) * scale.x), left, image.width)
  const bottom = clamp(Math.round((rect.y + rect.height) * scale.y), top, image.height)
  return {
    x: left,
    y: top,
    // A zero-width canvas throws; the selector already rejects drags this small.
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

/**
 * `clientWidth` and not `innerWidth`: the engine clips to the document element,
 * so on a page with a classic scrollbar the two disagree by its width and
 * `innerWidth` would skew every crop to the right.
 */
export function viewportSize(): Size {
  const doc = document.documentElement
  return {
    width: doc?.clientWidth || window.innerWidth,
    height: doc?.clientHeight || window.innerHeight,
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(n, hi))
}
