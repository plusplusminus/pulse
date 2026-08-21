// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { BAR_IN_RECORDING_NOTICE, FeedbackPanel, VOICE_OVER_NOTICE } from './panel'
import { CROSS_ORIGIN_NOTICE, ENGINE_LOAD_ERROR } from '../screenshot'
import type { WidgetPick } from '../types'

function pick(id: string, name: string, comment: string, intent: WidgetPick['intent'] = 'fix'): WidgetPick {
  return {
    id,
    elementPath: `main > ${name}`,
    name,
    classes: '',
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    nearbyText: '',
    comment,
    intent,
    isFixed: false,
  }
}

let shadow: ShadowRoot
let config: {
  onEditPick: Mock<(id: string) => void>
  onDeletePick: Mock<(id: string) => void>
  onPickElement: Mock<() => void>
  onTogglePause: Mock<() => void>
  onCaptureTab: Mock<() => void>
  onCaptureScreenshot: Mock<() => void>
  onRecordVideo: Mock<() => void>
  onRemoveVideo: Mock<() => void>
  onToggleVoiceOver: Mock<() => void>
}

function makePanel(
  allowElementPick = true,
  extra: {
    allowScreenshot?: boolean
    allowCaptureTab?: boolean
    allowVideo?: boolean
    allowVoiceOver?: boolean
  } = {}
): FeedbackPanel {
  return new FeedbackPanel(shadow, {
    position: 'bottom-right',
    allowElementPick,
    allowScreenshot: false,
    ...extra,
    onSubmit: vi.fn(async () => ({ id: '1', linearIssueId: null, linearIssueUrl: null, status: 'created' as const })),
    onClose: vi.fn(),
    onAnnotate: vi.fn(),
    onRetakeScreenshot: vi.fn(),
    ...config,
  })
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  shadow = document.getElementById('host')!.attachShadow({ mode: 'open' })
  config = {
    onEditPick: vi.fn<(id: string) => void>(),
    onDeletePick: vi.fn<(id: string) => void>(),
    onPickElement: vi.fn<() => void>(),
    onTogglePause: vi.fn<() => void>(),
    onCaptureTab: vi.fn<() => void>(),
    onCaptureScreenshot: vi.fn<() => void>(),
    onRecordVideo: vi.fn<() => void>(),
    onRemoveVideo: vi.fn<() => void>(),
    onToggleVoiceOver: vi.fn<() => void>(),
  }
})

describe('picks list', () => {
  it('renders a row per pick with name, intent badge, truncated comment and edit/delete', () => {
    const panel = makePanel()
    panel.setState('open')
    const long = 'x'.repeat(120)
    panel.setPicks([pick('a', 'button "Save"', long), pick('b', '3 elements: a, b+1 more', 'short', 'question')])

    const rows = shadow.querySelectorAll('.pulse-picks__row')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.pulse-picks__name')?.textContent).toBe('button "Save"')
    expect(rows[0].querySelector('.pulse-picks__intent')?.textContent).toBe('fix')
    expect(rows[0].querySelector('.pulse-picks__comment')?.textContent).toBe(`${'x'.repeat(80)}…`)
    expect(rows[1].querySelector('.pulse-picks__name')?.textContent).toBe('3 elements: a, b+1 more')
    expect(rows[1].querySelector('.pulse-picks__intent--question')).not.toBeNull()
    expect(rows[0].querySelectorAll('.pulse-picks__action')).toHaveLength(2)
  })

  it('routes edit and delete to the callbacks with the pick id', () => {
    const panel = makePanel()
    panel.setState('open')
    panel.setPicks([pick('a', 'button "Save"', 'c')])

    const row = shadow.querySelector('.pulse-picks__row')!
    ;(row.querySelector('.pulse-picks__action--edit') as HTMLButtonElement).click()
    expect(config.onEditPick).toHaveBeenCalledWith('a')
    ;(row.querySelector('.pulse-picks__action--delete') as HTMLButtonElement).click()
    expect(config.onDeletePick).toHaveBeenCalledWith('a')
  })

  // PULSE-402: the pick control is a fixed cell in the attach row now, so its
  // label no longer counts picks — it is a mode, and the row must not reflow.
  it('keeps one steady Element control in the attach row whether or not picks exist', () => {
    const panel = makePanel()
    panel.setState('open')
    expect(shadow.querySelector('.pulse-pick-btn span')?.textContent).toBe('Element')
    panel.setPicks([pick('a', 'button "Save"', '')])
    expect(shadow.querySelector('.pulse-pick-btn span')?.textContent).toBe('Element')
    ;(shadow.querySelector('.pulse-pick-btn') as HTMLButtonElement).click()
    expect(config.onPickElement).toHaveBeenCalled()
  })

  it('hides the whole picks section when element pick is off for the site', () => {
    const panel = makePanel(false)
    panel.setState('open')
    panel.setPicks([pick('a', 'button "Save"', '')])
    expect(shadow.querySelector('.pulse-picks')).toBeNull()
    expect(shadow.querySelector('.pulse-pick-btn')).toBeNull()
  })
})

