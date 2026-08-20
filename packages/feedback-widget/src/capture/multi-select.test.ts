// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MultiSelection, aggregateRect, multiPickName } from './multi-select'
import { buildMultiPick } from './pick-builder'

beforeEach(() => {
  document.body.innerHTML = ''
  window.scrollTo = vi.fn()
  Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
})

function rectOf(el: Element, x: number, y: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} }) as DOMRect
}

describe('multiPickName', () => {
  it('names two elements in full and counts the rest', () => {
    expect(multiPickName(['button "Save"', 'input [email]'])).toBe('2 elements: button "Save", input [email]')
    expect(multiPickName(['button "Save"', 'input [email]', 'a "Help"'])).toBe(
      '3 elements: button "Save", input [email]+1 more'
    )
    expect(multiPickName(['a', 'b', 'c', 'd', 'e'])).toBe('5 elements: a, b+3 more')
  })
})

describe('aggregateRect', () => {
  it('wraps every rect', () => {
    expect(
      aggregateRect([
        { x: 10, y: 20, width: 30, height: 10 },
        { x: 5, y: 50, width: 10, height: 10 },
      ])
    ).toEqual({ x: 5, y: 20, width: 35, height: 40 })
  })

  it('returns a zero rect for an empty selection', () => {
    expect(aggregateRect([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('MultiSelection', () => {
  it('toggles elements in and out, preserving insertion order', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    const sel = new MultiSelection()

    expect(sel.toggle(a)).toBe(true)
    expect(sel.toggle(b)).toBe(true)
    expect(sel.size).toBe(2)
    expect(sel.first).toBe(a)
    expect(sel.has(a)).toBe(true)

    expect(sel.toggle(a)).toBe(false)
    expect(sel.items).toEqual([b])

    sel.clear()
    expect(sel.size).toBe(0)
    expect(sel.first).toBeNull()
  })
})

describe('buildMultiPick', () => {
  it('produces one pick wrapping every element, with the first element metadata', () => {
    document.body.innerHTML =
      '<main><button id="save" class="btn">Save</button><input id="mail" name="email"><a id="help" href="/h">Help</a></main>'
    const save = document.getElementById('save')!
    const mail = document.getElementById('mail')!
    const help = document.getElementById('help')!
    rectOf(save, 10, 20, 100, 40)
    rectOf(mail, 5, 80, 200, 30)
    rectOf(help, 300, 25, 50, 20)

    const pick = buildMultiPick([save, mail, help], { id: 'm1' })

    expect(pick.isMultiSelect).toBe(true)
    expect(pick.name).toBe('3 elements: button "Save", input [email]+1 more')
    expect(pick.elementBoundingBoxes).toEqual([
      { x: 10, y: 20, width: 100, height: 40 },
      { x: 5, y: 80, width: 200, height: 30 },
      { x: 300, y: 25, width: 50, height: 20 },
    ])
    expect(pick.boundingBox).toEqual({ x: 5, y: 20, width: 345, height: 90 })
    // metadata comes from the first element only
    expect(pick.selector).toBe('#save')
    expect(pick.classes).toBe('btn')
  })

  it('falls back to a plain single pick for a one-element selection', () => {
    document.body.innerHTML = '<button id="only">Only</button>'
    const el = document.getElementById('only')!
    rectOf(el, 0, 0, 10, 10)
    const pick = buildMultiPick([el])
    expect(pick.isMultiSelect).toBeUndefined()
    expect(pick.elementBoundingBoxes).toBeUndefined()
    expect(pick.name).toBe('button "Only"')
  })
})
