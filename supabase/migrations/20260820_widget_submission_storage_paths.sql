-- PULSE-324: widget submissions reference media by storage path in the private
-- widget-media bucket instead of a public URL. `screenshot_url` is kept and now
-- holds the Pulse media-proxy URL (GET /api/widget/media/:id/screenshot) so the
-- admin table and the retry route keep working. `media_purged_at` is stamped by
-- the retention cron (PULSE-317/340/341) when it nulls the paths, which is how
-- the proxy tells "never had media" (404) from "purged" (410).

alter table widget_submissions
  add column if not exists screenshot_storage_path text,
  add column if not exists video_storage_path text,
  add column if not exists replay_storage_path text,
  add column if not exists media_purged_at timestamptz;
