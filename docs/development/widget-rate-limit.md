# Widget rate limiting (PULSE-313)

Public widget routes are rate-limited with a distributed sliding window on
Upstash Redis (`@upstash/ratelimit` over `@upstash/redis` REST). Production is
Vercel, so per-isolate `Map` limiters were not durable or shared across
instances; Upstash is reachable from both Node and edge runtimes.

## Module

`src/lib/widget-rate-limit.ts` — public surface:

| Export | Purpose |
| --- | --- |
| `checkRateLimit({ key, limit, windowMs }, deps?)` | `{ allowed, remaining, retryAfterMs }`. `deps.limiter` is an injected `Ratelimit`-like instance (tests use an in-memory fake + fake clock); omitted in routes. |
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
minimum 1) derived from the limiter's `reset` timestamp. The client IP is the
first hop of `x-forwarded-for` (Vercel), falling back to `x-real-ip`, then
`"unknown"` (`readClientIp` in `src/lib/widget-origin.ts`). Feedback/upload
check the site budget right after auth and the reporter/IP budget next, so a
429 there carries the matched origin's CORS headers. Bootstrap checks before
the site lookup (the database never sees a flood), so its 429 has no CORS
headers — the widget sees a failed fetch, which is the intended outcome.

Reporter emails appear lower-cased in Redis keys for the length of the window
(60 s). Acceptable for an internal tool; hash them if that changes.

## Fail-open

Availability beats strictness for an internal tool. `checkRateLimit` returns
`allowed: true` when:

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are not set,
- the backend throws, or
- the backend takes longer than 500 ms.

Each fail-open emits one Sentry warning (`level: warning`,
`tags.area = widget-rate-limit`, `extra.keyPrefix`, `extra.reason`) per minute
per key prefix (`widget:{site}` or `widget:bootstrap`) plus a `console.warn`.
A sustained stream of these means the limiter is effectively off — treat as
an incident, not noise.

## Provisioning (HITL, PULSE-325)

- Database: Upstash Redis, regional, same region as the Vercel project's
  function region. Region and plan: _to be filled in when provisioned_.
- Env vars in Vercel (production + preview) and `.env.local` for dev; see
  `.env.example`.
- `wrangler.jsonc` is untouched (no KV binding).
