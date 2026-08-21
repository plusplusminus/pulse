/**
 * One implementation of "fetch an IIFE artefact from the Pulse origin the first
 * time it is needed, and never before".
 *
 * The embed is an `iife` bundle and iife cannot code-split, so anything the
 * embed imports is inlined into it. Everything heavy therefore ships as its own
 * artefact next to pulse.js and registers itself on `window` — the capture
 * engine (PULSE-397), the WebM duration fixer (PULSE-336) and the annotation
 * editor (PULSE-401). Each used to carry its own copy of this ~50 lines; the
 * embed pays for all of them, so there is exactly one copy now.
 */
import { normaliseApiUrl } from './config'

export interface LazyGlobalSpec<T> {
  /** Path under the Pulse origin, e.g. '/widget/v1/capture-engine.js'. */
  path: string
  /** Attribute stamped on the injected <script>, so hosts and tests can find it. */
  marker: string
  /** Reads the artefact off `window`; null when it has not run, or is the wrong shape. */
  read: () => T | null
  /** Message the rejection carries when the script cannot be fetched or did not register. */
  error: string
}

export interface LazyGlobal<T> {
  url(apiUrl?: string): string
  load(apiUrl?: string): Promise<T>
  /**
   * Bypasses the network with an already-bundled module. The npm SDK calls this
   * so a consumer's bundler resolves the dependency normally and never reaches
   * back to the Pulse origin. Passing null restores lazy loading (and is how
   * tests reset the module).
   */
  set(next: T | null): void
}

export function createLazyGlobal<T>(spec: LazyGlobalSpec<T>): LazyGlobal<T> {
  let loaded: T | null = null
  let pending: Promise<T> | null = null

  const url = (apiUrl?: string): string => `${normaliseApiUrl(apiUrl)}${spec.path}`

  return {
    url,

    set(next: T | null): void {
      loaded = next
      pending = null
    },

    /**
     * Injects the script once. The promise is cached so concurrent callers share
     * a single load and later callers reuse it. A failed load clears the cache so
     * a retry can try again rather than being stuck with the first failure.
     */
    load(apiUrl?: string): Promise<T> {
      if (loaded) return Promise.resolve(loaded)

      // A second Pulse instance, or a host that preloads the artefact itself.
      const existing = spec.read()
      if (existing) {
        loaded = existing
        return Promise.resolve(existing)
      }

      if (pending) return pending

      const attempt = new Promise<T>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = url(apiUrl)
        script.async = true
        // /widget/v1/* is served with Access-Control-Allow-Origin: *, so anonymous
        // CORS costs nothing and gives real error details instead of "Script error".
        script.crossOrigin = 'anonymous'
        script.setAttribute(spec.marker, '')

        const fail = () => {
          script.remove()
          reject(new Error(spec.error))
        }

        script.addEventListener(
          'load',
          () => {
            const ready = spec.read()
            if (ready) {
              loaded = ready
              resolve(ready)
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
    },
  }
}
