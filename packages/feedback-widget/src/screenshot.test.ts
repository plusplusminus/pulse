// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const snapdomMock = vi.hoisted(() => vi.fn())
vi.mock('@zumer/snapdom', () => ({ snapdom: snapdomMock }))

import {
  CAPTURE_TIMEOUT_MS,
  CROSS_ORIGIN_NOTICE,
  DEFAULT_EXCLUDE_SELECTORS,
  MAX_SIZE_BYTES,
  captureExcludes,
  captureViewport,
  isMaskedNode,
  withTimeout,
} from './screenshot'

type CaptureOptions = { clip?: unknown; dpr?: number; exclude?: string[]; excludeMode?: string }

function blobOf(size: number, type: string): Blob {
  const blob = new Blob(['x'], { type })
  Object.defineProperty(blob, 'size', { value: size })
  return blob
}

/** Records what captureViewport asked snapdom for, and what it asked of the result. */
function mockCapture(pngSize: number, jpegSize = 10) {
  const toBlob = vi.fn(async (opts: { type?: string } = {}) =>
    opts.type === 'jpeg' ? blobOf(jpegSize, 'image/jpeg') : blobOf(pngSize, 'image/png')
  )
  snapdomMock.mockResolvedValue({ toBlob })
  return toBlob
}

beforeEach(() => {
  snapdomMock.mockReset()
  vi.useRealTimers()
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('captureExcludes', () => {
  it('always includes the defaults', () => {
    expect(captureExcludes()).toEqual([...DEFAULT_EXCLUDE_SELECTORS])
    expect(captureExcludes()).toContain('#pulse-widget')
    expect(captureExcludes()).toContain('[data-pulse-mask]')
  })

  it('adds configured selectors without letting them replace the defaults', () => {
    const result = captureExcludes(['.balance', '  [data-pii]  ', ''])
    for (const d of DEFAULT_EXCLUDE_SELECTORS) expect(result).toContain(d)
    expect(result).toContain('.balance')
    expect(result).toContain('[data-pii]')
    expect(result).not.toContain('')
  })

  it('de-duplicates a configured selector that repeats a default', () => {
    const result = captureExcludes(['#pulse-widget'])
    expect(result.filter((s) => s === '#pulse-widget')).toHaveLength(1)
  })
})

describe('captureViewport', () => {
  it('clips to the viewport at devicePixelRatio and hides excluded nodes', async () => {
    mockCapture(1000)
    await captureViewport({ maskSelectors: ['.secret'] })

    const [element, options] = snapdomMock.mock.calls[0] as [Element, CaptureOptions]
    expect(element).toBe(document.documentElement)
    expect(options.clip).toBe('viewport')
    expect(options.dpr).toBe(2)
    expect(options.excludeMode).toBe('hide')
    expect(options.exclude).toContain('#pulse-widget')
    expect(options.exclude).toContain('.secret')
  })

  it('never sets cacheBust — it breaks signed asset URLs on client sites', async () => {
    mockCapture(1000)
    await captureViewport()
    const [, options] = snapdomMock.mock.calls[0] as [Element, Record<string, unknown>]
    expect(options).not.toHaveProperty('cacheBust')
  })

  it('honours an explicit dpr over the display value', async () => {
    mockCapture(1000)
    await captureViewport({ dpr: 3 })
    const [, options] = snapdomMock.mock.calls[0] as [Element, CaptureOptions]
    expect(options.dpr).toBe(3)
  })

  it('returns the PNG when it is within the size ceiling', async () => {
    const toBlob = mockCapture(MAX_SIZE_BYTES)
    const blob = await captureViewport()
    expect(blob.type).toBe('image/png')
    expect(toBlob).toHaveBeenCalledTimes(1)
  })

  it('re-encodes as JPEG only when the PNG is over the ceiling', async () => {
    const toBlob = mockCapture(MAX_SIZE_BYTES + 1)
    const blob = await captureViewport()
    expect(blob.type).toBe('image/jpeg')
    expect(toBlob).toHaveBeenNthCalledWith(2, { type: 'jpeg', quality: 0.7 })
  })

  it('rejects on timeout rather than resolving with a partial image', async () => {
    snapdomMock.mockImplementation(() => new Promise(() => {}))
    await expect(captureViewport({ timeoutMs: 5 })).rejects.toThrow('timed out')
  })

  it('propagates an engine failure instead of swallowing it', async () => {
    snapdomMock.mockRejectedValue(new Error('tainted canvas'))
    await expect(captureViewport()).rejects.toThrow('tainted canvas')
  })

  it('defaults the timeout to 5s', () => {
    expect(CAPTURE_TIMEOUT_MS).toBe(5000)
  })
})

describe('withTimeout', () => {
  it('passes a value through and clears its timer', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })
})

describe('isMaskedNode', () => {
  it('matches configured selectors and ignores invalid ones', () => {
    document.body.innerHTML = '<div id="a" class="secret"></div>'
    const el = document.getElementById('a')!
    expect(isMaskedNode(el, ['.secret'])).toBe(true)
    expect(isMaskedNode(el, ['.other'])).toBe(false)
    expect(isMaskedNode(el, ['>>>bad'])).toBe(false)
  })
})

describe('CROSS_ORIGIN_NOTICE', () => {
  it('tells the user what to do about blank embeds', () => {
    expect(CROSS_ORIGIN_NOTICE).toContain('Capture tab')
  })
})
