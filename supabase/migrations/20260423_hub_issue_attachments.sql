-- PULSE-302 — Track Linear attachments created by Pulse on Linear issues.
--
-- Pulse creates one Linear attachment per issue per hub the issue is visible in,
-- pointing to the issue's Pulse hub page. We persist the mapping so we can later
-- update or remove attachments we created (rather than rediscovering them on
-- Linear's side). Rows are keyed by (issue_linear_id, hub_id); removing a hub
-- cascades.

CREATE TABLE IF NOT EXISTS hub_issue_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_linear_id TEXT NOT NULL,
  hub_id UUID NOT NULL REFERENCES client_hubs(id) ON DELETE CASCADE,
  linear_attachment_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_hub_issue_attachment UNIQUE (issue_linear_id, hub_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_issue_attachments_issue
  ON hub_issue_attachments (issue_linear_id);

CREATE INDEX IF NOT EXISTS idx_hub_issue_attachments_hub
  ON hub_issue_attachments (hub_id);