// PULSE-402/399: the row's composition follows the site's capture gates and
// nothing else, so evidence arriving can never make Record slide under a
// pointer that was aiming at Screenshot.
describe('attach row layout', () => {
  const rowShape = () =>
    Array.from(shadow.querySelectorAll('.pulse-attach__row > *'))
      .map((el) => el.className)
      .join('|')

  it('is identical before and after a screenshot, a video and picks arrive', () => {
    URL.createObjectURL = vi.fn(() => 'blob:pulse/0')
    URL.revokeObjectURL = vi.fn()
    const panel = makePanel(true, { allowScreenshot: true, allowCaptureTab: true, allowVideo: true })
    panel.setState('open')
    const before = rowShape()

    panel.setScreenshot(new Blob(['png'], { type: 'image/png' }))
    panel.setVideo(new Blob(['x'.repeat(2048)], { type: 'video/webm' }), 12_000)
    panel.setPicks([pick('a', 'button "Save"', ''), pick('b', 'nav', '')])

    expect(shadow.querySelector('.pulse-video__player')).not.toBeNull()
    expect(shadow.querySelector('.pulse-screenshot__img')).not.toBeNull()
    expect(rowShape()).toBe(before)
  })

  it('survives an error and a voice-over note without reshuffling', () => {
    const panel = makePanel(true, { allowScreenshot: true, allowVideo: true, allowVoiceOver: true })
    panel.setState('open')
    const before = rowShape()

    panel.setCaptureError('Screenshot capture timed out')
    panel.setVideoError('Recording failed')
    panel.setVoiceOverNote('No microphone was available')

    expect(shadow.querySelectorAll('.pulse-attach .pulse-capture-note').length).toBe(3)
    expect(rowShape()).toBe(before)
  })
})

describe('pause toggle', () => {
  it('routes clicks to onTogglePause and reflects the state the widget reports back', () => {
    const panel = makePanel()
    panel.setState('open')

    const btn = shadow.querySelector('.pulse-header__pause') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.title).toBe('Pause page animations')

    btn.click()
    expect(config.onTogglePause).toHaveBeenCalledTimes(1)
    // The widget owns the freeze, so the panel only changes on setPaused.
    expect(btn.getAttribute('aria-pressed')).toBe('false')

    panel.setPaused(true)
    expect(panel.isPaused()).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.title).toBe('Resume page animations')
    expect(btn.classList.contains('pulse-header__pause--active')).toBe(true)

    panel.setPaused(false)
    expect(btn.classList.contains('pulse-header__pause--active')).toBe(false)
  })
})

