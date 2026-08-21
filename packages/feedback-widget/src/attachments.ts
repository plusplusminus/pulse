import type { AnnotationEditorState, ScreenshotAnnotation } from './types'
import type { CaptureSurface } from './capture/tab-capture'

/**
 * How many screenshots one submission may carry (PULSE-403).
 *
 * Mirrors `WIDGET_ASSET_CAPS.screenshot` in src/lib/widget-assets.ts. The
 * feedback endpoint is public — the site key ships in the page — so the server
 * enforces the same number independently. This copy is UX: it stops the
 * reporter capturing a seventh image only to have the submit rejected.
 */
export const MAX_SCREENSHOTS = 6

/** Shown when a capture is refused because the submission is already full. */
export const SCREENSHOT_CAP_NOTICE = `You can attach up to ${MAX_SCREENSHOTS} screenshots. Remove one to add another.`

/**
 * One captured image and everything that belongs to it. Annotations are per
 * screenshot, not per submission: two images in one report carry two
 * independent sets of marks.
 */
export interface ScreenshotAttachment {
  /** Client-side only; the server assigns the real asset id on submit. */
  id: string
  /** Bitmap as captured, so re-annotating never stacks marks onto an export. */
  original: Blob
  /** What is submitted: the export with this screenshot's marks baked in. */
  current: Blob
  /** In the EXPORTED image's space, so a crop is already applied. */
  annotations: ScreenshotAnnotation[]
  /** The editor's own round-trip state (original image space). Opaque here. */
  editorState: AnnotationEditorState | null
  /** Only set for a native tab capture (PULSE-335). */
  surface?: CaptureSurface
}

export function newAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
