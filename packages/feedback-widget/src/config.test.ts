import { describe, it, expect } from 'vitest'
import { DEFAULT_API_URL, normaliseApiUrl, resolveEmbedConfig } from './config'

describe('normaliseApiUrl', () => {
  it('falls back to the build-time Pulse origin, never the page origin', () => {
    expect(DEFAULT_API_URL).toBe('https://pulse.test')
    expect(normaliseApiUrl(undefined)).toBe('https://pulse.test')
    expect(normaliseApiUrl('   ')).toBe('https://pulse.test')
  })

  it('strips trailing slashes', () => {
    expect(normaliseApiUrl('http://localhost:3000/')).toBe('http://localhost:3000')
    expect(normaliseApiUrl('http://localhost:3000///')).toBe('http://localhost:3000')
  })
})

describe('resolveEmbedConfig', () => {
  it('returns null when no site key is present anywhere', () => {
    expect(resolveEmbedConfig(undefined, undefined)).toBeNull()
    expect(resolveEmbedConfig({ api: 'http://x' }, { apiUrl: 'http://y' })).toBeNull()
    expect(resolveEmbedConfig({ site: '  ' }, {})).toBeNull()
  })

  it('applies defaults when only data-site is given', () => {
    expect(resolveEmbedConfig({ site: 'sk_abc' }, undefined)).toEqual({
      siteKey: 'sk_abc',
      apiUrl: 'https://pulse.test',
      theme: 'auto',
      position: 'bottom-right',
      triggerText: 'Feedback',
    })
  })

  it('prefers data-* over window.PulseConfig over defaults', () => {
    const config = resolveEmbedConfig(
      { site: 'sk_from_tag', api: 'http://tag-api/', theme: 'dark' },
      { siteKey: 'sk_from_global', apiUrl: 'http://global-api', theme: 'light', position: 'bottom-left', triggerText: 'Help' }
    )
    expect(config).toMatchObject({
      siteKey: 'sk_from_tag',
      apiUrl: 'http://tag-api',
      theme: 'dark',
      position: 'bottom-left',
      triggerText: 'Help',
    })
  })

  it('ignores invalid data-theme / data-position values', () => {
    const config = resolveEmbedConfig({ site: 'sk_abc', theme: 'neon', position: 'top' }, { position: 'bottom-left' })
    expect(config?.theme).toBe('auto')
    expect(config?.position).toBe('bottom-left')
  })

  it('passes through PulseConfig extras (user, custom, callbacks) but not loader-only fields', () => {
    const onSubmit = () => {}
    const config = resolveEmbedConfig(undefined, {
      siteKey: 'sk_abc',
      user: { email: 'a@b.c' },
      custom: { plan: 'pro' },
      onSubmit,
      loaderBase: 'http://cdn',
      onReady: () => {},
    })
    expect(config).toMatchObject({ user: { email: 'a@b.c' }, custom: { plan: 'pro' }, onSubmit })
    expect(config).not.toHaveProperty('loaderBase')
    expect(config).not.toHaveProperty('onReady')
  })
})
