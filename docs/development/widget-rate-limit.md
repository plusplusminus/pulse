# Widget rate limiting (PULSE-313)

Public widget routes are rate-limited with a distributed sliding window on
Upstash Redis (`@upstash/ratelimit` over `@upstash/redis` REST). Production is
Vercel, so per-isolate `Map` limiters were not durable or shared across
instances; Upstash is reachable from both Node and edge runtimes.

## Module

`src/lib/widget-rate-limit.ts` — public surface:

| Export | Purpose |
| --- | --- |
| `checkRateLimit({ key, limit, windowMs, onError? }, deps?)` | `{ allowed, remaining, retryAfterMs, unverified? }`. `onError` is the backend-failure policy (`"allow"`, the default, or `"deny"`). `deps.limiter` is an injected `Ratelimit`-like instance (tests use an in-memory fake + fake clock); omitted in routes. |
| `siteKey(prefix)` | `widget:{siteKeyPrefix}` |
| `reporterKey(prefix, reporterIdOrIp)` | `widget:{siteKeyPrefix}:{reporterId \| ip}` |
| `bootstrapKey(ip)` | `widget:bootstrap:{ip}` |

Redis keys carry the library prefix `pulse:` in front of the identifiers above.
One `Ratelimit` instance is cached per `(limit, windowMs)` budget with
`ephemeralCache` enabled, so a hot instance blocks repeat offenders without a
round-trip.

## Budgets

| Route | Key | Limit |
| --- | --- | --- |
| `POST /api/widget/feedback` | `siteKey(api_key_prefix)` | 60 / min |
| `POST /api/widget/feedback` | `reporterKey(api_key_prefix, reporter.email)` (schema requires an email, so always identified) | 10 / min |
| `POST /api/widget/upload` | `siteKey(api_key_prefix)` | 60 / min |
| `POST /api/widget/upload` | `reporterKey(api_key_prefix, ip)` | 10 / min |
| `GET /api/widget/v1/bootstrap/:siteKey` | `bootstrapKey(ip)` | 60 / min |

Either check denying yields `429` with `Retry-After` (seconds, rounded up,
minimum 1) derived from the limiter's `reset` timestamp — except a fail-closed
denial on `/api/widget/upload`, which is a `503` (see below). The client IP is the
first hop of `x-forwarded-for` (Vercel), falling back to `x-real-ip`, then
`"unknown"` (`readClientIp` in `src/lib/widget-origin.ts`). Feedback/upload
check the site budget right after auth and the reporter/IP budget next, so a
429 there carries the matched origin's CORS headers. Bootstrap checks before
the site lookup (the database never sees a flood), so its 429 has no CORS
headers — the widget sees a failed fetch, which is the intended outcome.

Reporter emails appear lower-cased in Redis keys for the length of the window
(60 s). Acceptable for an internal tool; hash them if that changes.

## Backend failure

The backend is treated as unavailable when:

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are not set,
- the backend throws, or
- the backend takes longer than 500 ms.

What happens next is the caller's `onError` policy.

### Fail-open (default): `/feedback`, bootstrap

Availability beats strictness for an internal tool: `checkRateLimit` returns
`allowed: true` and the request proceeds unmetered. A reporter can still file
feedback while Upstash hiccups, and every accepted submission is a row that
retention and the admin UI can see.

### Fail-closed (`onError: "deny"`): `/upload`

`POST /api/widget/upload` mints signed storage tickets. An object is only ever
discovered through a non-null path column on a `widget_submissions` row, so
bytes uploaded against a ticket that is never attached are referenced by
nothing and `widget-retention-run.ts` never sees them. With the limiter open,
one public site key sustains roughly 60 x 100 MB per minute of permanently
unpurgeable storage — and the limiter opens precisely when Upstash is under the
flood it exists to stop. So both upload budgets pass `onError: "deny"`.

The verdict comes back `allowed: false, unverified: true` and the route answers
`503` with `Retry-After: 5` and `{ "error": "rate_limit_unavailable" }` — "we
cannot check your budget right now", which is ours, not the caller's `429`.
CORS headers are still granted so the page can read the failure.

### Warnings

Each failure emits one Sentry warning (`level: warning`,
`tags.area = widget-rate-limit`, `tags.policy` = `allow` \| `deny`,
`extra.keyPrefix`, `extra.reason`, `extra.outcome`) plus a `console.warn`,
throttled to one per minute per key prefix (`widget:{site}` or
`widget:bootstrap`) **per policy** — a fail-open on `/feedback` must not
swallow the fail-closed warning `/upload` raises for the same site in the same
minute, because only the latter rejected a caller. A sustained stream of
`failing open` means the limiter is effectively off; a stream of
`failing closed` means uploads are being refused. Both are incidents, not
noise.

## Provisioning (HITL, PULSE-325)

- Database: Upstash Redis, regional, same region as the Vercel project's
  function region. Region and plan: _to be filled in when provisioned_.
- Env vars in Vercel (production + preview) and `.env.local` for dev; see
  `.env.example`.
- `wrangler.jsonc` is untouched (no KV binding).
