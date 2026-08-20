# Linear Sync Architecture

## Overview

This document explains how Pulse syncs data from Linear and the rationale behind the architecture. It serves as a reference for all sync-related development.

## Problem: Why We Moved Away From Pull-On-Demand

The original architecture called Linear's GraphQL API on every page load:

```
Browser → API Route → Decrypt Token → Linear GraphQL → Transform → Response
```

This had three fatal flaws:

1. **Rate limits** — Every public page viewer burned the form owner's Linear API quota (~60 req/min). A roadmap with 50 concurrent viewers would exhaust the token instantly.

2. **No event awareness** — Planned features like email notifications require knowing *when* something changed. Without webhooks, the only option is polling for diffs — fragile, expensive, and laggy.

3. **No write confirmation loop** — When a client adds a label or comment from gratis, we need to confirm the write succeeded and update the UI. Without a feedback mechanism, the client is blind.

4. **Poor performance** — Every page visit showed a loading spinner while waiting for Linear's API to respond. No caching meant no instant loads.

## Solution: Webhook-Driven Sync With Local Cache

```
┌──────────────────────────────────────────────────────────────────┐
│                        LINEAR (Source of Truth)                   │
│                                                                  │
│  Issues, Comments, Projects, Initiatives, Teams                  │
└──────────┬───────────────────────────────────┬───────────────────┘
           │                                   ▲
           │ Webhook push                      │ GraphQL mutations
           │ (Issue, Comment, Project,         │ (writes only)
           │  Initiative events)               │
           ▼                                   │
┌──────────────────────────────────────────────────────────────────┐
│                     NEXT.JS API ROUTES                           │
│                                                                  │
│  /api/webhooks/linear     ← receives events, upserts to DB      │
│  /api/sync/subscribe      ← registers webhook with Linear       │
│  /api/sync/initial        ← backfills all entities               │
│  /api/sync/reconcile      ← catches missed webhooks + teams      │
│  /api/public-view/[slug]  ← reads from Supabase (not Linear)    │
│  /api/roadmap/[slug]      ← reads from Supabase (not Linear)    │
└──────────┬───────────────────────────────────┬───────────────────┘
           │                                   ▲
           │ Upsert/Query                      │ Query
           ▼                                   │
┌──────────────────────────────────────────────────────────────────┐
│                     SUPABASE (Read Cache)                         │
│                                                                  │
│  synced_issues        — cached Linear issues                     │
│  synced_comments      — cached Linear comments                   │
│  synced_teams         — cached Linear teams + sub-teams          │
│  synced_projects      — cached Linear projects                   │
│  synced_initiatives   — cached Linear initiatives                │
│  sync_subscriptions   — webhook registrations per user           │
│  notification_queue   — pending email notifications              │
│                                                                  │
│  (Existing tables unchanged: profiles, public_views, roadmaps,   │
│   roadmap_votes, roadmap_comments, customer_request_forms, etc.) │
└──────────────────────────────────────────────────────────────────┘
           ▲
           │ Fetch
           │
┌──────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client)                          │
│                                                                  │
│  Public views, roadmaps, forms                                   │
│  Admin pages (forms config, views config, profile)               │
└──────────────────────────────────────────────────────────────────┘
```

### Core Principle

**Supabase is the read layer. Linear is the write target.**

- All client reads come from Supabase — fast, no API quota burned
- All client writes go to Linear — it stays the source of truth
- Webhooks close the loop: Linear → Supabase, keeping the cache fresh
- Notifications are a side effect of webhook processing

## Hybrid Storage Pattern

All sync tables use the same storage strategy:

```
┌──────────────────────────────────────────────────────────┐
│  Indexed Columns         │  data JSONB                    │
│  (for SQL filtering)     │  (full payload, zero data loss)│
│                          │                                │
│  state_name = "Done"     │  { id, title, description,     │
│  priority = 2            │    state: { id, name, color,   │
│  team_id = "abc"         │            type },             │
│  project_id = "xyz"      │    assignee: { id, name },     │
│                          │    labels: [...],              │
│                          │    ... everything Linear sends }│
└──────────────────────────────────────────────────────────┘
```

**Why?** Linear sends rich objects (state has `id`, `name`, `color`, `type`) but SQL queries need flat columns. Storing the full payload in `data` means we never lose fields, and read functions reconstruct the full shape from JSONB.

