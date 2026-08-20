-- Performance indexes from the 2026-08-20 production audit (docs/perf-audit-2026-08-20.md).
-- All target tables are small (<20k rows) so plain CREATE INDEX holds its lock for milliseconds.
-- If running by hand against prod outside a transaction, CONCURRENTLY is fine too.

-- 1. Missing from prod (migration drift): 20260602_synced_issues_state_id_index.sql was never applied.
--    resolveStateName() in notification-events.ts runs this per state-change webhook: 697ms mean, 6.2s max.
CREATE INDEX IF NOT EXISTS idx_synced_issues_state_id
  ON synced_issues ((data -> 'state' ->> 'id'));

-- 2. Every hub read filters (user_id, team_id). Only single-column indexes exist; user_id has 1 distinct value.
--    INCLUDE makes diffEntities() (select linear_id, updated_at ... 95k calls) an index-only scan.
CREATE INDEX IF NOT EXISTS idx_synced_issues_user_team
  ON synced_issues (user_id, team_id) INCLUDE (linear_id, updated_at);

-- 3. Cycle-scoped reads (fetchHubCycleIssues, fetchHubCycleStats once rewritten to filter by cycle in SQL).
--    Partial: excludes rows where cycle is absent or JSON null (2.7k of 11k rows).
CREATE INDEX IF NOT EXISTS idx_synced_issues_cycle_id
  ON synced_issues ((data -> 'cycle' ->> 'id'))
  WHERE (data -> 'cycle' ->> 'id') IS NOT NULL;

-- 4. synced_projects: 98k seq scans. Every fetchHubProjects() call is user_id filter + ORDER BY updated_at DESC.
CREATE INDEX IF NOT EXISTS idx_synced_projects_user_updated
  ON synced_projects (user_id, updated_at DESC);

-- 5. notification_reads.notification_event_id is an un-indexed FK. getUnreadCount() joins on it
--    ~490k times so far; FK cascade on notification_events delete also needs it.
CREATE INDEX IF NOT EXISTS idx_notification_reads_event
  ON notification_reads (notification_event_id);

-- 6. notification_email_queue: both FKs un-indexed.
CREATE INDEX IF NOT EXISTS idx_notification_email_queue_event
  ON notification_email_queue (notification_event_id);
CREATE INDEX IF NOT EXISTS idx_notification_email_queue_hub
  ON notification_email_queue (hub_id);

-- 7. /api/hub/[hubId]/last-sync polls every 30s: seq scan + sort on sync_runs (30k seq scans, 4.7s max).
--    Partial index lets the ORDER BY completed_at DESC LIMIT 1 stop after one row (0.05ms in EXPLAIN).
CREATE INDEX IF NOT EXISTS idx_sync_runs_completed
  ON sync_runs (completed_at DESC)
  WHERE status = 'completed' AND completed_at IS NOT NULL;

-- 8. Remaining un-indexed FKs (low traffic today, cheap insurance).
CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions (form_id);
CREATE INDEX IF NOT EXISTS idx_form_templates_hub ON form_templates (hub_id);
CREATE INDEX IF NOT EXISTS idx_hub_form_config_form ON hub_form_config (form_id);
CREATE INDEX IF NOT EXISTS idx_hub_workflow_logs_rule ON hub_workflow_logs (rule_id);
