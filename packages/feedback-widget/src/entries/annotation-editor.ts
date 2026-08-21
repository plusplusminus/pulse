/**
 * Lazy screenshot editor (dist/annotation-editor.global.js, served as
 * /widget/v1/annotation-editor.js).
 *
 * Injected by `src/ui/annotation.ts` on the first click of Annotate and never
 * before, so a reporter who does not annotate never downloads the editor. The
 * IIFE assigns `window.__PulseAnnotationEditor` (tsup `globalName`); the loader
 * reads `createAnnotationEditor` off it.
 */
export { createAnnotationEditor } from '../ui/annotation-editor'
