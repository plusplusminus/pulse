-- RICE scoring for hub projects
-- Clients score each project on Reach, Impact, Confidence, Effort
-- Score = (Reach * Impact * Confidence%) / Effort

create table if not exists hub_rice_scores (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references client_hubs(id) on delete cascade,
  user_id text not null,
  project_linear_id text not null,
  reach numeric check (reach >= 1 and reach <= 10),
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
  unique (hub_id, user_id, project_linear_id)
);

-- Index for fetching scores by hub
create index if not exists idx_hub_rice_scores_hub_id on hub_rice_scores(hub_id);

-- Index for composite queries
create index if not exists idx_hub_rice_scores_hub_project on hub_rice_scores(hub_id, project_linear_id);
