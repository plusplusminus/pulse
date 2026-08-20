/**
 * Lazy capture engine (dist/capture-engine.global.js, served as
 * /widget/v1/capture-engine.js).
 *
 * Injected by `src/screenshot.ts` on the first viewport capture and never
 * before, so a visitor who ignores the widget never downloads snapdom. The
 * IIFE assigns `window.__PulseCaptureEngine` (tsup `globalName`); the loader
 * reads `captureViewport` off it.
 */
export { captureViewport } from '../capture/engine'
