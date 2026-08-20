import { createIssueInLinear } from "@/lib/linear-push";
import type { WidgetMetadata } from "@/lib/widget-types";
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

export function buildWidgetIssueDescription(submission: {
  description?: string;
  reporter: { email: string; name?: string };
  metadata: WidgetMetadata;
  screenshotUrl?: string;
  videoUrl?: string;
  replayUrl?: string;
}): string {
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

  lines.push("---");
  lines.push("*Submitted via Pulse feedback widget*");

  return lines.join("\n");
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
