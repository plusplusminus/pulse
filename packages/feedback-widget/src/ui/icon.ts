/**
 * One builder for the widget's 16x16 line glyphs (PULSE-402).
 *
 * Every icon in the panel was six `setAttribute` calls repeated inline, which
 * is a lot of bytes on a script that loads on every page view of every client
 * site. The stroke treatment is identical across all of them, so the only
 * thing worth writing per icon is its path data.
 */

const NS = 'http://www.w3.org/2000/svg'

export interface IconOptions {
  /** Stroke width; ignored for filled paths. */
  width?: string
  /** Paths listed here are filled with currentColor instead of stroked. */
  filled?: readonly number[]
}

export function iconPath(d: string, filled: boolean, width: string): SVGPathElement {
  const p = document.createElementNS(NS, 'path')
  p.setAttribute('d', d)
  if (filled) {
    p.setAttribute('fill', 'currentColor')
    return p
  }
  p.setAttribute('stroke', 'currentColor')
  p.setAttribute('stroke-width', width)
  p.setAttribute('stroke-linecap', 'round')
  p.setAttribute('stroke-linejoin', 'round')
  return p
}

/** Decorative by contract: every caller pairs it with real text or an aria-label. */
export function icon(d: string | readonly string[], opts: IconOptions = {}): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  const paths = typeof d === 'string' ? [d] : d
  paths.forEach((path, i) => svg.appendChild(iconPath(path, opts.filled?.includes(i) ?? false, opts.width ?? '1.25')))
  return svg
}

/** The glyphs the panel and its popovers share. */
export const ICONS = {
  element: 'M3 3l10 4.5-4.5 1.5L7 13.5 3 3Z',
  screenshot: ['M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Z', 'M2 5h12'],
  tab: 'M2 4a1 1 0 0 1 1-1h4l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4Z',
  record: ['M8 1.75a6.25 6.25 0 1 1 0 12.5 6.25 6.25 0 0 1 0-12.5Z', 'M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z'],
  play: 'M5 3.5l7 4.5-7 4.5v-9Z',
  caret: 'M4.5 6.5L8 10l3.5-3.5',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  edit: 'M11.5 2.5a1.5 1.5 0 0 1 2 2L6 12l-3 1 1-3 7.5-7.5Z',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8',
} as const
