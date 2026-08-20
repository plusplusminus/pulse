/**
 * Freezes page motion so the user can report a timing/animation bug at a
 * specific frame: CSS animations and transitions, WAAPI animations, and <video>.
 *
 * Deliberately does NOT monkey-patch setTimeout/setInterval/requestAnimationFrame.
 * That freezes JS-driven animation too, but the global side-effects break
 * third-party libraries scheduling background work and conflict with dev-mode
 * module reload. CSS + WAAPI covers the large majority of animation bugs.
 */

export const FREEZE_STYLE_ATTR = 'freeze'

/** The widget itself is excluded so its own UI keeps animating while frozen. */
export const FREEZE_CSS =
  '*:not(#pulse-widget):not(#pulse-widget *) { animation-play-state: paused !important; transition: none !important; }'

const WAS_PAUSED = 'pulseWasPaused'

export class PageFreezer {
  private styleEl: HTMLStyleElement | null = null
  private paused: Animation[] = []

  get isFrozen(): boolean {
    return this.styleEl !== null
  }

  /** Returns the state after toggling. */
  toggle(): boolean {
    if (this.isFrozen) this.unfreeze()
    else this.freeze()
    return this.isFrozen
  }

  freeze(): void {
    if (this.isFrozen) return

    const style = document.createElement('style')
    style.setAttribute('data-pulse', FREEZE_STYLE_ATTR)
    style.textContent = FREEZE_CSS
    document.head.appendChild(style)
    this.styleEl = style

    // Snapshot only what WE paused, so unfreeze never starts an animation the
    // page had deliberately paused itself.
    this.paused = getAnimations().filter((a) => a.playState === 'running')
    for (const animation of this.paused) {
      try {
        animation.pause()
      } catch {
        // a detached or already-finished animation; nothing to pause
      }
    }

    for (const video of videos()) {
      video.dataset[WAS_PAUSED] = String(video.paused)
      video.pause()
    }
  }

  unfreeze(): void {
    if (!this.isFrozen) return

    this.styleEl?.remove()
    this.styleEl = null

    for (const animation of this.paused) {
      try {
        animation.play()
      } catch {
        // animation went away while frozen
      }
    }
    this.paused = []

    for (const video of videos()) {
      const wasPlaying = video.dataset[WAS_PAUSED] === 'false'
      delete video.dataset[WAS_PAUSED]
      if (wasPlaying) void video.play().catch(() => {})
    }
  }

  destroy(): void {
    this.unfreeze()
  }
}

function getAnimations(): Animation[] {
  if (typeof document.getAnimations !== 'function') return []
  try {
    return document.getAnimations()
  } catch {
    return []
  }
}

function videos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll('video'))
}
