// @vitest-environment jsdom
/**
 * Region capture end to end (PULSE-404).
 *
 * Drives the real Widget through the real panel DOM — the shadow root is forced
 * open for the test only. What is worth guarding here is everything the unit
 * tests cannot see: that the capture goes through the SAME `captureScreenshot`
 * the other modes use (which is what carries `privacy.maskSelectors` into the
 * region), that the crop is applied before the attachment is set, and that
 * backing out leaves nothing on the host page.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { Widget, type PulseCore } from './widget'
import type { RuntimeConfig } from './types'

let shadow: ShadowRoot
let widget: Widget
let captureScreenshot: Mock<() => Promise<Blob | null>>
let cropCalls: { region: unknown; viewport: unknown }[]

const CROPPED = new Blob(['cropped'], { type: 'image/png' })

vi.mock('./capture/crop', () => ({
  CROP_FAILED: 'Could not crop the selected region.',
  cropToRegion: vi.fn(async (_blob: Blob, region: unknown, viewport: unknown) => {
    cropCalls.push({ region, viewport })
    return CROPPED
  }),
}))

type Gates = Partial<RuntimeConfig['capture']>

function config(gates: Gates = {}): RuntimeConfig {
  return {
    siteKey: 'test',
    apiUrl: 'https://pulse.test',
    siteName: 'Test',
    ui: { theme: 'light', position: 'bottom-right', triggerText: 'Feedback' },
    capture: {
      screenshot: true,
      captureTab: true,
      elementPick: true,
      video: false,
      voiceOver: false,
      console: false,
      sentry: false,
      replay: { enabled: false, bufferSeconds: 0, maskAllInputs: false },
      ...gates,
    },
    privacy: { maskSelectors: ['.secret'] },
    user: {},
    custom: {},
    consoleLimit: 0,
  }
}

function core(): PulseCore {
  return {
    submitFeedback: vi.fn(async () => ({ id: '1', linearIssueId: null, linearIssueUrl: null, status: 'created' as const })),
    captureScreenshot,
    setWidgetHost: vi.fn(),
    getRuntimeConfig: vi.fn(() => config()),
    getUser: vi.fn(() => ({})),
  }
}

function mount(gates: Gates = {}): void {
  const attach = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    shadow = attach.call(this, { ...init, mode: 'open' })
    return shadow
  })
  widget = new Widget(core(), config(gates))
  widget.mount()
}

function q(selector: string): HTMLElement | null {
  return shadow.querySelector(selector)
}

function click(selector: string): void {
  const el = q(selector)
  if (!el) throw new Error(`missing ${selector}`)
  ;(el as HTMLButtonElement).click()
}

function mouse(type: string, x: number, y: number): void {
  document.body.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y })
  )
}

function drag(from: [number, number], to: [number, number]): void {
  mouse('mousedown', from[0], from[1])
  mouse('mousemove', to[0], to[1])
  mouse('mouseup', to[0], to[1])
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** Open the panel, then pick "Select a region…" out of the Screenshot popover. */
function startRegion(): void {
  click('.pulse-trigger')
  click('.pulse-caret[aria-label="Screenshot options"]')
  const item = Array.from(shadow.querySelectorAll('.pulse-pop__item')).find(
    (b) => b.querySelector('.pulse-pop__name')?.textContent === 'Select a region…'
  ) as HTMLButtonElement
  item.click()
}

const panelVisible = () => q('.pulse-panel')?.classList.contains('pulse-panel--visible') ?? false

beforeEach(() => {
  document.body.innerHTML = ''
  cropCalls = []
  captureScreenshot = vi.fn<() => Promise<Blob | null>>(async () => new Blob(['full'], { type: 'image/png' }))
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 1000, configurable: true })
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia: vi.fn(), getUserMedia: vi.fn() },
    configurable: true,
  })
  URL.createObjectURL = vi.fn(() => 'blob:pulse/1')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  widget.destroy()
  vi.restoreAllMocks()
})

