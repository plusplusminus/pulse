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
  /** Element picks (PULSE-329); max 50 */
  picks?: WidgetPick[]
  /** Screenshot annotation rects (PULSE-333); max 50 */
  screenshotAnnotations?: ScreenshotAnnotation[]
}

// -- Screenshot annotations: mirror of ScreenshotAnnotation in src/lib/widget-types.ts --

export const ANNOTATION_KINDS = ['highlight', 'hide'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

/** One rect in the captured bitmap's own pixel space (never viewport or panel space). */
export interface ScreenshotAnnotation {
  kind: AnnotationKind
  x: number
  y: number
  w: number
  h: number
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

export type WidgetState = 'closed' | 'open' | 'picking' | 'capturing' | 'annotating' | 'submitting' | 'success' | 'error'

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
