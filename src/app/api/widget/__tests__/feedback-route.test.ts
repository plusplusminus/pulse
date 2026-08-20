import { beforeEach, describe, expect, it, vi } from "vitest";

const HUB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HUB_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const inserts: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];

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
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
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
    // No `storage` on purpose: the feedback route must never touch the bucket.
  },
}));

vi.mock("@/lib/widget-auth", () => ({
  validateWidgetRequest: vi.fn(),
  isKnownWidgetOrigin: vi.fn(async () => true),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

// Real checkRateLimit over an injected in-memory limiter (one per budget).
const rateLimit = vi.hoisted(() => ({
  fakes: null as null | { get(limit: number, windowMs: number): unknown; reset(): void },
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
    async limit() {
      throw new Error("upstash down");
    },
  };
  return {
    ...actual,
    checkRateLimit: (input: Parameters<typeof actual.checkRateLimit>[0]) =>
      actual.checkRateLimit(input, {
        limiter: rateLimit.backendDown ? down : fakes.get(input.limit, input.windowMs),
      }),
  };
});

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

import * as Sentry from "@sentry/nextjs";
import { validateWidgetRequest } from "@/lib/widget-auth";
import { createWidgetLinearIssue } from "@/lib/widget-linear";
import { POST } from "../feedback/route";

const mockedValidate = vi.mocked(validateWidgetRequest);
const mockedCreateIssue = vi.mocked(createWidgetLinearIssue);

function authOk(hubId = HUB_A, prefix = `wk_${Math.random().toString(36).slice(2)}`) {
  mockedValidate.mockResolvedValue({
    config: {
      id: "cfg-1",
      hub_id: hubId,
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

function payload(extra: Record<string, unknown> = {}) {
  return {
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
    ...extra,
  };
}

function post(body: unknown, extraHeaders: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/widget/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-widget-key": "wk_abc",
        origin: "https://customer.example",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  mockedValidate.mockReset();
  mockedCreateIssue.mockClear();
  rateLimit.fakes?.reset();
  rateLimit.backendDown = false;
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pulse.test");
});

describe("POST /api/widget/feedback (rate limiting)", () => {
  it("lets a reporter submit 10 per minute, then 429 with Retry-After; another reporter is unaffected", async () => {
    authOk(HUB_A, "wk_site1");
    for (let i = 0; i < 10; i++) {
      expect((await post(payload())).status).toBe(201);
    }
    const denied = await post(payload());
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBe("https://customer.example");
    expect(inserts).toHaveLength(10);

    const other = await post(payload({ reporter: { email: "someone-else@example.com" } }));
    expect(other.status).toBe(201);
  });

  it("enforces the per-site budget across reporters", async () => {
    authOk(HUB_A, "wk_site3");
    for (let i = 0; i < 60; i++) {
      const res = await post(payload({ reporter: { email: `r${i}@example.com` } }));
      expect(res.status).toBe(201);
    }
    const denied = await post(payload({ reporter: { email: "fresh@example.com" } }));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBeTruthy();
  });

  it("fails open with one Sentry warning when the backend is down", async () => {
    authOk(HUB_A, "wk_site4");
    rateLimit.backendDown = true;
    for (let i = 0; i < 12; i++) {
      expect((await post(payload())).status).toBe(201);
    }
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureMessage).mock.calls[0][1]).toMatchObject({
      level: "warning",
      tags: { area: "widget-rate-limit" },
    });
  });
});

describe("POST /api/widget/feedback (storage path cut-over)", () => {
  it("stores the storage path and renders the media-proxy URL into Linear", async () => {
    authOk(HUB_A);
    const storagePath = `${HUB_A}/screenshots/abc.png`;

    const res = await post(payload({ screenshotStoragePath: storagePath }));

    expect(res.status).toBe(201);
    expect(inserts).toHaveLength(1);
    const row = inserts[0];
    expect(typeof row.id).toBe("string");
    expect(row.screenshot_storage_path).toBe(storagePath);
    expect(row.screenshot_url).toBe(
      `https://pulse.test/api/widget/media/${row.id}/screenshot`
    );
    expect(row).not.toHaveProperty("screenshot");

    const [call] = mockedCreateIssue.mock.calls;
    expect(call[0].description).toContain(
      `![Screenshot](https://pulse.test/api/widget/media/${row.id}/screenshot)`
    );
    const body = (await res.json()) as { id: string; status: string };
    expect(body.id).toBe(row.id);
    expect(body.status).toBe("created");
  });

  it("rejects a storage path scoped to another hub", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({ screenshotStoragePath: `${HUB_B}/screenshots/abc.png` })
    );
    expect(res.status).toBe(400);
    expect(inserts).toEqual([]);
    expect(mockedCreateIssue).not.toHaveBeenCalled();
  });

  it("rejects a storage path outside the screenshots folder", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({ screenshotStoragePath: `${HUB_A}/videos/abc.webm` })
    );
    expect(res.status).toBe(400);
    expect(inserts).toEqual([]);
  });

  it("rejects a malformed / traversing storage path at the schema", async () => {
    authOk(HUB_A);
    for (const bad of [
      `${HUB_A}/screenshots/../../x.png`,
      "../screenshots/x.png",
      "not-a-path",
      "",
    ]) {
      const res = await post(payload({ screenshotStoragePath: bad }));
      expect(res.status).toBe(400);
    }
    expect(inserts).toEqual([]);
  });

  it("stores a video path and links the media proxy from the Linear body", async () => {
    authOk(HUB_A);
    const videoPath = `${HUB_A}/videos/clip.webm`;

    const res = await post(payload({ videoStoragePath: videoPath }));

    expect(res.status).toBe(201);
    const row = inserts[0];
    expect(row.video_storage_path).toBe(videoPath);
    // Video renders as a link, never an image: Linear cannot inline a video.
    const [call] = mockedCreateIssue.mock.calls;
    expect(call[0].description).toContain(
      `[Watch recording](https://pulse.test/api/widget/media/${row.id}/video)`
    );
  });

  it("accepts an MP4 recording from desktop Safari", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({ videoStoragePath: `${HUB_A}/videos/clip.mp4` })
    );
    expect(res.status).toBe(201);
    expect(inserts[0].video_storage_path).toBe(`${HUB_A}/videos/clip.mp4`);
  });

  it("stores a screenshot and a video together", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({
        screenshotStoragePath: `${HUB_A}/screenshots/abc.png`,
        videoStoragePath: `${HUB_A}/videos/clip.webm`,
      })
    );

    expect(res.status).toBe(201);
    const row = inserts[0];
    expect(row.screenshot_storage_path).toBe(`${HUB_A}/screenshots/abc.png`);
    expect(row.video_storage_path).toBe(`${HUB_A}/videos/clip.webm`);
    const [call] = mockedCreateIssue.mock.calls;
    expect(call[0].description).toContain("## Screenshot");
    expect(call[0].description).toContain("## Video");
  });

  it("rejects a video path scoped to another hub", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({ videoStoragePath: `${HUB_B}/videos/clip.webm` })
    );
    expect(res.status).toBe(400);
    expect(inserts).toEqual([]);
    expect(mockedCreateIssue).not.toHaveBeenCalled();
  });

  it("rejects a video path outside the videos folder", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({ videoStoragePath: `${HUB_A}/screenshots/abc.png` })
    );
    expect(res.status).toBe(400);
    expect(inserts).toEqual([]);
  });

  it("rejects a malformed / traversing video path at the schema", async () => {
    authOk(HUB_A);
    for (const bad of [
      `${HUB_A}/videos/../../x.webm`,
      "../videos/x.webm",
      "not-a-path",
      "",
    ]) {
      const res = await post(payload({ videoStoragePath: bad }));
      expect(res.status).toBe(400);
    }
    expect(inserts).toEqual([]);
  });

  it("stores null and renders no Video section when no recording was made", async () => {
    authOk(HUB_A);
    const res = await post(payload());

    expect(res.status).toBe(201);
    expect(inserts[0].video_storage_path).toBeNull();
    const [call] = mockedCreateIssue.mock.calls;
    expect(call[0].description).not.toContain("## Video");
  });

  it("ignores the legacy base64 screenshot field and stores no media", async () => {
    authOk(HUB_A);
    const res = await post(payload({ screenshot: "iVBORw0KGgo=" }));

    expect(res.status).toBe(201);
    expect(inserts[0].screenshot_storage_path).toBeNull();
    expect(inserts[0].screenshot_url).toBeNull();
    const [call] = mockedCreateIssue.mock.calls;
    expect(call[0].description).toContain("_No screenshot attached_");
  });
});

