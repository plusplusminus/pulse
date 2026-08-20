/**
 * Tracks Linear API rate limit headers and provides adaptive pacing.
 *
 * Linear returns `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers
 * on every API response. This class reads those headers and exposes
 * helpers so callers can bail early before burning through the budget.
 *
 * Instantiate per sync run — not a global singleton.
 */
export class LinearRateLimiter {
  private remaining: number | null = null;
  private resetAt: Date | null = null;

  /**
   * Extract and store rate-limit headers from a Linear API response.
   * Safe to call on any Response — silently no-ops if headers are absent.
   */
  updateFromResponse(response: Response): void {
    const remainingHeader = response.headers.get("x-ratelimit-remaining");
    const resetHeader = response.headers.get("x-ratelimit-reset");

    if (remainingHeader !== null) {
      const parsed = parseInt(remainingHeader, 10);
      if (!Number.isNaN(parsed)) {
        this.remaining = parsed;
      }
    }

    if (resetHeader !== null) {
      const parsed = parseInt(resetHeader, 10);
      if (!Number.isNaN(parsed)) {
        // Linear sends the reset timestamp as Unix seconds
        this.resetAt = new Date(parsed * 1000);
      }
    }
  }

  /**
   * Returns true if we have enough budget to make another request.
   *
   * @param threshold - minimum remaining requests before we stop (default 500)
   *
   * If we have never received rate-limit headers, defaults to true
   * (graceful fallback — don't block when we simply don't know).
   */
  canProceed(threshold = 500): boolean {
    if (this.remaining === null) return true;
    return this.remaining >= threshold;
  }

  /**
   * Milliseconds until the rate limit window resets. Returns 0 if not limited
   * or if the reset time is already in the past.
   */
  getWaitTime(): number {
    if (this.resetAt === null) return 0;
    const ms = this.resetAt.getTime() - Date.now();
    return ms > 0 ? ms : 0;
  }

  /**
   * Snapshot for logging / observability.
   */
  getStatus(): {
    remaining: number | null;
    resetAt: Date | null;
    isLimited: boolean;
  } {
    return {
      remaining: this.remaining,
      resetAt: this.resetAt,
      isLimited: !this.canProceed(),
    };
  }
}
