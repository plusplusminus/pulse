-- Add optional status condition to workflow rules.
-- When set, the rule only fires if the issue's current status matches one of the listed state IDs.
-- Null means the rule fires unconditionally (backward compatible with existing rules).
alter table hub_workflow_rules
  add column condition_state_ids jsonb default null;

comment on column hub_workflow_rules.condition_state_ids is
  'Optional array of Linear state IDs. Rule only fires when issue is in one of these statuses. Null = unconditional.';
