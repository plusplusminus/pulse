-- PULSE-254 — Delete stale notification_events for issues that should be hidden
-- from the hub because the underlying issue carries a label configured in the
-- team mapping's `hidden_label_ids`.
--
-- Background: `filterHubsByVisibility` in src/lib/notification-events.ts now
-- suppresses emits when the issue (or the comment's parent issue) carries a
-- hidden label, but rows written before that filter existed still leak into
-- the Activity feed. This migration purges them for both Issue and Comment
-- notification events.
--
-- Safe to re-run. Only deletes rows where the match can be proven (synced data
-- is present AND the mapping still has hidden labels configured).

-- Helper CTE: explode hidden_label_ids per (hub_id, team_id) so we can do a
-- set-level overlap check against the issue's label IDs.
WITH hidden AS (
  SELECT
    htm.hub_id,
    htm.linear_team_id AS team_id,
    htm.hidden_label_ids
  FROM hub_team_mappings htm
  WHERE htm.is_active = true
    AND htm.hidden_label_ids IS NOT NULL
    AND array_length(htm.hidden_label_ids, 1) > 0
),
-- Issue label ids can live in either shape depending on the source of the
-- synced row:
--   * Linear webhook payloads store them as `labelIds: string[]` at the top
--     level of data.
--   * Initial sync / GraphQL pulls store them as `labels: [{id, ...}, ...]`.
-- Extract both and union them into a single text[] per issue, so the overlap
-- check below works regardless of which shape is present.
issue_label_ids AS (
  SELECT
    si.linear_id AS issue_linear_id,
    COALESCE(
      ARRAY(
        SELECT elem->>'id'
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(si.data->'labels') = 'array'
               THEN si.data->'labels'
               ELSE '[]'::jsonb END
        ) AS elem
        UNION
        SELECT elem
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(si.data->'labelIds') = 'array'
               THEN si.data->'labelIds'
               ELSE '[]'::jsonb END
        ) AS elem
      ),
      ARRAY[]::text[]
    ) AS label_ids
  FROM synced_issues si
),
-- Comment → parent issue lookup.
comment_to_issue AS (
  SELECT
    sc.linear_id AS comment_linear_id,
    sc.issue_linear_id
  FROM synced_comments sc
)
DELETE FROM notification_events ne
WHERE ne.id IN (
  -- Issue events whose underlying synced issue carries a hidden label.
  SELECT ne2.id
  FROM notification_events ne2
  JOIN issue_label_ids ili ON ili.issue_linear_id = ne2.entity_id
  JOIN hidden h
    ON h.hub_id = ne2.hub_id
   AND h.team_id = ne2.team_id
  WHERE ne2.entity_type = 'issue'
    AND ili.label_ids && h.hidden_label_ids

  UNION

  -- Comment events whose parent issue carries a hidden label.
  SELECT ne3.id
  FROM notification_events ne3
  JOIN comment_to_issue cti ON cti.comment_linear_id = ne3.entity_id
  JOIN issue_label_ids ili ON ili.issue_linear_id = cti.issue_linear_id
  JOIN hidden h
    ON h.hub_id = ne3.hub_id
   AND h.team_id = ne3.team_id
  WHERE ne3.entity_type = 'comment'
    AND ili.label_ids && h.hidden_label_ids
);

-- Clear orphaned reads (CASCADE should already handle this, safety net only).
DELETE FROM notification_reads nr
WHERE NOT EXISTS (
  SELECT 1 FROM notification_events ne WHERE ne.id = nr.notification_event_id
);
