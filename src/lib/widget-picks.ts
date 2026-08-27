import { z } from "zod";
import {
  ANNOTATION_COLORS,
  OUTPUT_DETAIL_LEVELS,
  PICK_INTENTS,
  type OutputDetailLevel,
  type ScreenshotAnnotation,
  type WidgetPick,
} from "@/lib/widget-types";

// Request validation for element picks (PULSE-329). Limits bound the JSONB row:
// a fully captured pick is ~3-5 KB, 50 picks ~250 KB.

export const MAX_PICKS = 50;

/**
 * Utility-first frameworks put design tokens in the class attribute, so one
 * element routinely carries 20+ classes of 50 chars each (a real capture:
 * 610 chars over 22 classes). The old 500 cap rejected the whole submission —
 * media already uploaded — over the least identifying field in the pick.
 * The widget clamps to the same number, so this is the backstop, not the gate.
 */
export const MAX_PICK_CLASSES = 2000;

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const widgetPickSchema = z.object({
  id: z.string().min(1).max(64),

  elementPath: z.string().max(500),
  name: z.string().max(200),
  classes: z.string().max(MAX_PICK_CLASSES),
  boundingBox: rectSchema,
  nearbyText: z.string().max(300),
  comment: z.string().max(1000),
  intent: z.enum(PICK_INTENTS),
  isFixed: z.boolean(),

  isMultiSelect: z.boolean().optional(),
  isArea: z.boolean().optional(),
  areaRect: rectSchema.optional(),
  elementBoundingBoxes: z.array(rectSchema).max(MAX_PICKS).optional(),

  selectedText: z.string().max(500).optional(),
  fullPath: z.string().max(2000).optional(),
  computedStyles: z
    .record(z.string().max(50), z.string().max(200))
    .refine((r) => Object.keys(r).length <= 30, "computedStyles: max 30 keys")
    .optional(),
  accessibility: z.string().max(300).optional(),
  nearbyElements: z.string().max(500).optional(),

  selector: z.string().max(500).nullable().optional(),
  xpath: z.string().max(1000).optional(),
  relocation: z
    .object({
      rect: rectSchema.extend({
        top: z.number(),
        left: z.number(),
        right: z.number(),
        bottom: z.number(),
      }),
      scrollX: z.number(),
      scrollY: z.number(),
      viewport: z.object({ width: z.number(), height: z.number() }),
      dpr: z.number(),
      textHash: z.string().max(16),
    })
    .optional(),
}) satisfies z.ZodType<WidgetPick>;

export const picksSchema = z.array(widgetPickSchema).max(MAX_PICKS).default([]);

// Screenshot annotations (PULSE-333, union in PULSE-401): vector marks in
// image-pixel space. `satisfies z.ZodType<ScreenshotAnnotation>` at the bottom
// is what keeps this in lockstep with the two hand-written declarations in
// src/lib/widget-types.ts and packages/feedback-widget/src/types.ts — adding a
// kind to either without adding it here is a compile error.
export const MAX_ANNOTATIONS = 50;

/** A freehand path longer than this is a scribble nobody will read; it also bounds the JSONB row. */
export const MAX_PEN_POINTS = 2000;
export const MAX_ANNOTATION_TEXT = 500;

/**
 * Sizes are in image pixels with DPR already applied, so a 2x capture legitimately
 * carries a 2x stroke. The ceiling is a sanity bound, not a design limit.
 */
const strokeWidthSchema = z.number().positive().max(400);

const colorSchema = z.enum(ANNOTATION_COLORS);

const rectGeometry = {
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
};

const strokeFields = {
  color: colorSchema,
  strokeWidth: strokeWidthSchema,
};

export const screenshotAnnotationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("highlight"), ...rectGeometry }),
  z.object({ kind: z.literal("hide"), ...rectGeometry }),
  z.object({ kind: z.literal("rect"), ...rectGeometry, ...strokeFields }),
  z.object({ kind: z.literal("ellipse"), ...rectGeometry, ...strokeFields }),
  z.object({
    kind: z.literal("arrow"),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    ...strokeFields,
  }),
  z.object({
    kind: z.literal("pen"),
    points: z.array(z.number()).max(MAX_PEN_POINTS),
    ...strokeFields,
  }),
  z.object({
    kind: z.literal("text"),
    x: z.number(),
    y: z.number(),
    text: z.string().min(1).max(MAX_ANNOTATION_TEXT),
    color: colorSchema,
    fontSize: z.number().positive().max(2000),
  }),
]) satisfies z.ZodType<ScreenshotAnnotation>;

export const screenshotAnnotationsSchema = z
  .array(screenshotAnnotationSchema)
  .max(MAX_ANNOTATIONS)
  .default([]);

export const outputDetailLevelSchema = z.enum(OUTPUT_DETAIL_LEVELS);

export function isOutputDetailLevel(value: unknown): value is OutputDetailLevel {
  return outputDetailLevelSchema.safeParse(value).success;
}
