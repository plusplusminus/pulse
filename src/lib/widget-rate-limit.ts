/**
 * In-memory sliding-window rate limiter for public widget endpoints.
 *
 * Per-isolate and non-durable (same caveat as the limiter inside
 * /api/widget/feedback); PULSE-313 replaces both with Upstash Redis. Kept as a
 * factory so each route owns its own budget and tests can create fresh ones.
 */
export type SlidingWindowLimiter = {
  /** Records a hit and returns true when the key is over budget. */
  isRateLimited(key: string, now?: number): boolean;
};

export function createSlidingWindowLimiter(options: {
  windowMs: number;
  max: number;
}): SlidingWindowLimiter {
  const hits = new Map<string, number[]>();

  return {
    isRateLimited(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter(
        (t) => now - t < options.windowMs
      );
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return true;
      }
      recent.push(now);
      hits.set(key, recent);
      return false;
    },
  };
}
