-- Pulse feedback widget tables
-- widget_configs: stores API keys and widget settings per hub
-- widget_submissions: stores each feedback submission

CREATE TABLE IF NOT EXISTS widget_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id UUID NOT NULL REFERENCES client_hubs(id) ON DELETE CASCADE,
  api_key_hash TEXT NOT NULL UNIQUE,
  api_key_prefix TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default Widget',
  is_active BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}',
  allowed_origins TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_widget_configs_api_key_hash ON widget_configs(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_widget_configs_hub_id ON widget_configs(hub_id);

CREATE TABLE IF NOT EXISTS widget_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_config_id UUID NOT NULL REFERENCES widget_configs(id),
  hub_id UUID NOT NULL REFERENCES client_hubs(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'bug' CHECK (type IN ('bug', 'feedback', 'idea')),
  screenshot_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  reporter_email TEXT NOT NULL,
  reporter_name TEXT,
  linear_issue_id TEXT,
  linear_issue_url TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
  sync_error TEXT,
  page_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_widget_submissions_hub ON widget_submissions(hub_id);
CREATE INDEX IF NOT EXISTS idx_widget_submissions_widget ON widget_submissions(widget_config_id);
CREATE INDEX IF NOT EXISTS idx_widget_submissions_sync_status ON widget_submissions(sync_status);

-- Widget media lives in the private `widget-media` bucket
-- (20260820_widget_media_bucket.sql, PULSE-321).
