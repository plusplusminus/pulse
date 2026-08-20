import { MAX_RECORDING_MS } from '../capture/video'
import type { VideoProgress } from '../capture/video'

/**
 * The only widget surface visible while a recording runs (PULSE-399).
 *
 * ## It is in the recording, and that is not fixable
 *
 * `getDisplayMedia` captures real pixels. When the reporter shares *this tab*
 * — the common case, since `recordingConstraints()` sets `preferCurrentTab` —
 * this bar is composited into the video like any other element. No page can
 * exclude itself from its own capture; only an extension living outside the
 * page can. So the bar is small, sits bottom-left out of the usual content
 * column, and shrinks further (`setSlim`) once the track reports
 * `displaySurface === 'browser'`. The panel owns up to it afterwards.
 *
 * The alternative — what shipped before this slice — was to hide the widget
 * entirely, which bought clean pixels at the price of no stop button, no
 * timer, no size, and Esc silently destroying up to two minutes of capture.
 */

/**
 * Minimum gap between DOM writes. The recorder ticks every 250 ms, so this
 * admits every real tick (~4 writes/s) while collapsing any burst — a
 * timeslice landing alongside a tick, or a browser firing catch-up timers —
 * into one write. Leading edge only: there is no trailing timer to leak,
 * and the next tick is never more than 250 ms away.
 */
export const PROGRESS_THROTTLE_MS = 200

/** Below this much time remaining, the countdown appears in the warning style. */
export const COUNTDOWN_THRESHOLD_MS = 15_000

export interface RecordingBarConfig {
  /** Ends the recording and KEEPS it. */
  onStop: () => void
  /** Ends the recording and DROPS it. Deliberate click only — never a keystroke. */
  onDiscard: () => void
  maxDurationMs?: number
  /** Injected for tests. */
  now?: () => number
}

/** `1:23`, or `0:07`. Minutes never pad; the cap is two minutes. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Always MB, always one decimal — a readout that switched KB→MB mid-recording
 * would change width every time, which is exactly the jitter `tabular-nums`
 * is there to prevent.
 */
export function formatMb(bytes: number): string {
  return `${Math.max(0, bytes / (1024 * 1024)).toFixed(1)} MB`
}

export class RecordingBar {
  private element: HTMLElement
  private timeEl: HTMLElement
  private sizeEl: HTMLElement
  private countdownEl: HTMLElement
  private stopBtn: HTMLButtonElement
  private discardBtn: HTMLButtonElement
  private lastWriteAt = -Infinity
  private countingDown = false
  private readonly maxDurationMs: number
  private readonly now: () => number

  constructor(
    shadow: ShadowRoot,
    private config: RecordingBarConfig
  ) {
    this.maxDurationMs = config.maxDurationMs ?? MAX_RECORDING_MS
    this.now = config.now ?? (() => Date.now())

    this.element = document.createElement('div')
    this.element.className = 'pulse-recbar'
    this.element.setAttribute('role', 'group')
    this.element.setAttribute('aria-label', 'Screen recording controls')

    const dot = document.createElement('span')
    dot.className = 'pulse-recbar__dot'
    dot.setAttribute('aria-hidden', 'true')
    this.element.appendChild(dot)

    const label = document.createElement('span')
    label.className = 'pulse-recbar__label'
    label.textContent = 'Recording'
    this.element.appendChild(label)

    this.timeEl = document.createElement('span')
    this.timeEl.className = 'pulse-recbar__time'
    // Read out as one status rather than two, and only when it changes.
    this.timeEl.setAttribute('role', 'timer')
    this.timeEl.textContent = formatClock(0)
    this.element.appendChild(this.timeEl)

    this.sizeEl = document.createElement('span')
    this.sizeEl.className = 'pulse-recbar__size'
    this.sizeEl.textContent = formatMb(0)
    this.element.appendChild(this.sizeEl)

    this.stopBtn = document.createElement('button')
    this.stopBtn.className = 'pulse-recbar__btn pulse-recbar__btn--stop'
    this.stopBtn.type = 'button'
    this.stopBtn.textContent = 'Stop'
    this.stopBtn.addEventListener('click', () => this.config.onStop())
    this.element.appendChild(this.stopBtn)

    this.discardBtn = document.createElement('button')
    this.discardBtn.className = 'pulse-recbar__btn pulse-recbar__btn--discard'
    this.discardBtn.type = 'button'
    this.discardBtn.textContent = 'Discard'
    this.discardBtn.addEventListener('click', () => this.config.onDiscard())
    this.element.appendChild(this.discardBtn)

    // Deliberately LAST. The bar is anchored bottom-left, so anything that
    // appears mid-recording pushes everything after it to the right. Putting
    // the countdown ahead of the buttons moved Stop under wherever the pointer
    // was aiming — and moved Discard into its place — at exactly the moment
    // the reporter is most likely to be reaching for Stop.
    this.countdownEl = document.createElement('span')
    this.countdownEl.className = 'pulse-recbar__countdown'
    this.countdownEl.style.display = 'none'
    this.element.appendChild(this.countdownEl)

    shadow.appendChild(this.element)
  }

  /**
   * Slim variant: this tab is being shared, so every pixel the bar spends is a
   * pixel burnt into the reporter's video. Drops the word "Recording" — the
   * pulsing dot already says it — and tightens the metrics.
   */
  setSlim(slim: boolean): void {
    this.element.classList.toggle('pulse-recbar--slim', slim)
  }

  /**
   * Focus starts on Stop so the keyboard route to the safe action is one
   * keystroke, and Discard is a deliberate Tab away. The panel behind is
   * transparent but still in the tab order, so landing focus here explicitly
   * is what makes the bar reachable at all.
   */
  focusStop(): void {
    this.stopBtn.focus()
  }

  /** Throttled; see PROGRESS_THROTTLE_MS. */
  update(progress: VideoProgress): void {
    const at = this.now()
    if (at - this.lastWriteAt < PROGRESS_THROTTLE_MS) return
    this.lastWriteAt = at
    this.write(progress)
  }

  private write({ elapsedMs, bytes }: VideoProgress): void {
    this.timeEl.textContent = formatClock(elapsedMs)
    this.sizeEl.textContent = formatMb(bytes)

    const remainingMs = this.maxDurationMs - elapsedMs
    const counting = remainingMs <= COUNTDOWN_THRESHOLD_MS
    if (counting) {
      this.countdownEl.textContent = `${Math.max(0, Math.ceil(remainingMs / 1000))}s left`
    }
    if (counting !== this.countingDown) {
      this.countingDown = counting
      this.countdownEl.style.display = counting ? '' : 'none'
      this.element.classList.toggle('pulse-recbar--ending', counting)
    }
  }

  destroy(): void {
    this.element.remove()
  }
}
