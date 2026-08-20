import { createIssueInLinear } from "@/lib/linear-push";
import type {
  OutputDetailLevel,
  PickRect,
  WidgetMetadata,
  WidgetPick,
} from "@/lib/widget-types";
import type { WidgetMediaKind } from "@/lib/widget-upload";

function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Pulse media-proxy URL for a submission artefact (PULSE-324). The route
 * authorises the viewer (admin or hub member) and redirects to a short-lived
 * signed read URL, so this is the only URL that ever leaves Pulse.
 */
export function widgetMediaUrl(
  submissionId: string,
  kind: WidgetMediaKind
): string {
  return `${getAppUrl()}/api/widget/media/${submissionId}/${kind}`;
}

export type WidgetSubmissionBody = {
  description?: string;
  reporter: { email: string; name?: string };
  metadata: WidgetMetadata;
  screenshotUrl?: string;
  videoUrl?: string;
  replayUrl?: string;
};

/**
 * Standard sections (everything except the picks block and the footer). Kept
 * separate so renderSubmissionBody can slot the picks between the media links
 * and the footer.
 */
function submissionSections(submission: WidgetSubmissionBody): string[] {
  const { description, reporter, metadata, screenshotUrl, videoUrl, replayUrl } =
    submission;
  const lines: string[] = [];

  lines.push("## Feedback");
  lines.push(description || "_No description provided_");
  lines.push("");

  lines.push("## Reporter");
  const name = reporter.name || "Unknown";
  lines.push(`${name} (${reporter.email})`);
  lines.push("");

  lines.push("## Context");
  lines.push(`- **Page:** ${metadata.url}`);
  lines.push(`- **Browser:** ${metadata.userAgent}`);
  lines.push(
    `- **Viewport:** ${metadata.viewport.width}x${metadata.viewport.height}`
  );
  lines.push(`- **Submitted:** ${metadata.timestamp}`);
  lines.push("");

  lines.push("## Sentry");
  if (metadata.sentry?.replayUrl) {
    lines.push(`[Session Replay](${metadata.sentry.replayUrl})`);
  } else {
    lines.push("No replay available");
  }
  lines.push("");

  const errors = metadata.console.filter((c) => c.level === "error");
  lines.push("## Console (last errors)");
  if (errors.length > 0) {
    for (const entry of errors) {
      lines.push(`- ${entry.message}`);
    }
  } else {
    lines.push("_No console errors_");
  }
  lines.push("");

  lines.push("## Screenshot");
  if (screenshotUrl) {
    lines.push(`![Screenshot](${screenshotUrl})`);
  } else {
    lines.push("_No screenshot attached_");
  }
  lines.push("");

  if (videoUrl) {
    lines.push("## Video");
    lines.push(`[Watch recording](${videoUrl})`);
    lines.push("");
  }

  if (replayUrl) {
    lines.push("## Session replay");
    lines.push(`[Open replay](${replayUrl})`);
    lines.push("");
  }

  return lines;
}

const FOOTER = ["---", "*Submitted via Pulse feedback widget*"];

/** Backwards-compatible entry point: standard sections with no element picks. */
export function buildWidgetIssueDescription(
  submission: WidgetSubmissionBody
): string {
  return renderSubmissionBody({ submission });
}

export async function createWidgetLinearIssue(params: {
  teamId: string;
  title: string;
  description: string;
  screenshotUrl?: string;
}): Promise<{ id: string; identifier: string; url: string }> {
  const issue = await createIssueInLinear({
    teamId: params.teamId,
    title: params.title,
    description: params.description,
  });

  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
  };
}

// -- Element picks -> Linear markdown (PULSE-332) --------------------------

const DEFAULT_DETAIL_LEVEL: OutputDetailLevel = "standard";

