---
id: pulse-project
domain: global
version: 1
updated: 2026-08-20
applies_to: ["src/**/*", "supabase/**/*", "packages/**/*"]
---

# Pulse — Project Conventions

Overrides the house core where they disagree (backend.md is NestJS/Drizzle, frontend.md is TanStack — neither applies here). Every rule below cites the file that shows it.

## Stack & runtime constraints
- Next.js ~15.5 App Router + React 19, TS `strict`, `@/*` -> `src/*` (`tsconfig.json`). Tailwind v4 via PostCSS, shadcn `new-york` (`components.json`). Package manager: pnpm (`pnpm-lock.yaml`).
- Production target is OpenNext on Cloudflare Workers: `wrangler.jsonc` (`main: .open-next/worker.js`, `compatibility_flags: ["nodejs_compat"]`, `compatibility_date: 2025-09-17`), `open-next.config.ts`, `pnpm build:worker` / `pnpm preview` / `pnpm deploy` (`package.json`). Dev uses `initOpenNextCloudflareForDev()` (`next.config.ts`).
- No route-level runtime flags anywhere (`export const runtime|dynamic|maxDuration` — 0 hits in `src/app`). Do not add `runtime = "edge"`; the whole app is one Worker.
- Node built-ins are stubbed server-side in `next.config.ts` (`crypto`, `fs`, `net`, ...). Prefer Web Crypto (`crypto.subtle`, `crypto.getRandomValues` in `src/lib/widget-auth.ts`); `node:crypto` HMAC is only used in `src/lib/webhook-handlers.ts` under nodejs_compat. `Buffer` appears in 3 files — keep it that way.
- `src/middleware.ts` runs on edge: it must use the fetch-based REST helpers in `src/lib/edge-db.ts` (no supabase-js, no writes — see the `lookupPPMAdmin` comment).
- In-memory state is per-isolate and non-durable: widget rate limiter `Map` (`src/app/api/widget/feedback/route.ts`), OAuth `tokenCache` (`src/lib/linear-oauth.ts`). `LinearRateLimiter` is "per sync run — not a global singleton" (`src/lib/linear-rate-limiter.ts`).
- Scheduled jobs are declared in `vercel.json` (`/api/sync/reconcile`, `/api/cron/*`); `wrangler.jsonc` has no cron triggers and `src/middleware.ts` checks `VERCEL_ENV`. Treat cron wiring as deploy-target-specific; confirm before adding a new schedule.
- Observability: Sentry via `@sentry/nextjs` (`src/instrumentation.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation-client.ts`, `tunnelRoute: "/monitoring"` in `next.config.ts`). Cron routes wrap work in `Sentry.captureCheckIn` and tag exceptions `{ tags: { area } }` (`src/app/api/cron/send-digests/route.ts`). PostHog server events go through `captureServerEvent` + `flushPostHog` (`src/lib/posthog-server.ts`) using names from the `noun_verb` catalog in `src/lib/posthog-events.ts`.
- `.cfignore` excludes `src/app/api/og/` and `scripts/` from the Worker bundle; `tsconfig.json` excludes `scripts/**`.

## Route handler conventions (`src/app/api/**/route.ts`, 92 routes)
- Auth guards, pick one per route family:
  - `/api/admin/**` -> `withAdminAuth()` (`src/lib/admin-auth.ts`, 39 routes).
  - `/api/hub/**`, `/api/hubs/**`, widget config -> `withHubAuth(hubId)` / `withHubAuthWrite(hubId)` (rejects `view_only`) (`src/lib/hub-auth.ts`, 34 routes). PPM admins get synthetic role `"admin"`.
  - `/api/widget/feedback` -> `validateWidgetRequest(request)` (`X-Widget-Key` SHA-256 hash + `allowed_origins`) in `src/lib/widget-auth.ts`, plus CORS `OPTIONS` handler.
  - `/api/cron/**`, `/api/sync/reconcile` -> `Authorization: Bearer ${CRON_SECRET}` compare (`src/app/api/cron/send-digests/route.ts`).
  - `/api/webhooks/linear` -> `verifyWebhookSignature` with secret from `workspace_settings.linear_webhook_secret` (`src/app/api/webhooks/linear/route.ts`).
