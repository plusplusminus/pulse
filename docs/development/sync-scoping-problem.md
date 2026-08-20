# Sync Scoping: How Should We Decide What To Sync?

## Current Behavior

When a user enables sync, the system automatically picks the **first team** returned by Linear's API (`teams.nodes[0]`) and scopes everything to it. The user has no input.

| Entity | Scope | Result |
|--------|-------|--------|
| Teams | All org teams | 74 teams (full org) |
| Initiatives | All org initiatives | 94 initiatives (full org) |
| Issues | Single team only | 49 issues (team[0]) |
| Projects | Accessible by single team | 3 projects (team[0]) |
| Comments | Per-issue (follows issues) | Only comments on team[0]'s issues |
| Webhook | Single team only | Only fires for team[0] events |

## Problems

1. **No team selection** — User can't choose which team to sync. First team returned by the API is arbitrary.

2. **Single team per user** — A user who works across multiple teams (e.g. Engineering + Design) only sees one team's issues and projects.

3. **Webhook is team-scoped** — The Linear webhook is registered with a single `teamId`, so changes in other teams never trigger events.

4. **Org-wide entities are disconnected** — We sync all 74 teams and 94 initiatives, but only 49 issues from one team. Initiatives reference projects across the org, but we only have 3 projects from one team. The data is inconsistent.

5. **No multi-tenant model** — If Pulse serves multiple organizations, each user gets one sync subscription. There's no concept of "sync these specific teams" or "sync the whole org."

## Questions To Answer

1. **Who is the sync for?** A single user's workspace? A team? An entire org? This determines the scoping model.

2. **Should users pick teams during setup?** A team picker (single or multi-select) during the "Enable Sync" flow would let users control what gets synced.

3. **One subscription per team, or one org-wide webhook?** Linear supports `allPublicTeams: true` on webhook creation, which fires for all teams. This is simpler but syncs everything. Alternatively, multiple team-scoped webhooks give granular control but add complexity.

4. **How do public views and roadmaps relate to sync scope?** A public view is tied to a project or team. If the user creates a public view for a project in Team B but only synced Team A, it would fall back to direct API calls. Should enabling a public view automatically expand the sync scope?

5. **What about the reconciliation cost?** Currently reconciliation does a full-refresh of all entities. With org-wide sync that could mean thousands of issues. Should reconciliation be incremental (fetch only recently updated) instead of full-refresh?

## Relevant Code

| File | What it does |
|------|-------------|
| `src/app/api/sync/subscribe/route.ts` | Picks `teams.nodes[0]`, creates webhook with that teamId |
| `src/lib/initial-sync.ts` | `runInitialSync(apiToken, userId, teamId)` — teamId param scopes issues + projects |
| `src/app/api/sync/reconcile/route.ts` | Reads `linear_team_id` from subscription, passes to fetch functions |
| `src/lib/supabase.ts` | `SyncSubscription.linear_team_id` — single team ID per subscription |
| `supabase/migrations/20260226_sync_tables.sql` | `sync_subscriptions` table has `linear_team_id text` (single value) |

## Options (High Level)

**A. Team picker (minimal change):** Add a team selection step to the subscribe flow. Still one team per subscription, but user chooses which one. Simplest change.

**B. Multi-team subscriptions:** Allow selecting multiple teams. Store as `linear_team_ids text[]`. Create one webhook per team or use `allPublicTeams`. Medium complexity.

**C. Org-wide sync:** Always sync everything the user's token has access to. Use `allPublicTeams: true` for the webhook. No team picker needed. Issues/projects fetched across all teams. Simplest UX but most data.

**D. Auto-expand based on usage:** Start with no sync. When a user creates a public view or roadmap for a project, automatically start syncing that project's team. Sync scope grows organically based on what features are actually used.
