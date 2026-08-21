// @vitest-environment jsdom
/**
 * The popover primitive behind the attach row (PULSE-402).
 *
 * The keyboard contract is the point of these: a reporter who never touches a
 * pointer has to be able to see that options exist, open them, move through
 * them and get back out without losing the panel.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Popover, popoverPlacement } from './popover'

let shadow: ShadowRoot

function makePopover(items = 2): Popover {
  const popover = new Popover(shadow, {
    id: 'test',
    label: 'Screenshot options',
    build: (close) => {
      const list = document.createElement('div')
      list.className = 'pulse-pop__list'
      for (let i = 0; i < items; i++) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = `item-${i}`
        btn.textContent = `Item ${i}`
        btn.addEventListener('click', () => close())
        list.appendChild(btn)
      }
      return list
    },
  })
  // The caret only takes focus once it is actually on the page.
  shadow.appendChild(popover.caret)
  return popover
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  shadow = document.getElementById('host')!.attachShadow({ mode: 'open' })
})

describe('placement', () => {
  const viewport = { width: 1134, height: 900 }
  const size = { width: 244, height: 160 }

  it('sits just below the trigger, left edges aligned', () => {
    const at = popoverPlacement({ left: 800, right: 900, top: 400, bottom: 430 }, size, viewport)
    expect(at).toEqual({ left: 800, top: 436 })
  })

  it('flips above rather than running off the bottom', () => {
    const at = popoverPlacement({ left: 800, right: 900, top: 800, bottom: 830 }, size, viewport)
    expect(at.top).toBe(800 - 6 - 160)
  })

  it('clamps a trigger near the right edge back inside the viewport', () => {
    const at = popoverPlacement({ left: 1050, right: 1120, top: 100, bottom: 130 }, size, viewport)
    expect(at.left).toBe(1134 - 244 - 8)
  })

  it('never pushes past the left edge on a narrow viewport', () => {
    const at = popoverPlacement({ left: 4, right: 80, top: 100, bottom: 130 }, size, { width: 200, height: 900 })
    expect(at.left).toBe(8)
  })
})

describe('the caret', () => {
  it('is always rendered, labelled and collapsed — never hover-revealed', () => {
    const popover = makePopover()
    expect(popover.caret.getAttribute('aria-expanded')).toBe('false')
    expect(popover.caret.getAttribute('aria-haspopup')).toBe('true')
    expect(popover.caret.getAttribute('aria-label')).toBe('Screenshot options')
    expect(popover.caret.querySelector('svg')).not.toBeNull()
  })

  it('opens on click, which is what Enter and Space fire on a button', () => {
    const popover = makePopover()
    popover.caret.click()
    expect(popover.isOpen).toBe(true)
    expect(popover.caret.getAttribute('aria-expanded')).toBe('true')
    expect(shadow.querySelector('.pulse-pop')).not.toBeNull()
  })

  it('toggles shut on a second click', () => {
    const popover = makePopover()
    popover.caret.click()
    popover.caret.click()
    expect(popover.isOpen).toBe(false)
    expect(shadow.querySelector('.pulse-pop')).toBeNull()
  })
})

describe('focus', () => {
  it('lands on the first option so the keyboard can carry straight on', () => {
    const popover = makePopover()
    popover.caret.click()
    expect(shadow.activeElement).toBe(shadow.querySelector('.item-0'))
  })

  it('returns to the trigger when the popover closes deliberately', () => {
    const popover = makePopover()
    popover.caret.click()
    popover.close()
    expect(shadow.activeElement).toBe(popover.caret)
  })

  it('does not chase focus back on an outside dismissal', () => {
    const popover = makePopover()
    popover.caret.click()
    popover.close(false)
    expect(shadow.activeElement).not.toBe(popover.caret)
  })

  it('wraps Tab within the options rather than escaping into the page', () => {
    const popover = makePopover(2)
    popover.caret.click()
    const first = shadow.querySelector('.item-0') as HTMLElement
    const last = shadow.querySelector('.item-1') as HTMLElement

    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(shadow.activeElement).toBe(first)

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(shadow.activeElement).toBe(last)
  })
})

describe('dismissal', () => {
  it('closes when a pointer lands anywhere else, without stealing focus back', () => {
    const popover = makePopover()
    popover.caret.click()
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
    expect(popover.isOpen).toBe(false)
  })

  it('survives a pointer inside its own surface', () => {
    const popover = makePopover()
    popover.caret.click()
    const item = shadow.querySelector('.item-0') as HTMLElement
    item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
    expect(popover.isOpen).toBe(true)
  })

  it('unhooks its document listener on close, leaving nothing behind', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const popover = makePopover()
    popover.caret.click()
    popover.close()
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)
  })

  it('rebuilds its contents on every open, so it can never show stale state', () => {
    let label = 'first'
    const popover = new Popover(shadow, {
      id: 'test',
      label: 'Options',
      build: () => {
        const el = document.createElement('div')
        el.className = 'built'
        el.textContent = label
        return el
      },
    })
    popover.caret.click()
    expect(shadow.querySelector('.built')?.textContent).toBe('first')
    popover.close()
    label = 'second'
    popover.caret.click()
    expect(shadow.querySelector('.built')?.textContent).toBe('second')
  })
})
