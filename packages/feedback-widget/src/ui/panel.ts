import type { WidgetState, SubmitResult, WidgetPick } from '../types'
import { CROSS_ORIGIN_NOTICE } from '../screenshot'
import { micIcon } from './mic-icon'
import { icon, ICONS } from './icon'
import { Popover, type PopoverConfig } from './popover'

/**
 * The panel and trigger hide for the recording, but a compact control bar
 * stays on the page (PULSE-399) — so there IS an in-page stop button, and Esc
 * now stops and keeps rather than discarding.
 */
export const RECORDING_NOTICE =
  'Your browser will ask what to share. A small control bar stays on the page while recording — stop from there or press Esc. Only Discard drops a recording.'

/**
 * Shown under a finished recording when the shared surface was this tab. The
 * bar is composited into the video like any other element; no page can leave
 * itself out of its own capture, so the honest move is to say so.
 */
export const BAR_IN_RECORDING_NOTICE =
  'You shared this tab, so the recording bar is visible in your recording — a page cannot leave itself out of its own capture.'

/**
 * Shown next to the voice-over toggle, BEFORE it is clicked (PULSE-400). The
 * microphone prompt must never be the first time a reporter learns that their
 * voice is part of the attachment.
 */
export const VOICE_OVER_NOTICE =
  'Your microphone is recorded into the video. Your browser will ask for permission, and you can mute at any time from the recording bar.'

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
  private videoBlob: Blob | null = null
  private videoUrl: string | null = null
  private videoDurationMs = 0
  private videoError: string | null = null
  private videoNotice: string | null = null
  private voiceOver = false
  private voiceOverNote: string | null = null
  private uploadPercent: number | null = null
  private picks: WidgetPick[] = []
  private paused = false
  private captureError: string | null = null
  private pauseBtn: HTMLButtonElement | null = null
  private user: { email?: string; name?: string }
  /** Rebuilt with the form; only ever one of them is open. */
  private popovers: Popover[] = []
  private openPopoverId: string | null = null
  /** Selector re-focused inside a popover that survived a re-render. */
  private reopenFocus: string | null = null

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
      /** capture.captureTab AND browser support; hides the native capture button when false. */
      allowCaptureTab?: boolean
      /** capture.video AND getDisplayMedia support; hides the record button when false (PULSE-339). */
      allowVideo?: boolean
      /**
       * capture.voiceOver AND getUserMedia support (PULSE-400). False means no
       * voice-over option is rendered and no microphone code path can be
       * reached from the panel at all.
       */
      allowVoiceOver?: boolean
      onSubmit: (data: PanelFormData) => Promise<SubmitResult>
      onClose: () => void
      onAnnotate: () => void
      onRetakeScreenshot: () => void
      onCaptureScreenshot: () => void
      onCaptureTab: () => void
      onRecordVideo: () => void
      onRemoveVideo: () => void
      /** Fires on the opt-in click; the mic prompt hangs off this activation. */
      onToggleVoiceOver?: () => void
      onPickElement: () => void
      onEditPick: (id: string) => void
      onDeletePick: (id: string) => void
      onTogglePause: () => void
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

    header.appendChild(this.renderPauseButton())

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

  /**
   * Freezes host-page motion so a timing bug can be captured at one frame.
   * Lives in the header next to Close; the global pause CSS excludes the widget,
   * so this button stays interactive while the page is frozen.
   */
  private renderPauseButton(): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'pulse-header__pause'
    btn.type = 'button'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.5')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
    btn.appendChild(svg)
    btn.addEventListener('click', () => this.config.onTogglePause())
    this.pauseBtn = btn
    this.applyPauseState()
    return btn
  }

  private applyPauseState(): void {
    const btn = this.pauseBtn
    if (!btn) return
    const label = this.paused ? 'Resume page animations' : 'Pause page animations'
    btn.title = label
    btn.setAttribute('aria-label', label)
    btn.setAttribute('aria-pressed', String(this.paused))
    btn.classList.toggle('pulse-header__pause--active', this.paused)
    // Paused shows "play" (the action available); running shows "pause".
    btn.querySelector('path')?.setAttribute('d', this.paused ? 'M5 3.5l7 4.5-7 4.5v-9Z' : 'M6 3.5v9M10 3.5v9')
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.applyPauseState()
  }

  isPaused(): boolean {
    return this.paused
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
    // An open popover has to survive the state change that caused this render —
    // toggling voice-over must not yank the surface it lives in out from under
    // the pointer. Remember it, rebuild, put it back.
    const reopen = this.openPopoverId
    const refocus = this.reopenFocus
    this.reopenFocus = null
    this.disposePopovers()
    this.bodyEl.textContent = ''

    const typeSelector = this.renderTypeSelector()
    this.bodyEl.appendChild(typeSelector)

    this.bodyEl.appendChild(this.createField('Title', 'title', 'input', true, 'Brief summary of your feedback'))
    this.bodyEl.appendChild(this.createField('Description', 'description', 'textarea', false, 'Additional details...'))

    this.bodyEl.appendChild(this.renderAttachRow())

    if (this.config.allowElementPick && this.picks.length > 0) {
      this.bodyEl.appendChild(this.renderPicksSection())
    }

    if (this.screenshotBlob) {
      this.bodyEl.appendChild(this.renderScreenshotPreview())
    }

    if (this.videoBlob) {
      this.bodyEl.appendChild(this.renderVideoPreview())
    }

    this.bodyEl.appendChild(this.createField('Email', 'email', 'input', true, 'your@email.com'))

    const submitBtn = document.createElement('button')
    submitBtn.className = 'pulse-submit'
    submitBtn.type = 'button'
    submitBtn.textContent = 'Submit Feedback'
    submitBtn.addEventListener('click', () => this.handleSubmit())
    this.bodyEl.appendChild(submitBtn)

    if (reopen) {
      const popover = this.popovers.find((p) => p.id === reopen)
      popover?.open({ focus: false })
      if (refocus) popover?.query<HTMLElement>(refocus)?.focus()
    }
  }

  // -- attach row (PULSE-402) --------------------------------------------------

  /**
   * One row: the three things a reporter can attach, each owning its own
   * options. The row's composition depends only on the site's `capture.*`
   * gates — never on what is already attached — so it cannot reshuffle under
   * the pointer while a capture is in flight (PULSE-399's rule).
   */
  private renderAttachRow(): HTMLElement {
    const section = document.createElement('div')
    section.className = 'pulse-attach'

    const row = document.createElement('div')
    row.className = 'pulse-attach__row'
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', 'Attach')

    const caption = document.createElement('span')
    caption.className = 'pulse-attach__caption'
    caption.textContent = 'Attach'
    row.appendChild(caption)

    if (this.config.allowElementPick) {
      row.appendChild(
        this.attachButton('Element', icon(ICONS.element), () => this.config.onPickElement(), 'element', 'pulse-pick-btn')
      )
    }

    if (this.config.allowScreenshot !== false) {
      row.appendChild(
        this.attachSplit(
          'Screenshot',
          icon(ICONS.screenshot),
          () => this.config.onCaptureScreenshot(),
          'shot',
          { id: 'shot', label: 'Screenshot options', build: (close) => this.buildScreenshotOptions(close) },
          'pulse-add-screenshot-btn'
        )
      )
    }

    if (this.config.allowVideo) {
      row.appendChild(
        this.attachSplit(
          'Record',
          icon(ICONS.record, { filled: [1] }),
          () => this.config.onRecordVideo(),
          'record',
          { id: 'record', label: 'Recording options', build: () => this.buildRecordOptions() },
          'pulse-record-btn'
        )
      )
    }

    section.appendChild(row)

    // Alerts stay in the panel, never behind a caret: a capture that failed
    // has to be readable without first reopening the popover that started it.
    for (const [message, role] of [
      [this.captureError, 'alert'],
      [this.videoError, 'alert'],
      [this.voiceOverNote, 'status'],
    ] as const) {
      if (!message) continue
      const note = document.createElement('div')
      note.className = `pulse-capture-note pulse-capture-note--${role === 'alert' ? 'error' : 'status'}`
      note.setAttribute('role', role)
      note.textContent = message
      section.appendChild(note)
    }

    return section
  }

  private attachButton(
    label: string,
    glyph: SVGSVGElement,
    onClick: () => void,
    variant: string,
    /** Kept from the stacked layout so the behaviour hooks stay stable. */
    alias?: string
  ): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `pulse-attach__btn pulse-attach__btn--${variant}${alias ? ` ${alias}` : ''}`
    btn.appendChild(glyph)
    const text = document.createElement('span')
    text.textContent = label
    btn.appendChild(text)
    // Screenshot and Record must reach getDisplayMedia with the user
    // activation intact, so nothing may be awaited before the callback.
    btn.addEventListener('click', () => onClick())
    return btn
  }

  /**
   * Action plus caret. The main half does the sensible default so the row
   * works untouched; the caret is always drawn, never hover-revealed, because
   * a first-time reporter has to see that options exist at all.
   */
  private attachSplit(
    label: string,
    glyph: SVGSVGElement,
    onClick: () => void,
    variant: string,
    config: PopoverConfig,
    alias?: string
  ): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'pulse-attach__split'
    wrap.appendChild(this.attachButton(label, glyph, onClick, variant, alias))

    const popover = new Popover(this.shadowRoot, {
      ...config,
      onOpen: () => {
        this.closePopovers()
        this.openPopoverId = config.id
      },
      onClose: () => {
        if (this.openPopoverId === config.id) this.openPopoverId = null
      },
    })
    this.popovers.push(popover)
    wrap.appendChild(popover.caret)
    return wrap
  }

  private buildScreenshotOptions(close: () => void): HTMLElement {
    const list = document.createElement('div')
    list.className = 'pulse-pop__list'

    list.appendChild(
      this.popItem('This viewport', 'The page as you see it now', icon(ICONS.screenshot), () => {
        close()
        this.config.onCaptureScreenshot()
      })
    )

    // Gated off means gone: never a disabled control advertising a feature the
    // site turned off, and never one the browser cannot honour (PULSE-339).
    if (this.config.allowCaptureTab) {
      list.appendChild(
        this.popItem('Capture tab', 'Pixel-exact; asks permission', icon(ICONS.tab), () => {
          close()
          this.config.onCaptureTab()
        })
      )
    }

    list.appendChild(this.popNote(CROSS_ORIGIN_NOTICE))
    return list
  }

  /**
   * Voice-over is not a second recording feature — it is how you record, so
   * it lives under Record rather than beside it (PULSE-402). The consent copy
   * comes with it: the microphone prompt must never be the first time a
   * reporter learns their voice is part of the attachment (PULSE-400).
   */
  private buildRecordOptions(): HTMLElement {
    const list = document.createElement('div')
    list.className = 'pulse-pop__list'

    if (this.config.allowVoiceOver) {
      list.appendChild(this.renderVoiceOverToggle())
      list.appendChild(this.popNote(VOICE_OVER_NOTICE))
    }

    list.appendChild(this.popNote(RECORDING_NOTICE))
    return list
  }

  private renderVoiceOverToggle(): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'pulse-pop__item pulse-pop__toggle pulse-voiceover__toggle'
    btn.setAttribute('aria-pressed', this.voiceOver ? 'true' : 'false')

    const { svg } = micIcon()
    btn.appendChild(svg)

    const text = document.createElement('span')
    text.className = 'pulse-pop__text'
    const name = document.createElement('span')
    name.className = 'pulse-pop__name pulse-voiceover__label'
    name.textContent = 'Voice-over'
    text.appendChild(name)
    const hint = document.createElement('span')
    hint.className = 'pulse-pop__hint'
    hint.textContent = 'Narrate the recording as you go'
    text.appendChild(hint)
    btn.appendChild(text)

    // The word, not just the border: "On" / "Off" is the state, colour a hint.
    const state = document.createElement('span')
    state.className = 'pulse-voiceover__state'
    state.textContent = this.voiceOver ? 'On' : 'Off'
    btn.appendChild(state)

    // getUserMedia wants the activation from this click: nothing awaited
    // first, and the popover deliberately stays open so the answer lands in
    // view rather than behind a caret the reporter has to reopen.
    btn.addEventListener('click', () => this.config.onToggleVoiceOver?.())
    return btn
  }

  private popItem(label: string, hint: string, glyph: SVGSVGElement, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'pulse-pop__item'
    btn.appendChild(glyph)

    const text = document.createElement('span')
    text.className = 'pulse-pop__text'
    const name = document.createElement('span')
    name.className = 'pulse-pop__name'
    name.textContent = label
    text.appendChild(name)
    const sub = document.createElement('span')
    sub.className = 'pulse-pop__hint'
    sub.textContent = hint
    text.appendChild(sub)
    btn.appendChild(text)

    btn.addEventListener('click', () => onClick())
    return btn
  }

  private popNote(text: string): HTMLElement {
    const note = document.createElement('div')
    note.className = 'pulse-pop__note'
    note.textContent = text
    return note
  }

  /**
   * True when it actually closed one. Escape consults this first and stops
   * there, so backing out of the options never also closes the panel.
   */
  closePopovers(restoreFocus = false): boolean {
    let closed = false
    for (const popover of this.popovers) {
      if (!popover.isOpen) continue
      popover.close(restoreFocus)
      closed = true
    }
    return closed
  }

  private disposePopovers(): void {
    this.closePopovers()
    this.popovers = []
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

    const list = document.createElement('ol')
    list.className = 'pulse-picks__list'
    this.picks.forEach((pick) => list.appendChild(this.renderPickRow(pick)))
    section.appendChild(list)

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
    main.appendChild(
      this.renderPickAction('Edit', `Edit ${pick.name}`, 'M11.5 2.5a1.5 1.5 0 0 1 2 2L6 12l-3 1 1-3 7.5-7.5Z', () =>
        this.config.onEditPick(pick.id)
      )
    )
    main.appendChild(
      this.renderPickAction('Delete', `Remove ${pick.name}`, 'M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8', () =>
        this.config.onDeletePick(pick.id)
      )
    )
    row.appendChild(main)

    if (pick.comment) {
      const comment = document.createElement('div')
      comment.className = 'pulse-picks__comment'
      comment.textContent = pick.comment.length > 80 ? `${pick.comment.slice(0, 80)}…` : pick.comment
      row.appendChild(comment)
    }

    return row
  }

  private renderPickAction(label: string, ariaLabel: string, icon: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `pulse-picks__action pulse-picks__action--${label.toLowerCase()}`
    btn.setAttribute('aria-label', ariaLabel)
    btn.title = label
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', icon)
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.25')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
    btn.appendChild(svg)
    btn.addEventListener('click', () => onClick())
    return btn
  }

  // -- video (PULSE-338) -------------------------------------------------------

  /** `1:23`, or `0:07`. Minutes never pad; the cap is two minutes. */
  static formatDuration(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000))
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${Math.round(kb)} KB`
    return `${(kb / 1024).toFixed(1)} MB`
  }

  private renderVideoPreview(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'pulse-screenshot pulse-video'

    if (this.videoUrl) {
      const video = document.createElement('video')
      video.className = 'pulse-video__player'
      video.src = this.videoUrl
      video.controls = true
      video.playsInline = true
      video.preload = 'metadata'
      container.appendChild(video)
    }

    // The live readout is impossible while the widget is hidden, so the numbers
    // land here the moment the panel comes back (PULSE-338).
    const meta = document.createElement('div')
    meta.className = 'pulse-video__meta'
    meta.textContent = `${FeedbackPanel.formatDuration(this.videoDurationMs)} · ${FeedbackPanel.formatBytes(
      this.videoBlob?.size ?? 0
    )}`
    container.appendChild(meta)

    const actions = document.createElement('div')
    actions.className = 'pulse-screenshot__actions'

    const rerecord = document.createElement('button')
    rerecord.className = 'pulse-screenshot__btn'
    rerecord.type = 'button'
    rerecord.textContent = 'Re-record'
    // Straight back to getDisplayMedia: no await may precede it.
    rerecord.addEventListener('click', () => this.config.onRecordVideo())
    actions.appendChild(rerecord)

    const remove = document.createElement('button')
    remove.className = 'pulse-screenshot__btn pulse-screenshot__btn--danger'
    remove.type = 'button'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => this.config.onRemoveVideo())
    actions.appendChild(remove)

    container.appendChild(actions)

    if (this.videoNotice) {
      const notice = document.createElement('div')
      notice.className = 'pulse-capture-note pulse-video__note'
      notice.textContent = this.videoNotice
      container.appendChild(notice)
    }

    return container
  }

  /** Blob and its measured duration move together; null clears both. */
  setVideo(blob: Blob | null, durationMs = 0): void {
    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl)
      this.videoUrl = null
    }
    this.videoBlob = blob
    this.videoDurationMs = blob ? durationMs : 0
    // The notice describes one particular recording; it goes with it.
    if (!blob) this.videoNotice = null
    if (blob) this.videoUrl = URL.createObjectURL(blob)
    if (this.state === 'open') this.renderForm()
  }

  getVideo(): Blob | null {
    return this.videoBlob
  }

  setVideoError(message: string | null): void {
    this.videoError = message
    if (this.state === 'open') this.renderForm()
  }

  /** Sits under the finished recording; only rendered once there is one. */
  setVideoNotice(message: string | null): void {
    this.videoNotice = message
    if (this.state === 'open') this.renderForm()
  }

  /**
   * Voice-over is armed only once the widget has a granted microphone; the
   * panel never assumes the click succeeded (PULSE-400).
   */
  setVoiceOver(on: boolean): void {
    this.voiceOver = on
    this.reopenFocus = '.pulse-voiceover__toggle'
    if (this.state === 'open') this.renderForm()
  }

  isVoiceOverOn(): boolean {
    return this.voiceOver
  }

  /** Denied, missing or broken microphone. Never an error state — a note. */
  setVoiceOverNote(message: string | null): void {
    this.voiceOverNote = message
    this.reopenFocus = '.pulse-voiceover__toggle'
    if (this.state === 'open') this.renderForm()
  }

  /**
   * Video is the reason the upload pipeline has a resumable path at all; a
   * 60 MB recording on poor wifi needs to look like it is doing something.
   */
  setUploadProgress(sent: number, total: number): void {
    const percent = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : null
    if (percent === this.uploadPercent) return
    this.uploadPercent = percent
    const label = this.bodyEl.querySelector('.pulse-submit span')
    if (label && percent !== null) {
      label.textContent = percent < 100 ? `Uploading ${percent}%` : 'Submitting...'
    }
  }

  /** Surfaced under the capture controls when a viewport capture fails outright. */
  setCaptureError(message: string | null): void {
    this.captureError = message
    if (this.state === 'open') this.renderForm()
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
    this.uploadPercent = null
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
    this.videoError = null
    // The opt-in does not survive a submitted report: the next reporter on the
    // same page must choose the microphone again, deliberately.
    this.voiceOver = false
    this.voiceOverNote = null
    this.uploadPercent = null
    this.setVideo(null)
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
    // Popover surfaces float in the shadow root, not inside the panel, so
    // hiding the panel would otherwise leave one stranded on the page.
    this.closePopovers()
    this.panelEl.classList.remove('pulse-panel--visible')
  }

  destroy(): void {
    this.disposePopovers()
    if (this.screenshotUrl) {
      URL.revokeObjectURL(this.screenshotUrl)
    }
    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl)
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
