# Pulse production performance audit — 2026-08-20

Sources: Vercel runtime logs (project `pulse`, prod, last 7d), Supabase `pg_stat_statements` / `pg_stat_user_tables` / `EXPLAIN ANALYZE` on project `Pulse` (`tyfzcufaxkwwtokfpzww`, eu-west-1), code review of this repo by Claude + Codex (independent passes, reconciled here).

## TL;DR

The database is tiny — `synced_issues` 11k rows, whole DB 120 MB, PostgREST pool of 10. Nothing here is a data-volume problem. The site is falling over because of **request amplification and query shape**:

1. **Cycle-stats query fetches ~7k full JSONB blobs (~14 MB) per hub page render and aggregates in JS** — 1.9 s in isolation, 8 s+ under load → `57014 statement timeout` (the `authenticator` role has `statement_timeout=8s`) → 504 on `/hub/54-collective/542`.
2. **Vercel functions run in `iad1` (US‑East); Supabase is in `eu-west-1`**. Every PostgREST call pays ~80–100 ms RTT. A hub page does 20+ sequential calls; the webhook path 10+. That alone is 1–2 s of latency per page before any query work.
3. **Two 30‑second pollers per open tab (`unread-count`, `last-sync`) each run 5–7 DB round trips** (middleware + `withHubAuth` + the query). Observed ~150 req/min on those two routes. `client_hubs` by id: 545k calls; `ppm_admins`: 995k seq scans; `notification_events` count: 490k calls.
4. **Missing indexes** — including one that exists in the repo but was never applied to prod (migration drift).
5. **Webhook data loss**: `synced_comments` upsert fails with `23502` on partial payloads and the route still returns 200, so Linear never retries.

Fix order (highest payoff first): indexes (5 min) → move Vercel region to `dub1`/`lhr1` (5 min) → rewrite `fetchHubCycleStats` + `getUnreadCount` as SQL RPCs → cut polling cost → fix webhook partial-update handling → dedupe `getHubMappings`/auth lookups with `React.cache`.

---

## 1. What production is telling us

### Vercel logs (7d, errors)

| Count | Route | Error |
|---|---|---|
| 33 | `GET /hub/54-collective/542` | `fetchHubCycleStats error: 57014 canceling statement due to statement timeout` |
| 6 | `GET /hub/54-collective/542` | `504 Your function was stopped as it did not return an initial response within 25s` |
| 3 | `GET /hub/54-collective/542` | `fetchHubProjects error: 57014` |
| 15 | `GET /api/hub/:id/notifications/unread-count` | `getUnreadCount total error: { message: '' }` (PostgREST fetch failed / aborted) |
| ~30 | various (`last-sync`, `unread-count`, webhook, reconcile, cron) | `TypeError: fetch failed` / `SocketError: other side closed` / `ETIMEDOUT` to Supabase — socket/pool pressure |
| 33 | `POST /api/webhooks/linear` | `Failed to upsert synced_comment: 23502 null value in column issue_linear_id` |
| 9 | `last-sync`, webhook, reconcile, retry-pushes | `Resend API error: Unable to fetch data` / `429 rate_limit_exceeded` |

Traffic shape (4‑minute sample of 1000 prod log lines): `unread-count` 332, `last-sync` 305, `POST /api/webhooks/linear` 94. Everything else is noise.

### Supabase (`pg_stat_statements`, cumulative since 2026‑02‑25)

