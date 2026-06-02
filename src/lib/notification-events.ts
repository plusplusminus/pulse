import { supabaseAdmin } from "@/lib/supabase";
import {
  getHubsForTeam,
  getAllActiveHubs,
  isProjectVisibleToHub,
  isProjectOverviewOnlyInHub,
  isInitiativeVisibleToHub,
  hasHiddenLabelInHub,
  type HubInfo,
} from "@/lib/hub-visibility";
import { isClientFacing } from "@/lib/hub-read";
import { processImmediateEmails } from "@/lib/notification-delivery";
import {
  resolveMentions,
  extractMentionTokens,
  type MentionableMember,
} from "@/lib/mentions";
import { pushCommentToLinear } from "@/lib/linear-push";
import { reactMentionOnComment } from "@/lib/pulse-reaction";

// -- Types -------------------------------------------------------------------

type NotificationEventType =
  | "comment"
  | "status_change"
  | "project_update"
  | "new_issue"
  | "cycle_update"
  | "initiative_update";

type EntityType = "issue" | "comment" | "project" | "cycle" | "initiative";

type EmitParams = {
  hubId: string;
  teamId: string | null;
  eventType: NotificationEventType;
  entityType: EntityType;
  entityId: string;
  actorName: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  mentionedUserIds?: string[];
};

type WebhookPayload = {
  action: "create" | "update" | "remove";
  type: string;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
};

// -- Low-level emitter -------------------------------------------------------

async function emitNotificationEvent(params: EmitParams): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("notification_events")
    .insert({
      hub_id: params.hubId,
      team_id: params.teamId,
      event_type: params.eventType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      actor_name: params.actorName,
      summary: params.summary,
      metadata: params.metadata ?? {},
      mentioned_user_ids: params.mentionedUserIds ?? [],
    })
    .select("id")
    .single();

  if (error) {
    console.error("emitNotificationEvent: insert failed:", error);
    return null;
  }

  return data?.id ?? null;
}

// -- Payload extraction helpers ----------------------------------------------

function extractTeamId(type: string, data: Record<string, unknown>): string | null {
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
    case "Cycle": {
      if (typeof data.teamId === "string") return data.teamId;
      const team = data.team as { id?: string } | undefined;
      return team?.id ?? null;
    }
    case "Project": {
      // Webhook payloads: data.teamIds (string[]).
      // Initial-sync / reconcile payloads: data.teams ([{ id, name, key }, ...]).
      const teamIds = data.teamIds as string[] | undefined;
      if (Array.isArray(teamIds) && teamIds.length > 0) return teamIds[0];
      const teams = data.teams as Array<{ id: string }> | undefined;
      return teams?.[0]?.id ?? null;
    }
    case "Initiative":
      return null; // org-level
    default:
      return null;
  }
}

function extractActorName(data: Record<string, unknown>): string | null {
  // Linear webhook payloads don't have a top-level actor field.
  // For comments, the author is in data.user.name.
  // For other entities, the actor info is not reliably available.
  const user = data.user as { name?: string } | undefined;
  if (user?.name) return user.name;
  const creator = data.creator as { name?: string } | undefined;
  if (creator?.name) return creator.name;
  const assignee = data.assignee as { name?: string } | undefined;
  if (assignee?.name) return assignee.name;
  return null;
}

function extractTeamKey(type: string, data: Record<string, unknown>): string | null {
  switch (type) {
    case "Issue": {
      const team = data.team as { key?: string } | undefined;
      return team?.key ?? null;
    }
    case "Comment": {
      const issue = data.issue as { team?: { key?: string } } | undefined;
      return issue?.team?.key ?? null;
    }
    case "Cycle": {
      const team = data.team as { key?: string } | undefined;
      return team?.key ?? null;
    }
    case "Project": {
      const teams = data.teams as Array<{ key: string }> | undefined;
      return teams?.[0]?.key ?? null;
    }
    case "Initiative":
      return null; // org-level, no team
    default:
      return null;
  }
}

