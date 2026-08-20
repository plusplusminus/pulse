import { setCaptureEngine } from '../screenshot'
import { captureViewport } from '../capture/engine'
import { setWebmDurationFixer } from '../capture/webm-duration'
import { fixWebmDuration } from './webm-duration'

// The npm build keeps snapdom as a static import: a consumer's bundler
// code-splits it properly, and an npm install must never reach back to the
// Pulse origin for a script. Only the IIFE embed lazy-loads the engine.
setCaptureEngine({ captureViewport })
setWebmDurationFixer({ fixWebmDuration })

export { Pulse } from '../index'
export type { PulseInstance, PulseConfig, SubmitResult, ConsoleEntry, SentryContext, WidgetContext } from '../index'
