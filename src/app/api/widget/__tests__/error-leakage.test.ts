import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A 500 body is the one place a handler can hand an internal string straight
 * back to a caller. On these routes the reachable messages include Postgres
 * error text ("duplicate key value violates unique constraint …"), storage
 * paths, and Linear API errors carrying team IDs — and /api/widget/feedback is
 * unauthenticated, so anyone can trigger one. Every 500 must be the generic
 * string, with the detail going to console.error instead.
 */

const DB_MESSAGE =
  'duplicate key value violates unique constraint "widget_configs_pkey" on relation widget_configs';

const behaviour = {
  throwOnInsert: false,
  selectError: false,
};

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: () => {
        if (behaviour.throwOnInsert) throw new Error(DB_MESSAGE);
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { message: DB_MESSAGE },
            }),
          }),
        };
      },
      select: () => ({
        eq: () => ({
          order: () => {
            if (behaviour.selectError) throw new Error(DB_MESSAGE);
            return {
              range: () => ({
                eq: () => ({ data: [], error: null }),
                then: (resolve: (v: unknown) => unknown) =>
                  resolve({ data: [], error: null }),
              }),
              then: (resolve: (v: unknown) => unknown) =>
                resolve({ data: [], error: null }),
            };
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/hub-auth", () => ({
  withHubAuth: vi.fn(),
  withHubAuthWrite: vi.fn(),
}));

vi.mock("@/lib/widget-auth", () => ({
  validateWidgetRequest: vi.fn(),
  isKnownWidgetOrigin: vi.fn(async () => true),
  generateWidgetApiKey: () => "wk_generated",
  hashWidgetApiKey: async () => "hash",
  widgetApiKeyPrefix: () => "wk_gen",
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

import { withHubAuth, withHubAuthWrite } from "@/lib/hub-auth";
import { validateWidgetRequest } from "@/lib/widget-auth";
import { GET as submissionsGET } from "../submissions/route";
import { POST as configPOST } from "../config/route";
import { POST as feedbackPOST } from "../feedback/route";

const HUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const authed = {
  user: { id: "u1" },
  hubId: HUB,
  role: "member",
} as unknown as Awaited<ReturnType<typeof withHubAuth>>;

let errorLogs: unknown[][] = [];

beforeEach(() => {
  behaviour.throwOnInsert = false;
  behaviour.selectError = false;
  errorLogs = [];
  vi.mocked(withHubAuth).mockResolvedValue(authed);
  vi.mocked(withHubAuthWrite).mockResolvedValue(authed);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLogs.push(args);
  });
});

function body(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

/** Every value in the body, flattened, so a nested `detail` cannot hide. */
function bodyText(json: Record<string, unknown>): string {
  return JSON.stringify(json);
}

/** JSON.stringify(new Error(...)) is "{}", so read the logged args directly. */
function loggedText(): string {
  return errorLogs
    .flat()
    .map((arg) => {
      if (arg instanceof Error) return arg.message;
      if (arg && typeof arg === "object") return JSON.stringify(arg);
      return String(arg ?? "");
    })
    .join(" | ");
}

describe("GET /api/widget/submissions", () => {
  it("returns a generic 500 and logs the real error", async () => {
    behaviour.selectError = true;
    const res = await submissionsGET(
      new Request(`http://localhost/api/widget/submissions?hubId=${HUB}`)
    );
    expect(res.status).toBe(500);
    const json = await body(res);
    expect(json.error).toBe("Internal server error");
    expect(bodyText(json)).not.toContain("widget_configs_pkey");
    expect(loggedText()).toContain("widget_configs_pkey");
  });
});

describe("POST /api/widget/config", () => {
  it("does not return the raw insert error as `detail`", async () => {
    const res = await configPOST(
      new Request("http://localhost/api/widget/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hubId: HUB,
          name: "Site",
          allowed_origins: ["https://customer.example"],
        }),
      })
    );
    expect(res.status).toBe(500);
    const json = await body(res);
    expect(json.detail).toBeUndefined();
    expect(bodyText(json)).not.toContain("widget_configs_pkey");
    expect(loggedText()).toContain("widget_configs_pkey");
  });

  it("returns a generic 500 when the handler itself throws", async () => {
    behaviour.throwOnInsert = true;
    const res = await configPOST(
      new Request("http://localhost/api/widget/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hubId: HUB,
          allowed_origins: ["https://customer.example"],
        }),
      })
    );
    expect(res.status).toBe(500);
    const json = await body(res);
    expect(json.error).toBe("Internal server error");
    expect(bodyText(json)).not.toContain("widget_configs_pkey");
  });
});

describe("POST /api/widget/feedback", () => {
  it("returns a generic 500 to an unauthenticated caller when the handler throws", async () => {
    vi.mocked(validateWidgetRequest).mockResolvedValue({
      config: {
        id: "cfg-1",
        hub_id: HUB,
        api_key_hash: "h",
        api_key_prefix: `wk_${Math.random().toString(36).slice(2)}`,
        name: "Default",
        is_active: true,
        config: {},
        allowed_origins: [],
        output_detail_level: "standard",
        created_at: "",
        updated_at: "",
      },
    } as unknown as Awaited<ReturnType<typeof validateWidgetRequest>>);

    // Malformed JSON: request.json() throws inside the handler, and the raw
    // parser message used to be echoed back to the caller.
    const res = await feedbackPOST(
      new Request("http://localhost/api/widget/feedback", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-widget-key": "wk_abc",
          origin: "https://customer.example",
        },
        body: "{ not json",
      })
    );
    expect(res.status).toBe(500);
    const json = await body(res);
    expect(json.error).toBe("Internal server error");
    expect(bodyText(json)).not.toMatch(/JSON|token|Unexpected/i);
    expect(errorLogs.length).toBeGreaterThan(0);
  });
});
