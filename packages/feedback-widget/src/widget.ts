import type { RuntimeConfig, SubmitResult, WidgetState } from './types'
import { getWidgetStyles } from './ui/styles'
import { TriggerButton } from './ui/trigger'
import { FeedbackPanel, type PanelFormData } from './ui/panel'
import { AnnotationCanvas } from './ui/annotation'
import { AreaSelector } from './ui/crop'

export interface PulseCore {
  submitFeedback(data: {
    title: string
    description?: string
    type: 'bug' | 'feedback' | 'idea'
    email: string
    name?: string
    screenshot?: Blob | null
  }): Promise<SubmitResult>
  captureScreenshot(): Promise<Blob | null>
  cropScreenshot(blob: Blob, rect: { x: number; y: number; width: number; height: number }): Promise<Blob>
  setWidgetHost(host: HTMLElement): void
  getRuntimeConfig(): RuntimeConfig
  getUser(): { email?: string; name?: string }
}

export class Widget {
  private host!: HTMLElement
  private shadow!: ShadowRoot
  private styleEl!: HTMLStyleElement
  private trigger!: TriggerButton
  private panel!: FeedbackPanel
  private annotation: AnnotationCanvas | null = null
  private state: WidgetState = 'closed'
  private currentScreenshot: Blob | null = null
  private user: { email?: string; name?: string }
  private themeQuery: MediaQueryList | null = null
  private themeHandler: ((e: MediaQueryListEvent) => void) | null = null
  private keyHandler: ((e: KeyboardEvent) => void) | null = null

  constructor(
    private pulse: PulseCore,
    private config: RuntimeConfig
  ) {
    this.user = { ...config.user }
  }

  mount(): void {
    this.host = document.createElement('div')
    this.host.id = 'pulse-widget'
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: 'closed' })

    const resolvedTheme = this.resolveTheme()
    this.styleEl = document.createElement('style')
    this.styleEl.textContent = getWidgetStyles(resolvedTheme)
    this.shadow.appendChild(this.styleEl)

    this.trigger = new TriggerButton(this.shadow, {
      text: this.config.ui.triggerText,
      position: this.config.ui.position,
      onClick: () => this.open(),
    })

    this.panel = new FeedbackPanel(this.shadow, {
      position: this.config.ui.position,
      user: this.user,
      allowScreenshot: this.config.capture.screenshot,
      onSubmit: (data) => this.handleSubmit(data),
      onClose: () => this.close(),
      onAnnotate: () => this.startAnnotation(),
      onRetakeScreenshot: () => this.retakeScreenshot(),
      onCaptureScreenshot: () => this.startScreenshotCapture(),
      onCaptureFullScreen: () => this.captureFullScreen(),
    })

    if (this.config.ui.theme === 'auto') {
      this.watchTheme()
    }

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.state !== 'closed') {
        this.close()
      }
    }
    document.addEventListener('keydown', this.keyHandler)

    this.pulse.setWidgetHost(this.host)
  }

  open(): void {
    if (this.state !== 'closed') return
    this.state = 'open'
    this.trigger.hide()
    this.currentScreenshot = null
    this.panel.setScreenshot(null)
    this.panel.setState('open')
    this.config.onOpen?.()
  }

  close(): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    this.panel.setState('closed')
    this.trigger.show()
    this.annotation?.hide()
    this.annotation = null
    this.config.onClose?.()
  }

  destroy(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler)
    }
    if (this.themeQuery && this.themeHandler) {
      this.themeQuery.removeEventListener('change', this.themeHandler)
    }
    this.trigger.destroy()
    this.panel.destroy()
    this.annotation?.destroy()
    this.host.remove()
  }

  setUser(user: { email?: string; name?: string }): void {
    this.user = { ...this.user, ...user }
    this.panel.setUser(this.user)
  }

  private resolveTheme(): 'light' | 'dark' {
    if (this.config.ui.theme === 'dark') return 'dark'
    if (this.config.ui.theme === 'light') return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  private watchTheme(): void {
    this.themeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    this.themeHandler = () => {
      const theme = this.resolveTheme()
      this.styleEl.textContent = getWidgetStyles(theme)
    }
    this.themeQuery.addEventListener('change', this.themeHandler)
  }

  private async startScreenshotCapture(): Promise<void> {
    // Hide widget so it doesn't appear in the screenshot or block the selector
    this.host.style.display = 'none'

    try {
      // Step 1: Let user select an area on the page
      const selector = new AreaSelector()
      const selectedRect = await selector.select()

      // Step 2: Capture the full viewport (widget hidden by us + captureScreenshot)
      const fullBlob = await this.pulse.captureScreenshot()
      if (!fullBlob) {
        this.host.style.display = ''
        this.panel.setScreenshot(null)
        this.state = 'open'
        this.panel.setState('open')
        return
      }

      // Step 3: Crop to selection if user dragged an area
      if (selectedRect) {
        const cropped = await this.pulse.cropScreenshot(fullBlob, selectedRect)
        this.currentScreenshot = cropped
      } else {
        this.currentScreenshot = fullBlob
      }
    } catch {
      this.currentScreenshot = null
    }

    // Restore widget visibility and update panel
    this.host.style.display = ''
    this.panel.setScreenshot(this.currentScreenshot)
    this.state = 'open'
    this.panel.setState('open')
  }

  private async captureFullScreen(): Promise<void> {
    this.host.style.display = 'none'
    try {
      const blob = await this.pulse.captureScreenshot()
      this.currentScreenshot = blob
    } catch {
      this.currentScreenshot = null
    }
    this.host.style.display = ''
    this.panel.setScreenshot(this.currentScreenshot)
    this.state = 'open'
    this.panel.setState('open')
  }

  private startAnnotation(): void {
    if (!this.currentScreenshot) return
    this.state = 'annotating'

    this.host.classList.add('pulse-annotating')

    this.annotation = new AnnotationCanvas(this.shadow, {
      onSave: (blob) => {
        this.host.classList.remove('pulse-annotating')
        this.currentScreenshot = blob
        this.panel.setScreenshot(blob)
        this.state = 'open'
        this.annotation = null
      },
      onCancel: () => {
        this.host.classList.remove('pulse-annotating')
        this.state = 'open'
        this.annotation = null
      },
    })

    this.annotation.show(this.currentScreenshot)
  }

  private async retakeScreenshot(): Promise<void> {
    await this.startScreenshotCapture()
  }

  private async handleSubmit(formData: PanelFormData): Promise<SubmitResult> {
    this.state = 'submitting'

    const result = await this.pulse.submitFeedback({
      title: formData.title,
      description: formData.description,
      type: formData.type,
      email: formData.email,
      name: formData.name,
      screenshot: this.currentScreenshot,
    })

    if (result.status === 'created') {
      this.state = 'success'
      this.currentScreenshot = null
    } else {
      this.state = 'error'
    }

    return result
  }
}
