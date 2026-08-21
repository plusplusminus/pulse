import type {
  FeedbackAsset,
  PulseConfig,
  RuntimeConfig,
  ScreenshotAnnotation,
  SubmitResult,
  WidgetContext,
  WidgetPick,
} from './types'
import { ConsoleInterceptor } from './console'
import { detectSentry } from './sentry'
import { collectContext } from './context'
import { captureViewport } from './screenshot'
import { submitFeedback } from './api'
import { uploadBlob } from './transport/upload'
import { Widget } from './widget'
import { normaliseApiUrl } from './config'
import { fetchBootstrap, resolveRuntimeConfig } from './bootstrap'
import { claimInstance, releaseInstance } from './singleton'

export type {
  PulseConfig,
  PulseGlobalConfig,
  RuntimeConfig,
  BootstrapPayload,
  SubmitResult,
  ConsoleEntry,
  SentryContext,
  WidgetContext,
  WidgetPick,
  PickIntent,
  FeedbackAsset,
} from './types'

export interface PulseInstance {
  open(): void
  close(): void
  destroy(): void
  identify(user: { email?: string; name?: string }): void
  setCustom(data: Record<string, string>): void
  /** Resolves once bootstrap has been applied and the widget is mounted (or init was abandoned). */
  ready: Promise<void>
}

export class Pulse implements PulseInstance {
  private readonly pageConfig: PulseConfig & { apiUrl: string }
  private runtime: RuntimeConfig
  private consoleInterceptor: ConsoleInterceptor
  private user: { email?: string; name?: string }
  private custom: Record<string, string>
  private widgetHost: HTMLElement | null = null
  private destroyed = false
  private widgetUI: Widget | null = null
  readonly ready: Promise<void>

  private constructor(config: PulseConfig) {
    if (!config.siteKey) throw new Error('[Pulse] siteKey is required')
    this.pageConfig = { ...config, apiUrl: normaliseApiUrl(config.apiUrl) }
    // Safe defaults until bootstrap arrives; never mounts before then.
    this.runtime = resolveRuntimeConfig(this.pageConfig, null)
    this.user = { ...config.user }
    this.custom = { ...config.custom }
    this.consoleInterceptor = new ConsoleInterceptor(this.runtime.consoleLimit)
    this.ready = this.boot()
  }

  /** Mounts the widget. Only one instance per page: a second call warns and returns the first. */
  static init(config: PulseConfig): PulseInstance {
    return claimInstance(() => new Pulse(config))
  }

  private async boot(): Promise<void> {
    const payload = await fetchBootstrap(this.pageConfig.apiUrl, this.pageConfig.siteKey)
    if (this.destroyed) return
    this.runtime = resolveRuntimeConfig(this.pageConfig, payload)

    if (this.runtime.capture.console) {
      this.consoleInterceptor.start()
    }

    const widget = new Widget(this, this.runtime)
    this.widgetUI = widget
    widget.mount()
  }

  open(): void {
    if (this.destroyed) return
    this.widgetUI?.open()
  }

  close(): void {
    if (this.destroyed) return
    this.widgetUI?.close()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    releaseInstance(this)
    this.consoleInterceptor.stop()
    this.widgetUI?.destroy()
    if (this.widgetHost) {
      this.widgetHost.remove()
      this.widgetHost = null
    }
  }

  identify(user: { email?: string; name?: string }): void {
    this.user = { ...this.user, ...user }
    this.widgetUI?.setUser(this.user)
  }

  setCustom(data: Record<string, string>): void {
    this.custom = { ...this.custom, ...data }
  }

  async submitFeedback(formData: {
    title: string
    description?: string
    type: 'bug' | 'feedback' | 'idea'
    email: string
    name?: string
    /** Every attached image, in the reporter's order, each with its own marks. */
    screenshots?: { blob: Blob; annotations?: ScreenshotAnnotation[] }[]
    video?: { blob: Blob; mimeType: string } | null
    picks?: WidgetPick[]
    captureSurface?: WidgetContext['captureSurface']
    onUploadProgress?: (sent: number, total: number) => void
  }): Promise<SubmitResult> {
    const sentryContext = this.runtime.capture.sentry ? detectSentry() : null

    const context = collectContext(
      this.runtime.capture.console ? this.consoleInterceptor.getEntries() : [],
      sentryContext,
      this.custom,
      formData.captureSurface
    )

    // Bytes go browser -> Supabase Storage; only the object key is submitted.
    // One asset per attachment (PULSE-403), positioned within its kind.
    const assets: FeedbackAsset[] = []

    // Sequential, not parallel: `position` is the reporter's ordering, and the
    // upload endpoint is rate limited per IP — six images at once would spend
    // the budget in one burst.
    if (this.runtime.capture.screenshot) {
      for (const [position, shot] of (formData.screenshots ?? []).entries()) {
        const storagePath = await uploadBlob(
          this.runtime.apiUrl,
          this.runtime.siteKey,
          'screenshot',
          shot.blob
        )
        assets.push({
          kind: 'screenshot',
          storagePath,
          contentType: shot.blob.type || undefined,
          sizeBytes: shot.blob.size,
          annotations: shot.annotations?.length ? shot.annotations : undefined,
          position,
        })
      }
    }

    // A recording is the one artefact big enough to need the resumable path
    // (> 6 MB) and slow enough to need a progress readout. The recorder's real
    // mimeType picks the extension server-side; never relabel it here.
    if (formData.video && this.runtime.capture.video) {
      const storagePath = await uploadBlob(
        this.runtime.apiUrl,
        this.runtime.siteKey,
        'video',
        formData.video.blob,
        {
          contentType: formData.video.mimeType,
          onProgress: formData.onUploadProgress,
        }
      )
      assets.push({
        kind: 'video',
        storagePath,
        contentType: formData.video.mimeType,
        sizeBytes: formData.video.blob.size,
        position: 0,
      })
    }

    const result = await submitFeedback(this.runtime.apiUrl, this.runtime.siteKey, {
      title: formData.title,
      description: formData.description,
      type: formData.type,
      metadata: context,
      reporter: {
        email: formData.email,
        name: formData.name,
      },
      assets: assets.length ? assets : undefined,
      picks: this.runtime.capture.elementPick && formData.picks?.length ? formData.picks : undefined,
    })

    this.runtime.onSubmit?.(result)
    return result
  }

  getRuntimeConfig(): RuntimeConfig {
    return this.runtime
  }

  getUser(): { email?: string; name?: string } {
    return { ...this.user }
  }

  setWidgetHost(host: HTMLElement): void {
    this.widgetHost = host
  }

  /** null means the site has screenshots switched off; a real failure rejects. */
  async captureScreenshot(): Promise<Blob | null> {
    if (!this.runtime.capture.screenshot) return null
    // apiUrl is the SAME resolved base the widget is already talking to, so the
    // engine is fetched from whichever Pulse origin this install points at.
    return captureViewport({
      maskSelectors: this.runtime.privacy.maskSelectors,
      apiUrl: this.runtime.apiUrl,
    })
  }

}
