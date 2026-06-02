-- PULSE-307: index the JSONB state-id path used by resolveStateName().
--
-- resolveStateName() (src/lib/notification-events.ts) resolves a Linear
-- workflow-state UUID to its name by querying synced_issues with
-- `data->state->>id = <id>`, which runs on every status-change webhook.
-- Without an index that expression forces a sequential scan that gets slower as
-- synced_issues grows. This functional index matches the expression PostgREST
-- generates (data -> 'state' ->> 'id') so the lookup is index-backed.
--
-- Note: plain CREATE INDEX briefly locks writes on synced_issues. If the table
-- is already large at deploy time, run CREATE INDEX CONCURRENTLY manually during
-- low traffic instead (it cannot run inside a migration transaction).
CREATE INDEX IF NOT EXISTS idx_synced_issues_state_id
  ON synced_issues ((data -> 'state' ->> 'id'));
