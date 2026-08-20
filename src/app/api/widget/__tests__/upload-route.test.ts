import { beforeEach, describe, expect, it, vi } from "vitest";

const signedUploads: string[] = [];

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
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
  isKnownWidgetOrigin: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

// Real checkRateLimit over an injected in-memory limiter (one per budget).
const rateLimit = vi.hoisted(() => ({
  fakes: null as null | { reset(): void },
}));
vi.mock("@/lib/widget-rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/widget-rate-limit")>(
    "@/lib/widget-rate-limit"
  );
  const { createFakeRateLimiterFactory } = await import("@/lib/__tests__/fake-rate-limiter");
  const fakes = createFakeRateLimiterFactory(() => Date.now());
  rateLimit.fakes = fakes;
  return {
    ...actual,
    checkRateLimit: (input: Parameters<typeof actual.checkRateLimit>[0]) =>
      actual.checkRateLimit(input, { limiter: fakes.get(input.limit, input.windowMs) }),
  };
});

import { isKnownWidgetOrigin, validateWidgetRequest } from "@/lib/widget-auth";
import { OPTIONS, POST } from "../upload/route";

const HUB = "11111111-1111-1111-1111-111111111111";
const mockedValidate = vi.mocked(validateWidgetRequest);
const mockedKnownOrigin = vi.mocked(isKnownWidgetOrigin);

function authOk(prefix = "wk_abc") {
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

type TicketBody = {
  storagePath: string;
  uploadUrl: string;
  token: string;
  bucket: string;
  resumableEndpoint: string;
  maxBytes: number;
  expiresAt: string;
  error?: string;
};

function readJson(res: Response): Promise<TicketBody> {
  return res.json() as Promise<TicketBody>;
}

function post(
  body: unknown,
  origin = "https://customer.example",
  extraHeaders: Record<string, string> = {}
) {
  return POST(
    new Request("http://localhost/api/widget/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-widget-key": "wk_abc123",
        origin,
        ...extraHeaders,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  signedUploads.length = 0;
  mockedValidate.mockReset();
  mockedKnownOrigin.mockReset();
  mockedKnownOrigin.mockResolvedValue(true);
  rateLimit.fakes?.reset();
});

function preflight(origin: string) {
  return OPTIONS(
    new Request("http://localhost/api/widget/upload", {
      method: "OPTIONS",
      headers: { origin },
    })
  );
}

describe("OPTIONS /api/widget/upload", () => {
  it("answers the preflight with CORS headers for a known origin", async () => {
    const res = await preflight("https://customer.example");
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://customer.example"
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-Site-Key");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("grants no CORS to an unknown origin", async () => {
    mockedKnownOrigin.mockResolvedValue(false);
    const res = await preflight("https://evil.example");
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });
});

describe("POST /api/widget/upload", () => {
  it("rejects when the origin check fails, with no CORS on the 403", async () => {
    mockedValidate.mockResolvedValue({ error: "Origin not allowed", status: 403 });
    const res = await post({
      kind: "screenshot",
      contentType: "image/png",
      sizeBytes: 1024,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(signedUploads).toEqual([]);
  });

  it("keeps a 401 on a known origin readable by the page", async () => {
    mockedValidate.mockResolvedValue({ error: "Invalid or inactive widget key", status: 401 });
    const res = await post({
      kind: "screenshot",
      contentType: "image/png",
      sizeBytes: 1024,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://customer.example");
    expect(signedUploads).toEqual([]);
  });

  it("returns a signed upload ticket scoped to the site's hub", async () => {
    authOk();
    const res = await post({
      kind: "screenshot",
      contentType: "image/png",
      sizeBytes: 1024,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://customer.example"
    );
    const body = await readJson(res);
    expect(body.storagePath).toMatch(
      new RegExp(`^${HUB}/screenshots/[0-9a-f-]{36}\\.png$`)
    );
    expect(body.uploadUrl).toContain(
      `/object/upload/sign/widget-media/${body.storagePath}?token=tok`
    );
    expect(body.token).toBe("tok");
    expect(body.bucket).toBe("widget-media");
    expect(body.resumableEndpoint).toBe(
      "https://proj.supabase.co/storage/v1/upload/resumable"
    );
    expect(body.maxBytes).toBe(10 * 1024 * 1024);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(signedUploads).toEqual([body.storagePath]);
  });

  it("rejects a malformed body", async () => {
    authOk();
    expect((await post("not json")).status).toBe(400);
    expect((await post({ kind: "screenshot" })).status).toBe(400);
    expect(
      (
        await post({
          kind: "document",
          contentType: "application/pdf",
          sizeBytes: 10,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await post({
          kind: "screenshot",
          contentType: "image/png",
          sizeBytes: -1,
        })
      ).status
    ).toBe(400);
    expect(signedUploads).toEqual([]);
  });

  it("rejects a content type that is not allowed for the kind", async () => {
    authOk();
    const res = await post({
      kind: "screenshot",
      contentType: "video/webm",
      sizeBytes: 10,
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/not allowed for screenshot/);
    expect(signedUploads).toEqual([]);
  });

  it("rejects sizeBytes over the per-kind cap before signing", async () => {
    authOk();
    const cases: Array<[string, string, number]> = [
      ["screenshot", "image/png", 10 * 1024 * 1024 + 1],
      ["video", "video/webm", 100 * 1024 * 1024 + 1],
      ["replay", "application/json", 20 * 1024 * 1024 + 1],
    ];
    for (const [kind, contentType, sizeBytes] of cases) {
      const res = await post({ kind, contentType, sizeBytes });
      expect(res.status).toBe(413);
      expect((await readJson(res)).error).toMatch(/size limit/);
    }
    expect(signedUploads).toEqual([]);
  });

  it("accepts sizes exactly at the cap", async () => {
    authOk();
    const res = await post({
      kind: "video",
      contentType: "video/mp4",
      sizeBytes: 100 * 1024 * 1024,
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).storagePath).toMatch(/\/videos\/.+\.mp4$/);
  });

  it("rate-limits an IP after 10 tickets per minute; another IP still gets tickets", async () => {
    authOk("wk_ratelimited");
    const body = { kind: "screenshot", contentType: "image/png", sizeBytes: 1 };
    const ipA = { "x-forwarded-for": "198.51.100.4, 10.0.0.1" };
    for (let i = 0; i < 10; i++) {
      expect((await post(body, undefined, ipA)).status).toBe(200);
    }
    const res = await post(body, undefined, ipA);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://customer.example");
    expect(signedUploads).toHaveLength(10);

    const other = await post(body, undefined, { "x-forwarded-for": "198.51.100.5" });
    expect(other.status).toBe(200);
  });

  it("rate-limits a site after 60 tickets per minute across IPs", async () => {
    authOk("wk_sitelimited");
    const body = { kind: "screenshot", contentType: "image/png", sizeBytes: 1 };
    for (let i = 0; i < 60; i++) {
      const res = await post(body, undefined, { "x-forwarded-for": `10.1.${i}.1` });
      expect(res.status).toBe(200);
    }
    const res = await post(body, undefined, { "x-forwarded-for": "10.9.9.9" });
    expect(res.status).toBe(429);
    expect(signedUploads).toHaveLength(60);
  });
});
