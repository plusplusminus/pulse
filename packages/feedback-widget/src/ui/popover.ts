import { icon, ICONS } from './icon'

const MARGIN = 8
const GAP = 6

export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Below the trigger by default, flipped above when the surface would run off
 * the bottom. Left edges align, clamped so neither edge leaves the viewport.
 */
export function popoverPlacement(
  trigger: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const left = Math.max(MARGIN, Math.min(trigger.left, viewport.width - size.width - MARGIN))
  const below = trigger.bottom + GAP
  const fitsBelow = below + size.height <= viewport.height - MARGIN
  const top = fitsBelow ? below : Math.max(MARGIN, trigger.top - GAP - size.height)
  return { left, top }
}

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'

export interface PopoverConfig {
  /** Stable key so the panel can reopen the same popover across a re-render. */
  id: string
  /** Accessible name for the caret, e.g. "Screenshot options". */
  label: string
  /** Built fresh on every open, so the contents always reflect current state. */
  build: (close: () => void) => HTMLElement
  /** Fires before this one opens, so the owner can close any sibling. */
  onOpen?: () => void
  onClose?: () => void
}

/**
 * The caret half of a split button, plus the surface it reveals (PULSE-402).
 *
 * The caret is always visible — a first-time reporter has to be able to SEE
 * that a capture has options, so nothing here is hover-revealed. The surface
 * floats in the shadow root rather than inside the scrolling panel body,
 * because the body clips and the panel must not reflow when options open.
 */
export class Popover {
  readonly caret: HTMLButtonElement
  private surface: HTMLElement | null = null
  private outsideHandler: ((e: Event) => void) | null = null
  private insideHandler: ((e: Event) => void) | null = null

  constructor(
    private shadow: ShadowRoot,
    private config: PopoverConfig
  ) {
    const caret = document.createElement('button')
    caret.type = 'button'
    caret.className = 'pulse-caret'
    caret.setAttribute('aria-label', config.label)
    caret.setAttribute('aria-haspopup', 'true')
    caret.setAttribute('aria-expanded', 'false')
    caret.appendChild(icon(ICONS.caret))
    // A <button> already fires click for both Enter and Space, so the keyboard
    // contract needs no extra key handling here.
    caret.addEventListener('click', () => this.toggle())
    this.caret = caret
  }

  get id(): string {
    return this.config.id
  }

  get isOpen(): boolean {
    return this.surface !== null
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  open(opts: { focus?: boolean } = {}): void {
    if (this.isOpen) return
    this.config.onOpen?.()

    const surface = document.createElement('div')
    surface.className = 'pulse-pop'
    surface.setAttribute('role', 'group')
    surface.setAttribute('aria-label', this.config.label)
    surface.appendChild(this.config.build(() => this.close()))
    surface.addEventListener('keydown', (e) => this.trapTab(e))
    this.shadow.appendChild(surface)
    this.surface = surface

    this.place()
    this.caret.setAttribute('aria-expanded', 'true')

    // The widget lives in a CLOSED shadow root, and `composedPath()` redacts
    // nodes inside a closed tree from listeners outside it: a document-level
    // handler sees the path stop at the host. Testing for `surface` there is
    // therefore always false, which closed the popover on its own item's
    // pointerdown and detached the button before `click` could fire — every
    // capture option was dead to a real mouse while passing every synthetic
    // test. So the check is split by where it can actually see.
    //
    // Inside the shadow the full path is visible, so the precise test works.
    this.insideHandler = (e: Event) => {
      const path = (e as MouseEvent).composedPath?.() ?? []
      if (!path.includes(surface) && !path.includes(this.caret)) this.close(false)
    }
    this.shadow.addEventListener('pointerdown', this.insideHandler, true)

    // Outside it, the host is the most we can see — and that is enough, because
    // its presence means the pointer went down somewhere in the widget.
    this.outsideHandler = (e: Event) => {
      const path = (e as MouseEvent).composedPath?.() ?? []
      if (!path.includes(this.shadow.host)) this.close(false)
    }
    document.addEventListener('pointerdown', this.outsideHandler, true)

    if (opts.focus !== false) this.focusFirst()
  }

  /** Escape and outside-clicks both land here; only Escape returns focus. */
  close(restoreFocus = true): void {
    if (!this.surface) return
    this.surface.remove()
    this.surface = null
    this.caret.setAttribute('aria-expanded', 'false')
    if (this.outsideHandler) {
      document.removeEventListener('pointerdown', this.outsideHandler, true)
      this.outsideHandler = null
    }
    if (this.insideHandler) {
      this.shadow.removeEventListener('pointerdown', this.insideHandler, true)
      this.insideHandler = null
    }
    this.config.onClose?.()
    if (restoreFocus) this.caret.focus()
  }

  /** Lets the owner update live state (a toggle, a note) without a re-render. */
  query<T extends Element>(selector: string): T | null {
    return this.surface?.querySelector<T>(selector) ?? null
  }

  private focusFirst(): void {
    this.items()[0]?.focus()
  }

  private items(): HTMLElement[] {
    return this.surface ? Array.from(this.surface.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
  }

  private trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.surface) return
    const items = this.items()
    if (items.length === 0) return
    const root = this.surface.getRootNode() as ShadowRoot | Document
    const active = root.activeElement
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  private place(): void {
    const surface = this.surface
    if (!surface || typeof this.caret.getBoundingClientRect !== 'function') return
    const anchor = (this.caret.parentElement ?? this.caret).getBoundingClientRect()
    const size = { width: surface.offsetWidth, height: surface.offsetHeight }
    // jsdom measures everything as zero; skip rather than pin it to a corner.
    if (size.width === 0 && size.height === 0) return
    const { left, top } = popoverPlacement(anchor, size, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    surface.style.left = `${Math.round(left)}px`
    surface.style.top = `${Math.round(top)}px`
  }
}
