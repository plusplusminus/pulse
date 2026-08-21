// @vitest-environment jsdom
/**
 * Multiple screenshots per submission, end to end through the real panel DOM
 * (PULSE-403).
 *
 * The state model went from one blob to an ordered list, so what is worth
 * guarding is everything that only became ambiguous once there can be several:
 * that a capture APPENDS, that removing one leaves the others alone, that the
 * cap refuses before a capture rather than after, and that the submitted
 * payload carries them in the reporter's order.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Widget, type PulseCore } from './widget'
import type { RuntimeConfig } from './types'
import { MAX_SCREENSHOTS, SCREENSHOT_CAP_NOTICE } from './attachments'

let shadow: ShadowRoot
let widget: Widget
let submitted: Parameters<PulseCore['submitFeedback']>[0] | null
let captures: number

function config(): RuntimeConfig {
  return {
    siteKey: 'test',
    apiUrl: 'https://pulse.test',
    siteName: 'Test',
    ui: { theme: 'light', position: 'bottom-right', triggerText: 'Feedback' },
    capture: {
      screenshot: true,
      captureTab: true,
      elementPick: false,
      video: false,
      voiceOver: false,
      console: false,
      sentry: false,
      replay: { enabled: false, bufferSeconds: 0, maskAllInputs: false },
    },
    privacy: { maskSelectors: [] },
    user: {},
    custom: {},
    consoleLimit: 0,
  }
}

function core(): PulseCore {
  return {
    submitFeedback: vi.fn(async (data) => {
      submitted = data
      return { id: '1', linearIssueId: null, linearIssueUrl: null, status: 'created' as const }
    }),
    // A distinct blob per call, so "which screenshot" is answerable.
    captureScreenshot: vi.fn(async () => {
      captures += 1
      return new Blob([`shot-${captures}`], { type: 'image/png' })
    }),
    setWidgetHost: vi.fn(),
    getRuntimeConfig: vi.fn(() => config()),
    getUser: vi.fn(() => ({})),
  }
}

function mount(): void {
  const attach = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit
  ) {
    shadow = attach.call(this, { ...init, mode: 'open' })
    return shadow
  })
  widget = new Widget(core(), config())
  widget.mount()
}

const chips = () => Array.from(shadow.querySelectorAll<HTMLButtonElement>('.pulse-chip__open--shot'))
const chipLabels = () => chips().map((c) => c.querySelector('span')?.textContent)

function actionButton(text: string): HTMLButtonElement {
  const found = Array.from(shadow.querySelectorAll<HTMLButtonElement>('.pulse-screenshot__btn')).find(
    (b) => b.textContent === text
  )
  if (!found) throw new Error(`no preview action labelled ${text}`)
  return found
}

/** Captures `n` screenshots through the Attach row, one after the other. */
async function capture(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    shadow.querySelector<HTMLButtonElement>('.pulse-attach__btn--shot')!.click()
    await vi.waitFor(() => expect(chips()).toHaveLength(Math.min(i + 1, MAX_SCREENSHOTS)))
  }
}

beforeEach(() => {
  submitted = null
  captures = 0
  document.body.innerHTML = ''
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia: vi.fn(), getUserMedia: vi.fn() },
    configurable: true,
  })
  let minted = 0
  URL.createObjectURL = vi.fn(() => `blob:pulse/${minted++}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  widget.destroy()
  vi.restoreAllMocks()
})

describe('capturing more than one screenshot', () => {
  it('appends rather than replacing — the reason this spec exists', async () => {
    mount()
    widget.open()
    await capture(3)

    expect(chipLabels()).toEqual(['Screenshot 1', 'Screenshot 2', 'Screenshot 3'])
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('removes only the chip that was crossed off, and frees only its blob', async () => {
    mount()
    widget.open()
    await capture(3)
    const urls = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value)

    shadow
      .querySelector<HTMLButtonElement>('.pulse-chip__remove[aria-label="Remove screenshot 2"]')!
      .click()

    expect(chipLabels()).toEqual(['Screenshot 1', 'Screenshot 2'])
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urls[1])
  })

  it('submits every screenshot in capture order, each with its own marks', async () => {
    mount()
    widget.open()
    await capture(2)

    ;(shadow.querySelector('.pulse-input') as HTMLInputElement).value = 'Broken flow'
    ;(shadow.querySelector('.pulse-input') as HTMLInputElement).dispatchEvent(new Event('input'))
    const email = shadow.querySelectorAll('.pulse-input')[1] as HTMLInputElement
    email.value = 'r@example.com'
    email.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.pulse-submit')!.click()

    await vi.waitFor(() => expect(submitted).not.toBeNull())
    const blobs = await Promise.all((submitted!.screenshots ?? []).map((s) => s.blob.text()))
    expect(blobs).toEqual(['shot-1', 'shot-2'])
    expect((submitted!.screenshots ?? []).map((s) => s.annotations)).toEqual([[], []])
  })

  it('clears every screenshot once the report is filed', async () => {
    mount()
    widget.open()
    await capture(2)

    ;(shadow.querySelector('.pulse-input') as HTMLInputElement).value = 'Broken flow'
    ;(shadow.querySelector('.pulse-input') as HTMLInputElement).dispatchEvent(new Event('input'))
    const email = shadow.querySelectorAll('.pulse-input')[1] as HTMLInputElement
    email.value = 'r@example.com'
    email.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.pulse-submit')!.click()
    await vi.waitFor(() => expect(submitted).not.toBeNull())

    widget.close()
    widget.open()
    expect(chips()).toHaveLength(0)
  })
})

describe('the cap', () => {
  it('refuses the seventh capture with a message, and never calls the engine', async () => {
    mount()
    widget.open()
    await capture(MAX_SCREENSHOTS)
    expect(captures).toBe(MAX_SCREENSHOTS)

    shadow.querySelector<HTMLButtonElement>('.pulse-attach__btn--shot')!.click()
    await vi.waitFor(() => expect(shadow.textContent).toContain(SCREENSHOT_CAP_NOTICE))

    // Refused BEFORE the capture, not after: no bitmap is taken and thrown away.
    expect(captures).toBe(MAX_SCREENSHOTS)
    expect(chips()).toHaveLength(MAX_SCREENSHOTS)
  })

  it('clears the refusal as soon as there is room again', async () => {
    mount()
    widget.open()
    await capture(MAX_SCREENSHOTS)
    shadow.querySelector<HTMLButtonElement>('.pulse-attach__btn--shot')!.click()
    await vi.waitFor(() => expect(shadow.textContent).toContain(SCREENSHOT_CAP_NOTICE))

    shadow
      .querySelector<HTMLButtonElement>('.pulse-chip__remove[aria-label="Remove screenshot 1"]')!
      .click()

    expect(shadow.textContent).not.toContain(SCREENSHOT_CAP_NOTICE)
  })
})

describe('per-screenshot preview', () => {
  it('opens the one that was clicked and offers Add another below the cap', async () => {
    mount()
    widget.open()
    await capture(2)

    chips()[1].click()
    expect(shadow.querySelectorAll('.pulse-screenshot__img')).toHaveLength(1)
    expect(shadow.querySelector('.pulse-screenshot__img')!.getAttribute('alt')).toBe(
      'Screenshot 2 preview'
    )

    actionButton('Add another').click()
    await vi.waitFor(() => expect(chips()).toHaveLength(3))
  })
})
