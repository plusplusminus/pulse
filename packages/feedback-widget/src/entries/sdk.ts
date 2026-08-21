import { setCaptureEngine } from '../screenshot'
import { captureViewport } from '../capture/engine'
import { setWebmDurationFixer } from '../capture/webm-duration'
import { fixWebmDuration } from './webm-duration'
import { setAnnotationEditorModule } from '../ui/annotation'
import { createAnnotationEditor } from '../ui/annotation-editor'

// The npm build keeps these as static imports: a consumer's bundler code-splits
// them properly, and an npm install must never reach back to the Pulse origin
// for a script. Only the IIFE embed lazy-loads them.
setCaptureEngine({ captureViewport })
setWebmDurationFixer({ fixWebmDuration })
setAnnotationEditorModule({ createAnnotationEditor })

export { Pulse } from '../index'
export type { PulseInstance, PulseConfig, SubmitResult, ConsoleEntry, SentryContext, WidgetContext } from '../index'
