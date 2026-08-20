/** Hard cap matching the zod schema's selectedText limit; truncated silently. */
export const MAX_SELECTED_TEXT = 500

/**
 * The user's current page selection, at click time. Reads the HOST page's
 * selection — the widget lives in a closed shadow root and never holds one.
 *
 * The selection survives the pick mousedown because ElementPicker skips
 * preventDefault on text tags and contenteditable (PULSE-330's opt-out).
 */
export function captureSelectedText(): string {
  const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection || selection.isCollapsed) return ''
  return selection.toString().trim().slice(0, MAX_SELECTED_TEXT)
}

/** Dropped after a pick commits so the next pick cannot inherit a stale selection. */
export function clearSelection(): void {
  if (typeof window.getSelection !== 'function') return
  window.getSelection()?.removeAllRanges()
}
