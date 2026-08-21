import type { BootstrapPayload, PulseConfig, RuntimeConfig } from './types'

export const BOOTSTRAP_TIMEOUT_MS = 2000

/** Safe defaults when bootstrap is unreachable: screenshot + element pick (user-initiated, no passive capture), everything else off. */
export const SAFE_DEFAULTS: Pick<BootstrapPayload, 'capture' | 'privacy' | 'ui'> = {
  capture: {
    screenshot: true,
    captureTab: false,
    elementPick: true,
    video: false,
    voiceOver: false,
    console: false,
    sentry: false,
    replay: { enabled: false, bufferSeconds: 30, maskAllInputs: true },
  },
  privacy: { maskSelectors: [] },
  ui: { theme: 'auto', position: 'bottom-right', triggerText: 'Feedback' },
}

export function bootstrapUrl(apiUrl: string, siteKey: string): string {
  return `${apiUrl}/api/widget/v1/bootstrap/${encodeURIComponent(siteKey)}`
}

let warnedOnce = false

export interface FetchBootstrapOptions {
  timeoutMs?: number
  fetchImpl?: typeof fetch
  warn?: (message: string, detail?: unknown) => void
}

/**
 * Fetch the per-site config. Resolves null on any failure (timeout, non-2xx, bad JSON)
 * and warns at most once per page so a down API never spams the client's console.
 */
export async function fetchBootstrap(
  apiUrl: string,
  siteKey: string,
  options: FetchBootstrapOptions = {}
): Promise<BootstrapPayload | null> {
  const timeoutMs = options.timeoutMs ?? BOOTSTRAP_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const warn = options.warn ?? ((m: string, d?: unknown) => console.warn(m, d ?? ''))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(bootstrapUrl(apiUrl, siteKey), {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as Partial<BootstrapPayload>
    if (!json || typeof json !== 'object' || !json.capture || !json.ui) throw new Error('malformed bootstrap payload')
    return json as BootstrapPayload
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true
      warn('[Pulse] Could not load site config; using safe defaults (screenshot + element pick only).', err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Test hook. */
export function resetBootstrapWarning(): void {
  warnedOnce = false
}

/**
 * Merge order: bootstrap (or SAFE_DEFAULTS) owns ui/capture/privacy; the host page's
 * PulseConfig owns apiUrl, siteKey, user, custom and callbacks. When bootstrap is
 * unavailable, PulseConfig's own ui hints (theme/position/triggerText) fill in.
 */
export function resolveRuntimeConfig(
  config: PulseConfig & { apiUrl: string },
  payload: BootstrapPayload | null
): RuntimeConfig {
  const base = payload ?? SAFE_DEFAULTS
  const ui = payload
    ? payload.ui
    : {
        theme: config.theme ?? SAFE_DEFAULTS.ui.theme,
        position: config.position ?? SAFE_DEFAULTS.ui.position,
        triggerText: config.triggerText ?? SAFE_DEFAULTS.ui.triggerText,
      }

  return {
    siteKey: config.siteKey,
    apiUrl: config.apiUrl,
    siteName: payload?.site.name ?? null,
    ui,
    capture: { ...base.capture, replay: { ...base.capture.replay } },
    privacy: { maskSelectors: [...base.privacy.maskSelectors] },
    user: { ...config.user },
    custom: { ...config.custom },
    consoleLimit: config.consoleLimit ?? 50,
    onSubmit: config.onSubmit,
    onOpen: config.onOpen,
    onClose: config.onClose,
  }
}
