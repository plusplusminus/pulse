import type { PulseConfig, PulseGlobalConfig } from './types'

/** Pulse origin injected by tsup `define` at build time. */
export const DEFAULT_API_URL: string = __PULSE_API_URL__

const THEMES = ['auto', 'light', 'dark'] as const
const POSITIONS = ['bottom-right', 'bottom-left'] as const

export function normaliseApiUrl(url: string | undefined): string {
  const value = (url ?? '').trim()
  if (!value) return DEFAULT_API_URL
  return value.replace(/\/+$/, '')
}

/**
 * Subset of `document.currentScript.dataset` the embed understands:
 * data-site, data-api, data-theme, data-position, data-trigger-text.
 */
export interface EmbedDataset {
  site?: string
  api?: string
  theme?: string
  position?: string
  triggerText?: string
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined
}

/**
 * Resolve the embed config. Precedence: data-* attributes > window.PulseConfig > defaults.
 * Returns null when no site key can be found (nothing to initialise).
 */
export function resolveEmbedConfig(
  dataset: EmbedDataset | undefined,
  globalConfig: PulseGlobalConfig | undefined
): PulseConfig | null {
  const ds = dataset ?? {}
  const gc = globalConfig ?? {}

  const siteKey = (ds.site ?? gc.siteKey ?? '').trim()
  if (!siteKey) return null

  const { loaderBase: _loaderBase, onReady: _onReady, ...passthrough } = gc

  return {
    ...passthrough,
    siteKey,
    apiUrl: normaliseApiUrl(ds.api ?? gc.apiUrl),
    theme: pick(ds.theme, THEMES) ?? gc.theme ?? 'auto',
    position: pick(ds.position, POSITIONS) ?? gc.position ?? 'bottom-right',
    triggerText: ds.triggerText ?? gc.triggerText ?? 'Feedback',
  }
}
