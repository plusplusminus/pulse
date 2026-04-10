-- Per-PPM-admin Linear OAuth tokens for personal identity attribution
CREATE TABLE IF NOT EXISTS admin_linear_tokens (
  user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  linear_user_id TEXT,
  linear_user_name TEXT,
  linear_user_email TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Note: No FK to ppm_admins since ppm_admins.user_id can be NULL during lazy-claim.
-- App code ensures only PPM admins can write to this table.
