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
  created_at: string
  updated_at: string
}

/**
 * Per-site settings stored in widget_configs.config (JSONB). Every field is optional;
 * buildBootstrapPayload (src/lib/widget-bootstrap.ts) applies the defaults.
 */
export type WidgetUIConfig = {
  theme?: 'auto' | 'light' | 'dark'
  position?: 'bottom-right' | 'bottom-left'
  triggerText?: string
  accentColor?: string
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
  reporter_email: string
  reporter_name: string | null
  linear_issue_id: string | null
  linear_issue_url: string | null
  sync_status: 'pending' | 'synced' | 'failed'
  sync_error: string | null
  page_url: string | null
  created_at: string
}

// -- Metadata types -------------------------------------------------------

export type WidgetMetadata = {
  url: string
  userAgent: string
  viewport: { width: number; height: number }
  timestamp: string
  console: ConsoleEntry[]
  sentry: SentryContext | null
  custom: Record<string, string>
}

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

export type WidgetFeedbackRequest = {
  title: string
  description?: string
  type?: 'bug' | 'feedback' | 'idea'
  metadata: WidgetMetadata
  reporter: {
    email: string
    name?: string
  }
  /** Object key in the private widget-media bucket, minted by POST /api/widget/upload */
  screenshotStoragePath?: string
}

export type WidgetFeedbackResponse = {
  id: string
  linearIssueId: string | null
  linearIssueUrl: string | null
  status: 'created' | 'failed'
}

// -- Admin API types ------------------------------------------------------

export type WidgetConfigCreateRequest = {
  name?: string
  allowed_origins?: string[]
  config?: WidgetUIConfig
}

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

export type WidgetConfigUpdateRequest = {
  name?: string
  is_active?: boolean
  allowed_origins?: string[]
  config?: WidgetUIConfig
}
