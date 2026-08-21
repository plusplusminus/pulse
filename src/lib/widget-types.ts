// Pulse feedback widget types

// -- Database row types ---------------------------------------------------

export type WidgetConfig = {
  id: string
  hub_id: string
  api_key_hash: string
  api_key_prefix: string
  name: string
  is_active: boolean
  config: WidgetUIConfig
  allowed_origins: string[]
  /** Per-pick verbosity in the Linear body (PULSE-329/332). Column default 'standard'. */
  output_detail_level: OutputDetailLevel
  created_at: string
  updated_at: string
}

export const OUTPUT_DETAIL_LEVELS = ['compact', 'standard', 'detailed', 'forensic'] as const
export type OutputDetailLevel = (typeof OUTPUT_DETAIL_LEVELS)[number]

/**
 * Per-site settings stored in widget_configs.config (JSONB). Every field is optional;
 * buildBootstrapPayload (src/lib/widget-bootstrap.ts) applies the defaults.
 */
export type WidgetUIConfig = {
  theme?: 'auto' | 'light' | 'dark'
  position?: 'bottom-right' | 'bottom-left'
  triggerText?: string
  capture?: WidgetCaptureConfig
  privacy?: {
    maskSelectors?: string[]
  }
}

export type WidgetCaptureConfig = {
  screenshot?: boolean
  captureTab?: boolean
  elementPick?: boolean
  video?: boolean
  /** Microphone voice-over on recordings (PULSE-400). Defaults false: a higher consent bar than a screenshot. */
  voiceOver?: boolean
  console?: boolean
  sentry?: boolean
  replay?: {
    enabled?: boolean
    bufferSeconds?: number
    maskAllInputs?: boolean
  }
}

