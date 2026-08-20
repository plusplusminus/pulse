import { snapdom } from '@zumer/snapdom'
import {
  CAPTURE_TIMEOUT_MS,
  JPEG_FALLBACK_QUALITY,
  MAX_SIZE_BYTES,
  captureExcludes,
  withTimeout,
  type CaptureViewportOptions,
} from '../screenshot'

/**
 * The snapdom half of screenshot capture, built as its own IIFE artefact
 * (`capture-engine.global.js`) and fetched on first use. Nothing in the embed
 * may import this module — a static or dynamic import pulls snapdom's ~45 KB gz
 * straight back into `embed.global.js`, because tsup's `iife` format cannot
 * code-split. `src/screenshot.ts` reaches it through the injected global instead.
 */

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
