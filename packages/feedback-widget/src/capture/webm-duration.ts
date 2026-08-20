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
import { normaliseApiUrl } from '../config'
import type { VideoPostProcess } from './video'

export interface WebmDurationFixer {
  fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob>
}

/** Same-origin with the widget bundle, so a host's script-src for Pulse covers it. */
export const WEBM_DURATION_PATH = '/widget/v1/webm-duration.js'

let fixer: WebmDurationFixer | null = null
let pending: Promise<WebmDurationFixer> | null = null

/**
 * Bypasses the network load with an already-bundled fixer. The npm SDK calls
 * this from its entry so a consumer's bundler resolves the dependency normally
 * and never reaches back to the Pulse origin. Passing null restores lazy
 * loading (and is how tests reset the module).
 */
export function setWebmDurationFixer(next: WebmDurationFixer | null): void {
  fixer = next
  pending = null
}

export function webmDurationUrl(apiUrl?: string): string {
  return `${normaliseApiUrl(apiUrl)}${WEBM_DURATION_PATH}`
}

/**
 * Injects the fixer script once. The promise is cached so concurrent recordings
 * share a single load; a failed load clears the cache so the next recording can
 * try again rather than being stuck with the first failure forever.
 */
export function loadWebmDurationFixer(apiUrl?: string): Promise<WebmDurationFixer> {
  if (fixer) return Promise.resolve(fixer)

  // A second Pulse instance, or a host that preloads the artefact itself.
  const existing = window.__PulseWebmDuration
  if (existing && typeof existing.fixWebmDuration === 'function') {
    fixer = existing
    return Promise.resolve(fixer)
  }

  if (pending) return pending

  const attempt = new Promise<WebmDurationFixer>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = webmDurationUrl(apiUrl)
    script.async = true
    // /widget/v1/* is served with Access-Control-Allow-Origin: *, so anonymous
    // CORS costs nothing and gives real error details instead of "Script error".
    script.crossOrigin = 'anonymous'
    script.setAttribute('data-pulse-webm-duration', '')

    const fail = () => {
      script.remove()
      reject(new Error('Could not load the WebM duration fixer'))
    }

    script.addEventListener(
      'load',
      () => {
        const loaded = window.__PulseWebmDuration
        if (loaded && typeof loaded.fixWebmDuration === 'function') {
          fixer = loaded
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
