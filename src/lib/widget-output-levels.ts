import type { OutputDetailLevel } from "@/lib/widget-types";

/**
 * Admin-facing copy for widget_configs.output_detail_level (PULSE-352).
 *
 * Backslashes in the preview are not typos: page-derived text is markdown-
 * escaped before it reaches Linear, and these lines have to match the real
 * output exactly.
 *
 * `preview` lines are real fragments of what renderSubmissionBody produces at
 * that level — widget-output-levels.test.ts asserts each line still appears in
 * the renderer's output, so the sample cannot drift away from the truth.
 */
export type OutputLevelCopy = {
  level: OutputDetailLevel;
  label: string;
  help: string;
  preview: string[];
};

export const OUTPUT_LEVEL_COPY: readonly OutputLevelCopy[] = [
  {
    level: "compact",
    label: "Compact",
    help: "One line per pick. Best for simple bug reports.",
    preview: [
      "## Page Feedback: /pricing",
      '1. **button "Sign up"**: Make this bigger (intent: fix)',
    ],
  },
  {
    level: "standard",
    label: "Standard",
    help: "Per-pick block with selector, intent, comment. Sensible default.",
    preview: [
      '### 1. button "Sign up"',
      "**Intent:** fix",
      "**Location:** `main > section.hero > .cta > button`",
      "**Comment:** Make this bigger",
    ],
  },
  {
    level: "detailed",
    label: "Detailed",
    help: "Adds classes, position, and nearby context. Good for layout bugs.",
    preview: [
      "**Location:** `main > section.hero > .cta > button`",
      "**Classes:** btn btn-primary",
      "**Position:** 120px, 340px (180×44px)",
      '**Context:** \\[before: "Get started"\\] CTA',
    ],
  },
  {
    level: "forensic",
    label: "Forensic",
    help: "Adds computed CSS, accessibility, and nearby elements. Best for design / a11y triage.",
    preview: [
      "**Full DOM Path:** `html > body > main.app > section.hero > div.cta > button.btn`",
      "**Computed Styles:** color: rgb(255,255,255); font-size: 16px",
      '**Accessibility:** role="button", aria-label="Sign up", focusable',
      "**Nearby Elements:** a.link, div.spacer (5 total in .cta)",
    ],
  },
];

export function outputLevelCopy(level: OutputDetailLevel): OutputLevelCopy {
  return OUTPUT_LEVEL_COPY.find((c) => c.level === level) ?? OUTPUT_LEVEL_COPY[1];
}
