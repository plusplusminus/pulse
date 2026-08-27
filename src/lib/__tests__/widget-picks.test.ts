import { describe, it, expect } from "vitest";
import {
  widgetPickSchema,
  picksSchema,
  isOutputDetailLevel,
  screenshotAnnotationSchema,
  screenshotAnnotationsSchema,
  MAX_ANNOTATIONS,
  MAX_ANNOTATION_TEXT,
  MAX_PEN_POINTS,
  MAX_PICKS,
  MAX_PICK_CLASSES,
} from "../widget-picks";
import { ANNOTATION_COLORS, ANNOTATION_KINDS } from "../widget-types";
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

describe("widgetPickSchema classes cap", () => {
  // Real capture from priority-pass-b2b-showcase: 22 design-token classes.
  const realClasses = [
    "inline-flex", "items-center", "justify-center", "gap-[var(--space-8)]",
    "rounded-pp-sm", "font-pp-sans", "font-pp-medium", "whitespace-nowrap",
    "transition-colors", "text-[length:var(--font-size-body-sm)]",
    "leading-[var(--font-line-height-body-sm)]",
    "tracking-[var(--font-letter-spacing-body-sm)]",
    "disabled:pointer-events-none", "disabled:opacity-40",
    "focus-visible:outline-[length:var(--focus-ring-width)]",
    "focus-visible:outline-offset-[var(--focus-ring-offset)]",
    "focus-visible:outline-pp-focus-default", "bg-pp-action-contrast",
    "text-pp-action-on-contrast", "hover:bg-pp-action-contrast-hover",
    "px-[var(--space-24)]", "py-[var(--space-16)]",
  ].join(", ");

  it("accepts the 610-char list that the old 500 cap rejected", () => {
    expect(realClasses.length).toBeGreaterThan(500);
    const parsed = widgetPickSchema.safeParse({ ...basePick, classes: realClasses });
    expect(parsed.success).toBe(true);
  });

  it("still rejects beyond the cap, and names the field in the issue path", () => {
    const parsed = picksSchema.safeParse([
      { ...basePick, classes: "x".repeat(MAX_PICK_CLASSES + 1) },
    ]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path.join(".")).toBe("0.classes");
    }
  });
});

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

describe("screenshotAnnotationsSchema", () => {
  const rect = { kind: "highlight", x: 10, y: 20, w: 100, h: 50 };
  const arrow = {
    kind: "arrow",
    x1: 0,
    y1: 0,
    x2: 50,
    y2: 60,
    color: "#ef4444",
    strokeWidth: 4,
  };
  const pen = { kind: "pen", points: [0, 0, 5, 5], color: "#22c55e", strokeWidth: 2 };
  const text = {
    kind: "text",
    x: 10,
    y: 20,
    text: "here",
    color: "#3b82f6",
    fontSize: 24,
  };

  /** One sample per kind; a test below pins that the set covers ANNOTATION_KINDS. */
  const SAMPLES = [
    rect,
    { ...rect, kind: "hide" },
    { ...rect, kind: "rect", color: "#ef4444", strokeWidth: 3 },
    { ...rect, kind: "ellipse", color: "#111827", strokeWidth: 3 },
    arrow,
    pen,
    text,
  ] as const;

  it("defaults to [] and caps at MAX_ANNOTATIONS", () => {
    expect(screenshotAnnotationsSchema.parse(undefined)).toEqual([]);
    expect(
      screenshotAnnotationsSchema.safeParse(Array.from({ length: MAX_ANNOTATIONS }, () => rect)).success
    ).toBe(true);
    expect(
      screenshotAnnotationsSchema.safeParse(Array.from({ length: MAX_ANNOTATIONS + 1 }, () => rect)).success
    ).toBe(false);
  });

  it("accepts every declared kind and rejects anything else", () => {
    for (const sample of SAMPLES) {
      expect(screenshotAnnotationSchema.safeParse(sample).success).toBe(true);
    }
    expect(screenshotAnnotationSchema.safeParse({ ...rect, kind: "redact" }).success).toBe(false);
  });

  it("covers every kind in ANNOTATION_KINDS — a new kind cannot be added unvalidated", () => {
    expect(SAMPLES.map((s) => s.kind).sort()).toEqual([...ANNOTATION_KINDS].sort());
  });

  it("keeps highlight and hide rect-only, so rows written before the union still parse", () => {
    const legacy = { kind: "hide", x: 1, y: 2, w: 3, h: 4 };
    expect(screenshotAnnotationSchema.parse(legacy)).toEqual(legacy);
    expect(screenshotAnnotationSchema.parse({ ...rect })).toEqual(rect);
  });

  it("holds every styled kind to the fixed palette", () => {
    for (const sample of SAMPLES) {
      if (!("color" in sample)) continue;
      expect(
        screenshotAnnotationSchema.safeParse({ ...sample, color: "#123456" }).success
      ).toBe(false);
    }
    for (const color of ANNOTATION_COLORS) {
      expect(screenshotAnnotationSchema.safeParse({ ...arrow, color }).success).toBe(true);
    }
  });

  it("requires a colour and a stroke on the drawn kinds", () => {
    const shaft = { kind: "arrow", x1: 0, y1: 0, x2: 50, y2: 60 };
    expect(screenshotAnnotationSchema.safeParse({ ...shaft, strokeWidth: 4 }).success).toBe(false);
    expect(screenshotAnnotationSchema.safeParse({ ...shaft, color: "#ef4444" }).success).toBe(false);
    expect(screenshotAnnotationSchema.safeParse({ ...arrow, strokeWidth: 0 }).success).toBe(false);
  });

  it("bounds a pen path and a label, so one mark cannot bloat the row", () => {
    const points = Array.from({ length: MAX_PEN_POINTS }, (_, i) => i);
    expect(screenshotAnnotationSchema.safeParse({ ...pen, points }).success).toBe(true);
    expect(
      screenshotAnnotationSchema.safeParse({ ...pen, points: [...points, 1] }).success
    ).toBe(false);
    expect(
      screenshotAnnotationSchema.safeParse({ ...text, text: "x".repeat(MAX_ANNOTATION_TEXT) })
        .success
    ).toBe(true);
    expect(
      screenshotAnnotationSchema.safeParse({ ...text, text: "x".repeat(MAX_ANNOTATION_TEXT + 1) })
        .success
    ).toBe(false);
  });

  it("rejects an empty label — a mark with nothing in it is not a mark", () => {
    expect(screenshotAnnotationSchema.safeParse({ ...text, text: "" }).success).toBe(false);
  });

  it("rejects negative extents but allows negative origins (a rect may start off-canvas)", () => {
    expect(screenshotAnnotationSchema.safeParse({ ...rect, w: -1 }).success).toBe(false);
    expect(screenshotAnnotationSchema.safeParse({ ...rect, h: -1 }).success).toBe(false);
    expect(screenshotAnnotationSchema.safeParse({ ...rect, x: -5, y: -5 }).success).toBe(true);
  });

  it("rejects a missing dimension", () => {
    expect(screenshotAnnotationSchema.safeParse({ kind: "hide", x: 0, y: 0, w: 1 }).success).toBe(false);
  });
});

describe("isOutputDetailLevel", () => {
  it("accepts the four levels only", () => {
    for (const l of ["compact", "standard", "detailed", "forensic"]) expect(isOutputDetailLevel(l)).toBe(true);
    expect(isOutputDetailLevel("verbose")).toBe(false);
    expect(isOutputDetailLevel(undefined)).toBe(false);
  });
});
