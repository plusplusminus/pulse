/**
 * Lazy loader for the screenshot editor (PULSE-401).
 *
 * This file — and only this file — is what the embed carries for annotation. A
 * toolbar, an undo stack, hit-testing, a text input and a crop tool are real
 * weight, and most submissions never annotate at all, so the editor ships as
 * its own artefact and is fetched on the first click of Annotate. The same
 * reasoning as snapdom (PULSE-397) and the WebM duration fixer (PULSE-336):
 * the embed is an iife bundle and iife cannot code-split, so keeping the editor
 * out of the embed means keeping it out of the embed's import graph entirely.
 *
 * Nothing here may import `./annotation-editor`, even as a type-only import
 * that a bundler might not erase.
 */
import { createLazyGlobal } from '../lazy-script'
import type { AnnotationEditorState, ScreenshotAnnotation } from '../types'

export interface AnnotationEditorConfig {
  /**
   * `annotations` match the exported blob exactly — a crop, if any, has been
   * applied to both. `state` is the editor's round-trip state and is opaque:
   * hand it back to `show()` to reopen the editor where the reporter left it.
   */
  onSave: (
    blob: Blob,
    annotations: ScreenshotAnnotation[],
    state: AnnotationEditorState
  ) => void
  onCancel: () => void
}

export interface AnnotationEditor {
  show(screenshotBlob: Blob, state?: AnnotationEditorState | null): Promise<void>
  hide(): void
  destroy(): void
}

export interface AnnotationEditorModule {
  createAnnotationEditor(
    shadowRoot: ShadowRoot,
    config: AnnotationEditorConfig,
    theme: 'light' | 'dark'
  ): AnnotationEditor
}

/** Same-origin with the widget bundle, so a host's existing script-src for Pulse covers it. */
export const ANNOTATION_EDITOR_PATH = '/widget/v1/annotation-editor.js'

/** Reads as an instruction because it lands in the panel's capture-failed row. */
export const EDITOR_LOAD_ERROR =
  'Could not load the screenshot editor — the screenshot itself is still attached.'

const editor = createLazyGlobal<AnnotationEditorModule>({
  path: ANNOTATION_EDITOR_PATH,
  marker: 'data-pulse-annotation-editor',
  read: () => {
    const g = window.__PulseAnnotationEditor
    return g && typeof g.createAnnotationEditor === 'function' ? g : null
  },
  error: EDITOR_LOAD_ERROR,
})

/**
 * Bypasses the network load with an already-bundled editor. The npm SDK calls
 * this from its entry so a consumer's bundler resolves it normally and never
 * reaches back to the Pulse origin. Passing null restores lazy loading (and is
 * how tests reset the module).
 */
export function setAnnotationEditorModule(next: AnnotationEditorModule | null): void {
  editor.set(next)
}

export function annotationEditorUrl(apiUrl?: string): string {
  return editor.url(apiUrl)
}

export function loadAnnotationEditor(apiUrl?: string): Promise<AnnotationEditorModule> {
  return editor.load(apiUrl)
}
