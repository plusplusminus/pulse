-- PULSE-254 — Delete stale notification_events rows for Linear comments
-- whose body does not start with a client-facing prefix (heyclient / pulse).
--
-- Background: Prior to the emit-time filter added in src/lib/notification-events.ts,
-- every synced Linear comment produced a notification_event visible to clients in
-- the hub Activity tab. The filter now suppresses non-client-facing comments, but
-- historical rows still exist and leak information about issues the client may not
-- even have access to. This migration purges them.
--
-- Prefix regex mirrors CLIENT_FACING_PREFIX in src/lib/hub-read.ts:
--   /^@?(?:heyclient|pulse)[\s\n]?/i
--
-- Safe to re-run. Only touches entity_type='comment' rows that can be matched to
-- a synced_comments row — rows without a matching comment body are left alone to
-- avoid accidentally deleting events for comments that were never synced.

DELETE FROM notification_events ne
USING synced_comments sc
WHERE ne.entity_type = 'comment'
  AND ne.entity_id = sc.linear_id
  AND COALESCE(sc.data->>'body', '') !~* '^@?(heyclient|pulse)[[:space:]]?';

-- Also clear any notification_reads rows that now reference deleted events
-- (FK with ON DELETE CASCADE may already handle this; the NOT EXISTS guard is
-- a safety net in case the constraint is missing in some environments).
DELETE FROM notification_reads nr
WHERE NOT EXISTS (
  SELECT 1 FROM notification_events ne WHERE ne.id = nr.notification_event_id
);
