// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildPick, pageRect, newPickId } from './pick-builder'

beforeEach(() => {
  document.body.innerHTML = ''
  window.scrollTo = vi.fn()
})

describe('buildPick', () => {
  it('captures every field the four detail levels need from a normal-flow element', () => {
    document.body.innerHTML =
      '<main><section class="hero">Intro <button id="cta" class="btn primary" aria-label="Sign up now">Sign up</button> trailing</section></main>'
    const el = document.getElementById('cta')!
    el.getBoundingClientRect = () => ({ x: 10, y: 20, width: 100, height: 40, top: 20, left: 10, right: 110, bottom: 60, toJSON() {} }) as DOMRect
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true })
    Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })

    const pick = buildPick(el, { id: 'p1' })

    expect(pick).toMatchObject({
      id: 'p1',
      elementPath: 'main > .hero > #cta',
      name: 'button [Sign up now]',
      classes: 'btn, primary',
      boundingBox: { x: 10, y: 520, width: 100, height: 40 },
      nearbyText: '[before: "Intro"] Sign up [after: "trailing"]',
      comment: '',
      intent: 'fix',
      isFixed: false,
      fullPath: 'main > .hero > #cta',
      accessibility: 'aria-label="Sign up now", focusable',
      xpath: '/html/body/main/section/button',
    })
    expect(pick.selector).toBe('#cta')
    expect(document.querySelector(pick.selector!)).toBe(el)
    expect(typeof pick.computedStyles).toBe('object')
    expect(pick.relocation?.scrollY).toBe(500)
    expect(pick.relocation?.textHash).toMatch(/^[0-9a-f]{8}$/)
    expect(pick).not.toHaveProperty('selectedText')
  })

  it('keeps viewport coordinates and flags isFixed for sticky/fixed elements', () => {
    document.body.innerHTML = '<style>nav{position:sticky}</style><nav><a id="l" href="/x">Home</a></nav>'
    const el = document.getElementById('l')!
    el.getBoundingClientRect = () => ({ x: 5, y: 8, width: 50, height: 20, top: 8, left: 5, right: 55, bottom: 28, toJSON() {} }) as DOMRect
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true })
    const pick = buildPick(el, { comment: 'hi', intent: 'question' })
    expect(pick.isFixed).toBe(true)
    expect(pick.boundingBox).toEqual({ x: 5, y: 8, width: 50, height: 20 })
    expect(pick.comment).toBe('hi')
    expect(pick.intent).toBe('question')
    expect(pick.id).toMatch(/^[0-9a-f-]{36}$|^pk_/)
  })
})

describe('pageRect / newPickId', () => {
  it('adds scroll for normal flow and not for fixed', () => {
    Object.defineProperty(window, 'scrollX', { value: 3, configurable: true })
    Object.defineProperty(window, 'scrollY', { value: 7, configurable: true })
    const r = { x: 1.4, y: 2.6, width: 10.5, height: 20.4 }
    expect(pageRect(r, false)).toEqual({ x: 4, y: 10, width: 11, height: 20 })
    expect(pageRect(r, true)).toEqual({ x: 1, y: 3, width: 11, height: 20 })
  })
  it('generates unique ids', () => {
    expect(newPickId()).not.toBe(newPickId())
  })
})