describe("POST /api/widget/feedback (element picks, PULSE-329)", () => {
  const pick = {
    id: "p1",
    elementPath: "main > .hero > button",
    name: 'button "Sign up"',
    classes: "btn, primary",
    boundingBox: { x: 1, y: 2, width: 3, height: 4 },
    nearbyText: "Sign up",
    comment: "Make this bigger",
    intent: "fix",
    isFixed: false,
  };

  it("persists picks on the submission row", async () => {
    authOk(HUB_A);
    const res = await post(payload({ picks: [pick, { ...pick, id: "p2", intent: "question" }] }));
    expect(res.status).toBe(201);
    expect(inserts[0].picks).toEqual([pick, { ...pick, id: "p2", intent: "question" }]);
  });

  it("defaults picks to [] when the widget sends none", async () => {
    authOk(HUB_A);
    const res = await post(payload());
    expect(res.status).toBe(201);
    expect(inserts[0].picks).toEqual([]);
  });

  it("rejects invalid picks at the schema (bad intent, too many)", async () => {
    authOk(HUB_A);
    expect((await post(payload({ picks: [{ ...pick, intent: "nuke" }] }))).status).toBe(400);
    expect((await post(payload({ picks: Array.from({ length: 51 }, () => pick) }))).status).toBe(400);
    expect(inserts).toEqual([]);
  });
});