function extractIdentifier(data: Record<string, unknown>): string {
  return (data.identifier as string) ?? (data.id as string) ?? "unknown";
}

function extractName(data: Record<string, unknown>): string {
  return (data.name as string) ?? (data.title as string) ?? "unknown";
}

// -- Summary generation ------------------------------------------------------

function generateIssueSummary(
  action: string,
  data: Record<string, unknown>,
  updatedFrom?: Record<string, unknown>
): { eventType: NotificationEventType; summary: string; metadata: Record<string, unknown> } | null {
  const identifier = extractIdentifier(data);
  const title = (data.title as string) ?? "";

  if (action === "create") {
    return {
      eventType: "new_issue",
      summary: `New issue ${identifier}: ${title}`,
      metadata: {},
    };
  }

  if (action === "remove") {
    return {
      eventType: "status_change",
      summary: `Issue ${identifier} removed`,
      metadata: {},
    };
  }

  // action === "update"
  if (!updatedFrom || Object.keys(updatedFrom).length === 0) return null;

  // Status change
  const oldState = updatedFrom.stateId ?? updatedFrom.state;
  if (oldState !== undefined) {
    const newStateName = (data.state as { name?: string })?.name ?? "unknown";
    // updatedFrom contains the old value for changed fields.
    // For state changes, Linear sends the old stateId but not the old state name directly.
    // We can check if there's a labelIds or priorityLabel too.
    return {
      eventType: "status_change",
      summary: `Issue ${identifier} moved to ${newStateName}`,
      metadata: {
        new_state: newStateName,
        old_state_id: oldState,
        title,
      },
    };
  }

  // Priority change
  if (updatedFrom.priority !== undefined) {
    const priorityLabels: Record<number, string> = {
      0: "No priority",
      1: "Urgent",
      2: "High",
      3: "Medium",
      4: "Low",
    };
    const oldPriority = priorityLabels[updatedFrom.priority as number] ?? "unknown";
    const newPriority = priorityLabels[(data.priority as number) ?? 0] ?? "unknown";
    return {
      eventType: "status_change",
      summary: `Issue ${identifier} priority changed from ${oldPriority} to ${newPriority}`,
      metadata: {
        old_priority: updatedFrom.priority,
        new_priority: data.priority,
        title,
      },
    };
  }

  // Label change
  if (updatedFrom.labelIds !== undefined) {
    return {
      eventType: "status_change",
      summary: `Issue ${identifier} labels updated`,
      metadata: { title },
    };
  }

  // Title change
  if (updatedFrom.title !== undefined) {
    return {
      eventType: "status_change",
      summary: `Issue ${identifier} renamed to "${title}"`,
      metadata: {
        old_title: updatedFrom.title,
        new_title: title,
      },
    };
  }

  // Assignee change
  if (updatedFrom.assigneeId !== undefined) {
    const assigneeName = (data.assignee as { name?: string })?.name;
    return {
      eventType: "status_change",
      summary: assigneeName
        ? `Issue ${identifier} assigned to ${assigneeName}`
        : `Issue ${identifier} unassigned`,
      metadata: { title },
    };
  }

  // Other update — not user-visible enough to emit
  return null;
}

async function resolveCommentAuthor(data: Record<string, unknown>): Promise<string> {
  // Linear webhook includes user.name for native Linear users
  const webhookUserName = (data.user as { name?: string })?.name;
  if (webhookUserName) return webhookUserName;

  // For createAsUser comments (Pulse client users), the webhook user
  // is the API app — not the actual author. Look up from hub_comments.
  const commentId = data.id as string | undefined;
  if (commentId) {
    const { data: hubComment } = await supabaseAdmin
      .from("hub_comments")
      .select("author_name")
      .eq("linear_comment_id", commentId)
      .single();
    if (hubComment?.author_name) return hubComment.author_name;
  }

  return "Someone";
}

