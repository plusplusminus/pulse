export interface PulseConfig {
  /** Public site identifier issued by the Pulse admin (sk_...). Not a secret. */
  siteKey: string
  /** Pulse API origin. Defaults to the origin baked in at build time; never the host page. */
  apiUrl?: string
  theme?: 'auto' | 'light' | 'dark'
  position?: 'bottom-right' | 'bottom-left'
  triggerText?: string
  /** Max console entries kept when the site has console capture enabled (bootstrap). */
  consoleLimit?: number
  user?: {
    email?: string
    name?: string
  }
  custom?: Record<string, string>
  onSubmit?: (result: SubmitResult) => void
  onOpen?: () => void
  onClose?: () => void
}

export interface SubmitResult {
  id: string
  linearIssueId: string | null
  linearIssueUrl: string | null
  status: 'created' | 'failed'
}

export interface ConsoleEntry {
  level: string
  message: string
  timestamp: string
}

export interface SentryContext {
  replayId: string | null
  replayUrl: string | null
  sessionId: string | null
  traceId: string | null
}

export interface WidgetContext {
  url: string
  userAgent: string
  viewport: { width: number; height: number }
  timestamp: string
  console: ConsoleEntry[]
  sentry: SentryContext | null
  custom: Record<string, string>
  /** What surface a native tab capture actually recorded (PULSE-335). */
  captureSurface?: 'browser' | 'window' | 'monitor'
}

export interface FeedbackPayload {
  title: string
  description?: string
  type: 'bug' | 'feedback' | 'idea'
  metadata: WidgetContext
  reporter: {
    email: string
    name?: string
  }
  /** Object key in the private widget-media bucket (from uploadBlob) */
  screenshotStoragePath?: string
  /** Screen recording object key under {hubId}/videos/ (PULSE-337) */
  videoStoragePath?: string
  /** Element picks (PULSE-329); max 50 */
  picks?: WidgetPick[]
  /** Screenshot annotation rects (PULSE-333); max 50 */
  screenshotAnnotations?: ScreenshotAnnotation[]
}

// -- Screenshot annotations: mirror of ScreenshotAnnotation in src/lib/widget-types.ts --
//
// A discriminated union on `kind` (PULSE-401). Every variant lives in the
// captured bitmap's own pixel space — never viewport or panel space — so marks
// survive a panel resize and bake onto the full-resolution export unchanged.
//
// `highlight` and `hide` keep exactly the rect-only shape they had before the
// union, so rows written by earlier widget versions still parse.

export const ANNOTATION_KINDS = [
  'highlight',
  'hide',
  'rect',
  'ellipse',
  'arrow',
  'pen',
  'text',
] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

/**
 * Fixed palette. Small on purpose — a colour picker is a paint-program feature.
 * Every entry has to stay visible on both a white app and a dark dashboard,
 * which is why the set skips mid-greys.
 */
export const ANNOTATION_COLORS = [
  '#ef4444', // red — default; the "look here" colour people reach for
  '#f59e0b', // amber
  '#22c55e', // green
  '#3b82f6', // blue
  '#111827', // near-black, for light screenshots
  '#ffffff', // white, for dark screenshots
] as const
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

/**
 * Stroke and font sizes are stored in IMAGE pixels, already multiplied by the
 * capture's DPR at the moment the mark is made. A 2x capture therefore gets a
 * 2x stroke and stays legible, and any renderer — the export, the editor
 * preview, the admin overlay — can scale by image size alone with no DPR
 * knowledge of its own.
 */
export interface AnnotationStroke {
  color: AnnotationColor
  /** Stroke width in image pixels. */
  strokeWidth: number
}

/** Shared rect geometry, in image pixels. */
export interface AnnotationRect {
  x: number
  y: number
  w: number
  h: number
}

/** Dims everything outside it and outlines it. Fixed appearance, as before. */
export interface HighlightAnnotation extends AnnotationRect {
  kind: 'highlight'
}

/** Solid black redaction. Fixed appearance, as before. */
export interface HideAnnotation extends AnnotationRect {
  kind: 'hide'
}

/** Outlined box — not filled; a filled box would hide what it points at. */
export interface BoxAnnotation extends AnnotationRect, AnnotationStroke {
  kind: 'rect'
}

