// @vitest-environment jsdom
/**
 * The Annotate flow end to end (PULSE-401).
 *
 * Drives the real Widget through the real panel DOM — the shadow root is forced
 * open for the test only — because what is worth guarding here only exists once
 * everything is wired together: the editor arrives over the network, a failed
 * fetch must not cost the reporter their screenshot, and a retake must not
 * carry the previous capture's marks or crop onto a new bitmap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Widget, type PulseCore } from './widget'
import type { AnnotationEditorState, RuntimeConfig } from './types'
import {
  EDITOR_LOAD_ERROR,
  setAnnotationEditorModule,
  type AnnotationEditorConfig,
  type AnnotationEditorModule,
} from './ui/annotation'

let shadow: ShadowRoot
let widget: Widget

function config(): RuntimeConfig {
  return {
    siteKey: 'test',
    apiUrl: 'https://pulse.test',
    siteName: 'Test',
    ui: { theme: 'light', position: 'bottom-right', triggerText: 'Feedback' },
    capture: {
      screenshot: true,
      captureTab: false,
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

let captured = 0

function core(): PulseCore {
  return {
    submitFeedback: vi.fn(async () => ({
      id: '1',
      linearIssueId: null,
      linearIssueUrl: null,
      status: 'created' as const,
    })),
    captureScreenshot: vi.fn(async () => {
      captured++
      return new Blob([`png-${captured}`], { type: 'image/png' })
    }),
    setWidgetHost: vi.fn(),
    getRuntimeConfig: vi.fn(() => config()),
    getUser: vi.fn(() => ({})),
  }
}

/** Records every show() the widget makes, and lets a test drive save/cancel. */
interface FakeEditor {
  shows: Array<AnnotationEditorState | null | undefined>
  configs: AnnotationEditorConfig[]
  themes: string[]
  module: AnnotationEditorModule
}

function fakeEditorModule(): FakeEditor {
  const fake: FakeEditor = {
    shows: [],
    configs: [],
    themes: [],
    module: {} as AnnotationEditorModule,
  }
  fake.module = {
    createAnnotationEditor: (_root, editorConfig, theme) => {
      fake.configs.push(editorConfig)
      fake.themes.push(theme)
      return {
        show: async (_blob, state) => {
          fake.shows.push(state)
        },
        hide: () => {},
        destroy: () => {},
      }
    },
  }
  return fake
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

function button(text: string): HTMLButtonElement {
  const found = Array.from(shadow.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text
  )
  if (!found) throw new Error(`no button labelled ${text}`)
  return found
}

/**
 * Opens the panel, attaches a capture, and expands its chip — Annotate lives
 * inside the expanded screenshot chip since the PULSE-402 panel restructure.
 */
async function attachScreenshot(): Promise<void> {
  widget.open()
  button('Screenshot').click()
  await vi.waitFor(() => {
    const chip = shadow.querySelector<HTMLButtonElement>('.pulse-chip__open--shot')
    if (!chip) throw new Error('no screenshot chip')
    return chip
  })
  shadow.querySelector<HTMLButtonElement>('.pulse-chip__open--shot')!.click()
  await vi.waitFor(() => button('Annotate'))
}

beforeEach(() => {
  captured = 0
  document.body.innerHTML = ''
  setAnnotationEditorModule(null)
  delete window.__PulseAnnotationEditor
  document.head.innerHTML = ''
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia: vi.fn(), getUserMedia: vi.fn() },
    configurable: true,
  })
  URL.createObjectURL = vi.fn(() => 'blob:pulse/1')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  widget.destroy()
  setAnnotationEditorModule(null)
  delete window.__PulseAnnotationEditor
  vi.restoreAllMocks()
})

