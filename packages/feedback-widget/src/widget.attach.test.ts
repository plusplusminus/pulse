// @vitest-environment jsdom
/**
 * The attach row end to end (PULSE-402).
 *
 * Drives the real Widget through the real panel DOM — the shadow root is
 * forced open for the test only — because the two things worth guarding here
 * are ordering rules that only exist once everything is wired together: what
 * Escape backs out of, and what the row is allowed to do while a capture is in
 * flight.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Widget, type PulseCore } from './widget'
import type { RuntimeConfig } from './types'

let shadow: ShadowRoot
let widget: Widget

type Gates = Partial<RuntimeConfig['capture']>

function config(gates: Gates = {}): RuntimeConfig {
  return {
    siteKey: 'test',
    apiUrl: 'https://pulse.test',
    siteName: 'Test',
    // 'light' keeps matchMedia (absent in jsdom) out of the mount path.
    ui: { theme: 'light', position: 'bottom-right', triggerText: 'Feedback' },
    capture: {
      screenshot: true,
      captureTab: true,
      elementPick: true,
      video: true,
      voiceOver: true,
      console: false,
      sentry: false,
      replay: { enabled: false, bufferSeconds: 0, maskAllInputs: false },
      ...gates,
    },
    privacy: { maskSelectors: [] },
    user: {},
    custom: {},
    consoleLimit: 0,
  }
}

function core(): PulseCore {
  return {
    submitFeedback: vi.fn(async () => ({
      id: '1',
      linearIssueId: null,
      linearIssueUrl: null,
      status: 'created' as const,
    })),
    captureScreenshot: vi.fn(async () => null),
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

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

const panelVisible = () => q('.pulse-panel')?.classList.contains('pulse-panel--visible') ?? false
beforeEach(() => {
  document.body.innerHTML = ''
  // getDisplayMedia has to exist or the video gates resolve to false.
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

describe('the row itself', () => {
  it('offers all three attachments in one row, with a caret on the two that have options', () => {
    mount()
    click('.pulse-trigger')

    expect(Array.from(shadow.querySelectorAll('.pulse-attach__btn span')).map((e) => e.textContent)).toEqual([
      'Element',
      'Screenshot',
      'Record',
    ])
    // Element is a mode, not a choice, so it has nothing behind a caret.
    expect(Array.from(shadow.querySelectorAll('.pulse-caret')).map((e) => e.getAttribute('aria-label'))).toEqual([
      'Screenshot options',
      'Recording options',
    ])
    expect(q('.pulse-attach__btn--element')?.parentElement?.className).not.toContain('split')
  })

  it('drops a whole control when the site turns that capture off', () => {
    mount({ video: false, elementPick: false })
    click('.pulse-trigger')

    expect(q('.pulse-attach__btn--record')).toBeNull()
    expect(q('.pulse-caret[aria-label="Recording options"]')).toBeNull()
    expect(q('.pulse-attach__btn--element')).toBeNull()
    expect(q('.pulse-attach__btn--shot')).not.toBeNull()
  })

})

describe('Escape', () => {
  it('closes an open popover and stops there, leaving the panel open', () => {
    mount()
    click('.pulse-trigger')
    click('.pulse-caret[aria-label="Screenshot options"]')
    expect(q('.pulse-pop')).not.toBeNull()

    pressEscape()

    expect(q('.pulse-pop')).toBeNull()
    expect(panelVisible()).toBe(true)
    expect(q('.pulse-caret[aria-label="Screenshot options"]')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('puts focus back on the caret it came from', () => {
    mount()
    click('.pulse-trigger')
    click('.pulse-caret[aria-label="Screenshot options"]')
    pressEscape()

    expect(shadow.activeElement).toBe(q('.pulse-caret[aria-label="Screenshot options"]'))
  })

  it('closes the panel on the SECOND press, once there is no popover left', () => {
    mount()
    click('.pulse-trigger')
    click('.pulse-caret[aria-label="Screenshot options"]')

    pressEscape()
    expect(panelVisible()).toBe(true)
    pressEscape()
    expect(panelVisible()).toBe(false)
  })

  it('still closes the panel directly when no popover is open', () => {
    mount()
    click('.pulse-trigger')
    pressEscape()
    expect(panelVisible()).toBe(false)
  })
})

describe('one at a time', () => {
  it('opening the second popover closes the first', () => {
    mount()
    click('.pulse-trigger')
    click('.pulse-caret[aria-label="Screenshot options"]')
    click('.pulse-caret[aria-label="Recording options"]')

    expect(shadow.querySelectorAll('.pulse-pop').length).toBe(1)
    expect(q('.pulse-caret[aria-label="Screenshot options"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(q('.pulse-caret[aria-label="Recording options"]')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('leaves no surface stranded when the panel closes underneath it', () => {
    mount()
    click('.pulse-trigger')
    click('.pulse-caret[aria-label="Screenshot options"]')
    click('.pulse-header__close')

    expect(q('.pulse-pop')).toBeNull()
  })
})