| Query (PostgREST-generated) | Calls | Mean | Max | Total |
|---|---:|---:|---:|---:|
| `UPSERT synced_issues` (webhook + sync) | 182k | 41 ms | 1.9 s | 7,406 s |
| `SELECT linear_id, updated_at FROM synced_issues WHERE user_id AND team_id` (`diffEntities`) | 96k | 59 ms | 1.6 s | 5,625 s |
| `SELECT state_name FROM synced_issues WHERE data->'state'->>'id' = $1` (`resolveStateName`) | 7.5k | **697 ms** | 6.2 s | 5,195 s |
| `SELECT id FROM notification_events WHERE hub_id` + `count:'exact'` (unread poll) | **491k** | 6 ms | 7.0 s | 3,068 s |
| `SELECT data FROM synced_issues WHERE user_id AND team_id=ANY AND data->'cycle' IS NOT NULL` (`fetchHubCycleStats`) | 10k | **199 ms** | **7.9 s** | 1,997 s |
| `SELECT data, team_id FROM synced_issues WHERE user_id AND team_id=ANY` (`fetchHubMetadata`) | 11k | 135 ms | 7.8 s | 1,490 s |
| `SELECT linear_id, data, … WHERE user_id AND project_id=ANY ORDER BY updated_at` (`fetchHubProjectIssues`) | 12k | 80 ms | 7.5 s | 952 s |
| `SELECT … FROM notification_reads JOIN notification_events` (unread poll) | 490k | 1 ms | 1.4 s | 397 s |
| `SELECT id, is_active FROM client_hubs WHERE id` (`withHubAuth`) | **546k** | 0.2 ms | 1.7 s | 102 s |
| `SELECT completed_at FROM sync_runs WHERE (hub_id IS NULL OR hub_id=$1) AND status … ORDER BY completed_at DESC` (last‑sync poll) | 37k | 9 ms | 4.7 s | 340 s |

Table stats: `notification_events` 63,799 seq scans / 156M tuples read; `synced_projects` 98,907 seq scans / 52M tuples; `sync_runs` 30,854 seq scans / 44M tuples; `ppm_admins` 995,475 seq scans; `workspace_settings` 116k seq scans; `hub_team_mappings` 48k seq scans.

Instance: PG 17.6, `max_connections=60`, `shared_buffers` 224 MB, `work_mem` 2 MB (→ `external merge Disk` sorts on 4k‑row issue lists), PostgREST pool 10. Role timeouts: `authenticator`/`authenticated` 8 s, `anon` 3 s. So anything the app does through `supabaseAdmin` dies at 8 s.

Data facts that matter: `user_id` has **1 distinct value** (`'workspace'`), so `idx_synced_issues_user_id` is useless; 22 teams; avg `synced_issues.data` 2.1 KB (max 29 KB), 23 MB total; 2,712 issues have `cycle: null` *in JSON* (which `.not("data->cycle","is",null)` does **not** exclude — SQL `IS NULL` ≠ JSON null); Linear state types are `completed` / `canceled` (one L).

---

## 2. Root causes, ranked by impact

### 2.1 `fetchHubCycleStats` — `src/lib/hub-read.ts:1520-1567` (critical; the 504s)

```ts
.from("synced_issues").select("data").eq("user_id", WORKSPACE_USER_ID).in("team_id", teamIds).not("data->cycle", "is", null)
```
then loops in JS to count per `cycle.id`, skipping overview-only projects, and counting `state.type in ("completed","cancelled")`.

- Pulls the **entire `data` JSONB for ~6.8k of 7k issues** for the hub's teams (the JSON-null filter removes nothing). PostgREST then `json_agg`s ~14 MB and ships it across the Atlantic.
- `cycleLinearIds` are known but **not pushed to SQL**.
- `EXPLAIN ANALYZE` today: seq scan, **1,905 ms** with everything cached. Projection-only variant (`data->'cycle'->>'id', data->'state'->>'type', data->'project'->>'id'`): **166 ms**. Aggregated in SQL: **172 ms** and returns 56 rows instead of 6,784.
- Latent bug: `"cancelled"` never matches Linear's `"canceled"` (1,219 issues), so completion % under-counts done work.

**Fix**: RPC that aggregates in SQL (below), filtered by `cycle_id = ANY(p_cycle_ids)`. Expect <20 ms once `idx_synced_issues_cycle_id` exists.

### 2.2 Vercel region `iad1` vs Supabase `eu-west-1` (critical; cheapest fix)

`vercel project` → `serverlessFunctionRegion: "iad1"`, `fluid: true`. Supabase → `eu-west-1`. Every `supabaseAdmin` call is a cross-Atlantic HTTPS round trip (~80–100 ms + TLS on cold sockets). A hub team page does ~20 sequential/partially-parallel calls (`resolveHubBySlug` ×3–4, `fetchHubTeams` ×3, `getHubMappings` ×8+, plus the data queries). The webhook handler does 8–12 calls per event. The 30 s pollers do 5–7 each.

**Fix**: Vercel project settings → Functions → region `dub1` (Dublin) (or `lhr1`). Users are in SA anyway; the latency that matters is function→DB. Also set `vercel.json` `"regions": ["dub1"]` so it's in code.

