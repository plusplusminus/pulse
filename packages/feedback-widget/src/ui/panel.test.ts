// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { FeedbackPanel } from './panel'
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
}

function makePanel(allowElementPick = true): FeedbackPanel {
  return new FeedbackPanel(shadow, {
    position: 'bottom-right',
    allowElementPick,
    allowScreenshot: false,
    onSubmit: vi.fn(async () => ({ id: '1', linearIssueId: null, linearIssueUrl: null, status: 'created' as const })),
    onClose: vi.fn(),
    onAnnotate: vi.fn(),
    onRetakeScreenshot: vi.fn(),
    onCaptureScreenshot: vi.fn(),
    onCaptureFullScreen: vi.fn(),
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
