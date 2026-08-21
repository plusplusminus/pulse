// @vitest-environment jsdom
/**
 * Voice-over end to end (PULSE-400).
 *
 * Drives the real Widget through the real panel and bar DOM — the shadow root
 * is forced open for the test only — so these assertions are about what a
 * reporter clicks and what reaches `MediaRecorder`, not about private methods.
 *
 * The two rules everything else hangs off:
 *
 *   1. No `getUserMedia` call may happen unless the reporter opted in on a
 *      site whose `capture.voiceOver` is true.
 *   2. Mute is `track.enabled = false`, never `track.stop()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Widget, type PulseCore } from './widget'
import { AUDIO_MIME_CANDIDATES, MIME_CANDIDATES } from './capture/video'
import { setWebmDurationFixer } from './capture/webm-duration'
import { VOICE_OVER_NOTICE } from './ui/panel'
import type { RuntimeConfig } from './types'

// -- fakes -------------------------------------------------------------------

type Listener = () => void

function fakeTrack(kind: 'video' | 'audio', displaySurface?: string) {
  const listeners: Listener[] = []
  return {
    kind,
    enabled: true,
    stop: vi.fn(function (this: { readyState?: string }) {
      this.readyState = 'ended'
    }),
    getSettings: () => (displaySurface ? { displaySurface } : {}),
    addEventListener: vi.fn((event: string, fn: Listener) => {
      if (event === 'ended') listeners.push(fn)
    }),
    end: () => listeners.forEach((fn) => fn()),
  }
}

type FakeTrack = ReturnType<typeof fakeTrack>

function streamOf(tracks: FakeTrack[]) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream
}

let instances: FakeMediaRecorder[] = []

class FakeMediaRecorder {
  static isTypeSupported = vi.fn((type: string) =>
    [...AUDIO_MIME_CANDIDATES, ...MIME_CANDIDATES].includes(type as never)
  )

  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(
    readonly stream: MediaStream,
    readonly options: { mimeType: string; audioBitsPerSecond?: number }
  ) {
    instances.push(this)
  }

  get mimeType(): string {
    return this.options.mimeType
  }

  start(): void {
    this.state = 'recording'
    this.ondataavailable?.({ data: new Blob(['x'.repeat(2048)]) })
  }

  stop(): void {
    this.state = 'inactive'
    this.onstop?.()
  }
}

/**
 * A real `MediaStream` is not available in jsdom, and the widget composes one
 * with `new MediaStream([...])`. This stands in for the constructor, keeping
 * the track identities so the assertions can follow the microphone through.
 */
class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}
  getTracks(): FakeTrack[] {
    return this.tracks
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'video')
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
}

/** Web Audio is absent in jsdom; the meter is built to no-op without it. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

// -- harness -----------------------------------------------------------------

let shadow: ShadowRoot
let widget: Widget
let videoTrack: FakeTrack
let micTrack: FakeTrack
let getDisplayMedia: ReturnType<typeof vi.fn>
let getUserMedia: ReturnType<typeof vi.fn>

function config(voiceOver: boolean): RuntimeConfig {
  return {
    siteKey: 'test',
    apiUrl: 'https://pulse.test',
    siteName: 'Test',
    ui: { theme: 'light', position: 'bottom-right', triggerText: 'Feedback' },
    capture: {
      screenshot: false,
      captureTab: false,
      elementPick: false,
      video: true,
      voiceOver,
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
    getRuntimeConfig: vi.fn(() => config(true)),
    getUser: vi.fn(() => ({})),
  }
}

function mount(voiceOver = true): void {
  const attach = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit
  ) {
    shadow = attach.call(this, { ...init, mode: 'open' })
    return shadow
  })
  widget = new Widget(core(), config(voiceOver))
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

function notes(): string[] {
  // PULSE-402: consent copy moved under the Record caret it belongs to.
  return Array.from(shadow.querySelectorAll('.pulse-capture-note, .pulse-pop__note')).map(
    (n) => n.textContent ?? ''
  )
}

/** Voice-over is a setting on Record, so it is reached through Record's caret. */
/** PULSE-402: a finished recording is a chip; its preview is one click in. */
function openVideo(): void {
  click('.pulse-chip__open--video')
}

