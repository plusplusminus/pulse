-- PULSE-329: element picks captured by the feedback widget. One JSONB array
-- of Pick objects per submission (shape: src/lib/widget-types.ts WidgetPick),
-- rendered into the Linear body at the site's output_detail_level.

alter table widget_submissions
  add column if not exists picks jsonb not null default '[]'::jsonb;
