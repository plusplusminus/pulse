// @vitest-environment jsdom
/**
 * Recording controls end to end (PULSE-399).
 *
 * Drives the real Widget through the real panel DOM — the shadow root is
 * forced open for the test only, since the widget attaches it closed — so the
 * assertions are about what a reporter can actually see and click, not about
 * private methods.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Widget, type PulseCore } from './widget'
import { MAX_RECORDING_MS, MIME_CANDIDATES } from './capture/video'
import { setWebmDurationFixer } from './capture/webm-duration'
import { BAR_IN_RECORDING_NOTICE } from './ui/panel'
import { DEFAULT_EXCLUDE_SELECTORS } from './screenshot'
import type { RuntimeConfig } from './types'

// -- fakes -------------------------------------------------------------------

type Listener = () => void

function fakeTrack(displaySurface?: string) {
  const listeners: Listener[] = []
  return {
    kind: 'video',
    stop: vi.fn(),
    getSettings: () => (displaySurface ? { displaySurface } : {}),
    addEventListener: vi.fn((event: string, fn: Listener) => {
      if (event === 'ended') listeners.push(fn)
    }),
    /** The browser's own "Stop sharing" bar. */
    end: () => listeners.forEach((fn) => fn()),
  }
}

type FakeTrack = ReturnType<typeof fakeTrack>

function fakeStream(track: FakeTrack) {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
}

let instances: FakeMediaRecorder[] = []

class FakeMediaRecorder {
  static isTypeSupported = vi.fn((type: string) => (MIME_CANDIDATES as readonly string[]).includes(type))

  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(
    readonly stream: MediaStream,
    readonly options: { mimeType: string }
  ) {
    instances.push(this)
  }

  get mimeType(): string {
    return this.options.mimeType
  }

  start(): void {
    this.state = 'recording'
    // One timeslice's worth of bytes, so a finished recording is never empty.
    this.ondataavailable?.({ data: new Blob(['x'.repeat(2048)]) })
  }

  stop(): void {
    this.state = 'inactive'
    this.onstop?.()
  }
}

/** The recorder resolves through several awaits before the panel sees a blob. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

// -- harness -----------------------------------------------------------------

let shadow: ShadowRoot
let widget: Widget
let track: FakeTrack
let getDisplayMedia: ReturnType<typeof vi.fn>

function config(): RuntimeConfig {
  return {
    siteKey: 'test',
    apiUrl: 'https://pulse.test',
    siteName: 'Test',
    // 'light' keeps matchMedia (absent in jsdom) out of the mount path.
    ui: { theme: 'light', position: 'bottom-right', triggerText: 'Feedback' },
    capture: {
      screenshot: false,
      captureTab: false,
      elementPick: false,
      video: true,
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

function host(): HTMLElement {
  return document.getElementById('pulse-widget')!
}

function q(selector: string): HTMLElement | null {
  return shadow.querySelector(selector)
}

function click(selector: string): void {
  const el = q(selector)
  if (!el) throw new Error(`missing ${selector}`)
  ;(el as HTMLButtonElement).click()
}

/** PULSE-402: a finished recording is a chip; its preview is one click in. */
function openVideo(): void {
  click('.pulse-chip__open--video')
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** Open the panel and start a recording the way a reporter does. */
async function startRecording(): Promise<void> {
  click('.pulse-trigger')
  click('.pulse-record-btn')
  await flush()
}

beforeEach(() => {
  document.body.innerHTML = ''
  instances = []
  track = fakeTrack('monitor')
  getDisplayMedia = vi.fn(async () => fakeStream(track))

  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia },
    configurable: true,
  })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  URL.createObjectURL = vi.fn(() => 'blob:pulse/1')
  URL.revokeObjectURL = vi.fn()
  // Bypasses the lazily fetched WebM duration fixer; identity is enough here.
  setWebmDurationFixer({ fixWebmDuration: async (blob: Blob) => blob })

  // The widget attaches a CLOSED shadow root; open it for the test so the
  // assertions can reach the DOM the reporter is looking at.
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
})

