// Injected by tsup `define` at build time (see tsup.config.ts). Tests set it via vitest `define`.
declare const __PULSE_API_URL__: string

// No top-level import/export here: this file must stay a global script so the
// `__PULSE_API_URL__` declaration above remains ambient.
interface Window {
  /** Set by capture-engine.global.js once the lazily injected engine has run. */
  __PulseCaptureEngine?: import('./screenshot').CaptureEngine
  /** Set by webm-duration.global.js once the lazily injected fixer has run. */
  __PulseWebmDuration?: import('./capture/webm-duration').WebmDurationFixer
  /** Set by annotation-editor.global.js once the lazily injected editor has run. */
  __PulseAnnotationEditor?: import('./ui/annotation').AnnotationEditorModule
}