describe('capture controls', () => {
  /** Opens a split button's popover the way a pointer or Enter would. */
  const openOptions = (label: string) => {
    const caret = shadow.querySelector(`.pulse-caret[aria-label="${label}"]`) as HTMLButtonElement
    caret.click()
    return caret
  }
  const optionLabels = () =>
    Array.from(shadow.querySelectorAll('.pulse-pop__name')).map((el) => el.textContent)
  const attachLabels = () =>
    Array.from(shadow.querySelectorAll('.pulse-attach__btn span')).map((el) => el.textContent)

  it('offers one Screenshot action in the row and its modes under the caret', () => {
    const panel = makePanel(false, { allowScreenshot: true, allowCaptureTab: true })
    panel.setState('open')
    expect(attachLabels()).toEqual(['Screenshot'])
    expect(optionLabels()).toEqual([])
    openOptions('Screenshot options')
    expect(optionLabels()).toEqual(['This viewport', 'Capture tab'])
  })

  it('hides Capture tab where the browser or the site does not allow it', () => {
    const panel = makePanel(false, { allowScreenshot: true, allowCaptureTab: false })
    panel.setState('open')
    openOptions('Screenshot options')
    // Absent, never a disabled control advertising a feature the site turned off.
    expect(optionLabels()).toEqual(['This viewport'])
    expect(shadow.querySelector('.pulse-pop__item[disabled]')).toBeNull()
  })

  it('routes the Capture tab click straight through, with nothing awaited first', () => {
    const panel = makePanel(false, { allowScreenshot: true, allowCaptureTab: true })
    panel.setState('open')
    openOptions('Screenshot options')
    const tabItem = Array.from(shadow.querySelectorAll('.pulse-pop__item')).find(
      (b) => b.querySelector('.pulse-pop__name')?.textContent === 'Capture tab'
    ) as HTMLButtonElement
    tabItem.click()
    expect(config.onCaptureTab).toHaveBeenCalledTimes(1)
  })

  it('takes a viewport screenshot from the row untouched, and from the popover', () => {
    const panel = makePanel(false, { allowScreenshot: true, allowCaptureTab: true })
    panel.setState('open')
    ;(shadow.querySelector('.pulse-attach__btn--shot') as HTMLButtonElement).click()
    expect(config.onCaptureScreenshot).toHaveBeenCalledTimes(1)

    openOptions('Screenshot options')
    ;(shadow.querySelector('.pulse-pop__item') as HTMLButtonElement).click()
    expect(config.onCaptureScreenshot).toHaveBeenCalledTimes(2)
  })

  it('carries the cross-origin notice inside the popover, where it is relevant', () => {
    const panel = makePanel(false, { allowScreenshot: true })
    panel.setState('open')
    expect(shadow.textContent).not.toContain(CROSS_ORIGIN_NOTICE)
    openOptions('Screenshot options')
    expect(
      Array.from(shadow.querySelectorAll('.pulse-pop__note')).map((n) => n.textContent)
    ).toContain(CROSS_ORIGIN_NOTICE)
  })

  it('keeps a capture error in the panel, never behind a caret', () => {
    const panel = makePanel(false, { allowScreenshot: true })
    panel.setState('open')
    expect(shadow.querySelector('.pulse-capture-note--error')).toBeNull()
    panel.setCaptureError('Screenshot capture timed out')
    const error = shadow.querySelector('.pulse-attach .pulse-capture-note--error')
    expect(error?.textContent).toBe('Screenshot capture timed out')
    expect(error?.getAttribute('role')).toBe('alert')
    panel.setCaptureError(null)
    expect(shadow.querySelector('.pulse-capture-note--error')).toBeNull()
  })

  it('surfaces an engine-load failure with Capture tab still on offer', () => {
    const panel = makePanel(false, { allowScreenshot: true, allowCaptureTab: true })
    panel.setState('open')
    panel.setCaptureError(ENGINE_LOAD_ERROR)

    expect(shadow.querySelector('.pulse-capture-note--error')?.textContent).toBe(ENGINE_LOAD_ERROR)
    // The panel is back in its resting state, not spinning, and the fallback
    // that needs no engine is still one click away.
    openOptions('Screenshot options')
    expect(optionLabels()).toContain('Capture tab')
  })

  it('hides the screenshot control and its caret when the site turns screenshots off', () => {
    const panel = makePanel(false, { allowScreenshot: false })
    panel.setState('open')
    expect(shadow.querySelector('.pulse-attach__btn--shot')).toBeNull()
    expect(shadow.querySelector('.pulse-caret[aria-label="Screenshot options"]')).toBeNull()
  })
})

