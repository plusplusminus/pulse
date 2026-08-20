-- PULSE-329: how much per-pick detail goes into the Linear issue body.
-- compact | standard | detailed | forensic (see src/lib/widget-linear.ts).

alter table widget_configs
  add column if not exists output_detail_level text not null default 'standard';

alter table widget_configs
  drop constraint if exists widget_configs_output_detail_level_check;
alter table widget_configs
  add constraint widget_configs_output_detail_level_check
  check (output_detail_level in ('compact', 'standard', 'detailed', 'forensic'));
