import type { RuntimeConfig, SubmitResult, WidgetState, WidgetPick } from './types'
import { getWidgetStyles } from './ui/styles'
import { TriggerButton } from './ui/trigger'
import { FeedbackPanel, type PanelFormData } from './ui/panel'
import { AnnotationCanvas } from './ui/annotation'
import { AreaSelector } from './ui/crop'
import { ElementPicker, type Point } from './capture/pick-mode'
import { buildPick, buildMultiPick } from './capture/pick-builder'
import { MultiSelection } from './capture/multi-select'
import { PickPopup, type PickPopupResult } from './ui/pick-popup'
import { PickMarkers, type Marker } from './ui/pick-markers'
import { PickOutlines } from './ui/pick-outlines'
import { PickStatus } from './ui/pick-status'

export interface PulseCore {
  submitFeedback(data: {
    title: string
    description?: string
    type: 'bug' | 'feedback' | 'idea'
    email: string
    name?: string
    screenshot?: Blob | null
    picks?: WidgetPick[]
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
  private picker: ElementPicker | null = null
  private popup: PickPopup | null = null
  private markers: PickMarkers | null = null
  private outlines: PickOutlines | null = null
  private status: PickStatus | null = null
  private picks: WidgetPick[] = []
  private markersById = new Map<string, Marker>()
  private pendingPick: { pick: WidgetPick; marker: Marker } | null = null
  private editingPickId: string | null = null
  private multi = new MultiSelection()
  private lastModifierPoint: Point | null = null
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
      allowElementPick: this.config.capture.elementPick,
      onSubmit: (data) => this.handleSubmit(data),
      onClose: () => this.close(),
      onAnnotate: () => this.startAnnotation(),
      onRetakeScreenshot: () => this.retakeScreenshot(),
      onCaptureScreenshot: () => this.startScreenshotCapture(),
      onCaptureFullScreen: () => this.captureFullScreen(),
      onPickElement: () => this.startPick(),
      onEditPick: (id) => this.startEditPick(id),
      onDeletePick: (id) => this.deletePick(id),
    })

    if (this.config.capture.elementPick) {
      this.markers = new PickMarkers(this.shadow)
      this.outlines = new PickOutlines(this.shadow)
      this.status = new PickStatus(this.shadow)
      this.popup = new PickPopup(this.shadow, {
        onSave: (result) => this.handlePopupSave(result),
        onCancel: () => this.handlePopupCancel(),
      })
      this.picker = new ElementPicker(this.shadow, this.host, {
        onPick: (target, point) => this.handlePick(target, point),
        onModifierEnter: () => this.handleModifierEnter(),
        onModifierClick: (target, point) => this.handleModifierClick(target, point),
        onModifierRelease: () => this.handleModifierRelease(),
      })
    }

    if (this.config.ui.theme === 'auto') {
      this.watchTheme()
    }