### 2.3 Polling amplification — `notification-bell.tsx:86-90`, `hub-topbar.tsx:58-62` (critical load)

Per open tab every 30 s: `GET unread-count` + `GET last-sync`. Each request runs:
- **middleware** (`src/middleware.ts` + `src/lib/edge-db.ts`): `ppm_admins` by user_id, then by email if miss, then `client_hubs` by slug — raw fetches, no cache.
- **`withHubAuth`** (`src/lib/hub-auth.ts:151-184`): `client_hubs` by id, `ppm_admins` by user_id (+ email), `hub_members` by user_id (+ email).
- then the actual query: `getUnreadCount` = `count:'exact'` over **all** hub events + fetch **all** the user's read rows for the hub and subtract in JS (`notification-read.ts:55-78`). `last-sync` = seq scan + sort on `sync_runs`.

That's why `client_hubs` by id is at 546k calls and `ppm_admins` at 995k seq scans. The DB work per call is small; the *count* of round trips is the problem, and each one competes for the 10-connection PostgREST pool with the heavy hub-page queries.

**Fixes** (in order of payoff): one RPC for unread count (anti-join, 4 ms in EXPLAIN vs 238 ms for the current join); merge both pollers into one `/api/hub/[hubId]/status` route with a single auth pass; poll every 60–120 s, pause on `document.hidden`, refetch on focus; `React.cache()`/short TTL cache for `client_hubs`, `ppm_admins`, `hub_members` lookups; render initial `lastSyncedAt` server-side.

### 2.4 Missing / un-applied indexes (high; 5-minute fix)

See `supabase/migrations/20260820_perf_indexes.sql`. Highlights:

| Index | Why | Evidence |
|---|---|---|
| `idx_synced_issues_state_id ((data->'state'->>'id'))` | **In repo (`20260602_synced_issues_state_id_index.sql`) but not in prod.** `resolveStateName` seq-scans JSONB on every state-change webhook. | 697 ms mean, 6.2 s max; `pg_indexes` has no such index; `schema_migrations` last entry is `20260324`. |
| `idx_synced_issues_user_team (user_id, team_id) INCLUDE (linear_id, updated_at)` | All hub reads filter on this pair; `diffEntities` becomes index-only. | 96k calls × 59 ms. |
| `idx_synced_issues_cycle_id ((data->'cycle'->>'id')) WHERE … IS NOT NULL` | Needed for cycle-scoped RPC / `fetchHubCycleIssues` once it filters by cycle in SQL (today it fetches all team issues and filters in JS at `hub-read.ts:863`). | 7,890 real cycle rows, 321 cycles. |
| `idx_synced_projects_user_updated (user_id, updated_at DESC)` | `fetchHubProjects` pattern. | 98,907 seq scans. |
| `idx_notification_reads_event (notification_event_id)` | Un-indexed FK used in the unread join ~490k times; FK cascades. | hash join 238 ms → anti-join 4 ms. |
| `idx_notification_email_queue_event / _hub` | Un-indexed FKs. | cron every 5 min. |
| `idx_sync_runs_completed (completed_at DESC) WHERE status='completed' AND completed_at IS NOT NULL` | last-sync poll: 0.69 ms seq+sort → 0.05 ms index. | 30,854 seq scans, 4.7 s max under contention. |

What **not** to index: `client_hubs`, `ppm_admins`, `workspace_settings`, `hub_team_mappings` — they already have PK/unique indexes; the planner chooses seq scans because the tables are 1–2 pages. The fix is fewer calls, not more indexes.

All hypothetical indexes above were validated with `EXPLAIN ANALYZE` inside a single rolled-back transaction against prod (created + dropped; `pg_indexes` confirmed 0 leftovers).

### 2.5 Full-JSONB reads + JS filtering elsewhere (high)

