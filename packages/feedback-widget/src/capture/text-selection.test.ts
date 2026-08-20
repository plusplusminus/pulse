// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { captureSelectedText, clearSelection, MAX_SELECTED_TEXT } from './text-selection'
import { buildPick } from './pick-builder'
import { TEXT_TAGS } from './pick-mode'

/** Real jsdom selection over the element's own text. */
function selectText(el: Element): void {
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
  window.scrollTo = vi.fn()
  Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
})

describe('captureSelectedText', () => {
  it('returns the trimmed page selection', () => {
    document.body.innerHTML = '<p id="p">  Sign up now  </p>'
    selectText(document.getElementById('p')!)
    expect(captureSelectedText()).toBe('Sign up now')
  })

  it('returns an empty string when nothing is selected', () => {
    document.body.innerHTML = '<p id="p">text</p>'
    expect(captureSelectedText()).toBe('')
  })

  it('truncates past the cap with no marker', () => {
    document.body.innerHTML = `<p id="p">${'x'.repeat(MAX_SELECTED_TEXT + 200)}</p>`
    selectText(document.getElementById('p')!)
    const captured = captureSelectedText()
    expect(captured).toHaveLength(MAX_SELECTED_TEXT)
    expect(captured.endsWith('…')).toBe(false)
  })

  it('captures a selection spanning several elements', () => {
    document.body.innerHTML = '<div id="wrap"><p>First part</p><p>second part</p></div>'
    selectText(document.getElementById('wrap')!)
    expect(captureSelectedText()).toContain('First part')
    expect(captureSelectedText()).toContain('second part')
  })

  it('works for every text tag the mousedown opt-out covers', () => {
    for (const tag of TEXT_TAGS) {
      document.body.innerHTML = `<${tag.toLowerCase()} id="t">picked words</${tag.toLowerCase()}>`
      selectText(document.getElementById('t')!)
      expect(captureSelectedText()).toBe('picked words')
      window.getSelection()?.removeAllRanges()
    }
  })

  it('survives a browser without getSelection', () => {
    const original = window.getSelection
    // @ts-expect-error deliberately removing the API
    window.getSelection = undefined
    expect(captureSelectedText()).toBe('')
    expect(() => clearSelection()).not.toThrow()
    window.getSelection = original
  })
})

describe('clearSelection', () => {
  it('drops the selection so the next pick cannot inherit it', () => {
    document.body.innerHTML = '<p id="p">Sign up now</p>'
    selectText(document.getElementById('p')!)
    expect(captureSelectedText()).toBe('Sign up now')
    clearSelection()
    expect(captureSelectedText()).toBe('')
  })
})

describe('buildPick selectedText', () => {
  it('stores a non-empty selection and omits the field otherwise', () => {
    document.body.innerHTML = '<p id="p">Sign up now</p>'
    const el = document.getElementById('p')!
    expect(buildPick(el, { selectedText: 'Sign up now' }).selectedText).toBe('Sign up now')
    expect(buildPick(el, { selectedText: '' })).not.toHaveProperty('selectedText')
    expect(buildPick(el)).not.toHaveProperty('selectedText')
  })
})
