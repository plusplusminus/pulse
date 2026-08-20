-- PULSE-321: private Supabase Storage bucket for widget media (screenshots,
-- video, session replays). Replaces the public `widget-screenshots` bucket.
--
-- Object layout: {hubId}/{screenshots|videos|replays}/{uuid}.{ext}
-- Access: service role only. The API mints short-lived signed upload URLs
-- (browser -> storage direct) and signed read URLs (via the Pulse media proxy,
-- GET /api/widget/media/:submissionId/:kind). Nothing is granted to anon or
-- authenticated. See docs/development/widget-media-storage.md.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'widget-media',
  'widget-media',
  false,
  104857600, -- 100 MB, the video cap
  array['image/png', 'image/jpeg', 'video/webm', 'video/mp4', 'application/json']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects has RLS on; with no permissive policy for this bucket the
-- anon and authenticated roles already get nothing. The restrictive policies
-- below make that explicit and survive any future broad policy someone adds
-- to storage.objects. The service role bypasses RLS and is unaffected.
drop policy if exists "widget_media_deny_select" on storage.objects;
create policy "widget_media_deny_select"
  on storage.objects as restrictive for select
  to anon, authenticated
  using (bucket_id <> 'widget-media');

drop policy if exists "widget_media_deny_insert" on storage.objects;
create policy "widget_media_deny_insert"
  on storage.objects as restrictive for insert
  to anon, authenticated
  with check (bucket_id <> 'widget-media');

drop policy if exists "widget_media_deny_update" on storage.objects;
create policy "widget_media_deny_update"
  on storage.objects as restrictive for update
  to anon, authenticated
  using (bucket_id <> 'widget-media')
  with check (bucket_id <> 'widget-media');

drop policy if exists "widget_media_deny_delete" on storage.objects;
create policy "widget_media_deny_delete"
  on storage.objects as restrictive for delete
  to anon, authenticated
  using (bucket_id <> 'widget-media');

-- Retire the public `widget-screenshots` bucket (its insert is removed from
-- 20260305_widget_tables.sql). Only drop it when empty: environments that
-- already hold screenshots keep them until they are purged by hand, so
-- existing widget_submissions.screenshot_url links do not break silently.
delete from storage.buckets
where id = 'widget-screenshots'
  and not exists (
    select 1 from storage.objects where bucket_id = 'widget-screenshots'
  );
