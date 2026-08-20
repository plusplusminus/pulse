import { z } from "zod";
import {
  ANNOTATION_KINDS,
  OUTPUT_DETAIL_LEVELS,
  PICK_INTENTS,
  type OutputDetailLevel,
  type ScreenshotAnnotation,
  type WidgetPick,
} from "@/lib/widget-types";

// Request validation for element picks (PULSE-329). Limits bound the JSONB row:
// a fully captured pick is ~3-5 KB, 50 picks ~250 KB.

export const MAX_PICKS = 50;

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
  classes: z.string().max(500),
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

// Screenshot annotations (PULSE-333): vector rects in image-pixel space.
export const MAX_ANNOTATIONS = 50;

export const screenshotAnnotationSchema = z.object({
  kind: z.enum(ANNOTATION_KINDS),
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
}) satisfies z.ZodType<ScreenshotAnnotation>;

export const screenshotAnnotationsSchema = z
  .array(screenshotAnnotationSchema)
  .max(MAX_ANNOTATIONS)
  .default([]);

export const outputDetailLevelSchema = z.enum(OUTPUT_DETAIL_LEVELS);

export function isOutputDetailLevel(value: unknown): value is OutputDetailLevel {
  return outputDetailLevelSchema.safeParse(value).success;
}
