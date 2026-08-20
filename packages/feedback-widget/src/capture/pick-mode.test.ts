// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ElementPicker, isTextTarget, dragRect, isMultiSelectModifier, type PickerEvents } from './pick-mode'

let host: HTMLElement
let shadow: ShadowRoot
let picker: ElementPicker
let events: { [K in keyof PickerEvents]-?: ReturnType<typeof vi.fn> }
let under: Element | null

function mouse(type: string, x: number, y: number, init: MouseEventInit = {}, target: EventTarget = document.body): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, ...init })
  target.dispatchEvent(e)
  return e
}

beforeEach(() => {
  document.body.innerHTML = '<main><button id="btn">Go</button><p id="para">Some text</p><div id="box"></div></main><div id="pulse-widget"></div>'
  host = document.getElementById('pulse-widget')!
  shadow = host.attachShadow({ mode: 'closed' })
  under = document.getElementById('btn')
  document.elementFromPoint = vi.fn(() => under)
  events = {
    onPick: vi.fn(),
    onDragStart: vi.fn(),
    onDragMove: vi.fn(),
    onDragEnd: vi.fn(),
    onModifierClick: vi.fn(() => false),
    onModifierRelease: vi.fn(),
  }
  picker = new ElementPicker(shadow, host, events)
  picker.start()
})

afterEach(() => {
  picker.stop()
  vi.restoreAllMocks()
})

describe('ElementPicker', () => {
  it('mounts a pointer-events:none overlay in the shadow root and a crosshair style in the page', () => {
    const overlay = shadow.querySelector('.pulse-pick-overlay') as HTMLElement
    expect(overlay).not.toBeNull()
    expect(document.head.querySelector('style[data-pulse="pick-cursor"]')).not.toBeNull()
    mouse('mousemove', 10, 10)
    expect(overlay.style.display).toBe('block')
    expect(shadow.querySelector('.pulse-pick-label')!.textContent).toBe('button "Go"')
    picker.stop()
    expect(shadow.querySelector('.pulse-pick-overlay')).toBeNull()
    expect(document.head.querySelector('style[data-pulse="pick-cursor"]')).toBeNull()
  })

  it('a plain click picks the element under the cursor and blocks the host page', () => {
    const hostHandler = vi.fn()
    document.getElementById('btn')!.addEventListener('click', hostHandler)
    mouse('mousedown', 10, 10)
    mouse('mouseup', 10, 10)
    const e = mouse('click', 10, 10)
    expect(events.onPick).toHaveBeenCalledTimes(1)
    expect(events.onPick.mock.calls[0][0]).toBe(under)
    expect(events.onPick.mock.calls[0][1]).toEqual({ x: 10, y: 10 })
    expect(e.defaultPrevented).toBe(true)
    expect(hostHandler).not.toHaveBeenCalled()
  })

  it('preventDefaults mousedown on containers but not on text tags / contenteditable', () => {
    under = document.getElementById('box')
    expect(mouse('mousedown', 1, 1).defaultPrevented).toBe(true)
    under = document.getElementById('para')
    expect(mouse('mousedown', 1, 1).defaultPrevented).toBe(false)
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    document.body.appendChild(editable)
    under = editable
    expect(mouse('mousedown', 1, 1).defaultPrevented).toBe(false)
  })

  it('discriminates drag from click with the squared 8px threshold and swallows the trailing click', () => {
    mouse('mousedown', 10, 10)
    mouse('mousemove', 15, 15) // 50 < 64: still a click
    expect(events.onDragStart).not.toHaveBeenCalled()
    mouse('mousemove', 19, 10) // 81 > 64: drag
    expect(events.onDragStart).toHaveBeenCalledWith({ x: 10, y: 10 })
    expect(events.onDragMove).toHaveBeenCalled()
    mouse('mouseup', 40, 30)
    expect(events.onDragEnd).toHaveBeenCalledWith({ x: 10, y: 10, width: 30, height: 20 }, expect.any(MouseEvent))
    mouse('click', 40, 30)
    expect(events.onPick).not.toHaveBeenCalled()
    // Next click is a normal pick again.
    mouse('mousedown', 5, 5)
    mouse('mouseup', 5, 5)
    mouse('click', 5, 5)
    expect(events.onPick).toHaveBeenCalledTimes(1)
  })

  it('ignores events from inside the widget host and while paused', () => {
    mouse('click', 10, 10, {}, host)
    expect(events.onPick).not.toHaveBeenCalled()
    picker.pause()
    mouse('click', 10, 10)
    expect(events.onPick).not.toHaveBeenCalled()
    picker.resume()
    mouse('click', 10, 10)
    expect(events.onPick).toHaveBeenCalledTimes(1)
  })

  it('does not pick html/body and hides the overlay over nothing', () => {
    under = document.body
    mouse('mousemove', 1, 1)
    expect((shadow.querySelector('.pulse-pick-overlay') as HTMLElement).style.display).toBe('none')
    mouse('click', 1, 1)
    expect(events.onPick).not.toHaveBeenCalled()
  })

  it('routes modifier clicks and modifier release to the multi-select hooks', () => {
    events.onModifierClick.mockReturnValue(true)
    mouse('click', 10, 10, { metaKey: true, shiftKey: true })
    expect(events.onModifierClick).toHaveBeenCalledTimes(1)
    expect(events.onPick).not.toHaveBeenCalled()
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }))
    expect(events.onModifierRelease).toHaveBeenCalledTimes(1)
  })
})

describe('helpers', () => {
  it('isTextTarget covers the hardcoded tag set', () => {
    for (const t of ['p', 'span', 'h1', 'h6', 'a', 'code', 'mark', 'label', 'li', 'blockquote']) {
      expect(isTextTarget(document.createElement(t))).toBe(true)
    }
    expect(isTextTarget(document.createElement('div'))).toBe(false)
    expect(isTextTarget(null)).toBe(false)
  })
  it('dragRect normalises direction', () => {
    expect(dragRect({ x: 10, y: 10 }, { x: 2, y: 4 })).toEqual({ x: 2, y: 4, width: 8, height: 6 })
  })
  it('isMultiSelectModifier needs (meta|ctrl) + shift', () => {
    expect(isMultiSelectModifier(new MouseEvent('click', { metaKey: true, shiftKey: true }))).toBe(true)
    expect(isMultiSelectModifier(new MouseEvent('click', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isMultiSelectModifier(new MouseEvent('click', { metaKey: true }))).toBe(false)
    expect(isMultiSelectModifier(new MouseEvent('click', { shiftKey: true }))).toBe(false)
  })
})
