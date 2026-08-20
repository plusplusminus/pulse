import { describe, it, expect } from "vitest";
import {
  buildWidgetIssueDescription,
  pageFeedbackPath,
  renderSubmissionBody,
} from "@/lib/widget-linear";
import {
  OUTPUT_DETAIL_LEVELS,
  type WidgetMetadata,
  type WidgetPick,
} from "@/lib/widget-types";

const metadata: WidgetMetadata = {
  url: "https://acme.test/pricing",
  userAgent: "Mozilla/5.0 (Macintosh) Chrome/140.0",
  viewport: { width: 1440, height: 900 },
  timestamp: "2026-05-12T10:00:00.000Z",
  console: [
    { level: "error", message: "TypeError: x is undefined", timestamp: "2026-05-12T09:59:00.000Z" },
    { level: "log", message: "noise", timestamp: "2026-05-12T09:59:30.000Z" },
  ],
  sentry: {
    replayId: "r1",
    replayUrl: "https://sentry.io/replay/r1",
    sessionId: "s1",
    traceId: "t1",
  },
  custom: {},
};

const submission = {
  description: "The hero CTA is too small on mobile.",
  reporter: { email: "sam@acme.test", name: "Sam" },
  metadata,
  screenshotUrl: "https://pulse.test/api/widget/media/sub-1/screenshot",
  videoUrl: "https://pulse.test/api/widget/media/sub-1/video",
  replayUrl: "https://pulse.test/api/widget/media/sub-1/replay",
};

function basePick(overrides: Partial<WidgetPick> = {}): WidgetPick {
  return {
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
    computedStyles: {
      color: "rgb(255,255,255)",
      "background-color": "rgb(0,0,0)",
      "font-size": "16px",
    },
    accessibility: 'role="button", aria-label="Sign up", focusable',
    nearbyElements: "a.link, div.spacer (5 total in .cta)",
    selector: "#cta",
    xpath: "/html/body/main/section/div/button",
    relocation: {
      rect: { x: 120, y: 340, width: 180, height: 44, top: 340, left: 120, right: 300, bottom: 384 },
      scrollX: 0,
      scrollY: 200,
      viewport: { width: 1440, height: 900 },
      dpr: 2,
      textHash: "a1b2c3d4",
    },
    ...overrides,
  };
}

const scenarios: Record<string, WidgetPick[]> = {
  empty: [],
  single: [basePick()],
  "multi-select": [
    basePick({
      id: "p2",
      name: '3 elements: button "Save", input [email]+1 more',
      isMultiSelect: true,
      boundingBox: { x: 5, y: 20, width: 345, height: 90 },
      elementBoundingBoxes: [
        { x: 10, y: 20, width: 100, height: 40 },
        { x: 5, y: 80, width: 200, height: 30 },
        { x: 300, y: 25, width: 50, height: 20 },
      ],
      comment: "These three should line up",
      intent: "change",
    }),
  ],
  "area-pick": [
    basePick({
      id: "p3",
      name: "Area selection",
      isArea: true,
      areaRect: { x: 40, y: 500, width: 620, height: 240 },
      elementPath: "",
      comment: "This whole block feels cramped",
      intent: "question",
    }),
  ],
  "text-selected": [
    basePick({
      id: "p4",
      selectedText: "Sign up now",
      comment: "Reword this",
    }),
  ],
};

describe("renderSubmissionBody", () => {
  for (const level of OUTPUT_DETAIL_LEVELS) {
    for (const [name, picks] of Object.entries(scenarios)) {
      it(`renders ${name} at ${level}`, () => {
        expect(
          renderSubmissionBody({
            submission,
            picks,
            config: { output_detail_level: level },
          })
        ).toMatchSnapshot();
      });
    }
  }

  it("is pure: the same input renders identically and the picks are untouched", () => {
    const picks = scenarios.single;
    const before = JSON.stringify(picks);
    const a = renderSubmissionBody({ submission, picks });
    const b = renderSubmissionBody({ submission, picks });
    expect(a).toBe(b);
    expect(JSON.stringify(picks)).toBe(before);
  });

  it("falls back to standard when the config has no level", () => {
    const picks = scenarios.single;
    expect(renderSubmissionBody({ submission, picks })).toBe(
      renderSubmissionBody({
        submission,
        picks,
        config: { output_detail_level: "standard" },
      })
    );
    expect(
      renderSubmissionBody({ submission, picks, config: { output_detail_level: null } })
    ).toBe(renderSubmissionBody({ submission, picks }));
  });

  it("escapes markdown-special characters in names, comments and selected text", () => {
    const body = renderSubmissionBody({
      submission,
      picks: [
        basePick({
          name: 'button *Buy* _now_',
          comment: "pipe | and `code` and *stars*",
          selectedText: "_underscored_",
        }),
      ],
    });
    expect(body).toContain("### 1. button \\*Buy\\* \\_now\\_");
    expect(body).toContain("**Comment:** pipe \\| and \\`code\\` and \\*stars\\*");
    expect(body).toContain('**Selected text:** "\\_underscored\\_"');
  });

  it("renders element paths inside inline code fences", () => {
    const body = renderSubmissionBody({
      submission,
      picks: scenarios.single,
      config: { output_detail_level: "forensic" },
    });
    expect(body).toContain("**Location:** `main > section.hero > .cta > button`");
    expect(body).toContain(
      "**Full DOM Path:** `html > body > main.app > section.hero > div.cta > button.btn`"
    );
  });

  it("keeps the screenshot, video and replay links above the picks at every level", () => {
    for (const level of OUTPUT_DETAIL_LEVELS) {
      const body = renderSubmissionBody({
        submission,
        picks: scenarios.single,
        config: { output_detail_level: level },
      });
      expect(body).toContain(`![Screenshot](${submission.screenshotUrl})`);
      expect(body).toContain(`[Watch recording](${submission.videoUrl})`);
      expect(body).toContain(`[Open replay](${submission.replayUrl})`);
      expect(body.indexOf(submission.replayUrl)).toBeLessThan(
        body.indexOf("## Page Feedback:")
      );
    }
  });

  it("renders only the header for an empty picks array", () => {
    const body = renderSubmissionBody({
      submission,
      picks: [],
      config: { output_detail_level: "standard" },
    });
    expect(body).toContain("## Page Feedback: /pricing");
    expect(body).not.toContain("### 1.");
  });

  it("takes dpr from env, else the first pick's relocation hint, else 1", () => {
    const forensic = { output_detail_level: "forensic" as const };
    expect(
      renderSubmissionBody({ submission, picks: scenarios.single, config: forensic, env: { dpr: 3 } })
    ).toContain("dpr: 3");
    expect(
      renderSubmissionBody({ submission, picks: scenarios.single, config: forensic })
    ).toContain("dpr: 2");
    expect(renderSubmissionBody({ submission, picks: [], config: forensic })).toContain(
      "dpr: 1"
    );
  });
});

describe("pageFeedbackPath", () => {
  it("returns the pathname, or the raw value when it will not parse", () => {
    expect(pageFeedbackPath("https://acme.test/a/b?c=1#d")).toBe("/a/b");
    expect(pageFeedbackPath("not a url")).toBe("not a url");
  });
});

describe("buildWidgetIssueDescription", () => {
  it("still renders the standard sections with no picks", () => {
    expect(buildWidgetIssueDescription(submission)).toBe(
      renderSubmissionBody({ submission })
    );
  });
});