describe('entering region mode', () => {
  it('hides the panel and dims the page', () => {
    mount()
    startRegion()

    expect(panelVisible()).toBe(false)
    expect(q('.pulse-region-dim')).not.toBeNull()
  })

  it('captures nothing until a region is actually released', () => {
    mount()
    startRegion()
    expect(captureScreenshot).not.toHaveBeenCalled()
  })

  it('is unreachable when the site turned screenshots off', () => {
    mount({ screenshot: false })
    click('.pulse-trigger')
    expect(q('.pulse-caret[aria-label="Screenshot options"]')).toBeNull()
    expect(q('.pulse-attach__btn--shot')).toBeNull()
  })
})

describe('capturing a region', () => {
  it('goes through the same captureScreenshot as every other mode', async () => {
    mount()
    startRegion()
    drag([100, 100], [500, 400])
    await vi.waitFor(() => expect(captureScreenshot).toHaveBeenCalledTimes(1))
  })

  it('crops the full capture to the selection, in viewport pixels', async () => {
    mount()
    startRegion()
    drag([100, 100], [500, 400])

    await vi.waitFor(() => expect(cropCalls).toHaveLength(1))
    expect(cropCalls[0].region).toEqual({ x: 100, y: 100, width: 400, height: 300 })
    expect(cropCalls[0].viewport).toEqual({ width: 1000, height: 800 })
  })

  it('attaches the CROPPED image and comes back to the panel', async () => {
    mount()
    startRegion()
    drag([100, 100], [500, 400])

    await vi.waitFor(() => expect(panelVisible()).toBe(true))
    expect(q('.pulse-chip__open--shot')).not.toBeNull()
    // The overlay is gone the moment the drag ends, not when the capture returns.
    expect(q('.pulse-region-dim')).toBeNull()
  })

  it('reports a failed capture in the panel rather than attaching nothing silently', async () => {
    mount()
    captureScreenshot.mockRejectedValueOnce(new Error('Screenshot capture timed out'))
    startRegion()
    drag([100, 100], [500, 400])

    await vi.waitFor(() => expect(panelVisible()).toBe(true))
    expect(q('.pulse-capture-note--error')?.textContent).toContain('Screenshot capture timed out')
  })
})

describe('backing out', () => {
  it('Escape returns to the panel with no attachment and no capture', async () => {
    mount()
    startRegion()
    mouse('mousedown', 100, 100)
    mouse('mousemove', 400, 400)
    pressEscape()

    expect(panelVisible()).toBe(true)
    expect(captureScreenshot).not.toHaveBeenCalled()
    expect(q('.pulse-chip__open--shot')).toBeNull()
  })

  it('Escape leaves no overlay on the host page and no crosshair', () => {
    mount()
    startRegion()
    pressEscape()

    expect(q('.pulse-region-dim')).toBeNull()
    expect(q('.pulse-marquee--cut')).toBeNull()
    expect(q('.pulse-region-size')).toBeNull()
    expect(document.head.querySelector('style[data-pulse="pick-cursor"]')).toBeNull()
  })

  it('Escape does not also close the panel — it backs out one mode', () => {
    mount()
    startRegion()
    pressEscape()
    expect(panelVisible()).toBe(true)
    expect(q('.pulse-trigger')?.style.display).toBe('none')
  })

  it('a click with no drag cancels rather than attaching an empty region', () => {
    mount()
    startRegion()
    mouse('mousedown', 200, 200)
    mouse('mouseup', 200, 200)

    expect(captureScreenshot).not.toHaveBeenCalled()
    expect(panelVisible()).toBe(true)
    expect(q('.pulse-region-dim')).toBeNull()
  })

  it('closing the widget mid-selection tears the overlay down too', () => {
    mount()
    startRegion()
    widget.close()

    expect(q('.pulse-region-dim')).toBeNull()
    expect(document.head.querySelector('style[data-pulse="pick-cursor"]')).toBeNull()
  })
})
