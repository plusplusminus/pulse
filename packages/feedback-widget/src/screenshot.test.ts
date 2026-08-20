// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  CAPTURE_ENGINE_PATH,
  CAPTURE_TIMEOUT_MS,
  CROSS_ORIGIN_NOTICE,
  DEFAULT_EXCLUDE_SELECTORS,
  ENGINE_LOAD_ERROR,
  captureEngineUrl,
  captureExcludes,
  captureViewport,
  isMaskedNode,
  loadCaptureEngine,
  setCaptureEngine,
  withTimeout,
  type CaptureEngine,
} from './screenshot'

const ENGINE_SELECTOR = 'script[data-pulse-capture-engine]'

function injectedScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>(ENGINE_SELECTOR))
}

/** jsdom never fetches the src, so the load/error outcome is dispatched by hand. */
function settleEngine(outcome: 'load' | 'error', engine?: CaptureEngine): void {
  const scripts = injectedScripts()
  const script = scripts[scripts.length - 1]
  if (!script) throw new Error('no capture-engine script was injected')
  if (engine) window.__PulseCaptureEngine = engine
  script.dispatchEvent(new Event(outcome))
}

function stubEngine(blob = new Blob(['png'], { type: 'image/png' })) {
  return { captureViewport: vi.fn(async () => blob) }
}

beforeEach(() => {
  setCaptureEngine(null)
  delete window.__PulseCaptureEngine
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  vi.useRealTimers()
})

afterEach(() => {
  setCaptureEngine(null)
  delete window.__PulseCaptureEngine
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

describe('captureEngineUrl', () => {
  it('sits next to the widget bundle on the resolved API base', () => {
    expect(captureEngineUrl('https://feedback.acme.test')).toBe(
      `https://feedback.acme.test${CAPTURE_ENGINE_PATH}`
    )
  })

  it('trims a trailing slash rather than emitting a double slash', () => {
    expect(captureEngineUrl('https://feedback.acme.test/')).toBe(
      `https://feedback.acme.test${CAPTURE_ENGINE_PATH}`
    )
  })

  it('falls back to the build-time origin when no base is given', () => {
    expect(captureEngineUrl()).toBe(`https://pulse.test${CAPTURE_ENGINE_PATH}`)
  })
})

describe('lazy engine load', () => {
  it('injects one script from the widget API base on the first capture', async () => {
    const engine = stubEngine()
    const pending = captureViewport({ apiUrl: 'https://feedback.acme.test' })

    const scripts = injectedScripts()
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe(`https://feedback.acme.test${CAPTURE_ENGINE_PATH}`)
    expect(scripts[0].async).toBe(true)
    expect(scripts[0].crossOrigin).toBe('anonymous')

    settleEngine('load', engine)
    await expect(pending).resolves.toBeInstanceOf(Blob)
    expect(engine.captureViewport).toHaveBeenCalledTimes(1)
  })

  it('does not refetch on a second capture', async () => {
    const engine = stubEngine()
    const first = captureViewport({ apiUrl: 'https://feedback.acme.test' })
    settleEngine('load', engine)
    await first

    await captureViewport({ apiUrl: 'https://feedback.acme.test' })

    expect(injectedScripts()).toHaveLength(1)
    expect(engine.captureViewport).toHaveBeenCalledTimes(2)
  })

  it('shares one load between concurrent captures', async () => {
    const engine = stubEngine()
    const a = captureViewport()
    const b = captureViewport()
    const c = loadCaptureEngine()

    expect(injectedScripts()).toHaveLength(1)

    settleEngine('load', engine)
    await Promise.all([a, b, c])

    expect(injectedScripts()).toHaveLength(1)
    expect(engine.captureViewport).toHaveBeenCalledTimes(2)
  })

  it('forwards the capture options to the loaded engine', async () => {
    const engine = stubEngine()
    const pending = captureViewport({ maskSelectors: ['.secret'], dpr: 3 })
    settleEngine('load', engine)
    await pending

    expect(engine.captureViewport).toHaveBeenCalledWith(
      expect.objectContaining({ maskSelectors: ['.secret'], dpr: 3 })
    )
  })

  it('reuses an engine that is already on the page without injecting anything', async () => {
    const engine = stubEngine()
    window.__PulseCaptureEngine = engine

    await captureViewport()

    expect(injectedScripts()).toHaveLength(0)
    expect(engine.captureViewport).toHaveBeenCalledTimes(1)
  })
})

describe('engine load failure', () => {
  it('rejects with an actionable message instead of hanging the panel', async () => {
    const pending = captureViewport()
    settleEngine('error')
    await expect(pending).rejects.toThrow(ENGINE_LOAD_ERROR)
  })

  it('points the user at Capture tab, which needs no engine', () => {
    expect(ENGINE_LOAD_ERROR).toContain('Capture tab')
  })

  it('rejects when the script loads but never registers the global', async () => {
    const pending = captureViewport()
    settleEngine('load')
    await expect(pending).rejects.toThrow(ENGINE_LOAD_ERROR)
  })

  it('rejects every concurrent caller from the single failed load', async () => {
    const a = captureViewport()
    const b = captureViewport()
    settleEngine('error')
    await expect(a).rejects.toThrow(ENGINE_LOAD_ERROR)
    await expect(b).rejects.toThrow(ENGINE_LOAD_ERROR)
    expect(injectedScripts()).toHaveLength(0)
  })

  it('drops the dead script tag and lets a retake try again', async () => {
    const failed = captureViewport()
    settleEngine('error')
    await expect(failed).rejects.toThrow(ENGINE_LOAD_ERROR)
    expect(injectedScripts()).toHaveLength(0)

    const engine = stubEngine()
    const retry = captureViewport()
    expect(injectedScripts()).toHaveLength(1)
    settleEngine('load', engine)
    await expect(retry).resolves.toBeInstanceOf(Blob)
  })
})

describe('setCaptureEngine', () => {
  it('lets the npm SDK use its bundled engine without any network load', async () => {
    const engine = stubEngine()
    setCaptureEngine(engine)

    await captureViewport({ maskSelectors: ['.secret'] })

    expect(injectedScripts()).toHaveLength(0)
    expect(engine.captureViewport).toHaveBeenCalledWith(
      expect.objectContaining({ maskSelectors: ['.secret'] })
    )
  })
})

describe('withTimeout', () => {
  it('passes a value through and clears its timer', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })

  it('rejects once the deadline passes', async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toThrow('timed out')
  })

  it('defaults the capture timeout to 5s', () => {
    expect(CAPTURE_TIMEOUT_MS).toBe(5000)
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
