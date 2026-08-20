-- Hub project rankings: client stack ranking of roadmap projects
create table hub_project_rankings (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references client_hubs(id) on delete cascade,
  user_id text not null,
  project_linear_id text not null,
  rank integer not null check (rank > 0),
  updated_at timestamptz not null default now(),
  unique (hub_id, user_id, project_linear_id),
  unique (hub_id, user_id, rank)
);

create index idx_hub_rankings_hub on hub_project_rankings (hub_id);
create index idx_hub_rankings_hub_user on hub_project_rankings (hub_id, user_id);

-- Ranking audit log: tracks every ranking change
create table hub_ranking_log (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references client_hubs(id) on delete cascade,
  user_id text not null,
  project_linear_id text not null,
  previous_rank integer,
  new_rank integer not null,
  created_at timestamptz not null default now()
);

create index idx_hub_ranking_log_hub on hub_ranking_log (hub_id, created_at desc);
create index idx_hub_ranking_log_hub_project on hub_ranking_log (hub_id, project_linear_id, created_at desc);
