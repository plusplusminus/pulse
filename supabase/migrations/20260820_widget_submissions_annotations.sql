-- PULSE-333: screenshot annotations captured by the feedback widget. Vector
-- rects in image-pixel space (shape: src/lib/widget-types.ts ScreenshotAnnotation)
-- so the admin detail view can re-render or undo them against the stored bitmap.

alter table widget_submissions
  add column if not exists screenshot_annotations jsonb not null default '[]'::jsonb;