## Entity Relationships

```
Organization
├── Teams (org-level, no webhooks)
│   ├── Sub-teams (via parent_team_id)
│   └── Members
├── Initiatives (org-level, has webhooks)
│   ├── Projects (many-to-many)
│   ├── Sub-initiatives
│   └── Owner
├── Projects (team-scoped for queries, span multiple teams)
│   ├── Issues
│   ├── Milestones
│   ├── Lead
│   └── Status + Health + Progress
└── Issues (team-scoped)
    ├── Comments
    ├── Labels
    ├── Assignee
    └── State + Priority
```

## Webhook Coverage

| Entity | Webhook Events | Sync Strategy |
|--------|---------------|---------------|
| Issue | create, update, remove | Webhook + initial sync + reconciliation |
| Comment | create, update, remove | Webhook + initial sync + reconciliation |
| Project | create, update, remove | Webhook + initial sync + reconciliation |
| Initiative | create, update, remove | Webhook + initial sync + reconciliation |
| Team | **None** | Initial sync + reconciliation only |

Teams have no webhook events in Linear's API. They change rarely (team renames, new sub-teams) so reconciliation is sufficient.

## Data Flow: Read Path

When a user visits a public view, roadmap, or admin page:

```
1. Browser requests /api/public-view/my-board
2. API route queries synced_issues WHERE project_id = X AND user_id = Y
3. Applies filters (status, labels, priority) as SQL WHERE clauses
4. Returns JSON (same shape as before — no frontend changes)
5. If no synced data exists, falls back to direct Linear API call
```

Latency: ~50ms (Supabase query) vs ~500-2000ms (Linear API).

## Data Flow: Webhook Processing

```
1. Linear sends POST /api/webhooks/linear
   Headers: { "linear-signature": "<HMAC-SHA256>" }
   Body: { "action": "update", "type": "Issue", "data": { ... } }

2. Webhook handler:
   a. Read raw body
   b. Compute HMAC-SHA256(body, webhook_secret)
   c. Compare with linear-signature header → reject if mismatch
   d. Look up sync_subscriptions by webhook metadata to find user_id
   e. Switch on event type:
      - Issue create/update → upsert synced_issues (indexed cols + full data JSONB)
      - Issue remove        → delete from synced_issues
      - Comment create/update/remove → same pattern for synced_comments
      - Project create/update/remove → same pattern for synced_projects
      - Initiative create/update/remove → same pattern for synced_initiatives
   f. Check notification rules → enqueue emails if applicable
   g. Return 200
```

## Data Flow: Initial Sync

When a user first enables sync:

```
1. User clicks "Enable Sync" on profile page
2. POST /api/sync/subscribe:
   a. Generate random webhook secret
   b. Call Linear webhookCreate mutation
      - resourceTypes: ["Issue", "Comment", "Project", "Initiative"]
   c. Store webhook_id + encrypted secret in sync_subscriptions
3. runInitialSync() fetches and upserts all entities:
   a. Teams (org-level, all viewer teams)
   b. Projects (team-scoped, with milestones/initiatives/teams)
   c. Initiatives (org-level, graceful failure if token lacks scope)
   d. Issues (team-scoped, with comments)
4. From this point, webhooks keep data fresh
```

## Data Flow: Reconciliation

Safety net for missed webhooks and the only sync mechanism for Teams:

```
1. Cron job runs every 5 minutes: GET /api/sync/reconcile
2. For each active sync_subscription:
   a. Fetch API token from profile
   b. Full-refresh teams (always — no webhooks for teams)
   c. Full-refresh projects (team-scoped)
   d. Full-refresh initiatives (org-level, graceful failure)
   e. Full-refresh issues (team-scoped)
   f. All use batchUpsert with hybrid storage (indexed cols + data JSONB)
3. This catches:
   - Missed webhooks
   - Team changes (renames, new sub-teams)
   - Issues/projects/initiatives created during downtime
```

## Database Tables

### synced_issues