afterEach(() => {
  widget.destroy()
  setWebmDurationFixer(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// -- the bar exists at all ----------------------------------------------------

describe('while recording', () => {
  it('keeps the host visible and shows the bar, hiding only the panel and trigger', async () => {
    await startRecording()

    expect(host().style.display).not.toBe('none')
    expect(q('.pulse-recbar')).toBeTruthy()
    expect(q('.pulse-trigger')!.style.display).toBe('none')
    expect(q('.pulse-panel')!.classList.contains('pulse-panel--visible')).toBe(false)
  })

  it('offers Stop and Discard, with focus starting on Stop', async () => {
    await startRecording()

    expect(q('.pulse-recbar__btn--stop')!.textContent).toBe('Stop')
    expect(q('.pulse-recbar__btn--discard')!.textContent).toBe('Discard')
    expect(shadow.activeElement).toBe(q('.pulse-recbar__btn--stop'))
  })

  it('drives the timer and the size readout from the recorder progress', async () => {
    vi.useFakeTimers()
    await startRecording()

    await vi.advanceTimersByTimeAsync(3_000)

    expect(q('.pulse-recbar__time')!.textContent).toBe('0:03')
    // 2 KB of fake chunk, rounded to the tenth of a MB the bar always shows.
    expect(q('.pulse-recbar__size')!.textContent).toBe('0.0 MB')
  })

  it('warns in the final 15 seconds before the cap', async () => {
    vi.useFakeTimers()
    await startRecording()

    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS - 10_000)

    expect(q('.pulse-recbar')!.classList.contains('pulse-recbar--ending')).toBe(true)
    expect(q('.pulse-recbar__countdown')!.textContent).toMatch(/^\d+s left$/)
  })

  it('leaves the bar out of screenshots for free — it lives inside #pulse-widget', async () => {
    await startRecording()

    expect(host().id).toBe('pulse-widget')
    expect(q('.pulse-recbar')!.getRootNode()).toBe(shadow)
    expect(host().contains(q('.pulse-recbar'))).toBe(false) // it is in the shadow tree
    expect(DEFAULT_EXCLUDE_SELECTORS).toContain('#pulse-widget')
  })
})

// -- stop vs discard ----------------------------------------------------------

describe('stop keeps, discard drops', () => {
  it('Stop ends the recording and attaches the video', async () => {
    await startRecording()

    click('.pulse-recbar__btn--stop')
    await flush()

    openVideo()

    expect(q('.pulse-video__player')).toBeTruthy()
    expect(q('.pulse-recbar')).toBeNull()
    expect(q('.pulse-panel')!.classList.contains('pulse-panel--visible')).toBe(true)
  })

  it('Discard drops it and returns to the panel with no video attached', async () => {
    await startRecording()

    click('.pulse-recbar__btn--discard')
    await flush()

    expect(q('.pulse-video__player')).toBeNull()
    expect(q('.pulse-record-btn')).toBeTruthy()
    expect(q('.pulse-recbar')).toBeNull()
    expect(q('.pulse-panel')!.classList.contains('pulse-panel--visible')).toBe(true)
  })

  it('Discard releases the shared stream, so the browser stops indicating capture', async () => {
    await startRecording()

    click('.pulse-recbar__btn--discard')
    await flush()

    expect(track.stop).toHaveBeenCalled()
  })

  /**
   * The regression this slice exists for: Esc used to call cancelRecording()
   * and silently destroy up to two minutes of capture.
   */
  it('Escape STOPS AND KEEPS rather than discarding', async () => {
    await startRecording()

    pressEscape()
    await flush()

    openVideo()

    expect(q('.pulse-video__player')).toBeTruthy()
    expect(q('.pulse-recbar')).toBeNull()
  })

  it('hitting the two-minute cap keeps the recording, same as Stop', async () => {
    vi.useFakeTimers()
    await startRecording()

    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS + 250)
    await flush()

    openVideo()

    expect(q('.pulse-video__player')).toBeTruthy()
    expect(q('.pulse-recbar')).toBeNull()
  })

  it('the browser’s own Stop sharing still keeps the recording', async () => {
    await startRecording()

    track.end()
    await flush()

    openVideo()

    expect(q('.pulse-video__player')).toBeTruthy()
    expect(q('.pulse-recbar')).toBeNull()
  })
})

// -- the honest constraint ----------------------------------------------------

describe('when this tab is the shared surface', () => {
  it('renders the slim bar and owns up to it in the panel afterwards', async () => {
    track = fakeTrack('browser')
    getDisplayMedia.mockImplementation(async () => fakeStream(track))

    await startRecording()
    expect(q('.pulse-recbar')!.classList.contains('pulse-recbar--slim')).toBe(true)

    click('.pulse-recbar__btn--stop')
    await flush()

    openVideo()
    expect(shadow.textContent).toContain(BAR_IN_RECORDING_NOTICE)
  })

  it('stays full-size and claims nothing when another surface is shared', async () => {
    await startRecording()
    expect(q('.pulse-recbar')!.classList.contains('pulse-recbar--slim')).toBe(false)

    click('.pulse-recbar__btn--stop')
    await flush()

    expect(shadow.textContent).not.toContain(BAR_IN_RECORDING_NOTICE)
  })

  it('claims nothing where the browser does not report a surface', async () => {
    track = fakeTrack(undefined)
    getDisplayMedia.mockImplementation(async () => fakeStream(track))

    await startRecording()
    expect(q('.pulse-recbar')!.classList.contains('pulse-recbar--slim')).toBe(false)

    click('.pulse-recbar__btn--stop')
    await flush()

    expect(shadow.textContent).not.toContain(BAR_IN_RECORDING_NOTICE)
  })

  it('drops the note with the recording it describes', async () => {
    track = fakeTrack('browser')
    getDisplayMedia.mockImplementation(async () => fakeStream(track))

    await startRecording()
    click('.pulse-recbar__btn--stop')
    await flush()

    // PULSE-402: removal moved onto the chip.
    click('.pulse-chip__remove')
    await flush()

    expect(shadow.textContent).not.toContain(BAR_IN_RECORDING_NOTICE)
  })
})

// -- failure paths ------------------------------------------------------------

describe('when the share prompt is declined', () => {
  it('tears the bar down and returns to the panel without an error', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    getDisplayMedia.mockRejectedValue(denied)

    await startRecording()

    expect(q('.pulse-recbar')).toBeNull()
    expect(q('.pulse-record-btn')).toBeTruthy()
    expect(q('.pulse-capture-note--error')).toBeNull()
    expect(host().style.display).not.toBe('none')
  })

  it('leaves no recorder behind, so the next attempt starts clean', async () => {
    getDisplayMedia.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    )
    await startRecording()

    click('.pulse-record-btn')
    await flush()

    expect(q('.pulse-recbar')).toBeTruthy()
    expect(instances).toHaveLength(1)
  })
})
