/**
 * Lazy WebM duration fixer (dist/webm-duration.global.js, served as
 * /widget/v1/webm-duration.js).
 *
 * Injected by `src/capture/webm-duration.ts` when a WebM recording finishes and
 * never before, so a visitor who never records never downloads it. The IIFE
 * assigns `window.__PulseWebmDuration` (tsup `globalName`); the loader reads
 * `fixWebmDuration` off it.
 */
import fixWebmDurationLib from 'fix-webm-duration'

/** Chrome/Firefox MediaRecorder WebM has no Duration in the Segment Info. */
export function fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  return fixWebmDurationLib(blob, durationMs, { logger: false })
}
