import type { PulseConfig, RuntimeConfig, ScreenshotAnnotation, SubmitResult, WidgetPick } from './types'
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
    screenshot?: Blob | null
    picks?: WidgetPick[]
    screenshotAnnotations?: ScreenshotAnnotation[]
  }): Promise<SubmitResult> {
    const sentryContext = this.runtime.capture.sentry ? detectSentry() : null

    const context = collectContext(
      this.runtime.capture.console ? this.consoleInterceptor.getEntries() : [],
      sentryContext,
      this.custom
    )

    // Bytes go browser -> Supabase Storage; only the object key is submitted.
    let screenshotStoragePath: string | undefined
    if (formData.screenshot && this.runtime.capture.screenshot) {
      screenshotStoragePath = await uploadBlob(
        this.runtime.apiUrl,
        this.runtime.siteKey,
        'screenshot',
        formData.screenshot
      )
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
      screenshotStoragePath,
      picks: this.runtime.capture.elementPick && formData.picks?.length ? formData.picks : undefined,
      screenshotAnnotations: formData.screenshotAnnotations?.length
        ? formData.screenshotAnnotations
        : undefined,
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

  getWidgetHost(): HTMLElement | null {
    return this.widgetHost
  }

  setWidgetHost(host: HTMLElement): void {
    this.widgetHost = host
  }

  /** null means the site has screenshots switched off; a real failure rejects. */
  async captureScreenshot(): Promise<Blob | null> {
    if (!this.runtime.capture.screenshot) return null
    return captureViewport({ maskSelectors: this.runtime.privacy.maskSelectors })
  }

}