- Guards return a discriminated result; the idiom is `const auth = await withX(); if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });` (`src/lib/admin-auth.ts` docblock).
- Params are `Promise<{...}>` and awaited (`{ params }: { params: Promise<{ hubId: string }> }`, 50 routes).
- Response shape: errors are `NextResponse.json({ error: string }, { status })` (154 occurrences); machine-readable codes add `message` (`error: "linear_not_connected"` in `src/app/api/hub/[hubId]/issues/route.ts`); validation failures may add `details: parsed.error.flatten()`. Success bodies are plain JSON objects, no envelope.
- Body validation: untrusted public input is a zod schema + `safeParse` (`src/app/api/widget/feedback/route.ts`, the only zod route). Authenticated routes cast `await request.json() as {...}` and check fields explicitly (`src/app/api/admin/hubs/route.ts`). Use zod for any new unauthenticated surface.
- Whole handler in `try/catch`; log `console.error("POST /api/admin/hubs ...", error)` with the method+path prefix; return 500 with a generic `error`.
- Rate limiting: outbound Linear budget via `LinearRateLimiter` passed through push helpers, which throw `RateLimitDeferredError` to be logged as "deferred" (`src/lib/linear-push.ts`); inbound public endpoints use a sliding-window `Map` keyed by `api_key_prefix`, 10/min -> 429 (`src/app/api/widget/feedback/route.ts`).
- Tenant scoping: every synced_* read filters `user_id = WORKSPACE_USER_ID ("workspace")` and the hub's team mappings via `src/lib/hub-read.ts`; user-supplied label IDs are intersected with `getHubVisibleLabelIds` before writing. `__tests__/tenant-isolation/query-audit.test.ts` statically enforces this — keep new readers in `hub-read.ts`.
- Server pages guard themselves too: `withAuth()` from `@workos-inc/authkit-nextjs` + `isPPMAdmin` / `getHubMembership` + `redirect()` (`src/app/admin/layout.tsx`, `src/app/hub/[slug]/(portal)/layout.tsx`); `src/middleware.ts` is the first line, not the only one.

## Supabase conventions
- Server code uses `supabaseAdmin` (service role) from `src/lib/supabase.ts`; the browser client `supabase` exists but app data is read via API routes. RLS is effectively off for hub tables ("RLS is off, queries filter by user_id" — `src/lib/supabase.ts`; policies exist only in legacy `001`–`010` migrations). Authorization lives in guards + `hub-read.ts`, never in RLS.
- Row types are hand-maintained in `src/lib/supabase.ts` (no generated DB types) — add the type next to the table's migration.
- Migrations: `supabase/migrations/YYYYMMDD_snake_case.sql` (legacy `NNN_` prefix retired after `010`). Start with a comment citing the Linear ticket, make DDL idempotent (`add column if not exists`, `drop constraint if exists` then add — `20260602_watch_mode.sql`). No `supabase/config.toml`; files are plain SQL.
- Secrets at rest (Linear tokens, OAuth creds) go through `encryptToken`/`decryptToken` (AES via crypto-js, `ENCRYPTION_KEY`) in `src/lib/encryption.ts` and the `workspace_settings` key/value store (`src/lib/workspace.ts`).
- Storage: public buckets `comment-attachments`, `form-attachments`; MIME allowlist and 10 MB image / 25 MB other limits are centralised in `src/lib/hub-upload.ts` — reuse it for any upload route.

## Linear usage conventions
- `@linear/sdk` is a declared dependency but unused (0 imports). All calls are raw `fetch` to `https://api.linear.app/graphql` with `Authorization: linearAuthHeader(token)` (`src/lib/linear-auth.ts`: `lin_api_` keys get no `Bearer`, OAuth tokens do). Never hand-build the header (PULSE-367).
- Write-token resolution is `resolveWriteToken` in `src/lib/linear-push.ts`: admin personal OAuth token (`src/lib/admin-linear-oauth.ts`) > workspace OAuth app token with `createAsUser` attribution (`getWriteToken`, `src/lib/linear-oauth.ts`) > workspace personal token (`getWorkspaceToken`, `src/lib/workspace.ts`).
- Issue creation lives in `createIssueInLinear` (`src/lib/linear-push.ts`); callers are `src/app/api/hub/[hubId]/issues/route.ts`, `processFormSubmission` (`src/lib/form-submit.ts`) and `createWidgetLinearIssue` (`src/lib/widget-linear.ts`). Comments: `pushCommentToLinear`. `/api/linear/create-issue` (token in body) is the legacy public-form path — don't extend it.
- Reads come from the synced cache (`src/lib/hub-read.ts`), fed by `/api/webhooks/linear` + `/api/sync/reconcile`; rationale in `docs/development/sync-architecture.md`. Don't call Linear on page load.

