-- Codify the row-level security posture that production already has.
--
-- Why this exists: RLS was enabled on the live database by hand and never
-- written down, so the migrations were the only description of the schema and
-- they described an INSECURE one. A project rebuilt from supabase/migrations
-- (local dev, a fresh staging project, disaster recovery) came up with RLS off
-- while Supabase's default `GRANT ALL ON ALL TABLES TO anon, authenticated`
-- was still in place -- which means the public anon key, shipped in the browser
-- bundle, could read every hub's data. Production was never exposed; a rebuild
-- would have been.
--
-- Verified against production 2026-08-21: RLS on for all 46 public tables,
-- zero policies on the hub and widget tables, and a SELECT with the real anon
-- key returns [] while an INSERT returns 42501. This migration is a no-op
-- there and the actual fix everywhere else.
--
-- RLS with zero policies denies everything regardless of GRANTs. Legitimate
-- server access uses the service role, which bypasses RLS by design.

-- 1. Enable RLS on every table in `public`. Idempotent, and safe for tables
--    that already carry policies (public_views, roadmaps, branding_settings
--    and friends keep serving anon reads through those policies).
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'enabled RLS on %', t.relname;
  end loop;
end $$;

-- 2. Belt and braces on the tables that must never be reachable by a browser
--    key: no policies exist for them, so RLS already denies, but revoking the
--    default grants means a future policy added in haste cannot silently open
--    them up. Every reader of these goes through `supabaseAdmin`.
do $$
declare t text;
begin
  foreach t in array array[
    'widget_configs',
    'widget_submissions',
    'client_hubs',
    'hub_members',
    'hub_team_mappings',
    'admin_linear_tokens',
    'workspace_settings',
    'ppm_admins'
  ]
  loop
    if exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