async function generateCommentSummary(
  action: string,
  data: Record<string, unknown>
): Promise<{ eventType: NotificationEventType; summary: string; metadata: Record<string, unknown>; actorName?: string } | null> {
  if (action === "remove") return null;

  const body = (data.body as string) ?? "";

  // Only notify clients about comments with the trigger prefix (heyclient, pulse).
  // Internal comments must never reach the client notification pipeline.
  if (!isClientFacing(body)) return null;

  const userName = await resolveCommentAuthor(data);
  const issueIdentifier =
    (data.issue as { identifier?: string })?.identifier ?? "an issue";
  const excerpt = body.length > 100 ? body.slice(0, 100) + "..." : body;

  if (action === "create") {
    return {
      eventType: "comment",
      summary: `New comment on ${issueIdentifier}`,
      actorName: userName,
      metadata: {
        excerpt,
        _issue_id: (data.issue as { id?: string })?.id,
        _issue_identifier: issueIdentifier,
      },
    };
  }

  // action === "update" — comment edited
  return {
    eventType: "comment",
    summary: `Comment updated on ${issueIdentifier}`,
    actorName: userName,
    metadata: {
      excerpt,
      _issue_id: (data.issue as { id?: string })?.id,
      _issue_identifier: issueIdentifier,
    },
  };
}

function generateProjectSummary(
  action: string,
  data: Record<string, unknown>,
  updatedFrom?: Record<string, unknown>
): { eventType: NotificationEventType; summary: string; metadata: Record<string, unknown> } | null {
  const name = extractName(data);

  if (action === "create") {
    return {
      eventType: "project_update",
      summary: `New project created: ${name}`,
      metadata: { name },
    };
  }

  if (action === "remove") {
    return {
      eventType: "project_update",
      summary: `Project ${name} removed`,
      metadata: { name },
    };
  }

  if (!updatedFrom || Object.keys(updatedFrom).length === 0) return null;

  // Status change on project
  if (updatedFrom.state !== undefined || updatedFrom.statusType !== undefined) {
    const statusName = (data.status as { name?: string })?.name ?? "unknown";
    return {
      eventType: "project_update",
      summary: `Project ${name} updated: status changed to ${statusName}`,
      metadata: { name, new_status: statusName },
    };
  }

  // Health change
  if (updatedFrom.health !== undefined) {
    return {
      eventType: "project_update",
      summary: `Project ${name} health changed to ${(data.health as string) ?? "unknown"}`,
      metadata: { name, new_health: data.health, old_health: updatedFrom.health },
    };
  }

  // Name change
  if (updatedFrom.name !== undefined) {
    return {
      eventType: "project_update",
      summary: `Project renamed from "${updatedFrom.name}" to "${name}"`,
      metadata: { old_name: updatedFrom.name, new_name: name },
    };
  }

  // Other updates — not meaningful enough
  return null;
}

function generateCycleSummary(
  action: string,
  data: Record<string, unknown>,
  updatedFrom?: Record<string, unknown>
): { eventType: NotificationEventType; summary: string; metadata: Record<string, unknown> } | null {
  const name = (data.name as string) ?? `Cycle ${(data.number as number) ?? ""}`.trim();

  if (action === "create") {
    return {
      eventType: "cycle_update",
      summary: `Cycle ${name} created`,
      metadata: { name },
    };
  }

  if (action === "remove") {
    return {
      eventType: "cycle_update",
      summary: `Cycle ${name} removed`,
      metadata: { name },
    };
  }

  if (!updatedFrom || Object.keys(updatedFrom).length === 0) return null;

  // Completion
  if (updatedFrom.completedAt === null && data.completedAt) {
    return {
      eventType: "cycle_update",
      summary: `Cycle ${name} completed`,
      metadata: { name },
    };
  }

  // Started
  if (updatedFrom.startsAt !== undefined) {
    return {
      eventType: "cycle_update",
      summary: `Cycle ${name} started`,
      metadata: { name },
    };
  }

  return null;
}