- `fetchHubMetadata` (`hub-read.ts:1612`) — `select("data, team_id")` for every team issue to derive distinct states/labels/cycles. 135 ms mean, 7.8 s max.
- `fetchHubCycleIssues` (`hub-read.ts:834-888`) — fetches **all** team issues ordered by `updated_at` (4 MB external-disk sort at 2 MB `work_mem`), then keeps one cycle in JS.
- `fetchHubProjects` (`hub-read.ts:1147-1209`) — when `auto_include_projects` is on, `mergeProjectVisibility` returns `null` → **no `linear_id` filter at all**, all workspace projects with full `data`, team filter in JS at line 1195. Then `deriveClientFacingHealth` pulls every `synced_project_updates.data` for those projects and regex-filters in JS.
- `getUnreadCount`, `markAllAsRead` — materialise all ids and diff in JS.

Pattern fix: select JSON paths, not `data`; push the predicate to SQL; aggregate server-side (RPC or generated columns `cycle_id`, `state_type` on `synced_issues`).

### 2.6 Duplicate reads per render (high)

`getHubMappings` (`hub-read.ts:409`) is called by 17 helpers with no memoisation; the team page calls 8 of them → **8+ identical `hub_team_mappings` queries per render** (48k seq scans). `resolveHubBySlug` runs 3–4× per request (slug metadata, portal layout, team metadata, page). `fetchHubTeams` 3×. Wrap these in `React.cache()`; optionally `unstable_cache` with a tag invalidated by the admin settings route.

### 2.7 Webhook correctness → silent data loss (high, correctness)

`webhook-handlers.ts:153-178` builds the `synced_comments` row; `issue_linear_id` is set only if `comment.issue?.id` exists; partial `update` payloads omit it; column is `NOT NULL` (`20260226_sync_tables_v2.sql:41`). `upsert` validates NOT NULL on the proposed INSERT before conflict resolution → `23502`. Route catches and returns **200** (`webhooks/linear/route.ts:198-232`), so Linear does not retry. Same shape risk for `synced_issues.identifier`, `synced_projects.name`, and successful upserts **overwrite full `data` with the partial payload**.

Fix: for `update` actions, `UPDATE … SET data = data || :partial` (or merge in code after a select), never INSERT a partial; if the row doesn't exist, fetch the full entity from Linear or return 5xx so Linear retries.

### 2.8 Sync paths (medium-high load)

- `diffEntities` (`initial-sync.ts:808-834`) reads every local `(linear_id, updated_at)` per table per team per reconcile (30 min cron) — and for `synced_projects` (no `team_id`) **the whole table once per team**. Hoist it out of the team loop.
- Comments are fetched + upserted **per issue** (`initial-sync.ts:1414-1434`, `reconcile/route.ts:405-419`) — N+1 against both Linear and Supabase.
- Topbar "refresh" runs a **full** `runHubSync()` inside a request (`hub-topbar.tsx:67` → `api/admin/hubs/[hubId]/sync/route.ts:59`). Should enqueue and return 202, or route through the diff path.
- `batchUpsert` rewrites rows whose `updatedAt` didn't change; 182k issue upserts at 41 ms each.

### 2.9 Socket pressure (medium)

`supabaseAdmin` is a module singleton (fine). Pressure comes from: unbounded `Promise.all` over recipients in `notification-delivery.ts:298` and 50-wide email retry in `:376`; per-hub concurrent checks in `notification-events.ts:692`; fire-and-forget `void` work inside webhook handling; `await flushPostHog()` on every webhook (`route.ts:226`); and the 30 s pollers. Bound concurrency (5–10), batch the preference lookup into one `IN` query, drop the per-request PostHog flush (use `after()` or let the client batch).

---

## 3. Proposed SQL (beyond the index migration)

```sql
-- Cycle stats: replaces fetchHubCycleStats' 14 MB fetch with ~56 rows.
create or replace function public.get_cycle_stats(
  p_user_id text, p_team_ids text[], p_cycle_ids text[], p_excluded_project_ids text[] default '{}'
) returns table (cycle_id text, total bigint, completed bigint)
language sql stable set search_path = public as $$
  select data->'cycle'->>'id',
         count(*),
         count(*) filter (where data->'state'->>'type' in ('completed','canceled'))
  from synced_issues
  where user_id = p_user_id
    and team_id = any(p_team_ids)
    and (data->'cycle'->>'id') = any(p_cycle_ids)
    and (project_id is null or not project_id = any(p_excluded_project_ids))
  group by 1
$$;

-- Unread count: one anti-join instead of count(*) + full read list + JS subtraction.
create or replace function public.notification_unread_count(p_user_id text, p_hub_id uuid)
returns bigint language sql stable set search_path = public as $$
  select count(*) from notification_events e
  where e.hub_id = p_hub_id
    and not exists (select 1 from notification_reads r
                    where r.notification_event_id = e.id and r.user_id = p_user_id)
$$;
```
(`revoke all … from public, anon, authenticated; grant execute … to service_role;` for both.)

