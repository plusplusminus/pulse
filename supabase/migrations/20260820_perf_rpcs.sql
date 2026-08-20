-- SQL-side aggregation for the two hottest read paths (docs/perf-audit-2026-08-20.md).

-- Replaces fetchHubCycleStats' "fetch every issue's JSONB and count in JS" with a grouped count.
-- Matches the JS semantics: exclude issues whose JSON project id is overview-only; an issue counts
-- as completed when its state type is completed/canceled (Linear spells it with one L).
create or replace function public.get_cycle_stats(
  p_user_id text,
  p_team_ids text[],
  p_cycle_ids text[],
  p_excluded_project_ids text[] default '{}'
)
returns table (cycle_id text, total bigint, completed bigint)
language sql
stable
set search_path = public
as $$
  select
    data -> 'cycle' ->> 'id' as cycle_id,
    count(*) as total,
    count(*) filter (
      where data -> 'state' ->> 'type' in ('completed', 'canceled', 'cancelled')
    ) as completed
  from synced_issues
  where user_id = p_user_id
    and team_id = any (p_team_ids)
    and (data -> 'cycle' ->> 'id') = any (p_cycle_ids)
    and (
      coalesce(array_length(p_excluded_project_ids, 1), 0) = 0
      or (data -> 'project' ->> 'id') is null
      or not ((data -> 'project' ->> 'id') = any (p_excluded_project_ids))
    )
  group by 1
$$;

revoke all on function public.get_cycle_stats(text, text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.get_cycle_stats(text, text[], text[], text[]) to service_role;

-- Replaces getUnreadCount's count(*) + "fetch all read rows and subtract in JS" with one anti-join.
create or replace function public.notification_unread_count(p_user_id text, p_hub_id uuid)
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)
  from notification_events e
  where e.hub_id = p_hub_id
    and not exists (
      select 1
      from notification_reads r
      where r.notification_event_id = e.id
        and r.user_id = p_user_id
    )
$$;

revoke all on function public.notification_unread_count(text, uuid) from public, anon, authenticated;
grant execute on function public.notification_unread_count(text, uuid) to service_role;
