import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getWorkspaceSetting } from "@/lib/workspace";
import { isTeamConfigured } from "@/lib/hub-team-lookup";
import {
  verifyWebhookSignature,
  routeWebhookEvent,
} from "@/lib/webhook-handlers";
import { logSyncEvent } from "@/lib/sync-logger";
import { emitNotificationEventsForWebhook } from "@/lib/notification-events";
import { captureServerEvent, flushPostHog } from "@/lib/posthog-server";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";

type WebhookPayload = {
  action: "create" | "update" | "remove";
  type: string;
  data: Record<string, unknown>;
  url?: string;
  createdAt: string;
  webhookId?: string;
  webhookTimestamp?: number;
};

const WORKSPACE_USER_ID = "workspace";

/**
 * Build a compact payload summary for sync event logging.
 * Extracts identifier/name + what changed on updates.
 */
function buildPayloadSummary(
  payload: WebhookPayload
): Record<string, unknown> {
  const { type, action, data } = payload;
  const summary: Record<string, unknown> = {};

  // Identity fields
  switch (type) {
    case "Issue": {
      if (data.identifier) summary.identifier = data.identifier;
      if (data.title) summary.title = data.title;
      break;
    }
    case "Comment": {
      const issue = data.issue as { identifier?: string } | undefined;
      if (issue?.identifier) summary.identifier = issue.identifier;
      const user = data.user as { name?: string } | undefined;
      if (user?.name) summary.author = user.name;
      break;
    }
    case "Project":
    case "Initiative":
    case "Cycle": {
      if (data.name) summary.name = data.name;
      break;
    }
    case "ProjectUpdate": {
      if (data.health) summary.health = data.health;
      const project = data.project as { name?: string } | undefined;
      if (project?.name) summary.project = project.name;
      break;
    }
  }

  // For updates, show what changed using Linear's updatedFrom field
  if (action === "update" && data.updatedFrom) {
    const changed = Object.keys(data.updatedFrom as Record<string, unknown>);
    if (changed.length > 0) {
      summary.changed = changed;
    }
  }

  return summary;
}

/**
 * Extract team ID from a webhook payload.
 * Returns null for org-level entities (Initiative).
 */
function extractTeamId(payload: WebhookPayload): string | null {
  const { type, data } = payload;

  switch (type) {
    case "Issue": {
      if (typeof data.teamId === "string") return data.teamId;
      const team = data.team as { id?: string } | undefined;
      return team?.id ?? null;
    }
    case "Comment": {
      const issue = data.issue as { team?: { id?: string } } | undefined;
      return issue?.team?.id ?? null;
    }
    case "Project": {
      const teams = (data as { teams?: Array<{ id: string }> }).teams;
      return teams?.[0]?.id ?? null;
    }
    case "ProjectUpdate":
      // Project updates don't carry team in the payload; treat as org-level
      // and let read-time hub project-visibility scope them.
      return null;
    case "Initiative":
      return null;
    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("linear-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing signature" },
        { status: 401 }
      );
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody) as WebhookPayload;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400 }
      );
    }

    // Verify against workspace webhook secret
    const workspaceSecret = await getWorkspaceSetting("linear_webhook_secret");
    if (!workspaceSecret) {
      return NextResponse.json(
        { error: "No webhook configured" },
        { status: 401 }
      );
    }

    let verified = false;
    try {
      verified = verifyWebhookSignature(rawBody, signature, workspaceSecret);
    } catch {
      // timingSafeEqual throws if lengths differ
    }

    if (!verified) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Discard events from teams not configured in any hub
    const teamId = extractTeamId(payload);
    const entityId = (payload.data?.id as string) ?? "unknown";

    const summary = buildPayloadSummary(payload);

    if (teamId) {
      const configured = await isTeamConfigured(teamId);
      if (!configured) {
        // Silently discard — don't log noise for unmapped teams
        return NextResponse.json({ success: true });
      }
    }
    // teamId === null → org-level entity (Initiative) — always process

    // Set Sentry context for this webhook event
    Sentry.setTag("webhook.event_type", payload.type);
    Sentry.setTag("webhook.action", payload.action);
    if (teamId) Sentry.setTag("webhook.team_id", teamId);
    Sentry.setContext("webhook_payload", {
      type: payload.type,
      action: payload.action,
      entityId,
      teamId,
    });

    // Route the event
    const start = Date.now();
    try {
      await Sentry.startSpan(
        { name: `webhook.${payload.type}.${payload.action}`, op: "webhook.process" },
        async () => {
          await routeWebhookEvent(payload, WORKSPACE_USER_ID);
        }
      );
      // Fire-and-forget: emit notification events for hub visibility
      void emitNotificationEventsForWebhook(payload);
      void logSyncEvent({
        eventType: payload.type,
        action: payload.action,
        entityId,
        teamId,
        status: "success",
        processingTimeMs: Date.now() - start,
        payloadSummary: summary,
      });
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          area: "sync",
          "webhook.event_type": payload.type,
          "webhook.action": payload.action,
        },
        contexts: {
          webhook: { type: payload.type, action: payload.action, entityId, teamId },
        },
      });
      console.error("Webhook handler error:", error);
      void logSyncEvent({
        eventType: payload.type,
        action: payload.action,
        entityId,
        teamId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        processingTimeMs: Date.now() - start,
        payloadSummary: summary,
      });
    }

    captureServerEvent("system", POSTHOG_EVENTS.webhook_received, {
      action: payload.action,
      type: payload.type,
    });
    await flushPostHog();

    return NextResponse.json({ success: true });
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "sync" } });
    console.error("Webhook route error:", error);
    return NextResponse.json({ success: true });
  }
}
