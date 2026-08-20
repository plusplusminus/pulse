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
 * Fail-open by design: when the backend is not configured, throws, or takes
 * longer than `timeoutMs` (500 ms), the request is allowed and one Sentry
 * warning is emitted per minute per key prefix. Availability beats strictness
 * for an internal tool; see docs/development/widget-rate-limit.md.
 */

export type RateLimitInput = {
  /** Built with `siteKey` / `reporterKey` / `bootstrapKey`. */
  key: string;
  /** Max hits per window. */
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets; 0 when allowed or failing open. */
  retryAfterMs: number;
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
    failOpen(input.key, "not_configured", now);
    return { allowed: true, remaining: input.limit, retryAfterMs: 0 };
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
    failOpen(input.key, error instanceof Error ? error.message : String(error), now);
    return { allowed: true, remaining: input.limit, retryAfterMs: 0 };
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

const lastWarnedAt = new Map<string, number>();

function failOpen(key: string, reason: string, now: () => number): void {
  const prefix = keyPrefix(key);
  const t = now();
  const last = lastWarnedAt.get(prefix);
  if (last !== undefined && t - last < WARN_INTERVAL_MS) return;
  lastWarnedAt.set(prefix, t);

  console.warn(`[widget-rate-limit] failing open for ${prefix}: ${reason}`);
  Sentry.captureMessage("Widget rate limit backend unavailable; failing open", {
    level: "warning",
    tags: { area: "widget-rate-limit" },
    extra: { keyPrefix: prefix, reason },
  });
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
