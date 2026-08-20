import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import {
  bootstrapKey,
  checkRateLimit,
  reporterKey,
  siteKey,
  type RateLimiterLike,
} from "@/lib/widget-rate-limit";
import { createFakeRateLimiter } from "./fake-rate-limiter";

const mockedCapture = vi.mocked(Sentry.captureMessage);

const T0 = Date.UTC(2026, 7, 20, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  mockedCapture.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function limiterFor(limit: number, windowMs: number) {
  return createFakeRateLimiter({ limit, windowMs, now: () => Date.now() });
}

describe("key builders", () => {
  it("compose site, reporter/IP and bootstrap keys under the widget namespace", () => {
    expect(siteKey("sk_0123456")).toBe("widget:sk_0123456");
    expect(reporterKey("sk_0123456", "r@example.com")).toBe(
      "widget:sk_0123456:r@example.com"
    );
    expect(reporterKey("sk_0123456", "203.0.113.9")).toBe(
      "widget:sk_0123456:203.0.113.9"
    );
    expect(bootstrapKey("203.0.113.9")).toBe("widget:bootstrap:203.0.113.9");
  });

  it("keeps site keys distinct from reporter keys and between sites", () => {
    expect(siteKey("sk_a")).not.toBe(reporterKey("sk_a", "x"));
    expect(reporterKey("sk_a", "x")).not.toBe(reporterKey("sk_b", "x"));
    expect(bootstrapKey("1.1.1.1")).not.toBe(siteKey("bootstrap"));
  });
});

describe("checkRateLimit", () => {
  it("allows up to the limit, then denies with retryAfterMs from the reset timestamp", async () => {
    const limiter = limiterFor(3, 60_000);
    const input = { key: siteKey("sk_a"), limit: 3, windowMs: 60_000 };

    expect(await checkRateLimit(input, { limiter })).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterMs: 0,
    });
    vi.advanceTimersByTime(1_000);
    expect(await checkRateLimit(input, { limiter })).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    vi.advanceTimersByTime(1_000);
    expect(await checkRateLimit(input, { limiter })).toMatchObject({
      allowed: true,
      remaining: 0,
    });

    vi.advanceTimersByTime(10_000);
    // First hit was at T0; window resets at T0 + 60s; now is T0 + 12s.
    expect(await checkRateLimit(input, { limiter })).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 48_000,
    });
    expect(limiter.calls).toEqual(Array(4).fill("widget:sk_a"));
  });

  it("rotates the window: requests are allowed again once the oldest hit ages out", async () => {
    const limiter = limiterFor(2, 60_000);
    const input = { key: bootstrapKey("1.2.3.4"), limit: 2, windowMs: 60_000 };

    await checkRateLimit(input, { limiter });
    vi.advanceTimersByTime(30_000);
    await checkRateLimit(input, { limiter });
    expect((await checkRateLimit(input, { limiter })).allowed).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect(await checkRateLimit(input, { limiter })).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it("tracks keys independently", async () => {
    const limiter = limiterFor(1, 60_000);
    const a = { key: reporterKey("sk_a", "1.1.1.1"), limit: 1, windowMs: 60_000 };
    const b = { key: reporterKey("sk_a", "2.2.2.2"), limit: 1, windowMs: 60_000 };

    expect((await checkRateLimit(a, { limiter })).allowed).toBe(true);
    expect((await checkRateLimit(a, { limiter })).allowed).toBe(false);
    expect((await checkRateLimit(b, { limiter })).allowed).toBe(true);
  });

  it("never reports a negative retryAfterMs", async () => {
    const limiter: RateLimiterLike = {
      async limit() {
        return { success: false, limit: 1, remaining: 0, reset: Date.now() - 5 };
      },
    };
    expect(
      await checkRateLimit({ key: "widget:x", limit: 1, windowMs: 1000 }, { limiter })
    ).toEqual({ allowed: false, remaining: 0, retryAfterMs: 0 });
  });

  describe("fail-open", () => {
    it("allows the request when the limiter throws and warns Sentry once per minute per key prefix", async () => {
      const limiter: RateLimiterLike = {
        async limit() {
          throw new Error("ECONNRESET");
        },
      };
      const site = { key: siteKey("sk_down"), limit: 60, windowMs: 60_000 };
      const reporter = {
        key: reporterKey("sk_down", "9.9.9.9"),
        limit: 10,
        windowMs: 60_000,
      };

      expect(await checkRateLimit(site, { limiter })).toEqual({
        allowed: true,
        remaining: 60,
        retryAfterMs: 0,
      });
      expect(await checkRateLimit(reporter, { limiter })).toMatchObject({
        allowed: true,
      });
      expect(await checkRateLimit(site, { limiter })).toMatchObject({
        allowed: true,
      });
      // Same prefix (widget:sk_down) -> one warning.
      expect(mockedCapture).toHaveBeenCalledTimes(1);
      expect(mockedCapture.mock.calls[0][1]).toMatchObject({
        level: "warning",
        tags: { area: "widget-rate-limit" },
      });

      // A different prefix warns on its own.
      await checkRateLimit(
        { key: bootstrapKey("9.9.9.9"), limit: 60, windowMs: 60_000 },
        { limiter }
      );
      expect(mockedCapture).toHaveBeenCalledTimes(2);

      // After a minute the same prefix may warn again.
      vi.advanceTimersByTime(60_001);
      await checkRateLimit(site, { limiter });
      expect(mockedCapture).toHaveBeenCalledTimes(3);
    });

    it("allows the request when the limiter exceeds the timeout", async () => {
      const limiter: RateLimiterLike = {
        limit: () => new Promise(() => {}),
      };
      const pending = checkRateLimit(
        { key: siteKey("sk_slow"), limit: 5, windowMs: 60_000 },
        { limiter, timeoutMs: 500 }
      );
      await vi.advanceTimersByTimeAsync(499);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ allowed: true, remaining: 5, retryAfterMs: 0 });
      expect(mockedCapture).toHaveBeenCalledTimes(1);
    });

    it("does not time out a limiter that answers in time", async () => {
      const limiter = limiterFor(1, 60_000);
      const result = checkRateLimit(
        { key: siteKey("sk_fast"), limit: 1, windowMs: 60_000 },
        { limiter, timeoutMs: 500 }
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(await result).toMatchObject({ allowed: true });
      expect(mockedCapture).not.toHaveBeenCalled();
    });

    it("allows the request when no backend is configured", async () => {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
      expect(
        await checkRateLimit({ key: siteKey("sk_noenv"), limit: 2, windowMs: 60_000 })
      ).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
      expect(
        await checkRateLimit({ key: siteKey("sk_noenv"), limit: 2, windowMs: 60_000 })
      ).toMatchObject({ allowed: true });
      vi.unstubAllEnvs();
    });
  });
});
