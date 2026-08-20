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
