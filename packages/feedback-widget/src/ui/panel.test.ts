// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { FeedbackPanel } from './panel'
import { ENGINE_LOAD_ERROR } from '../screenshot'
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
}

function makePanel(allowElementPick = true, extra: { allowScreenshot?: boolean; allowCaptureTab?: boolean } = {}): FeedbackPanel {
  return new FeedbackPanel(shadow, {
    position: 'bottom-right',
    allowElementPick,
    allowScreenshot: false,
    ...extra,
    onSubmit: vi.fn(async () => ({ id: '1', linearIssueId: null, linearIssueUrl: null, status: 'created' as const })),
    onClose: vi.fn(),
    onAnnotate: vi.fn(),
    onRetakeScreenshot: vi.fn(),
    onCaptureScreenshot: vi.fn(),
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

  it('labels the pick button "Pick another element" once picks exist', () => {
    const panel = makePanel()
    panel.setState('open')
    expect(shadow.querySelector('.pulse-pick-btn span')?.textContent).toBe('Pick element')
    panel.setPicks([pick('a', 'button "Save"', '')])
    expect(shadow.querySelector('.pulse-pick-btn span')?.textContent).toBe('Pick another element')
    ;(shadow.querySelector('.pulse-pick-btn') as HTMLButtonElement).click()
    expect(config.onPickElement).toHaveBeenCalled()
  })

  it('hides the whole picks section when element pick is off for the site', () => {
    const panel = makePanel(false)
    panel.setState('open')
    panel.setPicks([pick('a', 'button "Save"', '')])
    expect(shadow.querySelector('.pulse-picks')).toBeNull()
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
  const labels = () =>
    Array.from(shadow.querySelectorAll('.pulse-add-screenshot span')).map((el) => el.textContent)

  it('shows Capture tab beside the screenshot button only when allowed', () => {
    const panel = makePanel(false, { allowScreenshot: true, allowCaptureTab: true })
    panel.setState('open')
    expect(labels()).toEqual(['Add screenshot', 'Capture tab'])
  })

  it('hides Capture tab where the browser or the site does not allow it', () => {
    const panel = makePanel(false, { allowScreenshot: true, allowCaptureTab: false })
    panel.setState('open')
    expect(labels()).toEqual(['Add screenshot'])
  })

  it('routes the Capture tab click straight through, with nothing awaited first', () => {
    const panel = makePanel(false, { allowScreenshot: true, allowCaptureTab: true })
    panel.setState('open')
    const tabBtn = Array.from(shadow.querySelectorAll('.pulse-add-screenshot')).find(
      (b) => b.querySelector('span')?.textContent === 'Capture tab'
    ) as HTMLButtonElement
    tabBtn.click()
    expect(config.onCaptureTab).toHaveBeenCalledTimes(1)
  })

  it('shows a capture error and always shows the cross-origin notice', () => {
    const panel = makePanel(false, { allowScreenshot: true })
    panel.setState('open')
    expect(shadow.querySelector('.pulse-capture-note--error')).toBeNull()
    panel.setCaptureError('Screenshot capture timed out')
    const error = shadow.querySelector('.pulse-capture-note--error')
    expect(error?.textContent).toBe('Screenshot capture timed out')
    expect(shadow.querySelectorAll('.pulse-capture-note').length).toBe(2)
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
    expect(labels()).toContain('Capture tab')
  })
})
