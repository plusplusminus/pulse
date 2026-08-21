import * as Sentry from "@sentry/nextjs";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Distributed sliding-window rate limit for the public widget routes
 * (PULSE-313), backed by Upstash Redis via `@upstash/ratelimit`.
 *
 * Public surface: `checkRateLimit` plus the three key builders. Everything
 * else (Redis client, per-budget `Ratelimit` instances, Sentry throttling) is
 * private to this module.
 *
 * Fail-open by default: when the backend is not configured, throws, or takes
 * longer than `timeoutMs` (500 ms), the request is allowed and one Sentry
 * warning is emitted per minute per key prefix. Availability beats strictness
 * for an internal tool; see docs/development/widget-rate-limit.md.
 *
 * Callers for whom an unmetered request is worse than a rejected one pass
 * `onError: "deny"` and get a fail-CLOSED verdict instead, flagged
 * `unverified` so they can answer 503 ("cannot check") rather than 429
 * ("over budget"). See `/api/widget/upload`.
 */

/**
 * What to do when the backend cannot answer (unconfigured, throwing, or over
 * `timeoutMs`). "allow" keeps the caller available at the cost of an unmetered
 * request; "deny" refuses the request rather than let it through unmetered.
 */
export type RateLimitErrorPolicy = "allow" | "deny";

export type RateLimitInput = {
  /** Built with `siteKey` / `reporterKey` / `bootstrapKey`. */
  key: string;
  /** Max hits per window. */
  limit: number;
  windowMs: number;
  /** Backend-failure policy for this call; defaults to "allow". */
  onError?: RateLimitErrorPolicy;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /**
   * Milliseconds until the window resets; 0 when allowed or failing open. On
   * an `unverified` denial there is no window to wait for, so this is a fixed
   * short backoff.
   */
  retryAfterMs: number;
  /**
   * Set only on a fail-closed denial (`onError: "deny"` plus a backend
   * failure): the budget could not be consulted, so the caller was refused
   * without ever exceeding it.
   */
  unverified?: true;
};

/** The slice of `@upstash/ratelimit`'s `Ratelimit` that this module depends on. */
export type RateLimiterLike = {
  limit(identifier: string): Promise<{
    success: boolean;
    remaining: number;
    /** Unix ms when the window resets. */
    reset: number;
  }>;
};

export type RateLimitDeps = {
  /**
   * Limiter bound to `input.limit` / `input.windowMs`. Omit to use the shared
   * Upstash-backed instance for that budget; pass `null` to simulate a missing
   * backend.
   */
  limiter?: RateLimiterLike | null;
  now?: () => number;
  /** Backend budget before failing open. */
  timeoutMs?: number;
};

const KEY_NAMESPACE = "widget";
const DEFAULT_TIMEOUT_MS = 500;
const WARN_INTERVAL_MS = 60_000;
/** Backoff advertised on a fail-closed denial; the outage, not a window, is what has to clear. */
const UNVERIFIED_RETRY_AFTER_MS = 5_000;

/** Per-site budget: `widget:{siteKeyPrefix}`. */
export function siteKey(siteKeyPrefix: string): string {
  return `${KEY_NAMESPACE}:${siteKeyPrefix}`;
}

/** Per-reporter (identified) or per-IP (anonymous) budget within a site. */
export function reporterKey(siteKeyPrefix: string, reporterIdOrIp: string): string {
  return `${KEY_NAMESPACE}:${siteKeyPrefix}:${reporterIdOrIp}`;
}

/** Bootstrap is unauthenticated, so it is budgeted per IP only. */
export function bootstrapKey(ip: string): string {
  return `${KEY_NAMESPACE}:bootstrap:${ip}`;
}

export async function checkRateLimit(
  input: RateLimitInput,
  deps: RateLimitDeps = {}
): Promise<RateLimitResult> {
  const now = deps.now ?? Date.now;
  const limiter =
    deps.limiter === undefined
      ? defaultLimiter(input.limit, input.windowMs)
      : deps.limiter;

  if (!limiter) {
    return backendFailure(input, "not_configured", now);
  }

  try {
    const response = await withTimeout(
      limiter.limit(input.key),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    if (response.success) {
      return { allowed: true, remaining: response.remaining, retryAfterMs: 0 };
    }
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, response.reset - now()),
    };
  } catch (error) {
    return backendFailure(
      input,
      error instanceof Error ? error.message : String(error),
      now
    );
  }
}

// --- private -----------------------------------------------------------------

class RateLimitTimeoutError extends Error {
  constructor(ms: number) {
    super(`rate limit backend exceeded ${ms}ms`);
    this.name = "RateLimitTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RateLimitTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** `widget:sk_abc:1.2.3.4` -> `widget:sk_abc`; `widget:bootstrap:1.2.3.4` -> `widget:bootstrap`. */
function keyPrefix(key: string): string {
  return key.split(":").slice(0, 2).join(":");
}

/**
 * The backend could not answer. Warn (throttled) and apply `input.onError`:
 * allow the request through unmetered, or refuse it as unverified.
 */
function backendFailure(
  input: RateLimitInput,
  reason: string,
  now: () => number
): RateLimitResult {
  const policy = input.onError ?? "allow";
  warnBackendUnavailable(input.key, reason, policy, now);
  return policy === "deny"
    ? {
        allowed: false,
        remaining: 0,
        retryAfterMs: UNVERIFIED_RETRY_AFTER_MS,
        unverified: true,
      }
    : { allowed: true, remaining: input.limit, retryAfterMs: 0 };
}

// One warning per minute per key prefix, tracked per policy: a fail-open on
// /feedback must not swallow the fail-closed warning /upload raises for the
// same site in the same minute, since only the latter rejected a caller.
const lastWarnedAt = new Map<string, number>();

function warnBackendUnavailable(
  key: string,
  reason: string,
  policy: RateLimitErrorPolicy,
  now: () => number
): void {
  const prefix = keyPrefix(key);
  const t = now();
  const throttleKey = `${prefix}|${policy}`;
  const last = lastWarnedAt.get(throttleKey);
  if (last !== undefined && t - last < WARN_INTERVAL_MS) return;
  lastWarnedAt.set(throttleKey, t);

  const outcome = policy === "deny" ? "failing closed" : "failing open";
  console.warn(`[widget-rate-limit] ${outcome} for ${prefix}: ${reason}`);
  Sentry.captureMessage(
    `Widget rate limit backend unavailable; ${outcome}`,
    {
      level: "warning",
      tags: { area: "widget-rate-limit", policy },
      extra: { keyPrefix: prefix, reason, outcome },
    }
  );
}

let redis: Redis | null | undefined;
const limiters = new Map<string, Ratelimit>();

/**
 * One `Ratelimit` per (limit, window) budget, created lazily and cached at
 * module scope so `ephemeralCache` can short-circuit repeat offenders while
 * the instance is hot. Returns null when Upstash is not configured.
 */
function defaultLimiter(limit: number, windowMs: number): Ratelimit | null {
  if (redis === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    redis = url && token ? new Redis({ url, token }) : null;
  }
  if (!redis) return null;

  const id = `${limit}:${windowMs}`;
  let limiter = limiters.get(id);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      prefix: "pulse",
      ephemeralCache: new Map(),
      // The library's own timeout (default 5 s) silently resolves `success`;
      // leave it above ours so `checkRateLimit`'s 500 ms race wins and the
      // fail-open warning is actually emitted.
    });
    limiters.set(id, limiter);
  }
  return limiter;
}
