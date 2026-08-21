import { describe, it, expect } from "vitest";
import {
  ANNOTATION_COLORS as APP_COLORS,
  ANNOTATION_KINDS as APP_KINDS,
  type ScreenshotAnnotation as AppAnnotation,
} from "../widget-types";
import {
  ANNOTATION_COLORS as WIDGET_COLORS,
  ANNOTATION_KINDS as WIDGET_KINDS,
  type ScreenshotAnnotation as WidgetAnnotation,
} from "../../../packages/feedback-widget/src/types";
import { screenshotAnnotationSchema } from "../widget-picks";

/**
 * ScreenshotAnnotation is declared three times and all three must agree
 * (PULSE-401):
 *
 *   1. packages/feedback-widget/src/types.ts — the widget ships standalone and
 *      cannot import from the app, so its copy is hand-written.
 *   2. src/lib/widget-types.ts — what the app and the database row use.
 *   3. the zod schema in src/lib/widget-picks.ts — what the API accepts.
 *
 * (2) and (3) are already welded together by `satisfies z.ZodType<...>`, which
 * fails to compile if the schema drifts from the type. This file is what welds
 * (1) to them: the assignments below are compile-time proof that the two
 * declarations describe the same shape in BOTH directions, and the runtime
 * assertions catch a kind or colour added to one list and not the others.
 */

describe("ScreenshotAnnotation declarations", () => {
  it("declares the same kinds on the widget side and the app side", () => {
    expect([...WIDGET_KINDS]).toEqual([...APP_KINDS]);
  });

  it("declares the same palette on both sides", () => {
    expect([...WIDGET_COLORS]).toEqual([...APP_COLORS]);
  });

  it("accepts every kind the widget can produce through the API schema", () => {
    for (const kind of WIDGET_KINDS) {
      const sample = SAMPLES[kind];
      const parsed = screenshotAnnotationSchema.safeParse(sample);
      expect(parsed.success, `${kind} was rejected by the API schema`).toBe(true);
    }
  });

  it("round-trips every kind through the schema unchanged", () => {
    for (const kind of WIDGET_KINDS) {
      expect(screenshotAnnotationSchema.parse(SAMPLES[kind])).toEqual(SAMPLES[kind]);
    }
  });
});

/**
 * One sample per kind, typed as the WIDGET's union and consumed as the APP's.
 * If either declaration gains, loses or reshapes a member, this stops compiling
 * — which is the point: the mismatch is caught at build time, not in
 * production when a mark fails validation at the API.
 */
const SAMPLES: Record<WidgetAnnotation["kind"], WidgetAnnotation> = {
  highlight: { kind: "highlight", x: 10, y: 20, w: 30, h: 40 },
  hide: { kind: "hide", x: 1, y: 2, w: 3, h: 4 },
  rect: { kind: "rect", x: 5, y: 6, w: 70, h: 80, color: "#ef4444", strokeWidth: 3 },
  ellipse: { kind: "ellipse", x: 7, y: 8, w: 90, h: 100, color: "#3b82f6", strokeWidth: 5 },
  arrow: { kind: "arrow", x1: 0, y1: 0, x2: 50, y2: 60, color: "#22c55e", strokeWidth: 4 },
  pen: { kind: "pen", points: [0, 0, 5, 5, 10, 2], color: "#f59e0b", strokeWidth: 2 },
  text: { kind: "text", x: 12, y: 34, text: "here", color: "#111827", fontSize: 24 },
};

// Compile-time proof of mutual assignability, in both directions.
const widgetToApp: AppAnnotation[] = Object.values(SAMPLES);
const appToWidget: WidgetAnnotation[] = widgetToApp;
void appToWidget;
