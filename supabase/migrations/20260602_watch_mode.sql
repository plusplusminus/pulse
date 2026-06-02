-- PULSE-365: 'subscribed only' watch mode on the per-(hub,user) settings row.
--
-- watch_mode:
--   'all'             — all activity, minus tasks the user muted (current behaviour)
--   'subscribed_only' — only tasks the user follows, plus direct @mentions
-- Additive; default 'all' preserves existing behaviour, no backfill needed.
--
-- The column add and the CHECK are separate statements: `add column if not
-- exists` skips its inline constraint when the column already exists, so the
-- CHECK is added on its own and made idempotent via drop-if-exists + add (same
-- pattern as 20260602_health_update_event_type.sql).

alter table hub_notification_settings
  add column if not exists watch_mode text not null default 'all';

alter table hub_notification_settings
  drop constraint if exists hub_notification_settings_watch_mode_check;
alter table hub_notification_settings
  add constraint hub_notification_settings_watch_mode_check
  check (watch_mode in ('all', 'subscribed_only'));
