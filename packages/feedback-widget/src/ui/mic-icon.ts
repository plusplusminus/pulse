/**
 * The one microphone glyph (PULSE-400), shared by the panel opt-in and the
 * recording bar's mute toggle. Built once because the two must not drift: a
 * reporter who ticks a microphone in the panel has to recognise the same
 * microphone in the bar, and the slashed variant is the non-colour signal that
 * says they are recording silence.
 */

const NS = 'http://www.w3.org/2000/svg'

function shape(tag: 'path', attrs: Record<string, string>): SVGPathElement {
  const node = document.createElementNS(NS, tag)
  for (const key in attrs) node.setAttribute(key, attrs[key])
  return node
}

export interface MicIcon {
  svg: SVGSVGElement
  /** Hidden until the microphone is muted or was never opened. */
  slash: SVGPathElement
}

export function micIcon(): MicIcon {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')

  svg.appendChild(
    shape('path', {
      d: 'M8 2.25a1.85 1.85 0 0 1 1.85 1.85v3.4a1.85 1.85 0 1 1-3.7 0V4.1A1.85 1.85 0 0 1 8 2.25Z',
      fill: 'currentColor',
    })
  )
  svg.appendChild(
    shape('path', {
      d: 'M4.15 7.1a3.85 3.85 0 0 0 7.7 0M8 11v2.75',
      stroke: 'currentColor',
      'stroke-width': '1.3',
      'stroke-linecap': 'round',
    })
  )
  const slash = shape('path', {
    d: 'M2.5 2.5l11 11',
    stroke: 'currentColor',
    'stroke-width': '1.4',
    'stroke-linecap': 'round',
    display: 'none',
  })
  svg.appendChild(slash)

  return { svg, slash }
}