/** Chars that would otherwise turn page text into markup inside the body. */
function escapeMarkdown(value: string): string {
  return value.replace(/([*_`|])/g, "\\$1");
}

function code(value: string): string {
  return `\`${value}\``;
}

/** Pathname only; a metadata.url that will not parse is shown verbatim. */
export function pageFeedbackPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Multi-picks report the box wrapping every selected element. */
function pickRect(pick: WidgetPick): PickRect {
  if (pick.isArea && pick.areaRect) return pick.areaRect;
  return pick.boundingBox;
}

function pickTitle(pick: WidgetPick): string {
  return pick.isArea ? "Area selection" : escapeMarkdown(pick.name);
}

function computedStylesLine(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

function renderCompactPick(pick: WidgetPick, index: number): string {
  const rect = pickRect(pick);
  const where = pick.isArea ? ` at (${rect.x}, ${rect.y})` : "";
  const comment = pick.comment ? `: ${escapeMarkdown(pick.comment)}` : "";
  const selected = pick.selectedText
    ? `; re: "${escapeMarkdown(pick.selectedText)}"`
    : "";
  return `${index}. **${pickTitle(pick)}**${where}${comment} (intent: ${pick.intent}${selected})`;
}

function renderPick(
  pick: WidgetPick,
  index: number,
  level: OutputDetailLevel
): string {
  const detailed = level === "detailed" || level === "forensic";
  const forensic = level === "forensic";
  const rect = pickRect(pick);
  const lines: string[] = [];

  lines.push(`### ${index}. ${pickTitle(pick)}`);
  lines.push(`**Intent:** ${pick.intent}`);

  if (pick.isArea) {
    lines.push(
      `**Region:** (${rect.x}, ${rect.y}) ${rect.width}×${rect.height}`
    );
  } else {
    lines.push(`**Location:** ${code(pick.elementPath)}`);
  }

  if (detailed) {
    if (pick.classes) lines.push(`**Classes:** ${pick.classes}`);
    lines.push(
      `**Position:** ${rect.x}px, ${rect.y}px (${rect.width}×${rect.height}px)`
    );
  }

  if (forensic) {
    if (pick.fullPath) lines.push(`**Full DOM Path:** ${code(pick.fullPath)}`);
    if (pick.computedStyles && Object.keys(pick.computedStyles).length > 0) {
      lines.push(
        `**Computed Styles:** ${computedStylesLine(pick.computedStyles)}`
      );
    }
    if (pick.accessibility) {
      lines.push(`**Accessibility:** ${pick.accessibility}`);
    }
    if (pick.nearbyElements) {
      lines.push(`**Nearby Elements:** ${pick.nearbyElements}`);
    }
  }

  if (pick.selectedText) {
    lines.push(`**Selected text:** "${escapeMarkdown(pick.selectedText)}"`);
  } else if (detailed && pick.nearbyText) {
    lines.push(`**Context:** ${escapeMarkdown(pick.nearbyText)}`);
  }

  if (pick.comment) lines.push(`**Comment:** ${escapeMarkdown(pick.comment)}`);

  if (forensic && pick.isMultiSelect) {
    lines.push("*Forensic data shown for first element of selection*");
  }

  return lines.join("\n");
}

/** `## Page Feedback: <pathname>` plus the level's environment line(s). */
function renderPicksHeader(
  metadata: WidgetMetadata,
  level: OutputDetailLevel,
  dpr: number
): string[] {
  const lines = [`## Page Feedback: ${pageFeedbackPath(metadata.url)}`];
  const viewport = `${metadata.viewport.width}x${metadata.viewport.height}`;

  if (level === "forensic") {
    lines.push("");
    lines.push(
      `**Environment:** viewport: ${viewport}, URL: ${metadata.url}, UA: ${metadata.userAgent}, dpr: ${dpr}, captured: ${metadata.timestamp}`
    );
    lines.push("");
    lines.push("---");
  } else if (level !== "compact") {
    lines.push("");
    lines.push(`**Viewport:** ${viewport}`);
  }

  return lines;
}

export type RenderSubmissionBodyParams = {
  submission: WidgetSubmissionBody;
  picks?: WidgetPick[];
  config?: { output_detail_level?: OutputDetailLevel | null };
  /** dpr for the forensic environment line; falls back to the first pick's relocation hint. */
  env?: { dpr?: number };
};

/**
 * Full Linear issue body: standard sections, then the element picks rendered at
 * the site's configured detail level, then the footer. Pure and deterministic.
 */
export function renderSubmissionBody({
  submission,
  picks = [],
  config,
  env,
}: RenderSubmissionBodyParams): string {
  const level = config?.output_detail_level ?? DEFAULT_DETAIL_LEVEL;
  const dpr = env?.dpr ?? picks[0]?.relocation?.dpr ?? 1;

  const lines = submissionSections(submission);
  lines.push(...renderPicksHeader(submission.metadata, level, dpr));
  lines.push("");

  if (picks.length > 0) {
    // Compact packs one line per pick; the verbose levels get a blank line
    // between annotations (no rule, so Linear does not break the list up).
    lines.push(
      level === "compact"
        ? picks.map((pick, i) => renderCompactPick(pick, i + 1)).join("\n")
        : picks.map((pick, i) => renderPick(pick, i + 1, level)).join("\n\n")
    );
    lines.push("");
  }

  lines.push(...FOOTER);
  return lines.join("\n").trim();
}
