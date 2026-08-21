-- PULSE-403: multiple attachments per submission.
--
-- `widget_submissions` carries one column per artefact kind
-- (`screenshot_storage_path`, `video_storage_path`, `replay_storage_path`,
-- 20260820_widget_submission_storage_paths.sql), so a reporter can attach
-- exactly one screenshot. This adds `widget_submission_assets`: one row per
-- attached artefact, ordered by the reporter's `position`, with annotations
-- carried per screenshot rather than per submission.
--
-- This migration is deliberately DUAL-READ, not a cutover:
--   * every non-null legacy path is backfilled into an asset row;
--   * the legacy columns are NOT dropped, and the API keeps writing the first
--     asset of each kind into them;
--   * readers prefer asset rows and fall back to the columns
--     (src/lib/widget-assets.ts).
-- Dropping the columns is a later migration. A failed cutover here would lose
-- client screenshots.
--
-- Idempotent: `if not exists` throughout, and the backfill is guarded by the
-- unique (submission_id, storage_path) index so re-running is a no-op.

create table if not exists widget_submission_assets (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references widget_submissions(id) on delete cascade,
  kind          text not null,
  storage_path  text not null,
  content_type  text not null,
  size_bytes    bigint,
  width         int,
  height        int,
  duration_ms   int,
  -- Annotation rects in the captured bitmap's pixel space (PULSE-333). They
  -- belong to *a* screenshot, which is why they move off the submission.
  annotations   jsonb not null default '[]'::jsonb,
  -- The reporter's ordering within a kind. The media proxy's legacy URL shape
  -- (/api/widget/media/:submissionId/:kind) resolves to the lowest position.
  position      int not null default 0,
  -- Per-asset retention (PULSE-317/340). `widget_submissions.media_purged_at`
  -- stays in step for as long as the legacy columns are written, so the proxy's
  -- 410-vs-404 distinction keeps working on both paths.
  purged_at     timestamptz,
  created_at    timestamptz not null default now()
);

-- Kind allowlist. Dropped and re-added so re-running picks up a changed list.
alter table widget_submission_assets
  drop constraint if exists widget_submission_assets_kind_check;
alter table widget_submission_assets
  add constraint widget_submission_assets_kind_check
  check (kind in ('screenshot', 'video', 'replay'));

alter table widget_submission_assets
  drop constraint if exists widget_submission_assets_position_check;
alter table widget_submission_assets
  add constraint widget_submission_assets_position_check
  check (position >= 0);

-- The same object attached twice to one submission is a duplicate, not a second
-- attachment. This is also what makes the backfill below re-runnable.
create unique index if not exists idx_widget_submission_assets_unique_path
  on widget_submission_assets (submission_id, storage_path);

-- The proxy's hot path: "first asset of this kind for this submission".
create index if not exists idx_widget_submission_assets_lookup
  on widget_submission_assets (submission_id, kind, position);

-- The retention cron pages in id order over assets that still hold an object.
-- Partial on `purged_at is null` for the same reason
-- idx_widget_submissions_retention is partial: once the job has been running a
-- while, most old rows are already purged.
create index if not exists idx_widget_submission_assets_retention
  on widget_submission_assets (id)
  where purged_at is null;

-- RLS posture matches 20260821_codify_rls.sql: enabled with zero policies, so
-- the anon key shipped in the browser bundle can neither read nor write. Every
-- legitimate reader goes through `supabaseAdmin` (service role bypasses RLS).
alter table widget_submission_assets enable row level security;
revoke all on public.widget_submission_assets from anon, authenticated;

-- -- Backfill ---------------------------------------------------------------
-- One asset row per non-null legacy path. `created_at` is copied from the
-- submission so the retention windows land on the same day they would have.
-- Content type is derived from the extension the upload signer minted
-- (src/lib/widget-upload.ts WIDGET_MEDIA_CONTENT_TYPES); anything unrecognised
-- gets application/octet-stream rather than being skipped, so no object is left
-- unreferenced.

insert into widget_submission_assets
  (submission_id, kind, storage_path, content_type, annotations, position, created_at)
select
  s.id,
  'screenshot',
  s.screenshot_storage_path,
  case lower(regexp_replace(s.screenshot_storage_path, '^.*\.', ''))
    when 'png' then 'image/png'
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    else 'application/octet-stream'
  end,
  coalesce(s.screenshot_annotations, '[]'::jsonb),
  0,
  s.created_at
from widget_submissions s
where s.screenshot_storage_path is not null
on conflict (submission_id, storage_path) do nothing;

insert into widget_submission_assets
  (submission_id, kind, storage_path, content_type, position, created_at)
select
  s.id,
  'video',
  s.video_storage_path,
  case lower(regexp_replace(s.video_storage_path, '^.*\.', ''))
    when 'webm' then 'video/webm'
    when 'mp4' then 'video/mp4'
    else 'application/octet-stream'
  end,
  0,
  s.created_at
from widget_submissions s
where s.video_storage_path is not null
on conflict (submission_id, storage_path) do nothing;

insert into widget_submission_assets
  (submission_id, kind, storage_path, content_type, position, created_at)
select
  s.id,
  'replay',
  s.replay_storage_path,
  case lower(regexp_replace(s.replay_storage_path, '^.*\.', ''))
    when 'json' then 'application/json'
    else 'application/octet-stream'
  end,
  0,
  s.created_at
from widget_submissions s
where s.replay_storage_path is not null
on conflict (submission_id, storage_path) do nothing;