describe('Annotate', () => {
  it('does not fetch the editor until Annotate is actually clicked', async () => {
    mount()
    await attachScreenshot()
    expect(document.querySelector('script[data-pulse-annotation-editor]')).toBeNull()

    button('Annotate').click()
    await vi.waitFor(() =>
      expect(document.querySelector('script[data-pulse-annotation-editor]')).not.toBeNull()
    )
  })

  it('opens the editor with no prior state on a fresh capture', async () => {
    const fake = fakeEditorModule()
    setAnnotationEditorModule(fake.module)
    mount()
    await attachScreenshot()

    button('Annotate').click()
    await vi.waitFor(() => expect(fake.shows).toHaveLength(1))
    expect(fake.shows[0]).toBeNull()
    expect(fake.themes[0]).toBe('light')
  })

  it('hands the previous session back when Annotate is clicked again', async () => {
    const fake = fakeEditorModule()
    setAnnotationEditorModule(fake.module)
    mount()
    await attachScreenshot()

    button('Annotate').click()
    await vi.waitFor(() => expect(fake.configs).toHaveLength(1))

    const state: AnnotationEditorState = {
      annotations: [{ kind: 'highlight', x: 1, y: 2, w: 3, h: 4 }],
      crop: { x: 5, y: 6, w: 7, h: 8 },
    }
    fake.configs[0].onSave(
      new Blob(['flattened'], { type: 'image/png' }),
      [{ kind: 'highlight', x: 0, y: 0, w: 3, h: 4 }],
      state
    )

    button('Annotate').click()
    await vi.waitFor(() => expect(fake.shows).toHaveLength(2))
    expect(fake.shows[1]).toEqual(state)
  })

  it('gives a second capture its own blank session, leaving the first one marked', async () => {
    const fake = fakeEditorModule()
    setAnnotationEditorModule(fake.module)
    mount()
    await attachScreenshot()

    button('Annotate').click()
    await vi.waitFor(() => expect(fake.configs).toHaveLength(1))
    const first: AnnotationEditorState = {
      annotations: [{ kind: 'hide', x: 1, y: 2, w: 3, h: 4 }],
      crop: { x: 5, y: 6, w: 7, h: 8 },
    }
    fake.configs[0].onSave(new Blob(['flattened'], { type: 'image/png' }), [], first)

    // "Add another" appends (PULSE-403); the marked screenshot is untouched.
    button('Add another').click()
    await vi.waitFor(() => expect(captured).toBe(2))
    await vi.waitFor(() =>
      expect(shadow.querySelectorAll('.pulse-chip__open--shot')).toHaveLength(2)
    )

    const chips = shadow.querySelectorAll<HTMLButtonElement>('.pulse-chip__open--shot')
    chips[1].click()
    button('Annotate').click()
    await vi.waitFor(() => expect(fake.shows).toHaveLength(2))
    expect(fake.shows[1]).toBeNull()

    chips[0].click()
    button('Annotate').click()
    await vi.waitFor(() => expect(fake.shows).toHaveLength(3))
    expect(fake.shows[2]).toEqual(first)
  })

  it('goes full-screen only once the editor has arrived', async () => {
    const fake = fakeEditorModule()
    setAnnotationEditorModule(fake.module)
    mount()
    await attachScreenshot()

    const host = document.getElementById('pulse-widget')
    expect(host?.classList.contains('pulse-annotating')).toBe(false)
    button('Annotate').click()
    await vi.waitFor(() => expect(fake.shows).toHaveLength(1))
    expect(host?.classList.contains('pulse-annotating')).toBe(true)
  })

  it('keeps the screenshot and says so when the editor cannot be fetched', async () => {
    mount()
    await attachScreenshot()

    button('Annotate').click()
    await vi.waitFor(() =>
      expect(document.querySelector('script[data-pulse-annotation-editor]')).not.toBeNull()
    )
    document.querySelector('script[data-pulse-annotation-editor]')!.dispatchEvent(new Event('error'))

    await vi.waitFor(() => expect(shadow.textContent).toContain(EDITOR_LOAD_ERROR))
    const host = document.getElementById('pulse-widget')
    expect(host?.classList.contains('pulse-annotating')).toBe(false)
    // The capture is still attached: annotation failed, the screenshot did not.
    expect(button('Add another')).toBeTruthy()
  })
})
