-- PULSE-364: Per-task notification subscriptions (mute / subscribe overrides).
--
-- A row overrides the user's global notification settings for a single task:
--   'muted'      → never notify this user about this task (wins over everything)
--   'subscribed' → follow this task (pierces comment 'mentions_only' scope, and
--                  the PULSE-365 'subscribed_only' watch mode)
-- Absence of a row = follow global settings. Mirrors the per-(hub,user,issue)
-- convention of hub_task_rankings.
create table if not exists hub_task_subscriptions (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references client_hubs(id) on delete cascade,
  user_id text not null,
  issue_linear_id text not null,
  state text not null check (state in ('subscribed', 'muted')),
  -- how the row came to exist: an explicit user action, or auto-subscribe on
  -- participation. Used only for UX labelling ("Following because you commented").
  source text not null default 'manual' check (source in ('manual', 'auto_comment', 'auto_mention')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hub_id, user_id, issue_linear_id)
);

-- Immediate delivery looks up all subscribers for one task.
create index if not exists idx_hub_task_subscriptions_hub_issue
  on hub_task_subscriptions (hub_id, issue_linear_id);
-- Digest looks up one user's overrides across many tasks.
create index if not exists idx_hub_task_subscriptions_hub_user
  on hub_task_subscriptions (hub_id, user_id);