function generateInitiativeSummary(
  action: string,
  data: Record<string, unknown>,
  updatedFrom?: Record<string, unknown>
): { eventType: NotificationEventType; summary: string; metadata: Record<string, unknown> } | null {
  const name = extractName(data);

  if (action === "create") {
    return {
      eventType: "initiative_update",
      summary: `New initiative: ${name}`,
      metadata: { name },
    };
  }

  if (action === "remove") {
    return {
      eventType: "initiative_update",
      summary: `Initiative ${name} removed`,
      metadata: { name },
    };
  }

  if (!updatedFrom || Object.keys(updatedFrom).length === 0) return null;

  if (updatedFrom.status !== undefined) {
    return {
      eventType: "initiative_update",
      summary: `Initiative ${name} status changed to ${(data.status as string) ?? "unknown"}`,
      metadata: { name, new_status: data.status, old_status: updatedFrom.status },
    };
  }

  if (updatedFrom.health !== undefined) {
    return {
      eventType: "initiative_update",
      summary: `Initiative ${name} health changed to ${(data.health as string) ?? "unknown"}`,
      metadata: { name, new_health: data.health, old_health: updatedFrom.health },
    };
  }

  if (updatedFrom.name !== undefined) {
    return {
      eventType: "initiative_update",
      summary: `Initiative renamed from "${updatedFrom.name}" to "${name}"`,
      metadata: { old_name: updatedFrom.name, new_name: name },
    };
  }

  return null;
}

// -- Entity type mapping -----------------------------------------------------

function webhookTypeToEntityType(type: string): EntityType | null {
  switch (type) {
    case "Issue": return "issue";
    case "Comment": return "comment";
    case "Project": return "project";
    case "Cycle": return "cycle";
    case "Initiative": return "initiative";
    default: return null;
  }
}

// -- Hub resolution ----------------------------------------------------------

async function resolveTargetHubs(
  type: string,
  data: Record<string, unknown>,
  teamId: string | null
): Promise<HubInfo[]> {
  // Team-scoped entities
  if (teamId) {
    return getHubsForTeam(teamId);
  }

  // Org-level: Initiatives go to all active hubs (filtered by visibility below)
  if (type === "Initiative") {
    return getAllActiveHubs();
  }

  return [];
}

async function resolveIssueLabelIds(
  type: string,
  data: Record<string, unknown>
): Promise<string[]> {
  if (type === "Issue") {
    const ids = data.labelIds as string[] | undefined;
    if (Array.isArray(ids)) return ids;
    const labels = data.labels as Array<{ id: string }> | undefined;
    if (Array.isArray(labels)) return labels.map((l) => l.id).filter(Boolean);
    return [];
  }
  if (type === "Comment") {
    const issueId = (data.issue as { id?: string })?.id;
    if (!issueId) return [];
    const { data: row } = await supabaseAdmin
      .from("synced_issues")
      .select("data")
      .eq("linear_id", issueId)
      .maybeSingle();
    const issueData = (row?.data as Record<string, unknown> | null) ?? null;
    if (!issueData) return [];
    const labels = issueData.labels as Array<{ id: string }> | undefined;
    if (Array.isArray(labels)) return labels.map((l) => l.id).filter(Boolean);
    const ids = issueData.labelIds as string[] | undefined;
    if (Array.isArray(ids)) return ids;
    return [];
  }
  return [];
}

