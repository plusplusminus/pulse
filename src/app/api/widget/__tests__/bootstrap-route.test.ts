import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/widget-auth", () => ({
  validateWidgetKey: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

// Real checkRateLimit over an injected in-memory limiter (one per budget).
const rateLimit = vi.hoisted(() => ({
  fakes: null as null | { reset(): void },
  backendDown: false,
}));
vi.mock("@/lib/widget-rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/widget-rate-limit")>(
    "@/lib/widget-rate-limit"
  );
  const { createFakeRateLimiterFactory } = await import("@/lib/__tests__/fake-rate-limiter");
  const fakes = createFakeRateLimiterFactory(() => Date.now());
  rateLimit.fakes = fakes;
  const down = {
    limit: () => new Promise<never>(() => {}),
  };
  return {
    ...actual,
    checkRateLimit: (input: Parameters<typeof actual.checkRateLimit>[0]) =>
      actual.checkRateLimit(input, {
        limiter: rateLimit.backendDown ? down : fakes.get(input.limit, input.windowMs),
        timeoutMs: 5,
      }),
  };
});

import * as Sentry from "@sentry/nextjs";
import { validateWidgetKey } from "@/lib/widget-auth";
import { GET } from "../v1/bootstrap/[siteKey]/route";

const mockedValidateKey = vi.mocked(validateWidgetKey);

function siteOk() {
  mockedValidateKey.mockResolvedValue({
    id: "cfg-1",
    hub_id: "11111111-1111-1111-1111-111111111111",
    api_key_hash: "h",
    api_key_prefix: "sk_abc1234",
    name: "Default",
    is_active: true,
    config: {},
    output_detail_level: "standard",
    allowed_origins: ["https://customer.example"],
    created_at: "",
    updated_at: "",
  });
}

function get(ip: string, origin = "https://customer.example") {
  return GET(
    new Request("http://localhost/api/widget/v1/bootstrap/sk_abc", {
      headers: { origin, "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ siteKey: "sk_abc" }) }
  );
}

beforeEach(() => {
  mockedValidateKey.mockReset();
  rateLimit.fakes?.reset();
  rateLimit.backendDown = false;
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pulse.test");
});

describe("GET /api/widget/v1/bootstrap/[siteKey] (rate limiting)", () => {
  it("serves 60 per minute per IP, then 429 with Retry-After before any site lookup", async () => {
    siteOk();
    for (let i = 0; i < 60; i++) {
      expect((await get("203.0.113.1")).status).toBe(200);
    }
    const denied = await get("203.0.113.1");
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(denied.headers.get("Vary")).toBe("Origin");
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(mockedValidateKey).toHaveBeenCalledTimes(60);

    expect((await get("203.0.113.2")).status).toBe(200);
  });

  it("fails open with one Sentry warning when the backend times out", async () => {
    siteOk();
    rateLimit.backendDown = true;
    for (let i = 0; i < 3; i++) {
      expect((await get("203.0.113.3")).status).toBe(200);
    }
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledTimes(1);
  });
});