Longer term: stop treating `data` as the schema. Add generated columns on `synced_issues` — `cycle_id text generated always as (data->'cycle'->>'id') stored`, `state_type text generated always as (data->'state'->>'type') stored` — index them, and a `synced_states` table so `resolveStateName` isn't a JSONB scan over issues.

---

## 4. Things checked and ruled out

- RLS: none on the hot tables; everything goes through `service_role`. Not a factor.
- Connection count: 21/60 used, PostgREST 10 idle — no saturation at sample time; the `fetch failed` errors are burst-time socket/pool contention, not a steady leak.
- Autovacuum: current on hot tables; dead tuples modest (issues 1.8k, comments 2.4k).
- Lock waits: none observed.
- Migration state: prod has all 2026‑06‑02 tables/indexes **except** `idx_synced_issues_state_id`. `supabase_migrations.schema_migrations` stops at `20260324` — later migrations were applied by hand; treat the tracking table as unreliable.

## 5. Applied on 2026-08-20 (same day as the audit)

| Change | Where | Status |
|---|---|---|
| 12 indexes | `supabase/migrations/20260820_perf_indexes.sql` | **Applied to prod** via Management API; all 12 confirmed in `pg_indexes` |
| `get_cycle_stats` + `notification_unread_count` RPCs | `supabase/migrations/20260820_perf_rpcs.sql` | **Applied to prod**; output cross-checked against manual aggregation |
| Vercel function region `iad1` → `dub1` | project setting (API) + `vercel.json` `"regions": ["dub1"]` | **Project setting changed**; takes effect on the next production deployment |
| `fetchHubCycleStats` → RPC; `getHubMappings` memoised with `React.cache`; `canceled` spelling | `src/lib/hub-read.ts` | code, this branch |
| `getUnreadCount` → RPC | `src/lib/notification-read.ts` | code, this branch |
| `resolveHubBySlug`, hub lookup, `isPPMAdmin`, `getHubMembership` memoised per request | `src/lib/hub-auth.ts` | code, this branch |
| One polled `/api/hub/[hubId]/status` (unread + last sync), 60 s, paused when hidden, refetch on focus | `src/app/api/hub/[hubId]/status/route.ts`, `src/hooks/use-hub-status.ts`, `hub-topbar.tsx`, `notification-bell.tsx`, `src/lib/sync-status.ts` | code, this branch (old routes kept) |

Not yet done (next tier, see §2.5–2.9): webhook partial-update merge + non-200 on failure, `fetchHubMetadata` / `fetchHubCycleIssues` / `fetchHubProjects` SQL-side filtering, sync loop hoisting + comment batching, bounded fan-out in notification delivery.

## 6. Suggested sequencing (original)

| Step | Effort | Expected effect |
|---|---|---|
| Apply `20260820_perf_indexes.sql` | 5 min | `resolveStateName` 700 ms → <1 ms; last-sync, unread join, project reads drop to sub-ms; diffEntities index-only |
| Move Vercel functions to `dub1` | 5 min | −80–100 ms per DB call; hub page −1–2 s; webhook −0.5–1 s |
| `get_cycle_stats` RPC + call it from `fetchHubCycleStats` | 1–2 h | removes the 57014/504 on hub pages |
| `notification_unread_count` RPC; merge pollers; 60–120 s + visibility-aware | 2–3 h | ~−80 % of DB round trips |
| `React.cache()` on `getHubMappings` / `resolveHubBySlug` / `fetchHubTeams` / auth lookups | 1 h | −10–15 queries per hub render |
| Webhook partial-update merge + non-200 on failure | 2 h | stops comment data loss |
| Project/metadata/cycle-issue reads → SQL-side filtering, generated columns | 1–2 d | removes remaining multi-MB fetches |
| Sync: hoist project diff, batch comments, queue manual sync | 1 d | reconcile + refresh stop starving the pool |