async function filterHubsByVisibility(
  hubs: HubInfo[],
  type: string,
  data: Record<string, unknown>,
  teamId: string | null
): Promise<HubInfo[]> {
  // For issues and comments, skip notifications when the project is overview-only
  // or when the issue carries a hidden label for the hub's team mapping.
  if (type === "Issue" || type === "Comment") {
    const projectId = type === "Issue"
      ? (data.project as { id?: string })?.id ?? (data.projectId as string)
      : (data.issue as { project?: { id?: string } })?.project?.id;

    // Resolve the label IDs on the underlying issue. For Issue events the
    // labelIds are on the webhook payload; for Comment events we must look up
    // the parent issue from synced_issues since Linear's comment webhook does
    // not include the parent's labels.
    const labelIds = await resolveIssueLabelIds(type, data);

    const results = await Promise.all(
      hubs.map(async (hub) => {
        if (projectId) {
          const visible = await isProjectVisibleToHub(hub.id, projectId);
          if (!visible) return { hub, include: false };
          const overviewOnly = await isProjectOverviewOnlyInHub(hub.id, projectId);
          if (overviewOnly) return { hub, include: false };
        }
        if (teamId && labelIds.length > 0) {
          const hidden = await hasHiddenLabelInHub(hub.id, teamId, labelIds);
          if (hidden) return { hub, include: false };
        }
        return { hub, include: true };
      })
    );
    return results.filter((r) => r.include).map((r) => r.hub);
  }

  if (type === "Initiative") {
    const initiativeId = data.id as string;
    if (!initiativeId) return hubs;
    const results = await Promise.all(
      hubs.map(async (hub) => ({
        hub,
        visible: await isInitiativeVisibleToHub(hub.id, initiativeId),
      }))
    );
    return results.filter((r) => r.visible).map((r) => r.hub);
  }

  // Projects, Cycles — visible to all hubs for that team
  return hubs;
}

// -- Mention resolution + echo -----------------------------------------------

async function fetchMentionableMembers(hubId: string): Promise<MentionableMember[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_members")
    .select("user_id, email, mention_handle")
    .eq("hub_id", hubId);
  if (error) {
    console.error("fetchMentionableMembers error:", error);
    return [];
  }
  return (data ?? []) as MentionableMember[];
}

/**
 * Post an internal confirmation comment on the Linear issue summarising which
 * mentions were delivered and which tokens couldn't be matched. Fire-and-forget;
 * the body deliberately starts with an emoji so isClientFacing() is false and it
 * never surfaces in the hub.
 */
/**
 * Two independent, fire-and-forget mention signals on the Linear comment:
 *   - 👤 reaction when ≥1 @mention resolved — "Pulse recognised your @mention"
 *     (a recognition signal, NOT a delivery guarantee).
 *   - ⚠️ a top-level internal comment naming any unmatched tokens. It is posted
 *     top-level (not threaded) on purpose: hub-read surfaces every reply under a
 *     client-facing comment, so a threaded warning would leak to the client.
 * Stale ⚠️ comments from an earlier draft are intentionally left as-is.
 */
async function postMentionEcho(
  commentId: string | undefined,
  issueId: string | undefined,
  anyResolved: boolean,
  unresolved: string[]
): Promise<void> {
  if (anyResolved && commentId) {
    void reactMentionOnComment(commentId);
  }
  if (unresolved.length > 0 && issueId) {
    const tokens = unresolved.map((t) => `@${t}`).join(", ");
    void pushCommentToLinear(
      issueId,
      `⚠️ Pulse couldn't match ${tokens} to a hub member — notified everyone instead.`
    ).catch((err) => console.error("postMentionEcho ⚠️ failed:", err));
  }
}

// -- Main entry point --------------------------------------------------------

/**
 * Emit notification events for a webhook event.
 * Determines which hubs should receive the event, generates a summary,
 * and inserts one notification_event row per hub.
 *
 * Fire-and-forget: catches all errors internally, never throws.
 */
