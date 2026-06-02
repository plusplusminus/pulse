-- PULSE-307: Fix Daily Digest emails — default + backfill digest timezone
--
-- Digest delivery timing keys off notification_preferences.timezone. Rows
-- created without an explicit timezone could end up with an empty value, and
-- the previous default ('UTC') meant "09:00" delivered at 9am UTC (11am SAST).
-- Recipients are predominantly South Africa–based, so default new rows to
-- Africa/Johannesburg and backfill any rows that have no timezone set.
--
-- Note: rows with an explicit timezone (including an intentional 'UTC') are
-- left untouched — this only fills in missing values.

ALTER TABLE notification_preferences
  ALTER COLUMN timezone SET DEFAULT 'Africa/Johannesburg';

UPDATE notification_preferences
  SET timezone = 'Africa/Johannesburg'
  WHERE timezone IS NULL OR trim(timezone) = '';

-- Backfill any missing digest_time as well, since the cron parses it for the
-- delivery hour.
UPDATE notification_preferences
  SET digest_time = '09:00'
  WHERE digest_time IS NULL OR trim(digest_time) = '';
