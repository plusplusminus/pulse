-- =============================================================================
-- Synced Project Updates (Linear project "health" updates)
-- PULSE-359: pulse/heyclient trigger filtering for project health updates
-- =============================================================================
--
-- Stores Linear ProjectUpdate entities using the same hybrid JSONB pattern as
-- synced_projects / synced_cycles. All rows are written with user_id =
-- 'workspace' by the org-wide webhook + reconcile.
--
-- Client visibility is decided at READ time (hub-read.ts) using the
-- pulse/heyclient body prefix: every update is synced, only client-facing ones
-- are surfaced. Do NOT filter on write. RLS stays off — access via supabaseAdmin.

CREATE TABLE IF NOT EXISTS synced_project_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linear_id text NOT NULL,
  user_id text NOT NULL,
  project_id text,
  health text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_synced_project_updates_user_linear UNIQUE (user_id, linear_id)
);

CREATE INDEX IF NOT EXISTS idx_synced_project_updates_user_id ON synced_project_updates (user_id);
CREATE INDEX IF NOT EXISTS idx_synced_project_updates_linear_id ON synced_project_updates (linear_id);
CREATE INDEX IF NOT EXISTS idx_synced_project_updates_project_id ON synced_project_updates (project_id);
CREATE INDEX IF NOT EXISTS idx_synced_project_updates_user_project ON synced_project_updates (user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_synced_project_updates_created_at ON synced_project_updates (created_at);
