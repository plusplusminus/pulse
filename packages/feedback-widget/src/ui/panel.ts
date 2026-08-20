import type { WidgetState, SubmitResult, WidgetPick } from '../types'

export interface PanelFormData {
  title: string
  description?: string
  type: 'bug' | 'feedback' | 'idea'
  email: string
  name?: string
}

export class FeedbackPanel {
  private element: HTMLElement
  private state: WidgetState = 'closed'
  private formData: PanelFormData = { title: '', type: 'bug', email: '' }
  private screenshotBlob: Blob | null = null
  private screenshotUrl: string | null = null
  private picks: WidgetPick[] = []
  private user: { email?: string; name?: string }

  private bodyEl!: HTMLElement
  private panelEl!: HTMLElement

  constructor(
    private shadowRoot: ShadowRoot,
    private config: {
      position: 'bottom-right' | 'bottom-left'
      user?: { email?: string; name?: string }
      /** Per-site capture.screenshot from bootstrap; hides the screenshot controls when false. */
      allowScreenshot?: boolean
      /** Per-site capture.elementPick from bootstrap; hides the pick controls when false. */
      allowElementPick?: boolean
      onSubmit: (data: PanelFormData) => Promise<SubmitResult>
      onClose: () => void
      onAnnotate: () => void
      onRetakeScreenshot: () => void
      onCaptureScreenshot: () => void
      onCaptureFullScreen: () => void
      onPickElement: () => void
    }
  ) {
    this.user = { ...config.user }
    this.formData.email = this.user.email ?? ''
    this.formData.name = this.user.name
    this.element = this.render()
    this.shadowRoot.appendChild(this.element)
  }

  private render(): HTMLElement {
    const panel = document.createElement('div')
    panel.className = `pulse-panel pulse-panel--${this.config.position === 'bottom-left' ? 'left' : 'right'}`
    this.panelEl = panel

    panel.appendChild(this.renderHeader())
    const body = document.createElement('div')
    body.className = 'pulse-body'
    this.bodyEl = body
    panel.appendChild(body)
    panel.appendChild(this.renderFooter())

    this.renderForm()
    return panel
  }

  private renderHeader(): HTMLElement {
    const header = document.createElement('div')
    header.className = 'pulse-header'

    const title = document.createElement('span')
    title.className = 'pulse-header__title'
    title.textContent = 'Feedback'
    header.appendChild(title)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'pulse-header__close'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.addEventListener('click', () => this.config.onClose())

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M4 4l8 8M12 4l-8 8')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.5')
    path.setAttribute('stroke-linecap', 'round')
    svg.appendChild(path)
    closeBtn.appendChild(svg)
    header.appendChild(closeBtn)