## UI conventions
- Primitives in `src/components/ui/*` (shadcn new-york: `cva` + `cn()` from `src/lib/utils.ts`, `data-slot` attrs — `button.tsx`); domain components in `src/components/admin/**` and `src/components/hub/**`; contexts in `src/contexts/`; hooks in `src/hooks/`.
- Design tokens in `src/app/globals.css` are "Linear's exact" colours (`--primary: #5e6ad2`, `--radius: 0.375rem`, `.dark` variant). Use semantic classes (`bg-background`, `text-muted-foreground`, `border-border`), never hex. `CLAUDE.md`: new components must look just like Linear.app.
- Client data fetching is `useFetch` (`src/hooks/use-fetch.ts`, 13 users) or direct `fetch` to `/api/**`; no TanStack Query, no Zustand. Toasts via `sonner` (16 files). Icons `lucide-react`. `react-hook-form` exists only inside `src/components/ui/form.tsx`.
- Server layouts fetch + guard and pass data into client shells (`HubProvider`/`HubShell` in `src/app/hub/[slug]/(portal)/layout.tsx`). Emails are react-email components in `src/emails/`.

## Testing conventions
- Vitest 4, `vitest.config.ts`: `environment: node`, `globals: true`, `@` alias, `.env.local` loaded for integration tests, `esbuild.jsx: automatic`. No `test` script in `package.json` — run `pnpm vitest run [path]`.
- Locations: `src/lib/__tests__/*.test.ts` (pure helpers), `src/emails/**/__tests__/`, `__tests__/tenant-isolation/*.test.ts` (cross-hub isolation; fixtures in `test-helpers.ts`). Mock modules with relative `vi.mock("../supabase")` / `vi.mock("../workspace")` (`src/lib/__tests__/hub-workflows.test.ts`). Source-level audit tests are a sanctioned pattern (`query-audit.test.ts`).
- No testing-library / jsdom; no component tests; no CI workflow (`.github/` has only `ISSUE_TEMPLATE`). Gates are `pnpm build`, `pnpm lint`, `pnpm vitest run`.

## Env / config conventions
- `.env.example` is canonical: Supabase (URL, anon, service role), `ENCRYPTION_KEY`, `WORKOS_ENABLE_PKCE=false` (rationale in the file — keep off), `NEXT_PUBLIC_APP_URL`, Resend, `CRON_SECRET`, PostHog, Sentry. `ENCRYPTION_KEY` is asserted at module load server-side (`src/lib/encryption.ts`).
- `NEXT_PUBLIC_SUPABASE_*` are also pinned in `wrangler.jsonc` `vars`; secrets go in Worker secrets, never `vars`. `env.d.ts` is generated by `pnpm cf-typegen`.
- One-off scripts: `scripts/*.ts|mjs`, run as `node --env-file=.env.local --import tsx scripts/x.ts`, dry-run by default with `--apply` (`scripts/backfill-issue-emojis.ts`).

## Widget package (`packages/feedback-widget`)
- `@pulse/feedback-widget`, a pnpm workspace package (root `pnpm-workspace.yaml` -> `packages/*`, single root lockfile; never add a nested lockfile or workspace file). Root scripts: `pnpm widget:build | widget:dev | widget:typecheck | widget:test`. Root `tsconfig.json` excludes `packages/**`; the package has its own `tsconfig.json` and `vitest.config.ts` (root vitest excludes `packages/**`). `.cfignore` excludes `packages/` from the Worker bundle.
- Vanilla TS, no framework. Build with `tsup.config.ts`, three entries: `src/entries/embed.ts` -> `dist/embed.global.js` (IIFE, `globalName: "Pulse"`, script-tag install), `src/entries/sdk.ts` -> `dist/sdk.mjs` + `sdk.d.mts` (ESM, npm consumers), `src/loader.ts` -> `dist/pulse-loader.global.js` (tiny es2015 iife gated on `pulse_enabled=1` cookie). No CJS output. `__PULSE_API_URL__` is injected by tsup `define` (env `PULSE_API_URL`, default prod origin).
- Public API is `Pulse.init(config)` returning `PulseInstance` (`src/index.ts`); UI under `src/ui/*.ts` with styles in `src/ui/styles.ts`; screenshots via `html-to-image` (`src/screenshot.ts`).
- Transport: `POST ${apiUrl}/api/widget/feedback` (`src/api.ts`). The payload type in `packages/feedback-widget/src/types.ts` must stay in lockstep with `src/lib/widget-types.ts` and the zod schema in `src/app/api/widget/feedback/route.ts`.
