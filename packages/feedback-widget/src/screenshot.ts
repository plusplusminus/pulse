import { createLazyGlobal } from './lazy-script'

/** Beyond this a PNG is re-encoded as JPEG; uploads, not fidelity, set the ceiling. */
export const MAX_SIZE_BYTES = 2 * 1024 * 1024
export const CAPTURE_TIMEOUT_MS = 5000
export const JPEG_FALLBACK_QUALITY = 0.7

/**
 * Never captured, whatever the site configures. The widget host would otherwise
 * photograph itself, and these attributes are the documented opt-out for hosts.
 */
export const DEFAULT_EXCLUDE_SELECTORS = [
  '#pulse-widget',
  '[data-pulse-mask]',
  '[data-pulse-block]',
  'input[type=password]',
] as const

/** Shown next to the capture controls: snapdom cannot see into cross-origin frames. */
export const CROSS_ORIGIN_NOTICE =
  'Embedded third-party content may appear blank — use Capture tab for those.'

/** Site config is ADDED to the defaults; it can never shrink them. */
export function captureExcludes(maskSelectors: readonly string[] = []): string[] {
  const configured = maskSelectors.map((s) => s.trim()).filter(Boolean)
  return Array.from(new Set([...DEFAULT_EXCLUDE_SELECTORS, ...configured]))
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Screenshot capture timed out')), ms)
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>
}

/** True when the node matches any admin-configured mask selector (invalid selectors are ignored). */
export function isMaskedNode(node: Element, maskSelectors: readonly string[]): boolean {
  if (typeof node.matches !== 'function') return false
  for (const selector of maskSelectors) {
    try {
      if (node.matches(selector)) return true
    } catch {
      // invalid selector from config; skip
    }
  }
  return false
}

export interface CaptureViewportOptions {
  /** Extra selectors from the site's bootstrap config. */
  maskSelectors?: readonly string[]
  /** Defaults to the display's devicePixelRatio — captures are never downscaled. */
  dpr?: number
  timeoutMs?: number
  /** Pulse origin the engine is fetched from; defaults to the build-time origin. */
  apiUrl?: string
}

export interface CaptureEngine {
  captureViewport(options?: CaptureViewportOptions): Promise<Blob>
}

/** Same-origin with the widget bundle, so a host's existing script-src for Pulse covers it. */
export const CAPTURE_ENGINE_PATH = '/widget/v1/capture-engine.js'

/** Reads as an instruction because it lands in the panel's capture-failed row. */
export const ENGINE_LOAD_ERROR =
  'Could not load the screenshot engine — use Capture tab instead.'

const engine = createLazyGlobal<CaptureEngine>({
  path: CAPTURE_ENGINE_PATH,
  marker: 'data-pulse-capture-engine',
  read: () => {
    const g = window.__PulseCaptureEngine
    return g && typeof g.captureViewport === 'function' ? g : null
  },
  error: ENGINE_LOAD_ERROR,
})

/**
 * Bypasses the network load with an already-bundled engine. The npm SDK calls
 * this from its entry so bundlers keep code-splitting snapdom normally and an
 * npm consumer never fetches a script from the Pulse origin. Passing null
 * restores lazy loading (and is how tests reset the module).
 */
export function setCaptureEngine(next: CaptureEngine | null): void {
  engine.set(next)
}

export function captureEngineUrl(apiUrl?: string): string {
  return engine.url(apiUrl)
}

export function loadCaptureEngine(apiUrl?: string): Promise<CaptureEngine> {
  return engine.load(apiUrl)
}

/**
 * The visible viewport at device resolution, as a PNG.
 *
 * Rejects rather than resolving with a partial or null image — including when
 * the engine itself cannot be fetched. The panel turns that rejection into the
 * capture-failed row, which keeps offering "Capture tab" (native
 * getDisplayMedia, which never touches this engine).
 */
export async function captureViewport(options: CaptureViewportOptions = {}): Promise<Blob> {
  const loaded = await loadCaptureEngine(options.apiUrl)
  return loaded.captureViewport(options)
}