    return header
  }

  private renderFooter(): HTMLElement {
    const footer = document.createElement('div')
    footer.className = 'pulse-footer'

    const text = document.createElement('div')
    text.className = 'pulse-footer__text'
    text.textContent = 'Powered by Pulse'
    footer.appendChild(text)

    const info = document.createElement('div')
    info.className = 'pulse-footer__info'

    const infoSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    infoSvg.setAttribute('viewBox', '0 0 16 16')
    infoSvg.setAttribute('fill', 'none')
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', '8')
    circle.setAttribute('cy', '8')
    circle.setAttribute('r', '6.5')
    circle.setAttribute('stroke', 'currentColor')
    circle.setAttribute('stroke-width', '1.5')
    infoSvg.appendChild(circle)
    const infoLine = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    infoLine.setAttribute('d', 'M8 7v4M8 5.5v0')
    infoLine.setAttribute('stroke', 'currentColor')
    infoLine.setAttribute('stroke-width', '1.5')
    infoLine.setAttribute('stroke-linecap', 'round')
    infoSvg.appendChild(infoLine)
    info.appendChild(infoSvg)

    const infoText = document.createElement('span')
    infoText.textContent = 'Page info collected automatically'
    info.appendChild(infoText)

    footer.appendChild(info)
    return footer
  }

  private renderForm(): void {
    this.bodyEl.textContent = ''

    const typeSelector = this.renderTypeSelector()
    this.bodyEl.appendChild(typeSelector)

    this.bodyEl.appendChild(this.createField('Title', 'title', 'input', true, 'Brief summary of your feedback'))
    this.bodyEl.appendChild(this.createField('Description', 'description', 'textarea', false, 'Additional details...'))

    if (this.config.allowElementPick) {
      this.bodyEl.appendChild(this.renderPicksSection())
    }

    if (this.screenshotBlob) {
      this.bodyEl.appendChild(this.renderScreenshotPreview())
    } else if (this.config.allowScreenshot !== false) {
      this.bodyEl.appendChild(this.renderAddScreenshotButtons())
    }

    this.bodyEl.appendChild(this.createField('Email', 'email', 'input', true, 'your@email.com'))

    const submitBtn = document.createElement('button')
    submitBtn.className = 'pulse-submit'
    submitBtn.type = 'button'
    submitBtn.textContent = 'Submit Feedback'
    submitBtn.addEventListener('click', () => this.handleSubmit())
    this.bodyEl.appendChild(submitBtn)
  }

  private renderTypeSelector(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'pulse-types'

    const types: Array<{ value: 'bug' | 'feedback' | 'idea'; label: string; icon: string }> = [
      { value: 'bug', label: 'Bug', icon: 'M4.5 8a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0ZM8 2v2M8 12v2M2 8h2M12 8h2' },
      { value: 'idea', label: 'Idea', icon: 'M8 2a4 4 0 0 0-2 7.46V11a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V9.46A4 4 0 0 0 8 2ZM6.5 13.5h3' },
      { value: 'feedback', label: 'Feedback', icon: 'M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5.5L3 13.5V11H3a1 1 0 0 1-1-1V3Z' },
    ]

    for (const t of types) {
      const btn = document.createElement('button')
      btn.className = `pulse-type-btn${this.formData.type === t.value ? ' pulse-type-btn--active' : ''}`
      btn.type = 'button'
      btn.setAttribute('aria-pressed', String(this.formData.type === t.value))

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('fill', 'none')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', t.icon)
      path.setAttribute('stroke', 'currentColor')
      path.setAttribute('stroke-width', '1.5')
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(path)
      btn.appendChild(svg)

      const label = document.createElement('span')
      label.textContent = t.label
      btn.appendChild(label)

      btn.addEventListener('click', () => {
        this.formData.type = t.value
        this.renderForm()
      })

      container.appendChild(btn)
    }

    return container
  }

  private createField(
    label: string,
    key: 'title' | 'description' | 'email',
    type: 'input' | 'textarea',
    required: boolean,
    placeholder: string
  ): HTMLElement {
    const field = document.createElement('div')
    field.className = 'pulse-field'

    const labelEl = document.createElement('label')
    labelEl.className = `pulse-label${required ? ' pulse-label--required' : ''}`
    labelEl.textContent = label
    field.appendChild(labelEl)

    let input: HTMLInputElement | HTMLTextAreaElement
    if (type === 'textarea') {
      input = document.createElement('textarea')
      input.className = 'pulse-textarea'
      input.rows = 3
    } else {
      input = document.createElement('input')
      input.className = 'pulse-input'
      input.type = key === 'email' ? 'email' : 'text'
    }

    input.placeholder = placeholder
    input.value = (this.formData[key] as string) ?? ''
    input.addEventListener('input', () => {
      if (key === 'title') this.formData.title = input.value
      else if (key === 'description') this.formData.description = input.value
      else if (key === 'email') this.formData.email = input.value
    })

    field.appendChild(input)
    return field
  }

  private renderScreenshotPreview(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'pulse-screenshot'

    if (this.screenshotUrl) {
      const img = document.createElement('img')
      img.className = 'pulse-screenshot__img'
      img.src = this.screenshotUrl
      img.alt = 'Screenshot preview'
      container.appendChild(img)
    }

    const actions = document.createElement('div')
    actions.className = 'pulse-screenshot__actions'

    const annotateBtn = document.createElement('button')
    annotateBtn.className = 'pulse-screenshot__btn'
    annotateBtn.type = 'button'
    annotateBtn.textContent = 'Annotate'
    annotateBtn.addEventListener('click', () => this.config.onAnnotate())
    actions.appendChild(annotateBtn)

    const retakeBtn = document.createElement('button')
    retakeBtn.className = 'pulse-screenshot__btn'
    retakeBtn.type = 'button'
    retakeBtn.textContent = 'Retake'
    retakeBtn.addEventListener('click', () => this.config.onRetakeScreenshot())
    actions.appendChild(retakeBtn)

    const removeBtn = document.createElement('button')
    removeBtn.className = 'pulse-screenshot__btn pulse-screenshot__btn--danger'
    removeBtn.type = 'button'
    removeBtn.textContent = 'Remove'
    removeBtn.addEventListener('click', () => {
      this.setScreenshot(null)
    })
    actions.appendChild(removeBtn)

    container.appendChild(actions)
    return container
  }

  private renderPicksSection(): HTMLElement {
    const section = document.createElement('div')
    section.className = 'pulse-picks'

    if (this.picks.length > 0) {
      const list = document.createElement('ol')
      list.className = 'pulse-picks__list'
      this.picks.forEach((pick) => list.appendChild(this.renderPickRow(pick)))
      section.appendChild(list)
    }

    const btn = document.createElement('button')
    btn.className = 'pulse-add-screenshot pulse-pick-btn'
    btn.type = 'button'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M3 3l10 4.5-4.5 1.5L7 13.5 3 3Z')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.25')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
    btn.appendChild(svg)
    const label = document.createElement('span')
    label.textContent = this.picks.length > 0 ? 'Pick another element' : 'Pick element'
    btn.appendChild(label)
    btn.addEventListener('click', () => this.config.onPickElement())
    section.appendChild(btn)

    return section
  }

  private renderPickRow(pick: WidgetPick): HTMLElement {
    const row = document.createElement('li')
    row.className = 'pulse-picks__row'

    const main = document.createElement('div')
    main.className = 'pulse-picks__main'
    const name = document.createElement('span')
    name.className = 'pulse-picks__name'
    name.textContent = pick.name
    name.title = pick.elementPath
    main.appendChild(name)
    const intent = document.createElement('span')
    intent.className = `pulse-picks__intent pulse-picks__intent--${pick.intent}`
    intent.textContent = pick.intent
    main.appendChild(intent)
    row.appendChild(main)

    if (pick.comment) {
      const comment = document.createElement('div')
      comment.className = 'pulse-picks__comment'
      comment.textContent = pick.comment.length > 80 ? `${pick.comment.slice(0, 80)}…` : pick.comment
      row.appendChild(comment)
    }

    return row
  }

  private renderAddScreenshotButtons(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'pulse-screenshot-options'

    // Select Area button
    const areaBtn = document.createElement('button')
    areaBtn.className = 'pulse-add-screenshot'
    areaBtn.type = 'button'
    const areaSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    areaSvg.setAttribute('viewBox', '0 0 16 16')
    areaSvg.setAttribute('fill', 'none')
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    areaPath.setAttribute('d', 'M2 5V3.5A1.5 1.5 0 0 1 3.5 2H5M11 2h1.5A1.5 1.5 0 0 1 14 3.5V5M14 11v1.5a1.5 1.5 0 0 1-1.5 1.5H11M5 14H3.5A1.5 1.5 0 0 1 2 12.5V11')
    areaPath.setAttribute('stroke', 'currentColor')
    areaPath.setAttribute('stroke-width', '1.25')
    areaPath.setAttribute('stroke-linecap', 'round')
    areaSvg.appendChild(areaPath)
    areaBtn.appendChild(areaSvg)
    const areaLabel = document.createElement('span')
    areaLabel.textContent = 'Select Area'
    areaBtn.appendChild(areaLabel)
    areaBtn.addEventListener('click', () => this.config.onCaptureScreenshot())
    container.appendChild(areaBtn)

    // Full Screen button
    const fullBtn = document.createElement('button')
    fullBtn.className = 'pulse-add-screenshot'
    fullBtn.type = 'button'
    const fullSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    fullSvg.setAttribute('viewBox', '0 0 16 16')
    fullSvg.setAttribute('fill', 'none')
    const fullPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    fullPath.setAttribute('d', 'M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Z')
    fullPath.setAttribute('stroke', 'currentColor')
    fullPath.setAttribute('stroke-width', '1.25')
    fullSvg.appendChild(fullPath)
    const fullLine = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    fullLine.setAttribute('d', 'M2 5h12')
    fullLine.setAttribute('stroke', 'currentColor')
    fullLine.setAttribute('stroke-width', '1.25')
    fullSvg.appendChild(fullLine)
    fullBtn.appendChild(fullSvg)
    const fullLabel = document.createElement('span')
    fullLabel.textContent = 'Full Screen'
    fullBtn.appendChild(fullLabel)
    fullBtn.addEventListener('click', () => this.config.onCaptureFullScreen())
    container.appendChild(fullBtn)

    return container
  }

  private renderCapturing(): void {
    this.bodyEl.textContent = ''
    const wrap = document.createElement('div')
    wrap.className = 'pulse-capturing'

    const spinner = document.createElement('div')
    spinner.className = 'pulse-spinner pulse-spinner--dark'
    wrap.appendChild(spinner)

    const text = document.createElement('div')
    text.className = 'pulse-capturing__text'
    text.textContent = 'Capturing screenshot...'
    wrap.appendChild(text)

    this.bodyEl.appendChild(wrap)
  }

  private renderSubmitting(): void {
    const submitBtn = this.bodyEl.querySelector('.pulse-submit') as HTMLButtonElement | null
    if (submitBtn) {
      submitBtn.disabled = true
      submitBtn.textContent = ''
      const spinner = document.createElement('div')
      spinner.className = 'pulse-spinner'
      submitBtn.appendChild(spinner)
      const text = document.createElement('span')
      text.textContent = 'Submitting...'
      submitBtn.appendChild(text)
    }

    const inputs = this.bodyEl.querySelectorAll('input, textarea, button')
    inputs.forEach((el) => {
      ;(el as HTMLInputElement | HTMLButtonElement).disabled = true
    })
  }

  private renderSuccess(result: SubmitResult): void {
    this.bodyEl.textContent = ''
    const status = document.createElement('div')
    status.className = 'pulse-status'

    const iconWrap = document.createElement('div')
    iconWrap.className = 'pulse-status__icon pulse-status__icon--success'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M5 13l4 4L19 7')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
    iconWrap.appendChild(svg)
    status.appendChild(iconWrap)

    const title = document.createElement('div')
    title.className = 'pulse-status__title'
    title.textContent = 'Thank you!'
    status.appendChild(title)

    const message = document.createElement('div')
    message.className = 'pulse-status__message'
    message.textContent = 'Your feedback has been submitted successfully.'
    status.appendChild(message)

    if (result.linearIssueUrl) {
      const link = document.createElement('a')
      link.className = 'pulse-status__link'
      link.href = result.linearIssueUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = 'View in Linear'
      status.appendChild(link)
    }

    const btn = document.createElement('button')
    btn.className = 'pulse-status__btn'
    btn.type = 'button'
    btn.textContent = 'Send Another'
    btn.addEventListener('click', () => {
      this.resetForm()
      this.setState('open')
    })
    status.appendChild(btn)

    this.bodyEl.appendChild(status)
  }

  private renderError(message: string): void {
    this.bodyEl.textContent = ''
    const status = document.createElement('div')
    status.className = 'pulse-status'

    const iconWrap = document.createElement('div')
    iconWrap.className = 'pulse-status__icon pulse-status__icon--error'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M6 6l12 12M18 6L6 18')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-linecap', 'round')
    svg.appendChild(path)
    iconWrap.appendChild(svg)
    status.appendChild(iconWrap)

    const title = document.createElement('div')
    title.className = 'pulse-status__title'
    title.textContent = 'Something went wrong'
    status.appendChild(title)

    const msg = document.createElement('div')
    msg.className = 'pulse-status__message'
    msg.textContent = message
    status.appendChild(msg)

    const btn = document.createElement('button')
    btn.className = 'pulse-status__btn'
    btn.type = 'button'
    btn.textContent = 'Try Again'
    btn.addEventListener('click', () => {
      this.setState('open')
    })
    status.appendChild(btn)

    this.bodyEl.appendChild(status)
  }

  private resetForm(): void {
    this.formData = { title: '', type: 'bug', email: this.user.email ?? '' }
    this.picks = []
    this.screenshotBlob = null
    if (this.screenshotUrl) {
      URL.revokeObjectURL(this.screenshotUrl)
      this.screenshotUrl = null
    }
  }

  private validate(): string | null {
    if (!this.formData.title.trim()) return 'Title is required'
    if (!this.formData.email.trim()) return 'Email is required'
    if (!/\S+@\S+\.\S+/.test(this.formData.email)) return 'Please enter a valid email'
    return null
  }

  private async handleSubmit(): Promise<void> {
    const error = this.validate()
    if (error) {
      this.highlightErrors()
      return
    }

    this.setState('submitting')

    try {
      const result = await this.config.onSubmit(this.formData)
      if (result.status === 'created') {
        this.setSuccess(result)
      } else {
        this.setError('Failed to submit feedback.')
      }
    } catch (err) {
      this.setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    }
  }

  private highlightErrors(): void {
    const inputs = this.bodyEl.querySelectorAll('.pulse-input, .pulse-textarea')
    inputs.forEach((input) => {
      input.classList.remove('pulse-input--error', 'pulse-textarea--error')
    })

    if (!this.formData.title.trim()) {
      const titleInput = this.bodyEl.querySelector('.pulse-input') as HTMLInputElement | null
      if (titleInput) titleInput.classList.add('pulse-input--error')
    }

    const emailInput = this.bodyEl.querySelectorAll('.pulse-input')[1] as HTMLInputElement | undefined
    if (emailInput && (!this.formData.email.trim() || !/\S+@\S+\.\S+/.test(this.formData.email))) {
      emailInput.classList.add('pulse-input--error')
    }
  }

  show(): void {
    this.panelEl.classList.add('pulse-panel--visible')
  }

  hide(): void {
    this.panelEl.classList.remove('pulse-panel--visible')
  }

  destroy(): void {
    if (this.screenshotUrl) {
      URL.revokeObjectURL(this.screenshotUrl)
    }
    this.element.remove()
  }

  setUser(user: { email?: string; name?: string }): void {
    this.user = { ...user }
    if (user.email && !this.formData.email) {
      this.formData.email = user.email
    }
    if (user.name && !this.formData.name) {
      this.formData.name = user.name
    }
  }

  setState(state: WidgetState): void {
    this.state = state
    switch (state) {
      case 'open':
        this.renderForm()
        this.show()
        break
      case 'capturing':
        this.renderCapturing()
        this.show()
        break
      case 'submitting':
        this.renderSubmitting()
        break
      case 'closed':
        this.hide()
        break
      default:
        break
    }
  }

  setPicks(picks: WidgetPick[]): void {
    this.picks = [...picks]
    if (this.state === 'open') this.renderForm()
  }

  setScreenshot(blob: Blob | null): void {
    if (this.screenshotUrl) {
      URL.revokeObjectURL(this.screenshotUrl)
      this.screenshotUrl = null
    }
    this.screenshotBlob = blob
    if (blob) {
      this.screenshotUrl = URL.createObjectURL(blob)
    }
    if (this.state === 'open' || this.state === 'capturing') {
      this.setState('open')
    }
  }

  setError(message: string): void {
    this.state = 'error'
    this.renderError(message)
  }

  setSuccess(result: SubmitResult): void {
    this.state = 'success'
    this.renderSuccess(result)
  }

  getScreenshot(): Blob | null {
    return this.screenshotBlob
  }
}
