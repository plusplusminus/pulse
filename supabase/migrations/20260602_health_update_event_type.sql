-- PULSE-363: add 'health_update' to the notification event-type enums so
-- client-facing project health updates (PULSE-359) can drive notifications.
--
-- Both CHECK constraints were created inline in 20260302_notification_tables.sql,
-- so Postgres auto-named them <table>_event_type_check. We drop + re-add with the
-- extra value. Additive (superset) — existing rows already satisfy the new check.

alter table notification_events
  drop constraint if exists notification_events_event_type_check;
alter table notification_events
  add constraint notification_events_event_type_check
  check (event_type in (
    'comment', 'status_change', 'project_update', 'new_issue',
    'cycle_update', 'initiative_update', 'health_update'
  ));

alter table notification_preferences
  drop constraint if exists notification_preferences_event_type_check;
alter table notification_preferences
  add constraint notification_preferences_event_type_check
  check (event_type in (
    'comment', 'status_change', 'project_update', 'new_issue',
    'cycle_update', 'initiative_update', 'health_update'
  ));
