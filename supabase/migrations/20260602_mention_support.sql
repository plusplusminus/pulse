-- PULSE-362: Per-person comment mentions + per-user comment notification scope.

-- 1. Optional per-member mention handle, unique per hub when set.
--    Resolution order for a typed @token is handle → email local-part → full
--    email (see src/lib/mentions.ts); an explicit handle lets an admin override
--    the email-derived default.
alter table hub_members add column if not exists mention_handle text;

create unique index if not exists uq_hub_members_mention_handle
  on hub_members (hub_id, lower(mention_handle))
  where mention_handle is not null;

-- 2. Which hub members a notification event explicitly mentions.
--    Empty array = broadcast (no specific mention) — the fail-open default.
alter table notification_events
  add column if not exists mentioned_user_ids text[] not null default '{}';

-- 3. Per-(hub, user) notification settings singleton.
--    comment_scope: 'all'           = every client-facing comment (current behaviour)
--                   'mentions_only' = only comments that mention this user
--    (watch_mode is added by PULSE-365.)
create table if not exists hub_notification_settings (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references client_hubs(id) on delete cascade,
  user_id text not null,
  comment_scope text not null default 'all' check (comment_scope in ('all', 'mentions_only')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hub_id, user_id)
);

create index if not exists idx_hub_notification_settings_user_hub
  on hub_notification_settings (user_id, hub_id);
