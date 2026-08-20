// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FREEZE_CSS, PageFreezer } from './freeze'

function fakeAnimation(playState: AnimationPlayState) {
  return {
    playState,
    pause: vi.fn(),
    play: vi.fn(),
  } as unknown as Animation & { pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> }
}

function fakeVideo(paused: boolean): HTMLVideoElement {
  const v = document.createElement('video')
  Object.defineProperty(v, 'paused', { value: paused, configurable: true })
  v.pause = vi.fn()
  v.play = vi.fn(() => Promise.resolve())
  document.body.appendChild(v)
  return v
}

let freezer: PageFreezer

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.querySelectorAll('style[data-pulse="freeze"]').forEach((el) => el.remove())
  freezer = new PageFreezer()
})

afterEach(() => {
  freezer.destroy()
  vi.restoreAllMocks()
})

const styleEl = () => document.head.querySelector('style[data-pulse="freeze"]')

describe('PageFreezer', () => {
  it('injects the pause stylesheet into the host page head, not a shadow root', () => {
    freezer.freeze()
    expect(styleEl()?.textContent).toBe(FREEZE_CSS)
    expect(freezer.isFrozen).toBe(true)
  })

  it('excludes the widget so its own UI keeps animating', () => {
    expect(FREEZE_CSS).toContain(':not(#pulse-widget):not(#pulse-widget *)')
    expect(FREEZE_CSS).toContain('animation-play-state: paused !important')
    expect(FREEZE_CSS).toContain('transition: none !important')
  })

  it('removes the stylesheet on unfreeze and is idempotent both ways', () => {
    freezer.freeze()
    freezer.freeze()
    expect(document.head.querySelectorAll('style[data-pulse="freeze"]')).toHaveLength(1)
    freezer.unfreeze()
    expect(styleEl()).toBeNull()
    freezer.unfreeze()
    expect(freezer.isFrozen).toBe(false)
  })

  it('toggle reports the state it settled into', () => {
    expect(freezer.toggle()).toBe(true)
    expect(freezer.toggle()).toBe(false)
  })

  it('pauses only running WAAPI animations and resumes exactly those', () => {
    const running = fakeAnimation('running')
    const alreadyPaused = fakeAnimation('paused')
    document.getAnimations = vi.fn(() => [running, alreadyPaused])

    freezer.freeze()
    expect(running.pause).toHaveBeenCalledTimes(1)
    expect(alreadyPaused.pause).not.toHaveBeenCalled()

    freezer.unfreeze()
    expect(running.play).toHaveBeenCalledTimes(1)
    expect(alreadyPaused.play).not.toHaveBeenCalled()
  })

  it('survives a missing getAnimations (older browsers)', () => {
    // @ts-expect-error deliberately removing the API
    document.getAnimations = undefined
    expect(() => freezer.freeze()).not.toThrow()
    expect(freezer.isFrozen).toBe(true)
  })

  it('pauses videos and resumes only the ones that were playing', () => {
    const playing = fakeVideo(false)
    const stopped = fakeVideo(true)

    freezer.freeze()
    expect(playing.pause).toHaveBeenCalledTimes(1)
    expect(stopped.pause).toHaveBeenCalledTimes(1)
    expect(playing.dataset.pulseWasPaused).toBe('false')
    expect(stopped.dataset.pulseWasPaused).toBe('true')

    freezer.unfreeze()
    expect(playing.play).toHaveBeenCalledTimes(1)
    expect(stopped.play).not.toHaveBeenCalled()
    expect(playing.dataset.pulseWasPaused).toBeUndefined()
    expect(stopped.dataset.pulseWasPaused).toBeUndefined()
  })

  it('destroy unfreezes a frozen page', () => {
    freezer.freeze()
    freezer.destroy()
    expect(styleEl()).toBeNull()
  })

  it('never touches the global timer functions', () => {
    const timers = {
      setTimeout: window.setTimeout,
      setInterval: window.setInterval,
      requestAnimationFrame: window.requestAnimationFrame,
    }
    freezer.freeze()
    expect(window.setTimeout).toBe(timers.setTimeout)
    expect(window.setInterval).toBe(timers.setInterval)
    expect(window.requestAnimationFrame).toBe(timers.requestAnimationFrame)
  })
})
