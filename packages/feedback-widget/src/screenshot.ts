import { normaliseApiUrl } from './config'

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

let engine: CaptureEngine | null = null
let pending: Promise<CaptureEngine> | null = null

/**
 * Bypasses the network load with an already-bundled engine. The npm SDK calls
 * this from its entry so bundlers keep code-splitting snapdom normally and an
 * npm consumer never fetches a script from the Pulse origin. Passing null
 * restores lazy loading (and is how tests reset the module).
 */
export function setCaptureEngine(next: CaptureEngine | null): void {
  engine = next
  pending = null
}

export function captureEngineUrl(apiUrl?: string): string {
  return `${normaliseApiUrl(apiUrl)}${CAPTURE_ENGINE_PATH}`
}

/**
 * Injects the engine script once. The promise is cached so concurrent captures
 * share a single load and later captures reuse it. A failed load clears the
 * cache so a retry (or the user's "Retake") can try again rather than being
 * stuck with the first failure forever.
 */
export function loadCaptureEngine(apiUrl?: string): Promise<CaptureEngine> {
  if (engine) return Promise.resolve(engine)

  // A second Pulse instance, or a host that preloads the engine itself.
  const existing = window.__PulseCaptureEngine
  if (existing && typeof existing.captureViewport === 'function') {
    engine = existing
    return Promise.resolve(engine)
  }

  if (pending) return pending

  const attempt = new Promise<CaptureEngine>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = captureEngineUrl(apiUrl)
    script.async = true
    // /widget/v1/* is served with Access-Control-Allow-Origin: *, so anonymous
    // CORS costs nothing and gives real error details instead of "Script error".
    script.crossOrigin = 'anonymous'
    script.setAttribute('data-pulse-capture-engine', '')

    const fail = () => {
      script.remove()
      reject(new Error(ENGINE_LOAD_ERROR))
    }

    script.addEventListener(
      'load',
      () => {
        const loaded = window.__PulseCaptureEngine
        if (loaded && typeof loaded.captureViewport === 'function') {
          engine = loaded
          resolve(loaded)
        } else {
          fail()
        }
      },
      { once: true }
    )
    script.addEventListener('error', fail, { once: true })

    ;(document.head ?? document.documentElement).appendChild(script)
  })

  pending = attempt
  attempt.catch(() => {
    if (pending === attempt) pending = null
  })
  return attempt
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
