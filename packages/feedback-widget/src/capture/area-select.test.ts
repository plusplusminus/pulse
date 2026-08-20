// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  applyDominanceFilter,
  collectAreaCandidates,
  findMarqueeElements,
  rectsIntersect,
  resolveMarquee,
  MIN_AREA_SIZE,
} from './area-select'
import { buildAreaPick } from './pick-builder'

function rectOf(el: Element, x: number, y: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} }) as DOMRect
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.scrollTo = vi.fn()
  Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
})

describe('rectsIntersect', () => {
  const base = { x: 0, y: 0, width: 100, height: 100 }
  it('is true for overlap and false for touching or disjoint rects', () => {
    expect(rectsIntersect(base, { x: 50, y: 50, width: 100, height: 100 })).toBe(true)
    expect(rectsIntersect(base, { x: 100, y: 0, width: 10, height: 10 })).toBe(false)
    expect(rectsIntersect(base, { x: 200, y: 200, width: 10, height: 10 })).toBe(false)
  })
})

describe('applyDominanceFilter', () => {
  it('drops a section that contains matched buttons', () => {
    document.body.innerHTML = '<section id="s"><button id="a">A</button><button id="b">B</button></section>'
    const section = document.getElementById('s')!
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    expect(applyDominanceFilter([section, a, b])).toEqual([a, b])
  })

  it('keeps siblings that contain nothing else matched', () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>'
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    expect(applyDominanceFilter([a, b])).toEqual([a, b])
  })

  it('keeps a lone container when no descendant matched', () => {
    document.body.innerHTML = '<p id="p">text</p>'
    const p = document.getElementById('p')!
    expect(applyDominanceFilter([p])).toEqual([p])
  })
})

describe('collectAreaCandidates', () => {
  it('queries the narrow selector list and excludes the widget host subtree', () => {
    document.body.innerHTML =
      '<button id="a">A</button><div id="plain"></div><span id="sp">no</span>' +
      '<div id="host"><button id="inside">nope</button></div>'
    const host = document.getElementById('host')!
    const ids = collectAreaCandidates(host).map((el) => el.id)
    expect(ids).toEqual(['a'])
  })
})

describe('findMarqueeElements', () => {
  it('returns only intersecting, non-dominated, non-zero-size elements', () => {
    document.body.innerHTML =
      '<section id="s"><button id="in">in</button><button id="out">out</button><a id="zero" href="/z">z</a></section>'
    const section = document.getElementById('s')!
    const inside = document.getElementById('in')!
    const outside = document.getElementById('out')!
    const zero = document.getElementById('zero')!
    rectOf(section, 0, 0, 500, 500)
    rectOf(inside, 10, 10, 50, 20)
    rectOf(outside, 400, 400, 50, 20)
    rectOf(zero, 10, 10, 0, 0)

    const hits = findMarqueeElements([section, inside, outside, zero], { x: 0, y: 0, width: 100, height: 100 })
    expect(hits).toEqual([inside])
  })
})

describe('resolveMarquee', () => {
  const noCandidates: Element[] = []

  it('prefers intersecting elements', () => {
    document.body.innerHTML = '<button id="a">A</button>'
    const a = document.getElementById('a')!
    rectOf(a, 10, 10, 30, 30)
    expect(resolveMarquee([a], { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      kind: 'elements',
      elements: [a],
    })
  })

  it('falls back to an area for an empty box larger than the minimum', () => {
    expect(
      resolveMarquee(noCandidates, { x: 0, y: 0, width: MIN_AREA_SIZE + 1, height: MIN_AREA_SIZE + 1 })
    ).toEqual({ kind: 'area' })
  })

  it('is a no-op for an empty box at or below the minimum', () => {
    expect(
      resolveMarquee(noCandidates, { x: 0, y: 0, width: MIN_AREA_SIZE, height: MIN_AREA_SIZE })
    ).toEqual({ kind: 'none' })
    expect(resolveMarquee(noCandidates, { x: 0, y: 0, width: 100, height: 5 })).toEqual({ kind: 'none' })
  })
})

describe('buildAreaPick', () => {
  it('captures geometry and no element metadata', () => {
    Object.defineProperty(window, 'scrollY', { value: 200, configurable: true })
    const pick = buildAreaPick({ x: 40, y: 100, width: 620, height: 240 }, { id: 'a1', comment: 'cramped' })
    expect(pick).toEqual({
      id: 'a1',
      elementPath: 'region at (40, 300)',
      name: 'Area selection',
      classes: '',
      boundingBox: { x: 40, y: 300, width: 620, height: 240 },
      areaRect: { x: 40, y: 300, width: 620, height: 240 },
      nearbyText: '',
      comment: 'cramped',
      intent: 'fix',
      isFixed: false,
      isArea: true,
    })
    expect(pick).not.toHaveProperty('computedStyles')
    expect(pick).not.toHaveProperty('selector')
  })
})