export async function emitNotificationEventsForWebhook(
  payload: WebhookPayload
): Promise<void> {
  try {
    const { action, type, data } = payload;
    const updatedFrom = (data.updatedFrom ?? payload.updatedFrom) as Record<string, unknown> | undefined;
    const entityType = webhookTypeToEntityType(type);
    if (!entityType) return;

    // Generate summary based on entity type
    let result: { eventType: NotificationEventType; summary: string; metadata: Record<string, unknown>; actorName?: string } | null = null;

    switch (type) {
      case "Issue":
        result = generateIssueSummary(action, data, updatedFrom);
        break;
      case "Comment":
        result = await generateCommentSummary(action, data);
        break;
      case "Project":
        result = generateProjectSummary(action, data, updatedFrom);
        break;
      case "Cycle":
        result = generateCycleSummary(action, data, updatedFrom);
        break;
      case "Initiative":
        result = generateInitiativeSummary(action, data, updatedFrom);
        break;
    }

    // Skip if no meaningful event to emit
    if (!result) return;

    const teamId = extractTeamId(type, data);
    let teamKey = extractTeamKey(type, data);
    // Project webhook payloads only include teamIds (UUIDs, no key). Resolve
    // the key from synced_teams so downstream deep-links have the team prefix.
    if (!teamKey && teamId) {
      const { data: team } = await supabaseAdmin
        .from("synced_teams")
        .select("key")
        .eq("linear_id", teamId)
        .maybeSingle();
      teamKey = team?.key ?? null;
    }
    const entityId = (data.id as string) ?? "unknown";
    const actorName = result.actorName ?? extractActorName(data);

    // Enrich metadata with team_key for deep linking in UI
    const metadata: Record<string, unknown> = {
      ...result!.metadata,
      ...(teamKey ? { team_key: teamKey } : {}),
    };

    // Resolve which hubs should receive this event
    const allHubs = await resolveTargetHubs(type, data, teamId);
    if (allHubs.length === 0) return;

    const visibleHubs = await filterHubsByVisibility(allHubs, type, data, teamId);
    if (visibleHubs.length === 0) return;

    // For client-facing comments, resolve @mentions against each hub's members
    // so the delivery layer can honour "only notify me when mentioned". Resolve
    // once across the union of members, then stamp the per-hub subset below.
    const mentionByHub = new Map<string, string[]>();
    let echoAnyResolved = false;
    let echoUnresolved: string[] = [];
    let hasMentionTokens = false;
    if (type === "Comment") {
      const body = (data.body as string) ?? "";
      if (extractMentionTokens(body).length > 0) {
        hasMentionTokens = true;
        // Resolve mentions PER hub — members (and therefore name collisions)
        // differ between hubs, and fail-open must be decided against the hub the
        // notification is scoped to, not a global union.
        const perHub = await Promise.all(
          visibleHubs.map(async (h) => ({
            hub: h,
            members: await fetchMentionableMembers(h.id),
          }))
        );
        const unresolvedTokens = new Set<string>();
        for (const { hub, members } of perHub) {
          const res = resolveMentions(body, members);
          if (res.mentionedUserIds.length > 0) echoAnyResolved = true;
          if (res.unresolved.length > 0) {
            // Fail-open: an unmatched token broadcasts to every member of this
            // hub so a 'mentions_only' recipient is never silently skipped.
            mentionByHub.set(
              hub.id,
              members.map((m) => m.user_id)
            );
            res.unresolved.forEach((t) => unresolvedTokens.add(t));
          } else {
            mentionByHub.set(hub.id, res.mentionedUserIds);
          }
        }
        echoUnresolved = [...unresolvedTokens];
      }
    }

    // Emit one event per hub
    const eventIds = await Promise.all(
      visibleHubs.map((hub) =>
        emitNotificationEvent({
          hubId: hub.id,
          teamId,
          eventType: result!.eventType,
          entityType,
          entityId,
          actorName,
          summary: result!.summary,
          metadata,
          mentionedUserIds: mentionByHub.get(hub.id) ?? [],
        })
      )
    );

    // Fire-and-forget: trigger immediate email delivery for each created event
    for (let i = 0; i < visibleHubs.length; i++) {
      const eventId = eventIds[i];
      if (eventId) {
        void processImmediateEmails(visibleHubs[i].id, eventId, result!.eventType);
      }
    }

    // Post a one-off echo on the Linear issue confirming who the @mention
    // reached (or warning when a token didn't match). Internal-only.
    if (hasMentionTokens) {
      const commentId = data.id as string | undefined;
      const issueId = (data.issue as { id?: string })?.id;
      void postMentionEcho(commentId, issueId, echoAnyResolved, echoUnresolved);
    }
  } catch (error) {
    console.error("emitNotificationEventsForWebhook: unexpected error:", error);
  }
}
