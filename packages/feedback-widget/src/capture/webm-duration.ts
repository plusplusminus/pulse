/**
 * Lazy loader for the WebM duration fixer (PULSE-336).
 *
 * Chrome and Firefox write MediaRecorder WebM with no Duration in the Segment
 * Info, so the file plays but will not seek — the scrubber is dead in a
 * `<video>` element and in whatever viewer Linear hands the link to. Fixing it
 * means rewriting the EBML header, which `fix-webm-duration` does in ~4 KB gz.
 *
 * That is ~15% of the whole embed budget (PULSE-323) for bytes that only matter
 * once a recording has actually finished — so it is split out into its own
 * artefact and fetched on demand, exactly as snapdom is (PULSE-397). The embed
 * pays nothing until the first recording stops, and a visitor who never records
 * never downloads it.
 *
 * Failure here is never fatal: an unfixed recording still plays, so a failed
 * load degrades to "cannot seek" rather than "no video".
 */
import { createLazyGlobal } from '../lazy-script'
import type { VideoPostProcess } from './video'

export interface WebmDurationFixer {
  fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob>
}

/** Same-origin with the widget bundle, so a host's script-src for Pulse covers it. */
export const WEBM_DURATION_PATH = '/widget/v1/webm-duration.js'

/** Reads as a plain sentence: it only ever reaches a console, never the panel. */
const LOAD_ERROR = 'Could not load the WebM duration fixer'

const fixer = createLazyGlobal<WebmDurationFixer>({
  path: WEBM_DURATION_PATH,
  marker: 'data-pulse-webm-duration',
  read: () => {
    const g = window.__PulseWebmDuration
    return g && typeof g.fixWebmDuration === 'function' ? g : null
  },
  error: LOAD_ERROR,
})

/**
 * Bypasses the network load with an already-bundled fixer. The npm SDK calls
 * this from its entry so a consumer's bundler resolves the dependency normally
 * and never reaches back to the Pulse origin. Passing null restores lazy
 * loading (and is how tests reset the module).
 */
export function setWebmDurationFixer(next: WebmDurationFixer | null): void {
  fixer.set(next)
}

export function webmDurationUrl(apiUrl?: string): string {
  return fixer.url(apiUrl)
}

export function loadWebmDurationFixer(apiUrl?: string): Promise<WebmDurationFixer> {
  return fixer.load(apiUrl)
}

/**
 * The `postProcess` hook `createVideoRecorder` expects. video.ts only calls it
 * for WebM output and swallows a rejection, so a fixer that cannot load costs
 * the reporter nothing but a dead scrubber.
 */
export function webmDurationPostProcess(apiUrl?: string): VideoPostProcess {
  return async (blob, { durationMs }) => {
    const loaded = await loadWebmDurationFixer(apiUrl)
    return loaded.fixWebmDuration(blob, durationMs)
  }
}