Local cache of Linear issues. Hybrid storage: indexed columns for filtering + `data` JSONB for full payload.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| linear_id | text | Linear issue UUID |
| user_id | text | WorkOS user ID |
| identifier | text | Human-readable ID ("ENG-123") — indexed for display |
| team_id | text | Linear team UUID — indexed for filtering |
| project_id | text | Linear project UUID — indexed for filtering |
| state_name | text | Status name — indexed for filtering |
| priority | integer | Priority (0-4) — indexed for sorting |
| assignee_name | text | Assignee name — indexed for filtering |
| synced_at | timestamptz | When last synced |
| data | jsonb | **Full Linear payload** (state object, assignee object, labels array, etc.) |

**Unique constraint:** `(user_id, linear_id)`

### synced_comments

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| linear_id | text | Linear comment UUID |
| user_id | text | WorkOS user ID |
| issue_linear_id | text | Parent issue UUID — indexed for lookup |
| synced_at | timestamptz | When last synced |
| data | jsonb | **Full payload** (body, user object, timestamps) |

**Unique constraint:** `(user_id, linear_id)`

### synced_teams

Teams have no webhook events — synced via initial sync + reconciliation only.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| linear_id | text | Linear team UUID |
| user_id | text | WorkOS user ID |
| name | text | Team name — indexed, used for ordering |
| key | text | Team key ("ENG") |
| parent_team_id | text | Parent team UUID — indexed for hierarchy queries |
| synced_at | timestamptz | When last synced |
| data | jsonb | **Full payload** (displayName, description, icon, color, private, parent object, children array, members array) |

**Unique constraint:** `(user_id, linear_id)`

### synced_projects

Projects can span multiple teams — no single `team_id` column.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| linear_id | text | Linear project UUID |
| user_id | text | WorkOS user ID |
| name | text | Project name — indexed |
| status_name | text | Status name — indexed for filtering |
| lead_name | text | Lead name — indexed |
| priority | integer | Priority (0-4) — indexed |
| synced_at | timestamptz | When last synced |
| data | jsonb | **Full payload** (description, icon, color, url, progress, health, startDate, targetDate, status object, lead object, teams array, initiatives array, milestones array) |

**Unique constraint:** `(user_id, linear_id)`

### synced_initiatives

Initiatives are org-level (not team-scoped).

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| linear_id | text | Linear initiative UUID |
| user_id | text | WorkOS user ID |
| name | text | Initiative name — indexed |
| status | text | Status string ("Planned", "Active", "Completed") — indexed |
| owner_name | text | Owner name — indexed |
| synced_at | timestamptz | When last synced |
| data | jsonb | **Full payload** (description, icon, color, url, health, healthUpdatedAt, targetDate, owner object, projects array, subInitiatives array, parentInitiative object) |

**Unique constraint:** `(user_id, linear_id)`

### sync_subscriptions

Tracks webhook registrations per user.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | text | WorkOS user ID |
| linear_team_id | text | Linear team UUID |
| webhook_id | text | Linear webhook UUID |
| webhook_secret | text | Signing secret |
| events | text[] | Subscribed event types |
| is_active | boolean | Whether sync is enabled |

### notification_queue

Pending email notifications, populated by webhook handler.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | text | Who to notify |
| event_type | text | What happened |
| issue_linear_id | text | Which issue |
| payload | jsonb | Full event data |
| sent_at | timestamptz | When sent (null if pending) |

## Data Available in JSONB

### Issue `data` fields

`id`, `identifier`, `title`, `description`, `priority`, `priorityLabel`, `url`, `dueDate`, `state` (object: id, name, color, type), `assignee` (object: id, name), `labels` (array: id, name, color), `team` (object: id, name, key), `project` (object: id, name), `createdAt`, `updatedAt`

### Comment `data` fields

`id`, `body`, `user` (object: id, name), `issue` (object: id), `createdAt`, `updatedAt`

### Team `data` fields

`id`, `name`, `displayName`, `key`, `description`, `icon`, `color`, `private`, `parent` (object: id, name, key), `children` (array: id), `members` (array: id, name), `createdAt`, `updatedAt`

### Project `data` fields

`id`, `name`, `description`, `icon`, `color`, `url`, `priority`, `priorityLabel`, `progress` (float 0-1), `health`, `startDate`, `targetDate`, `status` (object: id, name, color, type), `lead` (object: id, name), `teams` (array: id, name, key), `initiatives` (array: id, name), `milestones` (array: id, name, targetDate), `createdAt`, `updatedAt`

### Initiative `data` fields