function openRecordOptions(): void {
  click('.pulse-caret[aria-label="Recording options"]')
}

/** Open the panel and turn the voice-over option on, the way a reporter does. */
async function optIn(): Promise<void> {
  click('.pulse-trigger')
  openRecordOptions()
  click('.pulse-voiceover__toggle')
  await flush()
}

async function record(): Promise<void> {
  click('.pulse-record-btn')
  await flush()
}

/** The stream MediaRecorder was actually handed. */
function recordedStream(): FakeMediaStream {
  return instances[0].stream as unknown as FakeMediaStream
}

beforeEach(() => {
  document.body.innerHTML = ''
  instances = []
  videoTrack = fakeTrack('video', 'monitor')
  micTrack = fakeTrack('audio')
  getDisplayMedia = vi.fn(async () => streamOf([videoTrack]))
  getUserMedia = vi.fn(async () => streamOf([micTrack]))

  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia, getUserMedia },
    configurable: true,
  })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('MediaStream', FakeMediaStream)
  URL.createObjectURL = vi.fn(() => 'blob:pulse/1')
  URL.revokeObjectURL = vi.fn()
  setWebmDurationFixer({ fixWebmDuration: async (blob: Blob) => blob })
})

afterEach(() => {
  widget.destroy()
  setWebmDurationFixer(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// -- the site has to allow it -------------------------------------------------

describe('capture.voiceOver false', () => {
  beforeEach(() => mount(false))

  it('renders no voice-over option at all', () => {
    click('.pulse-trigger')
    openRecordOptions()
    expect(q('.pulse-voiceover__toggle')).toBeNull()
    expect(q('.pulse-record-btn')).not.toBeNull()
  })

  it('never calls getUserMedia, not even through a whole recording', async () => {
    click('.pulse-trigger')
    await record()
    click('.pulse-recbar__btn--stop')
    await flush()

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('puts no mic control and no level meter in the recording bar', async () => {
    click('.pulse-trigger')
    await record()

    expect(q('.pulse-recbar')).not.toBeNull()
    expect(q('.pulse-recbar__mic')).toBeNull()
    expect(q('.pulse-recbar__level')).toBeNull()
  })

  it('records a video-only MIME type', async () => {
    click('.pulse-trigger')
    await record()

    expect(instances[0].options.mimeType).toBe('video/webm;codecs=vp9')
  })
})

// -- opting in ----------------------------------------------------------------

describe('the opt-in', () => {
  beforeEach(() => mount(true))

  it('says audio is captured BEFORE the prompt can appear', () => {
    click('.pulse-trigger')
    openRecordOptions()

    expect(notes()).toContain(VOICE_OVER_NOTICE)
    expect(VOICE_OVER_NOTICE).toMatch(/microphone is recorded/i)
    // The copy is on screen and getUserMedia has not been called yet.
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('is off until the reporter turns it on', () => {
    click('.pulse-trigger')
    openRecordOptions()
    expect(q('.pulse-voiceover__toggle')!.getAttribute('aria-pressed')).toBe('false')
    expect(q('.pulse-voiceover__state')!.textContent).toBe('Off')
  })

  it('prompts once, on the opt-in click and not on Record', async () => {
    await optIn()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(q('.pulse-voiceover__toggle')!.getAttribute('aria-pressed')).toBe('true')
    expect(q('.pulse-voiceover__state')!.textContent).toBe('On')
  })

  it('releases the probe stream, so no microphone sits open while the form is filled in', async () => {
    await optIn()

    // The prompt was the point; a live mic during form-filling is not.
    expect(micTrack.stop).toHaveBeenCalledTimes(1)
  })

  it('turns back off without a second prompt', async () => {
    await optIn()
    click('.pulse-voiceover__toggle')
    await flush()

    // The popover stayed open across the state change, so the answer is in view.
    expect(q('.pulse-voiceover__toggle')!.getAttribute('aria-pressed')).toBe('false')
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})

// -- a declined microphone must not cost the recording ------------------------

describe('a microphone that will not open', () => {
  beforeEach(() => mount(true))

  function deny(name = 'NotAllowedError'): void {
    getUserMedia.mockRejectedValue(Object.assign(new Error(name), { name }))
  }

  it('leaves the option off and explains, rather than erroring', async () => {
    deny()
    await optIn()

    expect(q('.pulse-voiceover__toggle')!.getAttribute('aria-pressed')).toBe('false')
    expect(notes().join(' ')).toMatch(/declined/i)
    expect(notes().join(' ')).toMatch(/recording continues without it/i)
  })

  it('still records video after a declined prompt', async () => {
    deny()
    await optIn()
    await record()

    expect(q('.pulse-recbar')).not.toBeNull()
    click('.pulse-recbar__btn--stop')
    await flush()
    openVideo()
    expect(q('.pulse-video__player')).not.toBeNull()
  })

  it('degrades to silent video when the mic dies between opt-in and Record', async () => {
    await optIn()
    deny('NotFoundError')

    await record()

    // The recording started and is running, silently.
    expect(q('.pulse-recbar')).not.toBeNull()
    expect(instances).toHaveLength(1)
    expect(recordedStream().getAudioTracks()).toHaveLength(0)
    expect(instances[0].options.mimeType).toBe('video/webm;codecs=vp9')
  })

  it('says "No mic" in the bar rather than letting the reporter narrate into nothing', async () => {
    await optIn()
    getUserMedia.mockResolvedValue(streamOf([]))

    await record()

    expect(q('.pulse-recbar__mic-text')!.textContent).toBe('No mic')
    expect((q('.pulse-recbar__mic') as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains the silence in the panel once the recording is over', async () => {
    await optIn()
    deny('NotFoundError')
    await record()
    click('.pulse-recbar__btn--stop')
    await flush()

    expect(notes().join(' ')).toMatch(/No microphone was found/i)
  })

  it('releases a microphone opened just before the share prompt was declined', async () => {
    await optIn()
    micTrack.stop.mockClear()
    getDisplayMedia.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))

    await record()

    // Otherwise the tab keeps a microphone indicator for a recording that
    // never started.
    expect(micTrack.stop).toHaveBeenCalledTimes(1)
  })
})

// -- recording with a voice-over ----------------------------------------------

describe('recording with a voice-over', () => {
  beforeEach(async () => {
    mount(true)
    await optIn()
    micTrack.stop.mockClear()
    await record()
  })

  it('hands MediaRecorder one stream carrying both the display video and the mic', () => {
    const stream = recordedStream()
    expect(stream.getVideoTracks()).toEqual([videoTrack])
    expect(stream.getAudioTracks()).toEqual([micTrack])
    expect(stream.getTracks()).toHaveLength(2)
  })

  it('negotiates an Opus-paired container so the audio is actually written', () => {
    expect(instances[0].options.mimeType).toBe('video/webm;codecs=vp9,opus')
  })

  it('never asks getDisplayMedia for audio — tab audio is a different thing entirely', () => {
    expect(getDisplayMedia.mock.calls[0][0].audio).toBe(false)
  })

  it('shows the mic live in the bar, in icon and text', () => {
    expect(q('.pulse-recbar__mic-text')!.textContent).toBe('Mic on')
    expect(q('.pulse-recbar__mic')!.getAttribute('aria-pressed')).toBe('true')
    expect(q('.pulse-recbar__level')).not.toBeNull()
  })

  it('mutes with enabled = false and NEVER with stop()', () => {
    click('.pulse-recbar__mic')

    expect(micTrack.enabled).toBe(false)
    // A stopped track cannot be revived and can desync what is already written.
    expect(micTrack.stop).not.toHaveBeenCalled()
    expect(q('.pulse-recbar__mic-text')!.textContent).toBe('Mic muted')
    expect(q('.pulse-recbar__mic')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('restores audio mid-recording when unmuted', () => {
    click('.pulse-recbar__mic')
    click('.pulse-recbar__mic')

    expect(micTrack.enabled).toBe(true)
    expect(micTrack.stop).not.toHaveBeenCalled()
    expect(q('.pulse-recbar__mic-text')!.textContent).toBe('Mic on')
  })

  it('survives a burst of mute toggles without ever stopping the track', () => {
    for (let i = 0; i < 7; i++) click('.pulse-recbar__mic')

    expect(micTrack.enabled).toBe(false)
    expect(micTrack.stop).not.toHaveBeenCalled()
    // The recorder was never rebuilt; it is still the same recording.
    expect(instances).toHaveLength(1)
  })

  it('keeps the recording running while muted — silence, not a stop', () => {
    click('.pulse-recbar__mic')

    expect(instances[0].state).toBe('recording')
    expect(q('.pulse-recbar')).not.toBeNull()
  })

  it('drops the level meter to the floor while muted', () => {
    click('.pulse-recbar__mic')
    expect((q('.pulse-recbar__level-fill') as HTMLElement).style.width).toBe('0%')
  })

  it('stops the microphone on Stop, so no indicator lingers in the tab', async () => {
    click('.pulse-recbar__btn--stop')
    await flush()

    expect(micTrack.stop).toHaveBeenCalledTimes(1)
    expect(videoTrack.stop).toHaveBeenCalledTimes(1)
    openVideo()
    expect(q('.pulse-video__player')).not.toBeNull()
  })

  it('stops the microphone on Discard', async () => {
    click('.pulse-recbar__btn--discard')
    await flush()

    expect(micTrack.stop).toHaveBeenCalledTimes(1)
    expect(q('.pulse-video__player')).toBeNull()
  })

  it('stops the microphone when Escape stops and keeps', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()

    expect(micTrack.stop).toHaveBeenCalledTimes(1)
    openVideo()
    expect(q('.pulse-video__player')).not.toBeNull()
  })

  it('stops the microphone when the widget is destroyed mid-recording', () => {
    widget.destroy()
    expect(micTrack.stop).toHaveBeenCalled()
    // destroy() runs again in afterEach; it must stay safe.
  })

  it('keeps the opt-in for a re-record, prompting no second time', async () => {
    click('.pulse-recbar__btn--stop')
    await flush()
    const calls = getUserMedia.mock.calls.length

    openRecordOptions()
    click('.pulse-voiceover__toggle')
    expect(q('.pulse-voiceover__toggle')!.getAttribute('aria-pressed')).toBe('false')
    // Turning it off is free; turning it back on re-uses the granted permission.
    click('.pulse-voiceover__toggle')
    await flush()
    expect(getUserMedia.mock.calls.length).toBe(calls + 1)
  })
})

// -- after a submitted report -------------------------------------------------

describe('after a report is submitted', () => {
  it('clears the opt-in, so the next reporter chooses the microphone again', async () => {
    mount(true)
    await optIn()

    const set = (selector: string, value: string) => {
      const input = shadow.querySelector(selector) as HTMLInputElement | null
      if (!input) throw new Error(`missing input ${selector}`)
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('input.pulse-input[type="text"]', 'A bug')
    set('input.pulse-input[type="email"]', 'r@example.com')
    click('.pulse-submit')
    await flush()

    // "Send Another" is the route back into a blank form.
    const again = Array.from(shadow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Send Another'
    )
    expect(again).toBeTruthy()
    again!.click()

    expect(q('.pulse-voiceover__toggle')!.getAttribute('aria-pressed')).toBe('false')
    // ...and the widget agrees, so Record does not quietly open a microphone.
    click('.pulse-record-btn')
    await flush()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})
