import type { RateLimiterLike } from "@/lib/widget-rate-limit";

/**
 * In-memory stand-in for an `@upstash/ratelimit` sliding-window instance.
 * Bound to one (limit, window) like the real thing; reads time from `now`.
 */
export function createFakeRateLimiter(options: {
  limit: number;
  windowMs: number;
  now: () => number;
}): RateLimiterLike & { calls: string[]; hits: Map<string, number[]> } {
  const hits = new Map<string, number[]>();
  const calls: string[] = [];
  return {
    hits,
    calls,
    async limit(identifier) {
      calls.push(identifier);
      const now = options.now();
      const recent = (hits.get(identifier) ?? []).filter(
        (t) => now - t < options.windowMs
      );
      const success = recent.length < options.limit;
      if (success) recent.push(now);
      hits.set(identifier, recent);
      return {
        success,
        limit: options.limit,
        remaining: Math.max(0, options.limit - recent.length),
        reset: recent[0] + options.windowMs,
        pending: Promise.resolve(),
      };
    },
  };
}

/**
 * Factory matching `checkRateLimit`'s (limit, windowMs) pairs so route tests
 * can inject one fake per budget while sharing a clock.
 */
export function createFakeRateLimiterFactory(now: () => number) {
  const limiters = new Map<string, ReturnType<typeof createFakeRateLimiter>>();
  return {
    get(limit: number, windowMs: number) {
      const id = `${limit}:${windowMs}`;
      let limiter = limiters.get(id);
      if (!limiter) {
        limiter = createFakeRateLimiter({ limit, windowMs, now });
        limiters.set(id, limiter);
      }
      return limiter;
    },
    reset() {
      limiters.clear();
    },
  };
}