/** Public runtime config served by GET /api/widget/v1/bootstrap/:siteKey. Never contains hashes or secrets. */
export type WidgetBootstrapPayload = {
  site: { name: string }
  api: { base: string }
  capture: {
    screenshot: boolean
    captureTab: boolean
    elementPick: boolean
    video: boolean
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

export type WidgetSubmission = {
  id: string
  widget_config_id: string
  hub_id: string
  title: string
  description: string | null
  type: 'bug' | 'feedback' | 'idea'
  screenshot_url: string | null
  screenshot_storage_path: string | null
  video_storage_path: string | null
  replay_storage_path: string | null
  media_purged_at: string | null
  metadata: WidgetMetadata
  /** Element picks (PULSE-329). Defaults to [] for rows created before the column existed. */
  picks: WidgetPick[]
  /** Screenshot annotation rects (PULSE-333), in image-pixel space. */
  screenshot_annotations: ScreenshotAnnotation[]
  reporter_email: string
  reporter_name: string | null
  linear_issue_id: string | null
  linear_issue_url: string | null
  sync_status: 'pending' | 'synced' | 'failed'
  sync_error: string | null
  page_url: string | null
  created_at: string
}

// -- Element picks (PULSE-329) --------------------------------------------

export const PICK_INTENTS = ['fix', 'change', 'question', 'approve'] as const
export type PickIntent = (typeof PICK_INTENTS)[number]

export type PickRect = { x: number; y: number; width: number; height: number }

/** Geometry + text hash so a relocator can score candidates when selector and XPath miss (PULSE-328). */
export type PickRelocation = {
  rect: PickRect & { top: number; left: number; right: number; bottom: number }
  scrollX: number
  scrollY: number
  viewport: { width: number; height: number }
  dpr: number
  textHash: string
}

/**
 * One element pick. Mirrored in packages/feedback-widget/src/types.ts and validated
 * by widgetPickSchema (src/lib/widget-picks.ts). Named WidgetPick because `Pick`
 * collides with the TypeScript utility type.
 */
export type WidgetPick = {
  id: string

  // Always captured (every level)
  elementPath: string
  name: string
  classes: string
  boundingBox: PickRect
  nearbyText: string
  comment: string
  intent: PickIntent
  isFixed: boolean

  // Multi-pick / area
  isMultiSelect?: boolean
  isArea?: boolean
  areaRect?: PickRect
  elementBoundingBoxes?: PickRect[]

  // Captured at pick time, used for detailed / forensic output
  selectedText?: string
  fullPath?: string
  computedStyles?: Record<string, string>
  accessibility?: string
  nearbyElements?: string

  // Machine-relocatable identity (PULSE-328)
  selector?: string | null
  xpath?: string
  relocation?: PickRelocation
}

// -- Screenshot annotations (PULSE-333, extended to a union in PULSE-401) --
//
// MIRROR of the declarations in packages/feedback-widget/src/types.ts. The zod
// schema in src/lib/widget-picks.ts closes the loop with
// `satisfies z.ZodType<ScreenshotAnnotation>`, so all three move together.
//
// Every variant is in the captured bitmap's own pixel space (never viewport or
// panel space), so marks survive panel resize and render against the
// full-resolution screenshot. `highlight` and `hide` keep exactly the rect-only
// shape they had before the union, so rows written by earlier widget versions
// still parse.

export const ANNOTATION_KINDS = [
  "highlight",
  "hide",
  "rect",
  "ellipse",
  "arrow",
  "pen",
  "text",
] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

/** Fixed palette; every entry stays visible on both light and dark screenshots. */
export const ANNOTATION_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#111827",
  "#ffffff",
] as const
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

/**
 * Stroke and font sizes are in IMAGE pixels with the capture's DPR already
 * applied, so a renderer scales by image size alone and never needs to know the
 * reporter's DPR.
 */
export type AnnotationStroke = {
  color: AnnotationColor
  strokeWidth: number
}

export type AnnotationRect = {
  x: number
  y: number
  w: number
  h: number
}

export type HighlightAnnotation = AnnotationRect & { kind: "highlight" }
export type HideAnnotation = AnnotationRect & { kind: "hide" }
export type BoxAnnotation = AnnotationRect & AnnotationStroke & { kind: "rect" }
export type EllipseAnnotation = AnnotationRect &
  AnnotationStroke & { kind: "ellipse" }

/** Tail (x1,y1) to head (x2,y2); the head is drawn at the second point. */
export type ArrowAnnotation = AnnotationStroke & {
  kind: "arrow"
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Freehand path as a flat [x0,y0,x1,y1,...] list. */
export type PenAnnotation = AnnotationStroke & {
  kind: "pen"
  points: number[]
}

/** (x,y) is the top-left of the first line's box. */
export type TextAnnotation = {
  kind: "text"
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

// -- Metadata types -------------------------------------------------------

export type WidgetMetadata = {
  url: string
  userAgent: string
  viewport: { width: number; height: number }
  timestamp: string
  console: ConsoleEntry[]
  sentry: SentryContext | null
  custom: Record<string, string>
  /** Surface a native tab capture recorded, when the screenshot came that way (PULSE-335). */
  captureSurface?: CaptureSurface
}

export const CAPTURE_SURFACES = ['browser', 'window', 'monitor'] as const
export type CaptureSurface = (typeof CAPTURE_SURFACES)[number]

export type ConsoleEntry = {
  level: string
  message: string
  timestamp: string
}

export type SentryContext = {
  replayId: string | null
  replayUrl: string | null
  sessionId: string | null
  traceId: string | null
}

// -- API request/response types -------------------------------------------

export type WidgetFeedbackResponse = {
  id: string
  linearIssueId: string | null
  linearIssueUrl: string | null
  status: 'created' | 'failed'
}

// -- Admin API types ------------------------------------------------------

export type WidgetConfigCreateResponse = {
  id: string
  apiKey: string
  apiKeyPrefix: string
  name: string
}

export type WidgetConfigRotateResponse = {
  id: string
  apiKey: string
  apiKeyPrefix: string
}