describe('video recording controls (PULSE-338)', () => {
  const recordBtn = () => shadow.querySelector('.pulse-record-btn') as HTMLButtonElement | null

  /** jsdom has no blob URL registry; keep it deterministic and revocable. */
  function stubObjectUrls() {
    const created: string[] = []
    const revoked: string[] = []
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:pulse/${created.length}`
      created.push(url)
      return url
    })
    URL.revokeObjectURL = vi.fn((url: string) => revoked.push(url))
    return { created, revoked }
  }

  function clip(size = 2048) {
    return new Blob(['x'.repeat(size)], { type: 'video/webm;codecs=vp9' })
  }

  it('shows the record button only when the site and browser allow video', () => {
    const off = makePanel(false, { allowVideo: false })
    off.setState('open')
    expect(recordBtn()).toBeNull()

    document.body.innerHTML = '<div id="host2"></div>'
    shadow = document.getElementById('host2')!.attachShadow({ mode: 'open' })
    const on = makePanel(false, { allowVideo: true })
    on.setState('open')
    expect(recordBtn()?.querySelector('span')?.textContent).toBe('Record')
  })

  it('routes the record click straight through, with nothing awaited first', () => {
    const panel = makePanel(false, { allowVideo: true })
    panel.setState('open')
    recordBtn()!.click()
    expect(config.onRecordVideo).toHaveBeenCalledTimes(1)
  })

  it('points at the in-page control bar and says only Discard drops a recording', () => {
    const panel = makePanel(false, { allowVideo: true })
    panel.setState('open')
    // PULSE-402: the copy moved under the caret it describes.
    ;(shadow.querySelector('.pulse-caret[aria-label="Recording options"]') as HTMLButtonElement).click()
    const notes = Array.from(shadow.querySelectorAll('.pulse-pop__note')).map((n) => n.textContent)
    expect(notes.some((n) => n?.includes('control bar stays on the page'))).toBe(true)
    // Esc stops and KEEPS now (PULSE-399); the copy must not send anyone to
    // the browser's Stop sharing bar as if it were the only way out.
    expect(notes.some((n) => n?.includes('Only Discard drops a recording'))).toBe(true)
    expect(notes.some((n) => n?.includes('Stop sharing'))).toBe(false)
  })

  it('carries a post-recording notice only while there is a recording to describe', () => {
    stubObjectUrls()
    const panel = makePanel(false, { allowVideo: true })
    panel.setState('open')

    panel.setVideoNotice(BAR_IN_RECORDING_NOTICE)
    // No recording yet: nothing to own up to.
    expect(shadow.textContent).not.toContain(BAR_IN_RECORDING_NOTICE)

    panel.setVideo(clip(2048), 5_000)
    expect(shadow.textContent).toContain(BAR_IN_RECORDING_NOTICE)

    panel.setVideo(null)
    expect(shadow.textContent).not.toContain(BAR_IN_RECORDING_NOTICE)
  })

  it('adds a <video controls> preview with duration and size, leaving the row alone', () => {
    stubObjectUrls()
    const panel = makePanel(false, { allowVideo: true })
    panel.setState('open')

    panel.setVideo(clip(2048), 83_000)

    const video = shadow.querySelector('.pulse-video__player') as HTMLVideoElement
    expect(video).not.toBeNull()
    expect(video.controls).toBe(true)
    expect(video.src).toBe('blob:pulse/0')
    expect(shadow.querySelector('.pulse-video__meta')?.textContent).toBe('1:23 · 2 KB')
    // PULSE-402/399: attaching evidence must not move the attach row.
    expect(recordBtn()).not.toBeNull()
    expect(panel.getVideo()?.size).toBe(2048)
  })

  it('re-record reopens the prompt and replaces the previous blob', () => {
    const urls = stubObjectUrls()
    const panel = makePanel(false, { allowVideo: true })
    panel.setState('open')
    panel.setVideo(clip(1024), 5_000)

    const rerecord = Array.from(shadow.querySelectorAll('.pulse-screenshot__btn')).find(
      (b) => b.textContent === 'Re-record'
    ) as HTMLButtonElement
    rerecord.click()
    expect(config.onRecordVideo).toHaveBeenCalledTimes(1)

    panel.setVideo(clip(4096), 9_000)
    // The superseded blob URL is released rather than leaked.
    expect(urls.revoked).toContain('blob:pulse/0')
    expect(shadow.querySelector('.pulse-video__meta')?.textContent).toBe('0:09 · 4 KB')
  })

  it('remove clears the recording and brings the record button back', () => {
    const urls = stubObjectUrls()
    const panel = makePanel(false, { allowVideo: true })
    panel.setState('open')
    panel.setVideo(clip(), 3_000)

    const remove = shadow.querySelector('.pulse-screenshot__btn--danger') as HTMLButtonElement
    remove.click()
    expect(config.onRemoveVideo).toHaveBeenCalledTimes(1)

    // The widget owns the blob, so the panel only clears on setVideo(null).
    panel.setVideo(null)
    expect(shadow.querySelector('.pulse-video__player')).toBeNull()
    expect(recordBtn()).not.toBeNull()
    expect(panel.getVideo()).toBeNull()
    expect(urls.revoked).toContain('blob:pulse/0')
  })

  it('keeps showing a finished recording even if the site later disallows video', () => {
    stubObjectUrls()
    const panel = makePanel(false, { allowVideo: false })
    panel.setState('open')
    panel.setVideo(clip(), 1_000)
    expect(shadow.querySelector('.pulse-video__player')).not.toBeNull()
  })

  it('surfaces a recording error above the notice', () => {
    const panel = makePanel(false, { allowVideo: true })
    panel.setState('open')
    expect(shadow.querySelector('.pulse-capture-note--error')).toBeNull()

    panel.setVideoError('This browser cannot record video')
    expect(shadow.querySelector('.pulse-capture-note--error')?.textContent).toBe(
      'This browser cannot record video'
    )

    panel.setVideoError(null)
    expect(shadow.querySelector('.pulse-capture-note--error')).toBeNull()
  })

  it('formats durations and sizes for the readout', () => {
    expect(FeedbackPanel.formatDuration(0)).toBe('0:00')
    expect(FeedbackPanel.formatDuration(7_400)).toBe('0:07')
    expect(FeedbackPanel.formatDuration(83_000)).toBe('1:23')
    expect(FeedbackPanel.formatDuration(120_000)).toBe('2:00')

    expect(FeedbackPanel.formatBytes(512)).toBe('512 B')
    expect(FeedbackPanel.formatBytes(2048)).toBe('2 KB')
    expect(FeedbackPanel.formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('reports upload progress on the submit button, then falls back to submitting', () => {
    const panel = makePanel(false, { allowVideo: true })
    panel.setState('open')
    panel.setState('submitting')

    const label = () => shadow.querySelector('.pulse-submit span')?.textContent

    panel.setUploadProgress(25, 100)
    expect(label()).toBe('Uploading 25%')
    panel.setUploadProgress(90, 100)
    expect(label()).toBe('Uploading 90%')
    panel.setUploadProgress(100, 100)
    expect(label()).toBe('Submitting...')
  })
})

describe('voice-over opt-in (PULSE-400)', () => {
  const toggle = () =>
    shadow.querySelector('.pulse-voiceover__toggle') as HTMLButtonElement | null
  const noteTexts = () =>
    Array.from(shadow.querySelectorAll('.pulse-capture-note')).map((n) => n.textContent ?? '')

  it('renders nothing when the site does not allow a microphone', () => {
    const panel = makePanel(false, { allowVideo: true, allowVoiceOver: false })
    panel.setState('open')

    expect(toggle()).toBeNull()
    expect(noteTexts()).not.toContain(VOICE_OVER_NOTICE)
    // The record button is untouched: voice-over is an option on video, not video.
    expect(shadow.querySelector('.pulse-record-btn')).not.toBeNull()
  })

  it('states that audio is captured before the toggle is ever clicked', () => {
    const panel = makePanel(false, { allowVideo: true, allowVoiceOver: true })
    panel.setState('open')

    expect(noteTexts()).toContain(VOICE_OVER_NOTICE)
    expect(config.onToggleVoiceOver).not.toHaveBeenCalled()
  })

  it('sits with the record control, so the choice comes before the picker', () => {
    const panel = makePanel(false, { allowVideo: true, allowVoiceOver: true })
    panel.setState('open')

    const body = shadow.querySelector('.pulse-body')!
    const order = Array.from(body.children).map((c) => c.className)
    const voiceOver = order.findIndex((c) => c.includes('pulse-voiceover'))
    const record = order.findIndex((c) => c.includes('pulse-attach'))
    expect(voiceOver).toBeGreaterThanOrEqual(0)
    expect(record).toBeGreaterThanOrEqual(0)
    expect(record).toBeLessThan(voiceOver)
  })

  it('routes the click straight through — getUserMedia needs that activation', () => {
    const panel = makePanel(false, { allowVideo: true, allowVoiceOver: true })
    panel.setState('open')

    toggle()!.click()

    expect(config.onToggleVoiceOver).toHaveBeenCalledTimes(1)
  })

  it('reflects state in aria-pressed and in a word, never in colour alone', () => {
    const panel = makePanel(false, { allowVideo: true, allowVoiceOver: true })
    panel.setState('open')
    expect(toggle()!.getAttribute('aria-pressed')).toBe('false')
    expect(shadow.querySelector('.pulse-voiceover__state')!.textContent).toBe('Off')

    panel.setVoiceOver(true)

    expect(toggle()!.getAttribute('aria-pressed')).toBe('true')
    expect(shadow.querySelector('.pulse-voiceover__state')!.textContent).toBe('On')
    expect(panel.isVoiceOverOn()).toBe(true)
  })

  it('shows a microphone problem as a status, not as a form error', () => {
    const panel = makePanel(false, { allowVideo: true, allowVoiceOver: true })
    panel.setState('open')

    panel.setVoiceOverNote('No microphone was found — the recording continues without voice-over.')

    const note = shadow.querySelector('.pulse-voiceover .pulse-capture-note--error')!
    expect(note.textContent).toContain('No microphone was found')
    // status, not alert: nothing failed, the recording just has no narration.
    expect(note.getAttribute('role')).toBe('status')
  })

  it('keeps the option visible next to a finished recording, so Re-record obeys it', () => {
    URL.createObjectURL = vi.fn(() => 'blob:pulse/0')
    URL.revokeObjectURL = vi.fn()
    const panel = makePanel(false, { allowVideo: true, allowVoiceOver: true })
    panel.setState('open')
    panel.setVoiceOver(true)
    panel.setVideo(new Blob(['x'], { type: 'video/webm;codecs=vp9,opus' }), 1_000)

    expect(toggle()!.getAttribute('aria-pressed')).toBe('true')
    expect(shadow.querySelector('.pulse-video__player')).not.toBeNull()
  })
})