/** Outlined ellipse inscribed in its rect. */
export interface EllipseAnnotation extends AnnotationRect, AnnotationStroke {
  kind: 'ellipse'
}

/** Tail (x1,y1) to head (x2,y2). The head is drawn at the second point. */
export interface ArrowAnnotation extends AnnotationStroke {
  kind: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Freehand path as a flat [x0,y0,x1,y1,...] list — half the JSON of point objects. */
export interface PenAnnotation extends AnnotationStroke {
  kind: 'pen'
  points: number[]
}

/** (x,y) is the top-left of the first line's box. */
export interface TextAnnotation {
  kind: 'text'
  x: number
  y: number
  text: string
  color: AnnotationColor
  /** Font size in image pixels (DPR already applied). */
  fontSize: number
}

export type ScreenshotAnnotation =
  | HighlightAnnotation
  | HideAnnotation
  | BoxAnnotation
  | EllipseAnnotation
  | ArrowAnnotation
  | PenAnnotation
  | TextAnnotation

/**
 * Non-destructive crop, in image pixels. Applied only at export, so it can be
 * adjusted or cleared while editing without invalidating any annotation.
 */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Everything needed to reopen the editor exactly where the reporter left it.
 * Annotations here are in the ORIGINAL capture's space; the crop has not been
 * applied. The widget stores this opaquely and hands it back on re-annotate —
 * the geometry all lives in the lazily loaded editor.
 */
export interface AnnotationEditorState {
  annotations: ScreenshotAnnotation[]
  crop: CropRect | null
}

// -- Element picks: mirror of WidgetPick in src/lib/widget-types.ts (Pulse app) ----------

export const PICK_INTENTS = ['fix', 'change', 'question', 'approve'] as const
export type PickIntent = (typeof PICK_INTENTS)[number]

export interface PickRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PickRelocation {
  rect: PickRect & { top: number; left: number; right: number; bottom: number }
  scrollX: number
  scrollY: number
  viewport: { width: number; height: number }
  dpr: number
  textHash: string
}

export interface WidgetPick {
  id: string

  elementPath: string
  name: string
  classes: string
  boundingBox: PickRect
  nearbyText: string
  comment: string
  intent: PickIntent
  isFixed: boolean

  isMultiSelect?: boolean
  isArea?: boolean
  areaRect?: PickRect
  elementBoundingBoxes?: PickRect[]

  selectedText?: string
  fullPath?: string
  computedStyles?: Record<string, string>
  accessibility?: string
  nearbyElements?: string

  selector?: string | null
  xpath?: string
  relocation?: PickRelocation
}

export type WidgetState =
  | 'closed'
  | 'open'
  | 'picking'
  | 'capturing'
  | 'recording'
  | 'annotating'
  | 'submitting'
  | 'success'
  | 'error'

/** Shape of `window.PulseConfig` for the script-tag / loader install path. */
export type PulseGlobalConfig = Partial<PulseConfig> & {
  /** Base URL the cookie loader fetches pulse.js from. */
  loaderBase?: string
  /** Called by the cookie loader once pulse.js has loaded. */
  onReady?: () => void
}

/** Mirror of WidgetBootstrapPayload in src/lib/widget-types.ts (Pulse app). */
export interface BootstrapPayload {
  site: { name: string }
  api: { base: string }
  capture: {
    screenshot: boolean
    captureTab: boolean
    elementPick: boolean
    video: boolean
    /** Microphone voice-over on recordings (PULSE-400); false means no getUserMedia path exists. */
    voiceOver: boolean
    console: boolean
    sentry: boolean
    replay: { enabled: boolean; bufferSeconds: number; maskAllInputs: boolean }
  }
  privacy: { maskSelectors: string[] }
  ui: {
    theme: 'auto' | 'light' | 'dark'
    position: 'bottom-right' | 'bottom-left'
    triggerText: string
  }
}

/** Fully resolved runtime config: bootstrap (or safe defaults) merged with the host page's PulseConfig. */
export interface RuntimeConfig {
  siteKey: string
  apiUrl: string
  siteName: string | null
  ui: BootstrapPayload['ui']
  capture: BootstrapPayload['capture']
  privacy: BootstrapPayload['privacy']
  user: { email?: string; name?: string }
  custom: Record<string, string>
  consoleLimit: number
  onSubmit?: (result: SubmitResult) => void
  onOpen?: () => void
  onClose?: () => void
}
