import { describe, it, expect } from "vitest";
import {
  buildBootstrapPayload,
  parseMaskSelectors,
  BOOTSTRAP_DEFAULTS,
} from "../widget-bootstrap";
import type { WidgetConfig } from "../widget-types";

const row: WidgetConfig = {
  id: "cfg_1",
  hub_id: "hub_1",
  api_key_hash: "deadbeef".repeat(8),
  api_key_prefix: "sk_deadbee",
  name: "Acme site",
  is_active: true,
  config: {},
  allowed_origins: ["https://acme.example"],
  output_detail_level: "standard",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("buildBootstrapPayload", () => {
  it("applies safe defaults for an empty config: screenshot only, everything else off", () => {
    const payload = buildBootstrapPayload(row, { apiBase: "https://pulse.test/" });
    expect(payload).toEqual({
      site: { name: "Acme site" },
      api: { base: "https://pulse.test" },
      ...BOOTSTRAP_DEFAULTS,
    });
    expect(payload.capture.console).toBe(false);
    expect(payload.capture.sentry).toBe(false);
    expect(payload.capture.replay.enabled).toBe(false);
  });

  it("treats a null config column like an empty one", () => {
    const payload = buildBootstrapPayload({ name: "x", config: null }, { apiBase: "https://p" });
    expect(payload.ui).toEqual(BOOTSTRAP_DEFAULTS.ui);
  });

  it("honours stored overrides", () => {
    const payload = buildBootstrapPayload(
      {
        ...row,
        config: {
          theme: "dark",
          position: "bottom-left",
          triggerText: "  Report a bug  ",
          capture: {
            screenshot: false,
            elementPick: true,
            console: true,
            replay: { enabled: true, bufferSeconds: 45, maskAllInputs: false },
          },
          privacy: { maskSelectors: [".secret", "[data-pii]"] },
        },
      },
      { apiBase: "https://pulse.test" }
    );
    expect(payload.ui).toEqual({ theme: "dark", position: "bottom-left", triggerText: "Report a bug" });
    expect(payload.capture).toMatchObject({
      screenshot: false,
      elementPick: true,
      console: true,
      captureTab: false,
      replay: { enabled: true, bufferSeconds: 45, maskAllInputs: false },
    });
    expect(payload.privacy.maskSelectors).toEqual([".secret", "[data-pii]"]);
  });

  it("rejects invalid enum values and clamps the replay buffer", () => {
    const payload = buildBootstrapPayload(
      {
        ...row,
        config: {
          // @ts-expect-error invalid stored value
          theme: "neon",
          // @ts-expect-error invalid stored value
          position: "top",
          capture: { replay: { bufferSeconds: 9999 } },
        },
      },
      { apiBase: "https://pulse.test" }
    );
    expect(payload.ui.theme).toBe("auto");
    expect(payload.ui.position).toBe("bottom-right");
    expect(payload.capture.replay.bufferSeconds).toBe(120);
    expect(
      buildBootstrapPayload({ ...row, config: { capture: { replay: { bufferSeconds: 1 } } } }, { apiBase: "x" })
        .capture.replay.bufferSeconds
    ).toBe(5);
  });

  it("never leaks the key hash, prefix, hub id or origins", () => {
    const json = JSON.stringify(buildBootstrapPayload(row, { apiBase: "https://pulse.test" }));
    expect(json).not.toContain(row.api_key_hash);
    expect(json).not.toContain(row.api_key_prefix);
    expect(json).not.toContain(row.hub_id);
    expect(json).not.toContain("acme.example");
    expect(json).not.toContain("allowed_origins");
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(["api", "capture", "privacy", "site", "ui"]);
  });
});

describe("parseMaskSelectors", () => {
  it("accepts arrays or newline/comma separated text, trims and dedupes", () => {
    expect(parseMaskSelectors(" .a \n\n.b,.a ")).toEqual([".a", ".b"]);
    expect(parseMaskSelectors([".x", " ", ".x", 3 as unknown as string])).toEqual([".x"]);
    expect(parseMaskSelectors(undefined)).toEqual([]);
  });
});
