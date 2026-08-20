-- Add push_retry_count to hub_comments for automated retry backoff
ALTER TABLE hub_comments
  ADD COLUMN IF NOT EXISTS push_retry_count integer NOT NULL DEFAULT 0;
