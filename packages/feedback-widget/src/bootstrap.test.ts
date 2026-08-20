import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  bootstrapUrl,
  fetchBootstrap,
  resetBootstrapWarning,
  resolveRuntimeConfig,
  SAFE_DEFAULTS,
} from './bootstrap'
import type { BootstrapPayload } from './types'

const payload: BootstrapPayload = {
  site: { name: 'Acme' },
  api: { base: 'https://pulse.test' },
  capture: {
    screenshot: false,
    captureTab: true,
    elementPick: true,
    video: false,
    console: true,
    sentry: true,
    replay: { enabled: true, bufferSeconds: 45, maskAllInputs: false },
  },
  privacy: { maskSelectors: ['.secret'] },
  ui: { theme: 'dark', position: 'bottom-left', triggerText: 'Report' },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => resetBootstrapWarning())

describe('fetchBootstrap', () => {
  it('builds the v1 bootstrap URL with an encoded site key', () => {
    expect(bootstrapUrl('https://pulse.test', 'sk_a/b')).toBe('https://pulse.test/api/widget/v1/bootstrap/sk_a%2Fb')
  })

  it('returns the payload on 200', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(payload))
    const warn = vi.fn()
    await expect(fetchBootstrap('https://pulse.test', 'sk_1', { fetchImpl, warn })).resolves.toEqual(payload)
    expect(warn).not.toHaveBeenCalled()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://pulse.test/api/widget/v1/bootstrap/sk_1')
    expect(init.credentials).toBe('omit')
  })

  it('returns null on 5xx and warns exactly once across calls', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'boom' }, 503))
    const warn = vi.fn()
    expect(await fetchBootstrap('https://pulse.test', 'sk_1', { fetchImpl, warn })).toBeNull()
    expect(await fetchBootstrap('https://pulse.test', 'sk_1', { fetchImpl, warn })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/safe defaults/)
  })

  it('returns null when the request exceeds the timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )
    const warn = vi.fn()
    const result = await fetchBootstrap('https://pulse.test', 'sk_1', { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 10, warn })
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('returns null on a malformed body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }))
    expect(await fetchBootstrap('https://pulse.test', 'sk_1', { fetchImpl, warn: () => {} })).toBeNull()
  })
})

describe('resolveRuntimeConfig', () => {
  const pageConfig = {
    siteKey: 'sk_1',
    apiUrl: 'http://localhost:3000',
    theme: 'light' as const,
    position: 'bottom-right' as const,
    triggerText: 'Page text',
    user: { email: 'u@x.y' },
    custom: { plan: 'pro' },
  }

  it('bootstrap owns ui/capture/privacy; PulseConfig owns apiUrl, user, custom', () => {
    const rc = resolveRuntimeConfig(pageConfig, payload)
    expect(rc.ui).toEqual(payload.ui)
    expect(rc.capture).toEqual(payload.capture)
    expect(rc.privacy.maskSelectors).toEqual(['.secret'])
    expect(rc.apiUrl).toBe('http://localhost:3000')
    expect(rc.user).toEqual({ email: 'u@x.y' })
    expect(rc.custom).toEqual({ plan: 'pro' })
    expect(rc.siteName).toBe('Acme')
  })

  it('falls back to safe defaults plus PulseConfig ui hints when bootstrap is null', () => {
    const rc = resolveRuntimeConfig(pageConfig, null)
    expect(rc.capture).toEqual(SAFE_DEFAULTS.capture)
    expect(rc.capture.screenshot).toBe(true)
    expect(rc.capture.console).toBe(false)
    expect(rc.capture.sentry).toBe(false)
    expect(rc.ui).toEqual({ theme: 'light', position: 'bottom-right', triggerText: 'Page text' })
    expect(rc.siteName).toBeNull()
  })

  it('does not share mutable state with the payload', () => {
    const rc = resolveRuntimeConfig(pageConfig, payload)
    rc.privacy.maskSelectors.push('.x')
    rc.capture.replay.enabled = false
    expect(payload.privacy.maskSelectors).toEqual(['.secret'])
    expect(payload.capture.replay.enabled).toBe(true)
  })
})
