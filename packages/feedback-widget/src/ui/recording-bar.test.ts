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
let config: {
  onStop: Mock<() => void>
  onDiscard: Mock<() => void>
  onToggleMic?: Mock<() => void>
}
let clock: { now: () => number; advance: (ms: number) => void }

function makeClock(start = 1_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => void (t += ms) }
}

function makeBar(): RecordingBar {
  return new RecordingBar(shadow, { ...config, now: clock.now })
}

/** A bar built for a reporter who opted into voice-over. */
function makeMicBar(): RecordingBar {
  config.onToggleMic = vi.fn<() => void>()
  return makeBar()
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

// -- voice-over (PULSE-400) ---------------------------------------------------

describe('mic control', () => {
  const micBtn = () => el('.pulse-recbar__mic') as HTMLButtonElement
  const micText = () => el('.pulse-recbar__mic-text').textContent
  const slashHidden = () =>
    shadow.querySelector('.pulse-recbar__mic svg path:last-of-type')!.getAttribute('display') ===
    'none'

  it('builds no mic control and no meter without an onToggleMic — a site with voiceOver off gets no mic UI', () => {
    makeBar()
    expect(shadow.querySelector('.pulse-recbar__mic')).toBeNull()
    expect(shadow.querySelector('.pulse-recbar__level')).toBeNull()
  })

  it('starts pending, because getUserMedia is still resolving when the bar is built', () => {
    makeMicBar()
    expect(micText()).toBe('Mic…')
    expect(micBtn().disabled).toBe(true)
    expect(micBtn().getAttribute('aria-pressed')).toBe('false')
  })

  it('shows live state in the icon AND the text, never colour alone', () => {
    const bar = makeMicBar()
    bar.setMicState('live')

    expect(micText()).toBe('Mic on')
    expect(slashHidden()).toBe(true)
    expect(micBtn().getAttribute('aria-pressed')).toBe('true')

    bar.setMicState('muted')

    expect(micText()).toBe('Mic muted')
    // The slash over the microphone is the second, non-colour signal.
    expect(slashHidden()).toBe(false)
    expect(micBtn().getAttribute('aria-pressed')).toBe('false')
  })

  it('is a real focusable button reachable by Tab, between the readouts and Stop', () => {
    makeMicBar()
    expect(micBtn().tagName).toBe('BUTTON')
    expect(micBtn().getAttribute('tabindex')).toBeNull()

    const order = Array.from(el('.pulse-recbar').children).map((c) => c.className)
    const mic = order.findIndex((c) => c.includes('pulse-recbar__mic'))
    const size = order.findIndex((c) => c.includes('pulse-recbar__size'))
    const stop = order.findIndex((c) => c.includes('pulse-recbar__btn--stop'))
    expect(mic).toBeGreaterThan(size)
    expect(mic).toBeLessThan(stop)
  })

  it('takes focus and fires the toggle from the keyboard', () => {
    const bar = makeMicBar()
    bar.setMicState('live')

    micBtn().focus()
    expect(shadow.activeElement).toBe(micBtn())
    micBtn().click()

    expect(config.onToggleMic).toHaveBeenCalledTimes(1)
    // Stop and Discard are untouched: muting is not ending.
    expect(config.onStop).not.toHaveBeenCalled()
    expect(config.onDiscard).not.toHaveBeenCalled()
  })

  it('toggles from muted as well as from live', () => {
    const bar = makeMicBar()
    bar.setMicState('muted')
    micBtn().click()
    expect(config.onToggleMic).toHaveBeenCalledTimes(1)
  })

  it('does not fire while pending or unavailable — there is no track to mute', () => {
    const bar = makeMicBar()
    micBtn().click()
    bar.setMicState('unavailable')
    micBtn().click()
    expect(config.onToggleMic).not.toHaveBeenCalled()
  })

  it('says "No mic" for the rest of the recording rather than quietly vanishing', () => {
    const bar = makeMicBar()
    bar.setMicState('unavailable')

    // Silently dropping the control would leave the reporter narrating into
    // nothing — and removing it would slide Stop sideways mid-recording.
    expect(shadow.querySelector('.pulse-recbar__mic')).not.toBeNull()
    expect(micText()).toBe('No mic')
    expect(micBtn().disabled).toBe(true)
    expect(slashHidden()).toBe(false)
  })

  it('never changes the number of children, so Stop never moves under the pointer', () => {
    const bar = makeMicBar()
    const before = el('.pulse-recbar').children.length
    for (const state of ['live', 'muted', 'unavailable', 'pending'] as const) {
      bar.setMicState(state)
      expect(el('.pulse-recbar').children.length).toBe(before)
    }
  })
})

describe('level meter', () => {
  const levelWidth = () => el('.pulse-recbar__level-fill').style.width

  it('sits at the floor before anything arrives', () => {
    makeMicBar()
    expect(levelWidth()).toBe('0%')
  })

  it('moves with the level', () => {
    const bar = makeMicBar()
    bar.setMicState('live')
    bar.setLevel(0.42)
    expect(levelWidth()).toBe('42%')
    bar.setLevel(1)
    expect(levelWidth()).toBe('100%')
  })

  it('clamps out-of-range values instead of overflowing the track', () => {
    const bar = makeMicBar()
    bar.setMicState('live')
    bar.setLevel(-3)
    expect(levelWidth()).toBe('0%')
    bar.setLevel(7)
    expect(levelWidth()).toBe('100%')
  })

  it('drops to the floor the moment the mic is muted', () => {
    const bar = makeMicBar()
    bar.setMicState('live')
    bar.setLevel(0.8)
    expect(levelWidth()).toBe('80%')

    bar.setMicState('muted')

    expect(levelWidth()).toBe('0%')
  })

  it('stays at the floor when the mic never opened', () => {
    const bar = makeMicBar()
    bar.setMicState('live')
    bar.setLevel(0.8)
    bar.setMicState('unavailable')
    expect(levelWidth()).toBe('0%')
  })

  it('is hidden from assistive tech: the same state is already in the button text', () => {
    makeMicBar()
    expect(el('.pulse-recbar__level').getAttribute('aria-hidden')).toBe('true')
  })

  it('skips redundant writes at frame rate', () => {
    const bar = makeMicBar()
    bar.setMicState('live')
    const fill = el('.pulse-recbar__level-fill')
    bar.setLevel(0.5)
    // A value setLevel would never write, so a rewrite is unmistakable.
    fill.style.width = '13px'
    // Same rounded percent: the style must not be touched.
    bar.setLevel(0.502)
    expect(fill.style.width).toBe('13px')
    bar.setLevel(0.6)
    expect(fill.style.width).toBe('60%')
  })
})

describe('mic in the slim bar', () => {
  it('keeps the mic text, unlike the word Recording', () => {
    const bar = makeMicBar()
    bar.setMicState('muted')
    bar.setSlim(true)

    const css = getWidgetStyles('light')
    expect(css).toContain('.pulse-recbar--slim .pulse-recbar__label')
    // Whether a voice is being recorded is not something to infer from a 13px
    // icon burnt into someone's video.
    expect(css).not.toContain('.pulse-recbar--slim .pulse-recbar__mic-text')
    expect(el('.pulse-recbar__mic-text').textContent).toBe('Mic muted')
  })

  it('gives the mic control the same focus ring as Stop and Discard', () => {
    // It carries .pulse-recbar__btn, so the focus ring is literally the same rule.
    const btn = shadow.querySelector('.pulse-recbar__mic')
    expect(btn).toBeNull()
    makeMicBar()
    expect(el('.pulse-recbar__mic').classList.contains('pulse-recbar__btn')).toBe(true)
    expect(getWidgetStyles('light')).toContain('.pulse-recbar__btn:focus-visible')
  })

  it('keeps Stop and Discard hovering as themselves, not as the mic button', () => {
    const css = getWidgetStyles('light')
    // A bare .pulse-recbar__btn:hover declared after them would override both.
    expect(css).toContain('.pulse-recbar__mic:not(:disabled):hover')
    expect(css).not.toContain('.pulse-recbar__btn:not(:disabled):hover')
  })
})