`id`, `name`, `description`, `icon`, `color`, `url`, `status` (string: Planned/Active/Completed), `health`, `healthUpdatedAt`, `targetDate`, `owner` (object: id, name), `projects` (array: id, name), `subInitiatives` (array: id, name), `parentInitiative` (object: id, name), `createdAt`, `updatedAt`

## Freshness Guarantees

| Scenario | Latency | Mechanism |
|----------|---------|-----------|
| Normal operation (Issues, Comments, Projects, Initiatives) | < 5 seconds | Webhook fires near-instantly |
| Teams | < 5 minutes | Reconciliation only (no webhooks) |
| Missed webhook | < 5 minutes | Reconciliation cron catches it |
| First sync | Seconds to minutes | Initial sync backfills all data |
| Linear API down | Stale but available | Supabase cache serves last known state |

## Fallback Behavior

If a user hasn't enabled sync (no sync_subscription), the app falls back to direct Linear API calls. This ensures:

- Existing users aren't broken
- New users can use the app before enabling sync
- Gradual migration — no big bang cutover

## Security

- **Webhook signatures**: Every incoming webhook is verified via HMAC-SHA256 with a per-user secret. Unverified payloads are rejected with 401.
- **Token encryption**: Linear API tokens are encrypted at rest using AES (`src/lib/encryption.ts`).
- **Webhook secrets**: Generated server-side as 32-byte random hex. Only used for HMAC verification.
- **No RLS**: All queries go through `supabaseAdmin` (service role), scoped by `user_id` in application code.

## Upgrading Existing Subscriptions

Linear webhook subscriptions are immutable — you can't add new event types to an existing webhook. Users who set up sync before Project/Initiative support was added need to disconnect and reconnect to pick up the new event types. The disconnect flow (`DELETE /api/sync/subscribe`) deletes the webhook from Linear and deactivates the subscription, then reconnecting creates a fresh webhook with all current event types.

## Implementation Status

| Spec | Title | Est | Status |
|------|-------|-----|--------|
| PPMLG-32 | Sync architecture documentation | 4h | Done |
| PPMLG-33 | Supabase sync tables migration | 4h | Done |
| PPMLG-34 | Webhook endpoint + verification | 8h | Done |
| PPMLG-35 | Subscription management UI/API | 8h | Done |
| PPMLG-36 | Initial sync job | 8h | Done |
| PPMLG-37 | Migrate public view API | 8h | Done |
| PPMLG-38 | Migrate roadmap API | 8h | Done |
| PPMLG-39 | Reconciliation job | 4h | Done |
| PPMLG-40 | Admin API migration | 4h | Done |
| PPMLG-44 | Entity sync tables migration | 4h | Done |
| PPMLG-45 | Teams sync: initial sync + read functions | 8h | Done |
| PPMLG-46 | Projects sync: webhook + initial sync + read | 8h | Done |
| PPMLG-47 | Initiatives sync: webhook + initial sync + read | 8h | Done |
| PPMLG-48 | Expand webhook subscription + reconciliation | 8h | Done |
| PPMLG-49 | Unit + integration tests for new entities | 8h | Done |
| PPMLG-50 | Sync architecture docs update | 4h | Done |

## Key Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260226_sync_tables_v2.sql` | Issues + Comments tables (hybrid storage) |
| `supabase/migrations/20260226_entity_sync_tables.sql` | Teams, Projects, Initiatives tables |
| `src/lib/webhook-handlers.ts` | Signature verification, event handlers for Issue/Comment/Project/Initiative |
| `src/lib/initial-sync.ts` | Paginated backfill from Linear GraphQL (all 5 entity types) |
| `src/lib/sync-read.ts` | Read helpers: mapping functions + query functions for all entity types |
| `src/lib/supabase.ts` | TypeScript types for all sync tables |
| `src/app/api/webhooks/linear/route.ts` | Webhook receiver endpoint |
| `src/app/api/sync/subscribe/route.ts` | POST/DELETE/GET subscription + sync status |
| `src/app/api/sync/initial/route.ts` | Manual re-sync trigger |
| `src/app/api/sync/reconcile/route.ts` | Cron + manual reconciliation (all entity types) |
| `src/lib/__tests__/*.test.ts` | 153 tests covering all mapping, reading, and round-trip scenarios |
