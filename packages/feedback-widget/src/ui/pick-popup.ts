import { PICK_INTENTS, type PickIntent } from '../types'

const EDGE_CLAMP = 160
const FLIP_THRESHOLD = 290
const GAP = 20

export interface PopupAnchor {
  /** Marker X as a percentage of viewport width (keeps the anchor on resize). */
  xPercent: number
  /** Marker Y in viewport pixels at the moment the popup opens. */
  y: number
}

export interface PopupPosition {
  left: number
  top?: number
  bottom?: number
}

/** 280 px popup centred on the marker; clamped 160 px from either edge; flips above near the bottom. */
export function popupPosition(anchor: PopupAnchor, viewport: { width: number; height: number }): PopupPosition {
  const x = (anchor.xPercent * viewport.width) / 100
  const left = Math.min(Math.max(EDGE_CLAMP, x), viewport.width - EDGE_CLAMP)
  if (anchor.y > viewport.height - FLIP_THRESHOLD) {
    return { left, bottom: viewport.height - anchor.y + GAP }
  }
  return { left, top: anchor.y + GAP }
}

export interface PickPopupResult {
  comment: string
  intent: PickIntent
}

const INTENT_LABELS: Record<PickIntent, string> = {
  fix: 'Fix',
  change: 'Change',
  question: 'Question',
  approve: 'Approve',
}

/** Comment + intent prompt shown next to a fresh pick. Lives in the widget's shadow root. */
export class PickPopup {
  private element: HTMLElement | null = null
  private textarea: HTMLTextAreaElement | null = null
  private intent: PickIntent = 'fix'
  private intentButtons: HTMLButtonElement[] = []

  constructor(
    private shadow: ShadowRoot,
    private config: {
      onSave: (result: PickPopupResult) => void
      onCancel: () => void
    }
  ) {}

  get isOpen(): boolean {
    return this.element !== null
  }

  open(anchor: PopupAnchor, options: { title: string; comment?: string; intent?: PickIntent } = { title: '' }): void {
    this.close()
    this.intent = options.intent ?? 'fix'

    const el = document.createElement('div')
    el.className = 'pulse-pick-popup'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', 'Comment on element')

    const title = document.createElement('div')
    title.className = 'pulse-pick-popup__title'
    title.textContent = options.title
    el.appendChild(title)

    const intents = document.createElement('div')
    intents.className = 'pulse-pick-popup__intents'
    this.intentButtons = PICK_INTENTS.map((intent) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'pulse-pick-popup__intent'
      btn.dataset.intent = intent
      btn.textContent = INTENT_LABELS[intent]
      btn.addEventListener('click', () => this.setIntent(intent))
      intents.appendChild(btn)
      return btn
    })
    el.appendChild(intents)
    this.applyIntent()

    const textarea = document.createElement('textarea')
    textarea.className = 'pulse-textarea pulse-pick-popup__comment'
    textarea.rows = 3
    textarea.placeholder = 'What should change here?'
    textarea.value = options.comment ?? ''
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        this.save()
      }
    })
    el.appendChild(textarea)
    this.textarea = textarea

    const actions = document.createElement('div')
    actions.className = 'pulse-pick-popup__actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'pulse-pick-popup__btn'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => this.cancel())
    const save = document.createElement('button')
    save.type = 'button'
    save.className = 'pulse-pick-popup__btn pulse-pick-popup__btn--primary'
    save.textContent = 'Save'
    save.addEventListener('click', () => this.save())
    actions.appendChild(cancel)
    actions.appendChild(save)
    el.appendChild(actions)

    this.element = el
    this.shadow.appendChild(el)
    this.position(anchor)
    textarea.focus()
  }

  position(anchor: PopupAnchor): void {
    if (!this.element) return
    const pos = popupPosition(anchor, { width: window.innerWidth, height: window.innerHeight })
    this.element.style.left = `${pos.left}px`
    this.element.style.top = pos.top !== undefined ? `${pos.top}px` : ''
    this.element.style.bottom = pos.bottom !== undefined ? `${pos.bottom}px` : ''
  }

  close(): void {
    this.element?.remove()
    this.element = null
    this.textarea = null
    this.intentButtons = []
  }

  destroy(): void {
    this.close()
  }

  private setIntent(intent: PickIntent): void {
    this.intent = intent
    this.applyIntent()
  }

  private applyIntent(): void {
    for (const btn of this.intentButtons) {
      const active = btn.dataset.intent === this.intent
      btn.classList.toggle('pulse-pick-popup__intent--active', active)
      btn.setAttribute('aria-pressed', String(active))
    }
  }

  private save(): void {
    const comment = (this.textarea?.value ?? '').trim()
    const intent = this.intent
    this.close()
    this.config.onSave({ comment, intent })
  }

  private cancel(): void {
    this.close()
    this.config.onCancel()
  }
}
