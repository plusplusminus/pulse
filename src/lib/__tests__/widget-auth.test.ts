import { describe, it, expect, vi } from "vitest";

vi.mock("../supabase", () => ({ supabaseAdmin: {} }));

import {
  generateWidgetApiKey,
  widgetApiKeyPrefix,
  readSiteKey,
  hashWidgetApiKey,
  SITE_KEY_HEADER,
} from "../widget-auth";

describe("site keys", () => {
  it("issues sk_-prefixed 32-hex keys and a 10-char prefix", () => {
    const key = generateWidgetApiKey();
    expect(key).toMatch(/^sk_[0-9a-f]{32}$/);
    expect(widgetApiKeyPrefix(key)).toBe(key.slice(0, 10));
    expect(widgetApiKeyPrefix(key)).toHaveLength(10);
  });

  it("hashes deterministically and never stores the raw key", async () => {
    const key = generateWidgetApiKey();
    const hash = await hashWidgetApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashWidgetApiKey(key)).toBe(hash);
    expect(hash).not.toContain(key.slice(3));
  });
});

describe("readSiteKey", () => {
  it("reads X-Site-Key", () => {
    const req = new Request("https://pulse.test/api/widget/feedback", {
      headers: { [SITE_KEY_HEADER]: "sk_abc" },
    });
    expect(readSiteKey(req)).toBe("sk_abc");
  });

  it("falls back to the legacy X-Widget-Key header", () => {
    const req = new Request("https://pulse.test/api/widget/feedback", {
      headers: { "X-Widget-Key": "wk_old" },
    });
    expect(readSiteKey(req)).toBe("wk_old");
  });

  it("prefers X-Site-Key when both are present and returns null when neither is", () => {
    const both = new Request("https://pulse.test/", {
      headers: { "X-Site-Key": "sk_new", "X-Widget-Key": "wk_old" },
    });
    expect(readSiteKey(both)).toBe("sk_new");
    expect(readSiteKey(new Request("https://pulse.test/"))).toBeNull();
  });
});

describe("validateWidgetRequest", () => {
  // Re-import with a supabase mock that returns a fixed config for any hash.
  const makeConfig = (allowed_origins: string[], is_active = true) => ({
    id: "cfg_1",
    hub_id: "hub_1",
    api_key_hash: "h",
    api_key_prefix: "sk_abc",
    name: "Site",
    is_active,
    config: {},
    allowed_origins,
    created_at: "",
    updated_at: "",
  });

  async function load(row: ReturnType<typeof makeConfig> | null) {
    vi.resetModules();
    vi.doMock("../supabase", () => ({
      supabaseAdmin: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({ data: row, error: row ? null : { message: "nf" } }),
            }),
          }),
        }),
      },
    }));
    return import("../widget-auth");
  }

  const req = (headers: Record<string, string>) =>
    new Request("https://pulse.test/api/widget/feedback", { method: "POST", headers });

  it("401 without a site key", async () => {
    const { validateWidgetRequest } = await load(makeConfig(["https://acme.example"]));
    expect(await validateWidgetRequest(req({ Origin: "https://acme.example" }))).toMatchObject({ status: 401 });
  });

  it("401 for an unknown or inactive key", async () => {
    const { validateWidgetRequest } = await load(null);
    expect(await validateWidgetRequest(req({ "X-Site-Key": "sk_x", Origin: "https://acme.example" }))).toMatchObject({ status: 401 });
    const inactive = await load(makeConfig(["https://acme.example"], false));
    expect(await inactive.validateWidgetRequest(req({ "X-Site-Key": "sk_x", Origin: "https://acme.example" }))).toMatchObject({ status: 401 });
  });

  it("403 for a non-allowlisted origin, a missing Origin, or an empty allowlist", async () => {
    const { validateWidgetRequest } = await load(makeConfig(["https://acme.example"]));
    expect(await validateWidgetRequest(req({ "X-Site-Key": "sk_x", Origin: "https://evil.example" }))).toMatchObject({ status: 403 });
    expect(await validateWidgetRequest(req({ "X-Site-Key": "sk_x" }))).toMatchObject({ status: 403 });
    const empty = await load(makeConfig([]));
    expect(await empty.validateWidgetRequest(req({ "X-Site-Key": "sk_x", Origin: "https://acme.example" }))).toMatchObject({ status: 403 });
  });

  it("returns the config for an allowlisted origin (normalised match)", async () => {
    const { validateWidgetRequest } = await load(makeConfig(["https://Acme.Example/"]));
    const result = await validateWidgetRequest(req({ "X-Widget-Key": "sk_x", Origin: "https://acme.example" }));
    expect("config" in result && result.config.id).toBe("cfg_1");
  });
});
