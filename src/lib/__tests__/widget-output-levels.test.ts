import { describe, it, expect } from "vitest";
import { OUTPUT_LEVEL_COPY, outputLevelCopy } from "@/lib/widget-output-levels";
import { renderSubmissionBody } from "@/lib/widget-linear";
import { OUTPUT_DETAIL_LEVELS, type WidgetMetadata, type WidgetPick } from "@/lib/widget-types";

const metadata: WidgetMetadata = {
  url: "https://acme.test/pricing",
  userAgent: "Mozilla/5.0",
  viewport: { width: 1440, height: 900 },
  timestamp: "2026-05-12T10:00:00.000Z",
  console: [],
  sentry: null,
  custom: {},
};

/** The pick the admin previews describe. */
const samplePick: WidgetPick = {
  id: "p1",
  elementPath: "main > section.hero > .cta > button",
  name: 'button "Sign up"',
  classes: "btn btn-primary",
  boundingBox: { x: 120, y: 340, width: 180, height: 44 },
  nearbyText: '[before: "Get started"] CTA',
  comment: "Make this bigger",
  intent: "fix",
  isFixed: false,
  fullPath: "html > body > main.app > section.hero > div.cta > button.btn",
  computedStyles: { color: "rgb(255,255,255)", "font-size": "16px" },
  accessibility: 'role="button", aria-label="Sign up", focusable',
  nearbyElements: "a.link, div.spacer (5 total in .cta)",
};

const submission = {
  reporter: { email: "sam@acme.test" },
  metadata,
};

describe("OUTPUT_LEVEL_COPY", () => {
  it("covers every level exactly once, in menu order", () => {
    expect(OUTPUT_LEVEL_COPY.map((c) => c.level)).toEqual([...OUTPUT_DETAIL_LEVELS]);
  });

  it("has help copy and a 2-4 line preview for each level", () => {
    for (const copy of OUTPUT_LEVEL_COPY) {
      expect(copy.help.length).toBeGreaterThan(20);
      expect(copy.preview.length).toBeGreaterThanOrEqual(2);
      expect(copy.preview.length).toBeLessThanOrEqual(4);
    }
  });

  // The guard that matters: an admin preview that lies is worse than none.
  it.each(OUTPUT_LEVEL_COPY.map((c) => [c.level, c] as const))(
    "%s preview lines all appear in real rendered output",
    (level, copy) => {
      const body = renderSubmissionBody({
        submission,
        picks: [samplePick],
        config: { output_detail_level: level },
      });
      for (const line of copy.preview) {
        expect(body).toContain(line);
      }
    }
  );
});

describe("outputLevelCopy", () => {
  it("looks a level up", () => {
    expect(outputLevelCopy("forensic").label).toBe("Forensic");
    expect(outputLevelCopy("compact").label).toBe("Compact");
  });
});
