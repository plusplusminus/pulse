import type { PulseConfig, SubmitResult } from './types'
import { ConsoleInterceptor } from './console'
import { detectSentry } from './sentry'
import { collectContext } from './context'
import { captureScreenshot, cropBlob, blobToBase64 } from './screenshot'
import { submitFeedback } from './api'
import { Widget } from './widget'
import { normaliseApiUrl } from './config'
import { claimInstance, releaseInstance } from './singleton'

export type { PulseConfig, PulseGlobalConfig, SubmitResult, ConsoleEntry, SentryContext, WidgetContext } from './types'

export interface PulseInstance {
  open(): void
  close(): void
  destroy(): void
  identify(user: { email?: string; name?: string }): void
  setCustom(data: Record<string, string>): void
}

export class Pulse {
  private config: Required<Pick<PulseConfig, 'siteKey' | 'apiUrl'>> & PulseConfig
  private consoleInterceptor: ConsoleInterceptor
  private user: { email?: string; name?: string }
  private custom: Record<string, string>
  private widgetHost: HTMLElement | null = null
  private destroyed = false
  private widgetUI: { open: () => void; close: () => void; destroy: () => void; setUser: (user: { email?: string; name?: string }) => void } | null = null

  private constructor(config: PulseConfig) {
    if (!config.siteKey) throw new Error('[Pulse] siteKey is required')
    this.config = {
      ...config,
      apiUrl: normaliseApiUrl(config.apiUrl),
      theme: config.theme ?? 'auto',
      position: config.position ?? 'bottom-right',
      triggerText: config.triggerText ?? 'Feedback',
      collectConsole: config.collectConsole ?? true,
      consoleLimit: config.consoleLimit ?? 50,
    }

    this.user = { ...config.user }
    this.custom = { ...config.custom }

    this.consoleInterceptor = new ConsoleInterceptor(this.config.consoleLimit)

    if (this.config.collectConsole) {
      this.consoleInterceptor.start()
    }
  }

  /** Mounts the widget. Only one instance per page: a second call warns and returns the first. */
  static init(config: PulseConfig): PulseInstance {
    return claimInstance(() => {
      const instance = new Pulse(config)
      const widget = new Widget(instance, config)
      instance.widgetUI = widget
      widget.mount()
      return instance
    })
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
  }): Promise<SubmitResult> {
    const sentryContext = this.config.sentry?.enabled !== false
      ? detectSentry()
      : null

    const context = collectContext(
      this.consoleInterceptor.getEntries(),
      sentryContext,
      this.custom
    )

    let screenshotBase64: string | undefined
    if (formData.screenshot) {
      screenshotBase64 = await blobToBase64(formData.screenshot)
    }

    const result = await submitFeedback(this.config.apiUrl, this.config.siteKey, {
      title: formData.title,
      description: formData.description,
      type: formData.type,
      metadata: context,
      reporter: {
        email: formData.email,
        name: formData.name,
      },
      screenshot: screenshotBase64,
    })

    this.config.onSubmit?.(result)
    return result
  }

  getConfig(): PulseConfig {
    return this.config
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

  async captureScreenshot(): Promise<Blob | null> {
    return captureScreenshot(this.widgetHost)
  }

  async cropScreenshot(blob: Blob, rect: { x: number; y: number; width: number; height: number }): Promise<Blob> {
    return cropBlob(blob, rect)
  }
}
