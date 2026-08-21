import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The limiter's backend-failure policy is per route, so both routes are
 * exercised here against the same broken limiter.
 *
 * /api/widget/upload mints signed storage tickets. An object is only ever
 * discovered through a non-null path column on a widget_submissions row, so
 * bytes uploaded against a ticket that is never attached are referenced by
 * nothing and the retention cron never sees them: an open limiter turns a
 * per-minute ticket budget into unbounded unpurgeable storage. It fails
 * closed. /api/widget/feedback writes a row for everything it accepts and
 * stays available, so it keeps failing open.
 */

const HUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const signedUploads: string[] = [];
const inserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: row.id }, error: null }),
          }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({
              single: async () =>
                table === "hub_team_mappings"
                  ? { data: { linear_team_id: "team-1" }, error: null }
                  : { data: null, error: null },
            }),
          }),
        }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => {
          signedUploads.push(path);
          return {
            data: {
              signedUrl: `https://proj.supabase.co/storage/v1/object/upload/sign/${bucket}/${path}?token=tok`,
              token: "tok",
              path,
            },
            error: null,
          };
        },
      }),
    },
  },
}));

vi.mock("@/lib/widget-auth", () => ({
  validateWidgetRequest: vi.fn(),
  isKnownWidgetOrigin: vi.fn(async () => true),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

vi.mock("@/lib/widget-linear", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/widget-linear")>(
      "@/lib/widget-linear"
    );
  return {
    ...actual,
    createWidgetLinearIssue: vi.fn(async () => ({
      id: "lin-1",
      identifier: "PULSE-1",
      url: "https://linear.app/x/issue/PULSE-1",
    })),
  };
});

// Real checkRateLimit — including each route's own onError policy — over a
// limiter that is broken in the way the test selects.
const rateLimit = vi.hoisted(() => ({
  mode: "throws" as "throws" | "hangs",
}));
vi.mock("@/lib/widget-rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/widget-rate-limit")>(
    "@/lib/widget-rate-limit"
  );
  const throwing = {
    async limit() {
      throw new Error("ECONNRESET");
    },
  };
  // Never settles: `checkRateLimit`'s 500 ms race is what resolves the call.
  const hanging = { limit: () => new Promise<never>(() => {}) };
  return {
    ...actual,
    checkRateLimit: (input: Parameters<typeof actual.checkRateLimit>[0]) =>
      actual.checkRateLimit(input, {
        limiter: rateLimit.mode === "hangs" ? hanging : throwing,
      }),
  };
});

import * as Sentry from "@sentry/nextjs";
import { validateWidgetRequest } from "@/lib/widget-auth";
import { POST as feedbackPost } from "../feedback/route";
import { POST as uploadPost } from "../upload/route";

const mockedValidate = vi.mocked(validateWidgetRequest);

function authOk(prefix: string) {
  mockedValidate.mockResolvedValue({
    config: {
      id: "cfg-1",
      hub_id: HUB,
      api_key_hash: "h",
      api_key_prefix: prefix,
      name: "Default",
      is_active: true,
      config: {},
      allowed_origins: [],
      output_detail_level: "standard",
      created_at: "",
      updated_at: "",
    },
  });
}

function uploadRequest() {
  return uploadPost(
    new Request("http://localhost/api/widget/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-widget-key": "wk_abc",
        origin: "https://customer.example",
      },
      body: JSON.stringify({
        kind: "screenshot",
        contentType: "image/png",
        sizeBytes: 1024,
      }),
    })
  );
}

function feedbackRequest() {
  return feedbackPost(
    new Request("http://localhost/api/widget/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-widget-key": "wk_abc",
        origin: "https://customer.example",
      },
      body: JSON.stringify({
        title: "Button broken",
        type: "bug",
        metadata: {
          url: "https://customer.example/page",
          userAgent: "UA",
          viewport: { width: 1, height: 1 },
          timestamp: "2026-08-20T12:00:00.000Z",
          console: [],
          sentry: null,
          custom: {},
        },
        reporter: { email: "r@example.com" },
      }),
    })
  );
}

beforeEach(() => {
  signedUploads.length = 0;
  inserts.length = 0;
  rateLimit.mode = "throws";
  mockedValidate.mockReset();
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pulse.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("widget rate limit backend failure", () => {
  it("denies /upload with 503 while /feedback still succeeds, when the limiter throws", async () => {
    authOk("wk_throws");
    const upload = await uploadRequest();
    const feedback = await feedbackRequest();

    expect(upload.status).toBe(503);
    expect(feedback.status).toBe(201);
    expect(upload.status).not.toBe(feedback.status);

    // No ticket minted, so nothing unattachable can be written to the bucket.
    expect(signedUploads).toEqual([]);
    expect(inserts).toHaveLength(1);
  });

  it("denies /upload with 503 while /feedback still succeeds, when the limiter blows the 500 ms timeout", async () => {
    vi.useFakeTimers();
    try {
      rateLimit.mode = "hangs";
      authOk("wk_hangs");

      const uploadPending = uploadRequest();
      await vi.advanceTimersByTimeAsync(500);
      const upload = await uploadPending;

      const feedbackPending = feedbackRequest();
      await vi.advanceTimersByTimeAsync(1_000);
      const feedback = await feedbackPending;

      expect(upload.status).toBe(503);
      expect(feedback.status).toBe(201);
      expect(upload.status).not.toBe(feedback.status);
      expect(signedUploads).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers 503 with Retry-After and an outage-specific error, not a 429", async () => {
    authOk("wk_shape");
    const res = await uploadRequest();

    expect(res.status).toBe(503);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    // CORS still granted, so the page can read the failure.
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://customer.example"
    );
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("rate_limit_unavailable");
    expect(body.message).not.toMatch(/exceeded/i);
  });

  it("logs the denial as failing closed, once per minute, distinct from a fail-open warning", async () => {
    authOk("wk_logs");
    await uploadRequest();
    await uploadRequest();

    const captured = vi.mocked(Sentry.captureMessage).mock.calls;
    expect(captured).toHaveLength(1);
    expect(captured[0][0]).toMatch(/failing closed/);
    expect(captured[0][1]).toMatchObject({
      level: "warning",
      tags: { area: "widget-rate-limit", policy: "deny" },
    });
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/failing closed/);
  });

  it("keeps warning separately for the fail-open callers on the same site key", async () => {
    authOk("wk_shared");
    await uploadRequest();
    await feedbackRequest();

    const messages = vi
      .mocked(Sentry.captureMessage)
      .mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => /failing closed/.test(m))).toBe(true);
    expect(messages.some((m) => /failing open/.test(m))).toBe(true);
  });
});
