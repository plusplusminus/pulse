import { describe, it, expect } from "vitest";
import {
  widgetPickSchema,
  picksSchema,
  isOutputDetailLevel,
  MAX_PICKS,
} from "../widget-picks";
import type { WidgetPick } from "../widget-types";

const basePick: WidgetPick = {
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

describe("widgetPickSchema", () => {
  it("accepts a minimal pick and a fully populated one", () => {
    expect(widgetPickSchema.safeParse(basePick).success).toBe(true);
    const full: WidgetPick = {
      ...basePick,
      isMultiSelect: true,
      elementBoundingBoxes: [{ x: 0, y: 0, width: 1, height: 1 }],
      selectedText: "Sign up now",
      fullPath: "html > body > main > button",
      computedStyles: { color: "rgb(0, 0, 0)" },
      accessibility: 'role="button", focusable',
      nearbyElements: "a.link, div.spacer",
      selector: "main > .hero > button",
      xpath: "/html/body/main/button",
      relocation: {
        rect: { x: 1, y: 2, width: 3, height: 4, top: 2, left: 1, right: 4, bottom: 6 },
        scrollX: 0,
        scrollY: 0,
        viewport: { width: 1280, height: 800 },
        dpr: 2,
        textHash: "4f9f2cab",
      },
    };
    expect(widgetPickSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ["intent", { intent: "delete" }],
    ["comment > 1000", { comment: "x".repeat(1001) }],
    ["selectedText > 500", { selectedText: "x".repeat(501) }],
    ["nearbyElements > 500", { nearbyElements: "x".repeat(501) }],
    ["accessibility > 300", { accessibility: "x".repeat(301) }],
    ["computedStyles value > 200", { computedStyles: { color: "x".repeat(201) } }],
    [
      "computedStyles > 30 keys",
      { computedStyles: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`p${i}`, "v"])) },
    ],
    ["missing boundingBox", { boundingBox: undefined }],
  ])("rejects %s", (_label, patch) => {
    expect(widgetPickSchema.safeParse({ ...basePick, ...patch }).success).toBe(false);
  });

  it("accepts exactly 30 computedStyles keys and a 1000-char comment", () => {
    const ok = {
      ...basePick,
      comment: "x".repeat(1000),
      computedStyles: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, "v"])),
    };
    expect(widgetPickSchema.safeParse(ok).success).toBe(true);
  });
});

describe("picksSchema", () => {
  it("defaults to [] and caps at MAX_PICKS", () => {
    expect(picksSchema.parse(undefined)).toEqual([]);
    expect(picksSchema.safeParse(Array.from({ length: MAX_PICKS }, () => basePick)).success).toBe(true);
    expect(picksSchema.safeParse(Array.from({ length: MAX_PICKS + 1 }, () => basePick)).success).toBe(false);
  });
});

describe("isOutputDetailLevel", () => {
  it("accepts the four levels only", () => {
    for (const l of ["compact", "standard", "detailed", "forensic"]) expect(isOutputDetailLevel(l)).toBe(true);
    expect(isOutputDetailLevel("verbose")).toBe(false);
    expect(isOutputDetailLevel(undefined)).toBe(false);
  });
});
