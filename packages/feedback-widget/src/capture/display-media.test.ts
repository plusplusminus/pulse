// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { isGetDisplayMediaSupported, isIOS } from './display-media'

/** Real UA strings; the point of the helper is that it matches these exactly. */
const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadLegacy:
    'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ deliberately lies and reports a desktop Mac.
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  chromeDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
}

function stubNavigator(options: {
  userAgent: string
  maxTouchPoints?: number
  getDisplayMedia?: boolean
}) {
  Object.defineProperty(navigator, 'userAgent', {
    value: options.userAgent,
    configurable: true,
  })
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: options.maxTouchPoints ?? 0,
    configurable: true,
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    value: options.getDisplayMedia === false ? {} : { getDisplayMedia: vi.fn() },
    configurable: true,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isIOS', () => {
  it('matches iPhone and older iPad user agents', () => {
    expect(isIOS(UA.iphone, 5)).toBe(true)
    expect(isIOS(UA.ipadLegacy, 5)).toBe(true)
  })

  it('catches iPadOS 13+ pretending to be a Mac, via touch points', () => {
    expect(isIOS(UA.ipadDesktopMode, 5)).toBe(true)
  })

  it('does not mistake a real Mac for an iPad', () => {
    expect(isIOS(UA.macSafari, 0)).toBe(false)
  })

  it('is false on desktop Chrome', () => {
    expect(isIOS(UA.chromeDesktop, 0)).toBe(false)
  })
})

describe('isGetDisplayMediaSupported', () => {
  it('is false on iOS Safari, where screen capture does not exist', () => {
    stubNavigator({ userAgent: UA.iphone, maxTouchPoints: 5, getDisplayMedia: false })
    expect(isGetDisplayMediaSupported()).toBe(false)
  })

  it('is false on iOS even when a browser exposes a getDisplayMedia stub', () => {
    // Some iOS browsers ship the method and simply reject; feature detection
    // alone would offer the button and fail at the click.
    stubNavigator({ userAgent: UA.iphone, maxTouchPoints: 5, getDisplayMedia: true })
    expect(isGetDisplayMediaSupported()).toBe(false)
  })

  it('is false on iPadOS in desktop mode', () => {
    stubNavigator({
      userAgent: UA.ipadDesktopMode,
      maxTouchPoints: 5,
      getDisplayMedia: true,
    })
    expect(isGetDisplayMediaSupported()).toBe(false)
  })

  it('is false anywhere the API is simply absent', () => {
    stubNavigator({ userAgent: UA.chromeDesktop, getDisplayMedia: false })
    expect(isGetDisplayMediaSupported()).toBe(false)
  })

  it('is true on desktop Chrome and desktop Safari', () => {
    stubNavigator({ userAgent: UA.chromeDesktop, getDisplayMedia: true })
    expect(isGetDisplayMediaSupported()).toBe(true)

    stubNavigator({ userAgent: UA.macSafari, maxTouchPoints: 0, getDisplayMedia: true })
    expect(isGetDisplayMediaSupported()).toBe(true)
  })
})
