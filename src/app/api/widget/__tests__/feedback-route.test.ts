import { beforeEach, describe, expect, it, vi } from "vitest";

const HUB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HUB_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const inserts: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];
// widget_submission_assets rows (PULSE-403), kept apart from the submission
// insert so the pre-existing assertions on `inserts` still mean one submission.
const assetInserts: Array<Record<string, unknown>> = [];
const db = { assetInsertError: null as { message: string } | null };

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (table === "widget_submission_assets") {
          assetInserts.push(...(Array.isArray(row) ? row : [row]));
          return Promise.resolve({ error: db.assetInsertError });
        }
        const single = row as Record<string, unknown>;
        inserts.push(single);
        return {
          select: () => ({
            single: async () => ({ data: { id: single.id }, error: null }),
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

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

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
  assetInserts.length = 0;
  db.assetInsertError = null;
  mockedValidate.mockReset();
  mockedCreateIssue.mockClear();
  rateLimit.fakes?.reset();
  rateLimit.backendDown = false;
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.mocked(Sentry.captureException).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
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

// -- Metadata bounds (security) -------------------------------------------

/**
 * The endpoint is public: the site key ships in the page and Origin is
 * spoofable outside a browser. url / userAgent / timestamp were bare
 * z.string() and `custom` an uncapped record, so a caller could push megabytes
 * into the widget_submissions.metadata JSONB — and on into the Linear issue —
 * on every request. Oversized input must be rejected, never silently truncated.
 */
describe("POST /api/widget/feedback (metadata bounds)", () => {
  function metaWith(over: Record<string, unknown>) {
    return payload({ metadata: { ...payload().metadata, ...over } });
  }

  it("rejects a url over 2048 chars", async () => {
    authOk(HUB_A, "wk_meta1");
    const long = `https://customer.example/${"a".repeat(2100)}`;
    const res = await post(metaWith({ url: long }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("accepts a url exactly at 2048 chars", async () => {
    authOk(HUB_A, "wk_meta2");
    const prefix = "https://customer.example/";
    const url = prefix + "a".repeat(2048 - prefix.length);
    expect(url).toHaveLength(2048);
    expect((await post(metaWith({ url }))).status).toBe(201);
  });

  it("rejects a userAgent over 500 chars", async () => {
    authOk(HUB_A, "wk_meta3");
    const res = await post(metaWith({ userAgent: "U".repeat(501) }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("rejects a timestamp over 64 chars", async () => {
    authOk(HUB_A, "wk_meta4");
    const res = await post(metaWith({ timestamp: "2026-08-20T12:00:00.000Z".padEnd(65, "0") }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("rejects more than 20 custom keys", async () => {
    authOk(HUB_A, "wk_meta5");
    const custom = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"])
    );
    const res = await post(metaWith({ custom }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("accepts exactly 20 custom keys", async () => {
    authOk(HUB_A, "wk_meta6");
    const custom = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`k${i}`, "v"])
    );
    expect((await post(metaWith({ custom }))).status).toBe(201);
  });

  it("rejects a custom value over 500 chars", async () => {
    authOk(HUB_A, "wk_meta7");
    const res = await post(metaWith({ custom: { big: "x".repeat(501) } }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("rejects a custom key long enough to be a payload in its own right", async () => {
    authOk(HUB_A, "wk_meta8");
    const res = await post(metaWith({ custom: { ["k".repeat(101)]: "v" } }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("rejects rather than truncates: nothing oversized reaches the row", async () => {
    authOk(HUB_A, "wk_meta9");
    const res = await post(
      metaWith({
        userAgent: "U".repeat(5000),
        custom: { big: "x".repeat(5000) },
      })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Validation failed"
    );
    expect(inserts).toHaveLength(0);
    expect(mockedCreateIssue).not.toHaveBeenCalled();
  });
});



describe("POST /api/widget/feedback (screenshot annotations)", () => {
  /** One of every kind the editor can produce (PULSE-401). */
  const annotations = [
    { kind: "highlight", x: 10, y: 20, w: 100, h: 50 },
    { kind: "hide", x: 5, y: 6, w: 7, h: 8 },
    { kind: "rect", x: 1, y: 2, w: 30, h: 40, color: "#ef4444", strokeWidth: 3 },
    { kind: "ellipse", x: 3, y: 4, w: 50, h: 60, color: "#3b82f6", strokeWidth: 5 },
    { kind: "arrow", x1: 0, y1: 0, x2: 90, y2: 80, color: "#22c55e", strokeWidth: 4 },
    { kind: "pen", points: [0, 0, 5, 5, 10, 2], color: "#f59e0b", strokeWidth: 2 },
    { kind: "text", x: 12, y: 34, text: "this is broken", color: "#111827", fontSize: 24 },
  ];

  beforeEach(() => {
    authOk();
  });

  it("stores every kind on the row exactly as it was sent", async () => {
    const res = await post(
      payload({
        screenshotStoragePath: `${HUB_A}/screenshots/shot.png`,
        screenshotAnnotations: annotations,
      })
    );
    expect(res.status).toBe(201);
    expect(inserts[0].screenshot_annotations).toEqual(annotations);
  });

  it("defaults to an empty array when a report carries no marks", async () => {
    const res = await post(payload());
    expect(res.status).toBe(201);
    expect(inserts[0].screenshot_annotations).toEqual([]);
  });

  it("rejects an unknown kind rather than storing it", async () => {
    const res = await post(payload({ screenshotAnnotations: [{ kind: "laser", x: 0, y: 0, w: 1, h: 1 }] }));
    expect(res.status).toBe(400);
  });

  it("rejects a colour outside the fixed palette", async () => {
    const res = await post(
      payload({
        screenshotAnnotations: [{ ...annotations[4], color: "#123456" }],
      })
    );
    expect(res.status).toBe(400);
  });

  it("still accepts a rect-only row written before the union existed", async () => {
    const legacy = [{ kind: "highlight", x: 1, y: 2, w: 3, h: 4 }];
    const res = await post(
      payload({
        screenshotStoragePath: `${HUB_A}/screenshots/shot.png`,
        screenshotAnnotations: legacy,
      })
    );
    expect(res.status).toBe(201);
    expect(inserts[0].screenshot_annotations).toEqual(legacy);
  });

  it("caps the set so one report cannot bloat the JSONB row", async () => {
    const many = Array.from({ length: 51 }, () => annotations[0]);
    expect((await post(payload({ screenshotAnnotations: many }))).status).toBe(400);
  });
});

describe("POST /api/widget/feedback (multiple attachments, PULSE-403)", () => {
  function shots(n: number, hub = HUB_A) {
    return Array.from({ length: n }, (_, i) => ({
      kind: "screenshot" as const,
      storagePath: `${hub}/screenshots/shot-${i}.png`,
      contentType: "image/png",
      position: i,
    }));
  }

  it("writes one asset row per attachment, in position order", async () => {
    authOk(HUB_A);
    const res = await post(payload({ assets: shots(3) }));

    expect(res.status).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(assetInserts).toHaveLength(3);
    expect(assetInserts.map((a) => a.position)).toEqual([0, 1, 2]);
    expect(assetInserts.map((a) => a.storage_path)).toEqual([
      `${HUB_A}/screenshots/shot-0.png`,
      `${HUB_A}/screenshots/shot-1.png`,
      `${HUB_A}/screenshots/shot-2.png`,
    ]);
    expect(assetInserts.every((a) => a.submission_id === inserts[0].id)).toBe(
      true
    );
    expect(assetInserts[0].content_type).toBe("image/png");
  });

  it("keeps writing the legacy columns from the first asset of each kind", async () => {
    authOk(HUB_A);
    await post(
      payload({
        assets: [
          ...shots(2),
          {
            kind: "video",
            storagePath: `${HUB_A}/videos/clip.webm`,
            contentType: "video/webm",
          },
        ],
      })
    );

    // Dual-read, not a cutover: readers still on the columns keep working.
    expect(inserts[0].screenshot_storage_path).toBe(
      `${HUB_A}/screenshots/shot-0.png`
    );
    expect(inserts[0].video_storage_path).toBe(`${HUB_A}/videos/clip.webm`);
    expect(inserts[0].screenshot_url).toBe(
      `https://pulse.test/api/widget/media/${inserts[0].id}/screenshot`
    );
  });

  it("accepts exactly 6 screenshots, 1 video and 1 replay", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({
        assets: [
          ...shots(6),
          {
            kind: "video",
            storagePath: `${HUB_A}/videos/clip.webm`,
            contentType: "video/webm",
          },
          {
            kind: "replay",
            storagePath: `${HUB_A}/replays/r.json`,
            contentType: "application/json",
          },
        ],
      })
    );

    expect(res.status).toBe(201);
    expect(assetInserts).toHaveLength(8);
  });

  it("rejects a 7th screenshot even though the client cap was bypassed", async () => {
    authOk(HUB_A);
    const res = await post(payload({ assets: shots(7) }));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Too many screenshot");
    expect(inserts).toEqual([]);
    expect(assetInserts).toEqual([]);
    expect(mockedCreateIssue).not.toHaveBeenCalled();
  });

  it("rejects a second video and a second replay", async () => {
    authOk(HUB_A);
    const video = {
      kind: "video" as const,
      storagePath: `${HUB_A}/videos/a.webm`,
      contentType: "video/webm",
    };
    const res = await post(
      payload({
        assets: [video, { ...video, storagePath: `${HUB_A}/videos/b.webm` }],
      })
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Too many video");
    expect(inserts).toEqual([]);
  });

  it("rejects an assets array long enough to be an attack, at the schema", async () => {
    authOk(HUB_A);
    const res = await post(payload({ assets: shots(200) }));
    expect(res.status).toBe(400);
    expect(inserts).toEqual([]);
  });

  it("validates every path in the list, not just the first", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({
        assets: [
          ...shots(2),
          {
            kind: "screenshot",
            storagePath: `${HUB_B}/screenshots/other.png`,
            contentType: "image/png",
          },
        ],
      })
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("does not belong to this site");
    expect(inserts).toEqual([]);
    expect(assetInserts).toEqual([]);
  });

  it("rejects an asset whose folder does not match its kind", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({
        assets: [
          {
            kind: "screenshot",
            storagePath: `${HUB_A}/videos/clip.webm`,
            contentType: "image/png",
          },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect(inserts).toEqual([]);
  });

  it("rejects a content type outside the per-kind allowlist", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({
        assets: [
          {
            kind: "screenshot",
            storagePath: `${HUB_A}/screenshots/a.png`,
            contentType: "image/svg+xml",
          },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("content type");
    expect(inserts).toEqual([]);
  });

  it("keeps the per-kind size caps", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({
        assets: [
          {
            kind: "screenshot",
            storagePath: `${HUB_A}/screenshots/a.png`,
            contentType: "image/png",
            sizeBytes: 10 * 1024 * 1024 + 1,
          },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("byte limit");
    expect(inserts).toEqual([]);
  });

  it("carries annotations onto the asset they belong to", async () => {
    authOk(HUB_A);
    await post(
      payload({
        assets: [
          {
            kind: "screenshot",
            storagePath: `${HUB_A}/screenshots/a.png`,
            contentType: "image/png",
            position: 0,
            annotations: [{ kind: "highlight", x: 1, y: 2, w: 3, h: 4 }],
          },
          {
            kind: "screenshot",
            storagePath: `${HUB_A}/screenshots/b.png`,
            contentType: "image/png",
            position: 1,
            annotations: [{ kind: "hide", x: 5, y: 6, w: 7, h: 8 }],
          },
        ],
      })
    );

    expect(assetInserts[0].annotations).toEqual([
      { kind: "highlight", x: 1, y: 2, w: 3, h: 4 },
    ]);
    expect(assetInserts[1].annotations).toEqual([
      { kind: "hide", x: 5, y: 6, w: 7, h: 8 },
    ]);
    // The submission column tracks the screenshot the legacy URL resolves to.
    expect(inserts[0].screenshot_annotations).toEqual([
      { kind: "highlight", x: 1, y: 2, w: 3, h: 4 },
    ]);
  });

  it("saves the report even when the asset insert fails, and alerts", async () => {
    authOk(HUB_A);
    db.assetInsertError = { message: "deadlock detected" };

    const res = await post(payload({ assets: shots(2) }));

    expect(res.status).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].screenshot_storage_path).toBe(
      `${HUB_A}/screenshots/shot-0.png`
    );
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/widget/feedback (older embed compatibility, PULSE-403)", () => {
  it("maps the legacy single-path fields onto asset rows", async () => {
    authOk(HUB_A);
    const res = await post(
      payload({
        screenshotStoragePath: `${HUB_A}/screenshots/abc.png`,
        videoStoragePath: `${HUB_A}/videos/clip.webm`,
      })
    );

    expect(res.status).toBe(201);
    expect(assetInserts).toHaveLength(2);
    expect(assetInserts.map((a) => [a.kind, a.storage_path])).toEqual([
      ["screenshot", `${HUB_A}/screenshots/abc.png`],
      ["video", `${HUB_A}/videos/clip.webm`],
    ]);
    expect(assetInserts.map((a) => a.content_type)).toEqual([
      "image/png",
      "video/webm",
    ]);
    expect(assetInserts.every((a) => a.position === 0)).toBe(true);
  });

  it("carries a legacy embed's submission-level annotations onto its screenshot", async () => {
    authOk(HUB_A);
    await post(
      payload({
        screenshotStoragePath: `${HUB_A}/screenshots/abc.png`,
        screenshotAnnotations: [{ kind: "highlight", x: 1, y: 2, w: 3, h: 4 }],
      })
    );

    expect(assetInserts[0].annotations).toEqual([
      { kind: "highlight", x: 1, y: 2, w: 3, h: 4 },
    ]);
    expect(inserts[0].screenshot_annotations).toEqual([
      { kind: "highlight", x: 1, y: 2, w: 3, h: 4 },
    ]);
  });

  it("merges both payload shapes without losing or duplicating an attachment", async () => {
    authOk(HUB_A);
    await post(
      payload({
        assets: [
          {
            kind: "screenshot",
            storagePath: `${HUB_A}/screenshots/new.png`,
            contentType: "image/png",
          },
        ],
        // Same object as the asset above, plus one the new list omits.
        screenshotStoragePath: `${HUB_A}/screenshots/new.png`,
        videoStoragePath: `${HUB_A}/videos/clip.webm`,
      })
    );

    expect(assetInserts.map((a) => a.storage_path)).toEqual([
      `${HUB_A}/screenshots/new.png`,
      `${HUB_A}/videos/clip.webm`,
    ]);
  });

  it("writes no asset rows for a submission with no attachments", async () => {
    authOk(HUB_A);
    const res = await post(payload());

    expect(res.status).toBe(201);
    expect(assetInserts).toEqual([]);
    expect(inserts[0].screenshot_storage_path).toBeNull();
  });
});
