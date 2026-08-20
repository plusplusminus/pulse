alter table hub_team_mappings
  add column if not exists include_unassigned_issues boolean not null default false;
