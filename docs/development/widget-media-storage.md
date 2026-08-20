# Widget media storage

Where feedback-widget artefacts (screenshots, video, session replays) live and
how they move. Decision log: PULSE-312 (2026-08-20) — Supabase Storage private
bucket, signed direct uploads, Pulse media proxy into Linear. The earlier GCS
attempt is retired.

## Bucket

| | |
|---|---|
| Bucket | `widget-media` (private) — `supabase/migrations/20260820_widget_media_bucket.sql` |
| Object key | `{hubId}/{screenshots|videos|replays}/{uuid}.{ext}` |
| MIME allowlist | `image/png`, `image/jpeg`, `video/webm`, `video/mp4`, `application/json` |
| Bucket size limit | 100 MB per object (Supabase `file_size_limit`) |
| Per-kind caps (API) | screenshot 10 MB, video 100 MB, replay 20 MB — enforced in `POST /api/widget/upload` before a URL is minted |
| Access | service role only. Restrictive RLS policies deny `anon`/`authenticated` on `storage.objects` for this bucket |

The per-hub prefix is part of the path pattern (`src/lib/widget-upload.ts`),
so a leaked signed URL can only ever read or write inside its own hub folder.

## Flow

1. Widget asks `POST /api/widget/upload` `{ kind, contentType, sizeBytes }` with
   `X-Widget-Key`. The route validates key + origin, rate-limits, checks the
   per-kind cap, and returns `{ uploadUrl, token, storagePath, expiresAt }`
   (signed via `createSignedUploadUrl`; we treat it as valid for 5 minutes
   even though Supabase's own token lasts 2 h).
2. Widget uploads the bytes straight to Supabase: a single `PUT` to `uploadUrl`
   up to 6 MB, TUS (`tus-js-client`, `x-signature: token`, 6 MB chunks) above.
   The Pulse API is never in the blob path (Vercel body limits).
3. Widget submits `POST /api/widget/feedback` with `screenshotStoragePath`
   (later `videoStoragePath`, `replayStoragePath`). The route checks the
   path's hub segment equals the site's hub and stores it on
   `widget_submissions`.
4. Readers go through the proxy: `GET /api/widget/media/:submissionId/:kind`
   (admin or member of that hub) -> `302` to a 10-minute signed read URL;
   `404` unknown / not yours; `410` once retention has purged the object.
   The Linear issue body embeds that proxy URL (image markdown for
   screenshots, plain link for video/replay). Linear's image proxy has no
   Pulse session, so viewers without Pulse access see a link-to-login —
   accepted trade-off.

## Retention (PULSE-317 / 340 / 341)

Media is the bulk of storage cost, so objects are not kept forever:

- A cron deletes objects older than the retention window via
  `deleteWidgetObjects(paths)` from `src/lib/widget-upload.ts`, then nulls the
  `*_storage_path` column on the submission and stamps `media_purged_at`.
- The proxy returns `410 Gone` for a purged path; the submission row and the
  Linear issue stay, only the media goes.
- There is exactly one copy of every artefact (no Linear `fileUpload`
  mirror), so purging the bucket is the whole job.

## Migrating off `widget-screenshots`

The old public bucket is no longer written to. The migration only deletes it
when it is empty; an environment that still holds screenshots keeps them
(and their `screenshot_url` links keep working) until someone purges the
bucket by hand and re-runs the migration.
