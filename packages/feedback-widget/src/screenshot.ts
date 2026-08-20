import { snapdom } from '@zumer/snapdom'

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
}

/**
 * The visible viewport at device resolution, as a PNG.
 *
 * Rejects rather than resolving with a partial or null image: the panel offers
 * "Capture tab" when this fails, and a silently degraded screenshot is worse
 * than an honest failure.
 *
 * Excluded nodes are hidden, not removed, so the capture keeps the layout the
 * user was actually looking at. `cacheBust` is deliberately never set — it
 * appends a query param that breaks signed asset URLs on client sites.
 */
export async function captureViewport(options: CaptureViewportOptions = {}): Promise<Blob> {
  const dpr = options.dpr ?? window.devicePixelRatio ?? 1
  const capture = await withTimeout(
    snapdom(document.documentElement, {
      clip: 'viewport',
      dpr,
      exclude: captureExcludes(options.maskSelectors),
      excludeMode: 'hide',
    }),
    options.timeoutMs ?? CAPTURE_TIMEOUT_MS
  )

  const png = await capture.toBlob({ type: 'png' })
  if (png.size <= MAX_SIZE_BYTES) return png
  return capture.toBlob({ type: 'jpeg', quality: JPEG_FALLBACK_QUALITY })
}
