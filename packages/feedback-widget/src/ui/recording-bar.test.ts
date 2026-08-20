// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import {
  RecordingBar,
  COUNTDOWN_THRESHOLD_MS,
  PROGRESS_THROTTLE_MS,
  formatClock,
  formatMb,
} from './recording-bar'
import { MAX_RECORDING_MS } from '../capture/video'
import { getWidgetStyles } from './styles'

let shadow: ShadowRoot
let config: { onStop: Mock<() => void>; onDiscard: Mock<() => void> }
let clock: { now: () => number; advance: (ms: number) => void }

function makeClock(start = 1_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => void (t += ms) }
}

function makeBar(): RecordingBar {
  return new RecordingBar(shadow, { ...config, now: clock.now })
}

function el(selector: string): HTMLElement {
  const found = shadow.querySelector(selector)
  if (!found) throw new Error(`missing ${selector}`)
  return found as HTMLElement
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  shadow = document.getElementById('host')!.attachShadow({ mode: 'open' })
  config = { onStop: vi.fn<() => void>(), onDiscard: vi.fn<() => void>() }
  clock = makeClock()
})

describe('formatting', () => {
  it('renders elapsed time as m:ss and never pads the minutes', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(7_400)).toBe('0:07')
    expect(formatClock(83_000)).toBe('1:23')
    expect(formatClock(MAX_RECORDING_MS)).toBe('2:00')
  })

  it('floors rather than rounds, so the timer never shows a second early', () => {
    expect(formatClock(1_999)).toBe('0:01')
  })

  it('clamps a negative elapsed to zero', () => {
    expect(formatClock(-500)).toBe('0:00')
  })

  it('always reports MB to one decimal, so the readout keeps its width', () => {
    expect(formatMb(0)).toBe('0.0 MB')
    expect(formatMb(512 * 1024)).toBe('0.5 MB')
    expect(formatMb(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('render', () => {
  it('mounts a bar with a dot, the word Recording, both readouts and both buttons', () => {
    makeBar()
    expect(el('.pulse-recbar__dot')).toBeTruthy()
    expect(el('.pulse-recbar__label').textContent).toBe('Recording')
    expect(el('.pulse-recbar__time').textContent).toBe('0:00')
    expect(el('.pulse-recbar__size').textContent).toBe('0.0 MB')
    expect(el('.pulse-recbar__btn--stop').textContent).toBe('Stop')
    expect(el('.pulse-recbar__btn--discard').textContent).toBe('Discard')
  })

  it('hides the countdown until the recording is near the cap', () => {
    makeBar()
    expect(el('.pulse-recbar__countdown').style.display).toBe('none')
  })

  it('labels the group and hides the decorative dot from assistive tech', () => {
    makeBar()
    expect(el('.pulse-recbar').getAttribute('aria-label')).toBe('Screen recording controls')
    expect(el('.pulse-recbar__dot').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('progress', () => {
  it('writes the timer and the size from a progress event', () => {
    const bar = makeBar()
    bar.update({ elapsedMs: 83_000, bytes: 3 * 1024 * 1024 })
    expect(el('.pulse-recbar__time').textContent).toBe('1:23')
    expect(el('.pulse-recbar__size').textContent).toBe('3.0 MB')
  })

  it('collapses a burst of progress events into a single DOM write', () => {
    const bar = makeBar()
    bar.update({ elapsedMs: 1_000, bytes: 1024 })
    for (let i = 0; i < 20; i++) {
      bar.update({ elapsedMs: 2_000 + i, bytes: 999_999 })
    }
    // Only the first of the burst landed; the rest were inside the window.
    expect(el('.pulse-recbar__time').textContent).toBe('0:01')
    expect(el('.pulse-recbar__size').textContent).toBe('0.0 MB')
  })

  it('writes again once the throttle window has passed', () => {
    const bar = makeBar()
    bar.update({ elapsedMs: 1_000, bytes: 1024 })
    clock.advance(PROGRESS_THROTTLE_MS)
    bar.update({ elapsedMs: 2_000, bytes: 2 * 1024 * 1024 })
    expect(el('.pulse-recbar__time').textContent).toBe('0:02')
    expect(el('.pulse-recbar__size').textContent).toBe('2.0 MB')
  })

  it('admits every tick of the recorder at its real 250ms cadence', () => {
    const bar = makeBar()
    for (let i = 1; i <= 8; i++) {
      bar.update({ elapsedMs: i * 250, bytes: 0 })
      clock.advance(250)
    }
    // Eight ticks over two seconds, every one of them written: 4 writes/s.
    expect(el('.pulse-recbar__time').textContent).toBe('0:02')
  })
})

describe('countdown', () => {
  it('stays hidden with more than the threshold left', () => {
    const bar = makeBar()
    bar.update({ elapsedMs: MAX_RECORDING_MS - COUNTDOWN_THRESHOLD_MS - 1_000, bytes: 0 })
    expect(el('.pulse-recbar__countdown').style.display).toBe('none')
    expect(el('.pulse-recbar').classList.contains('pulse-recbar--ending')).toBe(false)
  })

  it('shows the seconds left in the warning style inside the final 15s', () => {
    const bar = makeBar()
    bar.update({ elapsedMs: MAX_RECORDING_MS - 12_000, bytes: 0 })
    const countdown = el('.pulse-recbar__countdown')
    expect(countdown.style.display).toBe('')
    expect(countdown.textContent).toBe('12s left')
    expect(el('.pulse-recbar').classList.contains('pulse-recbar--ending')).toBe(true)
  })

  it('sits after both controls, so neither button moves when it appears', () => {
    makeBar()
    const order = Array.from(el('.pulse-recbar').children).map((c) => c.className)
    const countdown = order.findIndex((c) => c.includes('pulse-recbar__countdown'))
    const discard = order.findIndex((c) => c.includes('pulse-recbar__btn--discard'))
    // Anchored bottom-left: anything inserted before a button pushes it right,
    // and Discard would land where Stop was.
    expect(countdown).toBeGreaterThan(discard)
  })

  it('never counts below zero if progress overshoots the cap', () => {
    const bar = makeBar()
    bar.update({ elapsedMs: MAX_RECORDING_MS + 5_000, bytes: 0 })
    expect(el('.pulse-recbar__countdown').textContent).toBe('0s left')
  })
})

describe('controls', () => {
  it('calls onStop for Stop and onDiscard for Discard, never the other way round', () => {
    makeBar()
    ;(el('.pulse-recbar__btn--stop') as HTMLButtonElement).click()
    expect(config.onStop).toHaveBeenCalledTimes(1)
    expect(config.onDiscard).not.toHaveBeenCalled()
    ;(el('.pulse-recbar__btn--discard') as HTMLButtonElement).click()
    expect(config.onDiscard).toHaveBeenCalledTimes(1)
    expect(config.onStop).toHaveBeenCalledTimes(1)
  })

  it('puts focus on Stop, so the keyboard route to the safe action is one key', () => {
    const bar = makeBar()
    bar.focusStop()
    expect(shadow.activeElement).toBe(el('.pulse-recbar__btn--stop'))
  })

  it('reaches Discard from Stop in one tab step: it is the next control in order', () => {
    makeBar()
    const controls = Array.from(shadow.querySelectorAll('.pulse-recbar button'))
    expect(controls.map((c) => c.textContent)).toEqual(['Stop', 'Discard'])
    for (const control of controls) {
      // Native buttons, no negative tabindex: reachable by Tab.
      expect(control.getAttribute('tabindex')).toBeNull()
    }
  })

  it('removes itself on destroy', () => {
    const bar = makeBar()
    bar.destroy()
    expect(shadow.querySelector('.pulse-recbar')).toBeNull()
  })
})

describe('slim variant', () => {
  it('is off by default and toggles with setSlim', () => {
    const bar = makeBar()
    expect(el('.pulse-recbar').classList.contains('pulse-recbar--slim')).toBe(false)
    bar.setSlim(true)
    expect(el('.pulse-recbar').classList.contains('pulse-recbar--slim')).toBe(true)
    bar.setSlim(false)
    expect(el('.pulse-recbar').classList.contains('pulse-recbar--slim')).toBe(false)
  })

  it('keeps both controls and both readouts — slim spends fewer pixels, not less function', () => {
    const bar = makeBar()
    bar.setSlim(true)
    bar.update({ elapsedMs: 5_000, bytes: 1024 * 1024 })
    expect(el('.pulse-recbar__time').textContent).toBe('0:05')
    expect(el('.pulse-recbar__size').textContent).toBe('1.0 MB')
    expect(shadow.querySelectorAll('.pulse-recbar button')).toHaveLength(2)
  })
})

describe('styles', () => {
  it('gives the readouts tabular numerals so digits do not shift the layout', () => {
    const css = getWidgetStyles('light')
    const block = css.slice(css.indexOf('.pulse-recbar__time'))
    expect(block.slice(0, 220)).toContain('font-variant-numeric: tabular-nums')
  })

  it('pins the bar bottom-left, out of the usual content column', () => {
    const css = getWidgetStyles('dark')
    const block = css.slice(css.indexOf('.pulse-recbar {'), css.indexOf('.pulse-recbar__dot'))
    expect(block).toContain('bottom: 20px')
    expect(block).toContain('left: 20px')
    expect(block).not.toContain('right:')
  })

  it('gives both controls a visible focus ring', () => {
    expect(getWidgetStyles('light')).toContain('.pulse-recbar__btn:focus-visible')
  })
})
