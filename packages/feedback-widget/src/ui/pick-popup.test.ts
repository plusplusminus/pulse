// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { PickPopup, popupPosition, type PickPopupResult } from './pick-popup'

describe('popupPosition', () => {
  const vp = { width: 1000, height: 800 }
  it('centres under the marker with a 20px gap', () => {
    expect(popupPosition({ xPercent: 50, y: 100 }, vp)).toEqual({ left: 500, top: 120 })
  })
  it('clamps 160px from either edge', () => {
    expect(popupPosition({ xPercent: 2, y: 100 }, vp).left).toBe(160)
    expect(popupPosition({ xPercent: 99, y: 100 }, vp).left).toBe(840)
  })
  it('flips above the marker within 290px of the bottom', () => {
    expect(popupPosition({ xPercent: 50, y: 511 }, vp)).toEqual({ left: 500, bottom: 800 - 511 + 20 })
    expect(popupPosition({ xPercent: 50, y: 510 }, vp)).toEqual({ left: 500, top: 530 })
  })
})

describe('PickPopup', () => {
  let shadow: ShadowRoot
  let onSave: Mock<(result: PickPopupResult) => void>
  let onCancel: Mock<() => void>
  let popup: PickPopup

  beforeEach(() => {
    document.body.innerHTML = '<div id="h"></div>'
    shadow = document.getElementById('h')!.attachShadow({ mode: 'open' })
    onSave = vi.fn<(result: PickPopupResult) => void>()
    onCancel = vi.fn<() => void>()
    popup = new PickPopup(shadow, { onSave, onCancel })
  })

  it('renders title, 4 intents (fix default), textarea and saves the trimmed comment + intent', () => {
    popup.open({ xPercent: 50, y: 100 }, { title: 'button "Go"' })
    expect(popup.isOpen).toBe(true)
    const el = shadow.querySelector('.pulse-pick-popup') as HTMLElement
    expect(el.querySelector('.pulse-pick-popup__title')!.textContent).toBe('button "Go"')
    const intents = Array.from(el.querySelectorAll<HTMLButtonElement>('.pulse-pick-popup__intent'))
    expect(intents.map((b) => b.dataset.intent)).toEqual(['fix', 'change', 'question', 'approve'])
    expect(intents[0].classList.contains('pulse-pick-popup__intent--active')).toBe(true)
    expect(el.style.left).toBe(`${window.innerWidth / 2}px`)

    intents[2].click()
    expect(intents[2].getAttribute('aria-pressed')).toBe('true')
    const ta = el.querySelector('textarea')!
    ta.value = '  Make it bigger  '
    ;(el.querySelector('.pulse-pick-popup__btn--primary') as HTMLButtonElement).click()
    expect(onSave).toHaveBeenCalledWith({ comment: 'Make it bigger', intent: 'question' })
    expect(popup.isOpen).toBe(false)
  })

  it('pre-fills comment + intent when editing and cancels cleanly', () => {
    popup.open({ xPercent: 50, y: 100 }, { title: 't', comment: 'old', intent: 'approve' })
    const el = shadow.querySelector('.pulse-pick-popup') as HTMLElement
    expect(el.querySelector('textarea')!.value).toBe('old')
    expect(el.querySelector('[data-intent="approve"]')!.classList.contains('pulse-pick-popup__intent--active')).toBe(true)
    ;(el.querySelector('.pulse-pick-popup__btn') as HTMLButtonElement).click()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
    expect(shadow.querySelector('.pulse-pick-popup')).toBeNull()
  })

  it('Cmd/Ctrl+Enter in the textarea saves', () => {
    popup.open({ xPercent: 50, y: 100 }, { title: 't' })
    const ta = shadow.querySelector('textarea')!
    ta.value = 'quick'
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    expect(onSave).toHaveBeenCalledWith({ comment: 'quick', intent: 'fix' })
  })
})
