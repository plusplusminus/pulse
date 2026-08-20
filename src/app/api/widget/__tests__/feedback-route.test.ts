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
}));

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

import { validateWidgetRequest } from "@/lib/widget-auth";
import { createWidgetLinearIssue } from "@/lib/widget-linear";
import { POST } from "../feedback/route";

const mockedValidate = vi.mocked(validateWidgetRequest);
const mockedCreateIssue = vi.mocked(createWidgetLinearIssue);

function authOk(hubId = HUB_A) {
  mockedValidate.mockResolvedValue({
    config: {
      id: "cfg-1",
      hub_id: hubId,
      api_key_hash: "h",
      api_key_prefix: `wk_${Math.random().toString(36).slice(2)}`,
      name: "Default",
      is_active: true,
      config: {},
      allowed_origins: [],
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

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/widget/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-widget-key": "wk_abc",
        origin: "https://customer.example",
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
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pulse.test");
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
