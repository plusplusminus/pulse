CREATE TABLE IF NOT EXISTS sync_watermarks (
  team_id text NOT NULL,
  entity_type text NOT NULL,
  last_reconciled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, entity_type)
);
