// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { RegionSelector, REGION_HINT, type RegionEvents } from './region-select'

let host: HTMLElement
let shadow: ShadowRoot
let selector: RegionSelector
let events: { [K in keyof RegionEvents]: Mock<RegionEvents[K]> }

function mouse(type: string, x: number, y: number, target: EventTarget = document.body): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y })
  target.dispatchEvent(e)
  return e
}

function drag(from: [number, number], to: [number, number]): void {
  mouse('mousedown', from[0], from[1])
  mouse('mousemove', to[0], to[1])
  mouse('mouseup', to[0], to[1])
}

function dim(): HTMLElement | null {
  return shadow.querySelector('.pulse-region-dim')
}

function marquee(): HTMLElement | null {
  return shadow.querySelector('.pulse-marquee--cut')
}

function readout(): HTMLElement | null {
  return shadow.querySelector('.pulse-region-size')
}

beforeEach(() => {
  document.body.innerHTML = '<main><a id="link" href="/gone">Go</a></main><div id="pulse-widget"></div>'
  host = document.getElementById('pulse-widget')!
  shadow = host.attachShadow({ mode: 'closed' })
  // jsdom reports 0 for both, which would clamp every region away.
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 1000, configurable: true })
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true })
  events = { onSelect: vi.fn(), onCancel: vi.fn() }
  selector = new RegionSelector(shadow, host, events)
})

afterEach(() => {
  selector.destroy()
  vi.restoreAllMocks()
})

describe('start', () => {
  it('dims the page and says what to do', () => {
    selector.start()
    expect(dim()?.style.display).toBe('')
    expect(shadow.querySelector('.pulse-pick-status')?.textContent).toBe(REGION_HINT)
  })

  it('puts the whole page under a crosshair', () => {
    selector.start()
    const style = document.head.querySelector('style[data-pulse="pick-cursor"]')
    expect(style?.textContent).toContain('crosshair')
  })

  it('is idempotent — a second start does not stack two overlays', () => {
    selector.start()
    selector.start()
    expect(shadow.querySelectorAll('.pulse-region-dim')).toHaveLength(1)
  })
})

describe('dragging', () => {
  beforeEach(() => selector.start())

  it('draws the rectangle and a live pixel readout', () => {
    mouse('mousedown', 100, 100)
    mouse('mousemove', 500, 400)

    expect(marquee()?.style.width).toBe('400px')
    expect(marquee()?.style.height).toBe('300px')
    expect(readout()?.textContent).toBe('400 × 300')
  })

  it('updates the readout as the drag grows', () => {
    mouse('mousedown', 100, 100)
    mouse('mousemove', 300, 200)
    expect(readout()?.textContent).toBe('200 × 100')
    mouse('mousemove', 600, 500)
    expect(readout()?.textContent).toBe('500 × 400')
  })

  it('drops the flat dim once the cut-out rectangle is doing the dimming', () => {
    mouse('mousedown', 100, 100)
    mouse('mousemove', 500, 400)
    expect(dim()?.style.display).toBe('none')
  })

  it('reports the released rect in viewport CSS pixels', () => {
    drag([100, 100], [500, 400])
    expect(events.onSelect).toHaveBeenCalledWith({ x: 100, y: 100, width: 400, height: 300 })
  })

  it('normalises a drag made up and to the left', () => {
    drag([500, 400], [100, 100])
    expect(events.onSelect).toHaveBeenCalledWith({ x: 100, y: 100, width: 400, height: 300 })
  })

  it('clamps a drag that ran off the viewport', () => {
    drag([900, 700], [1400, 1200])
    expect(events.onSelect).toHaveBeenCalledWith({ x: 900, y: 700, width: 100, height: 100 })
  })
})

describe('cancelling', () => {
  beforeEach(() => selector.start())

  it('treats a click with no drag as a cancel, not a zero-size region', () => {
    mouse('mousedown', 200, 200)
    mouse('mouseup', 200, 200)
    expect(events.onSelect).not.toHaveBeenCalled()
    expect(events.onCancel).toHaveBeenCalledTimes(1)
  })

  it('treats a twitch under the drag threshold as a cancel', () => {
    drag([200, 200], [202, 201])
    expect(events.onSelect).not.toHaveBeenCalled()
    expect(events.onCancel).toHaveBeenCalledTimes(1)
  })

  it('treats a sliver as a cancel — a 4px-tall band is a mis-drag', () => {
    drag([100, 100], [400, 104])
    expect(events.onSelect).not.toHaveBeenCalled()
    expect(events.onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('the host page', () => {
  beforeEach(() => selector.start())

  it('never sees the drag — a link under the marquee is not followed', () => {
    const clicked = vi.fn()
    document.getElementById('link')!.addEventListener('click', clicked)
    drag([100, 100], [500, 400])
    mouse('click', 500, 400, document.getElementById('link')!)
    expect(clicked).not.toHaveBeenCalled()
  })

  it('preventDefaults mousedown, so no text gets selected mid-drag', () => {
    const e = mouse('mousedown', 100, 100)
    expect(e.defaultPrevented).toBe(true)
  })

  it('ignores events from inside the widget itself', () => {
    const inner = document.createElement('button')
    shadow.appendChild(inner)
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, clientX: 5, clientY: 5 })
    inner.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
  })
})

describe('stop', () => {
  it('leaves no overlay and no cursor override on the host page', () => {
    selector.start()
    mouse('mousedown', 100, 100)
    mouse('mousemove', 400, 400)
    selector.stop()

    expect(shadow.querySelector('.pulse-region-dim')).toBeNull()
    expect(shadow.querySelector('.pulse-marquee--cut')).toBeNull()
    expect(shadow.querySelector('.pulse-region-size')).toBeNull()
    expect(shadow.querySelector('.pulse-pick-status')).toBeNull()
    expect(document.head.querySelector('style[data-pulse="pick-cursor"]')).toBeNull()
  })

  it('stops listening, so a later drag on the page reports nothing', () => {
    selector.start()
    selector.stop()
    drag([100, 100], [500, 400])
    expect(events.onSelect).not.toHaveBeenCalled()
    expect(events.onCancel).not.toHaveBeenCalled()
  })

  it('reports inactive once stopped', () => {
    selector.start()
    expect(selector.isActive).toBe(true)
    selector.stop()
    expect(selector.isActive).toBe(false)
  })
})