    // Esc is the only global shortcut the widget owns: it backs out one mode at a time.
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.handleEscape(e)
    }
    document.addEventListener('keydown', this.keyHandler, true)

    this.pulse.setWidgetHost(this.host)
  }

  open(): void {
    if (this.state !== 'closed') return
    this.state = 'open'
    this.trigger.hide()
    this.currentScreenshot = null
    this.panel.setScreenshot(null)
    this.picks = []
    this.markersById.clear()
    this.markers?.clear()
    this.markers?.show()
    this.panel.setPicks(this.picks)
    this.panel.setState('open')
    this.config.onOpen?.()
  }

  close(): void {
    if (this.state === 'closed') return
    this.teardownPickMode()
    this.state = 'closed'
    this.panel.setState('closed')
    this.markers?.hide()
    this.trigger.show()
    this.annotation?.hide()
    this.annotation = null
    this.config.onClose?.()
  }

  destroy(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler, true)
    }
    if (this.themeQuery && this.themeHandler) {
      this.themeQuery.removeEventListener('change', this.themeHandler)
    }
    this.teardownPickMode()
    this.picker = null
    this.popup?.destroy()
    this.markers?.destroy()
    this.outlines?.destroy()
    this.status?.destroy()
    this.trigger.destroy()
    this.panel.destroy()
    this.annotation?.destroy()
    this.host.remove()
  }

  setUser(user: { email?: string; name?: string }): void {
    this.user = { ...this.user, ...user }
    this.panel.setUser(this.user)
  }

  // -- element pick ----------------------------------------------------------

  private startPick(): void {
    if (!this.picker || this.state !== 'open') return
    this.state = 'picking'
    this.panel.hide()
    this.picker.start()
  }

  /** Back to the open panel, keeping committed picks. */
  private exitPickMode(): void {
    this.teardownPickMode()
    this.state = 'open'
    this.panel.setPicks(this.picks)
    this.panel.setState('open')
  }

  private teardownPickMode(): void {
    this.popup?.close()
    this.pendingPick = null
    this.editingPickId = null
    this.markers?.setPending(null)
    this.clearMultiSelect()
    this.picker?.stop()
  }

  private handlePick(target: Element, point: Point): void {
    if (!this.picker || !this.popup || !this.markers) return
    this.picker.pause()
    this.openPickPopup(buildPick(target), point)
  }

  /** Stage a fresh pick: pending marker at `point`, comment popup anchored on it. */
  private openPickPopup(pick: WidgetPick, point: Point): void {
    const marker: Marker = {
      id: pick.id,
      xPercent: (point.x / window.innerWidth) * 100,
      y: pick.isFixed ? point.y : point.y + window.scrollY,
      isFixed: pick.isFixed,
    }
    this.pendingPick = { pick, marker }
    this.markers?.setPending(marker)
    this.popup?.open({ xPercent: marker.xPercent, y: point.y }, { title: pick.name })
  }

  // -- multi-select (Cmd/Ctrl+Shift+click) -------------------------------------

  private handleModifierEnter(): void {
    if (this.state !== 'picking') return
    this.status?.show('Multi-select — click elements, release to comment')
  }

  /** Returns true when the click was consumed as a multi-select toggle. */
  private handleModifierClick(target: Element, point: Point): boolean {
    if (this.state !== 'picking') return false
    this.multi.toggle(target)
    this.lastModifierPoint = point
    this.outlines?.set(this.multi.items)
    this.status?.show(
      this.multi.size === 0
        ? 'Multi-select — click elements, release to comment'
        : `${this.multi.size} selected — release to comment`
    )
    return true
  }

  /**
   * Either modifier released: commit the pending set as one annotation. A single
   * element is a normal pick (no multi wrapper); an empty set is a no-op that
   * leaves the user in pick mode.
   */
  private handleModifierRelease(): void {
    const elements = this.multi.items
    const point = this.lastModifierPoint
    this.clearMultiSelect()
    if (elements.length === 0 || !point) return
    if (!this.picker || !this.popup || !this.markers) return
    this.picker.pause()
    this.openPickPopup(buildMultiPick(elements), point)
  }

  private clearMultiSelect(): void {
    this.multi.clear()
    this.lastModifierPoint = null
    this.outlines?.clear()
    this.status?.hide()
  }

  // -- popup save/cancel -------------------------------------------------------

  private handlePopupSave(result: PickPopupResult): void {
    if (this.editingPickId) {
      const pick = this.picks.find((p) => p.id === this.editingPickId)
      this.editingPickId = null
      if (pick) {
        pick.comment = result.comment
        pick.intent = result.intent
      }
      this.panel.setPicks(this.picks)
      return
    }
    this.commitPendingPick(result)
  }

  private handlePopupCancel(): void {
    if (this.editingPickId) {
      this.editingPickId = null
      this.popup?.close()
      return
    }
    this.cancelPendingPick()
  }

  private commitPendingPick(result: PickPopupResult): void {
    const pending = this.pendingPick
    this.pendingPick = null
    if (pending) {
      pending.pick.comment = result.comment
      pending.pick.intent = result.intent
      this.picks.push(pending.pick)
      this.markersById.set(pending.pick.id, pending.marker)
      this.markers?.add(pending.marker)
    }
    this.exitPickMode()
  }

  /** Popup cancelled: drop the pending pick and return to pick mode. */
  private cancelPendingPick(): void {
    this.pendingPick = null
    this.markers?.setPending(null)
    this.popup?.close()
    this.picker?.resume()
  }

  // -- picks list (panel) ------------------------------------------------------

  /** Reopen the comment popup for an existing pick, anchored on its marker. */
  private startEditPick(id: string): void {
    const pick = this.picks.find((p) => p.id === id)
    if (!pick || !this.popup) return
    this.editingPickId = id
    const marker = this.markersById.get(id)
    const rawY = marker ? (marker.isFixed ? marker.y : marker.y - window.scrollY) : window.innerHeight / 2
    // A marker scrolled out of view would put the popup off-screen; centre instead.
    const y = rawY < 0 || rawY > window.innerHeight ? window.innerHeight / 2 : rawY
    this.popup.open(
      { xPercent: marker?.xPercent ?? 50, y },
      { title: pick.name, comment: pick.comment, intent: pick.intent }
    )
  }

  private deletePick(id: string): void {
    this.picks = this.picks.filter((p) => p.id !== id)
    this.markersById.delete(id)
    this.markers?.remove(id)
    if (this.editingPickId === id) {
      this.editingPickId = null
      this.popup?.close()
    }
    this.panel.setPicks(this.picks)
  }

  private handleEscape(e: KeyboardEvent): void {
    if (this.state === 'closed') return
    e.stopPropagation()
    if (this.popup?.isOpen) {
      this.handlePopupCancel()
    } else if (this.state === 'picking' && this.multi.size > 0) {
      this.clearMultiSelect()
    } else if (this.state === 'picking') {
      this.exitPickMode()
    } else {
      this.close()
    }
  }

  // -- screenshot --------------------------------------------------------------

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
      picks: this.picks,
    })

    if (result.status === 'created') {
      this.state = 'success'
      this.currentScreenshot = null
      this.picks = []
      this.markersById.clear()
      this.markers?.clear()
      this.panel.setPicks(this.picks)
    } else {
      this.state = 'error'
    }

    return result
  }
}
