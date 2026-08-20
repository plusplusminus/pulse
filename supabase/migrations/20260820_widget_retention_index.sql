-- PULSE-317/341: supporting index for the daily retention cron
-- (/api/cron/widget-retention). The job pages widget_submissions in id order,
-- filtering to rows created before the shortest retention window (30d) that
-- still hold at least one media object.
--
-- Partial on the "has media" predicate: once the cron has been running a while,
-- the overwhelming majority of old rows have null paths, so this keeps the scan
-- proportional to the work actually left rather than to the table. Indexed on
-- id because that is the cursor column the pagination orders by.

create index if not exists idx_widget_submissions_retention
  on widget_submissions (id)
  where screenshot_storage_path is not null
     or video_storage_path is not null
     or replay_storage_path is not null;
