-- Task-level prioritisation: ranking + RICE scoring for issues within projects
-- Mirrors hub_project_rankings / hub_rice_scores but scoped by project_id

-- ─── Task Rankings ───

create table if not exists hub_task_rankings (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references client_hubs(id) on delete cascade,
  user_id text not null,
  project_linear_id text not null,
  issue_linear_id text not null,
  rank integer not null check (rank > 0),
  updated_at timestamptz not null default now(),
  unique (hub_id, user_id, project_linear_id, issue_linear_id),
  unique (hub_id, user_id, project_linear_id, rank)
);

create index if not exists idx_hub_task_rankings_hub_project on hub_task_rankings (hub_id, project_linear_id);
create index if not exists idx_hub_task_rankings_hub_user on hub_task_rankings (hub_id, user_id, project_linear_id);

-- Task ranking audit log
create table if not exists hub_task_ranking_log (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references client_hubs(id) on delete cascade,
  user_id text not null,
  project_linear_id text not null,
  issue_linear_id text not null,
  previous_rank integer,
  new_rank integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_hub_task_ranking_log_hub_project on hub_task_ranking_log (hub_id, project_linear_id, created_at desc);

-- ─── Task RICE Scores ───

create table if not exists hub_task_rice_scores (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references client_hubs(id) on delete cascade,
  user_id text not null,
  project_linear_id text not null,
  issue_linear_id text not null,
  reach integer check (reach >= 1 and reach <= 10),
  impact numeric check (impact in (0.25, 0.5, 1, 2, 3)),
  confidence numeric check (confidence >= 0 and confidence <= 100),
  effort numeric check (effort >= 0.5),
  score numeric generated always as (
    case when reach is not null and impact is not null and confidence is not null and effort is not null and effort > 0
      then (reach * impact * (confidence / 100.0)) / effort
      else null
    end
  ) stored,
  updated_at timestamptz not null default now(),
  unique (hub_id, user_id, project_linear_id, issue_linear_id)
);

create index if not exists idx_hub_task_rice_scores_hub_project on hub_task_rice_scores(hub_id, project_linear_id);

-- ─── Scoping: opt-in per project ───

alter table hub_team_mappings
  add column if not exists task_priority_project_ids text[] not null default '{}';
