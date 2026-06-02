-- PULSE-365: 'subscribed only' watch mode on the per-(hub,user) settings row.
--
-- watch_mode:
--   'all'             — all activity, minus tasks the user muted (current behaviour)
--   'subscribed_only' — only tasks the user follows, plus direct @mentions
-- Additive; default 'all' preserves existing behaviour, no backfill needed.
alter table hub_notification_settings
  add column if not exists watch_mode text not null default 'all'
  check (watch_mode in ('all', 'subscribed_only'));
