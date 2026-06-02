import crypto from "crypto";
import { supabaseAdmin } from "./supabase";
import {
  issueContextFromData,
  loadIssueContext,
  ensurePulseAttachmentsForIssue,
} from "./attachment-sync";
import { isClientFacing } from "./hub-read";
import { reactPulseOnComment } from "./pulse-reaction";
import { updateIssueTitle } from "./linear-push";
import {
  applyEmojiToTitle,
  classifyIssueEmoji,
  extractLeadingEmoji,
} from "./issue-emoji";

// -- Signature verification --------------------------------------------------

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  const expected = hmac.digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// -- Linear webhook payload types --------------------------------------------

type LinearWebhookPayload = {
  action: "create" | "update" | "remove";
  type: string;
  data: Record<string, unknown>;
  url?: string;
  createdAt: string;
  webhookId?: string;
  webhookTimestamp?: number;
};

type LinearIssueData = {
  id: string;
  identifier?: string;
  title?: string;
  description?: string;
  state?: { name?: string };
  priority?: number;
  assignee?: { name?: string };
  labels?: Array<{ id: string; name: string; color: string }>;
  dueDate?: string;
  url?: string;
  team?: { id: string };
  project?: { id: string };
  createdAt?: string;
  updatedAt?: string;
};

type LinearCommentData = {
  id: string;
  body?: string;
  issue?: { id: string };
  user?: { name?: string };
  createdAt?: string;
  updatedAt?: string;
};

type LinearProjectData = {
  id: string;
  name?: string;
  status?: { name?: string };
  lead?: { name?: string };
  priority?: number;
  createdAt?: string;
  updatedAt?: string;
};

type LinearProjectUpdateData = {
  id: string;
  body?: string;
  health?: string;
  project?: { id?: string };
  projectId?: string;
  user?: { name?: string };
  createdAt?: string;
  updatedAt?: string;
  editedAt?: string;
};

type LinearInitiativeData = {
  id: string;
  name?: string;
  status?: string;
  owner?: { name?: string };
  createdAt?: string;
  updatedAt?: string;
};

type LinearCycleData = {
  id: string;
  name?: string;
  number?: number;
  startsAt?: string;
  endsAt?: string;
  teamId?: string;
  team?: { id: string };
  createdAt?: string;
  updatedAt?: string;
};

// -- Issue mapping (pure, exported for testing) ------------------------------

export function mapIssueWebhookToRow(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Record<string, unknown> {
  const issue = data as unknown as LinearIssueData;

  const row: Record<string, unknown> = {
    linear_id: issue.id,
    user_id: userId,
    synced_at: new Date().toISOString(),
    data, // Store full webhook payload as-is
  };

  // Extract indexed columns for filtering/sorting
  if (issue.identifier !== undefined) row.identifier = issue.identifier;
  if (issue.state?.name !== undefined) row.state_name = issue.state.name;
  if (issue.priority !== undefined) row.priority = issue.priority;
  if (issue.assignee?.name !== undefined) row.assignee_name = issue.assignee.name;
  // Linear webhooks send teamId/projectId as top-level strings OR nested objects
  const teamId = issue.team?.id ?? (data.teamId as string | undefined);
  const projectId = issue.project?.id ?? (data.projectId as string | undefined);
  if (teamId) row.team_id = teamId;
  if (projectId) row.project_id = projectId;

  if (action === "create") {
    row.created_at = issue.createdAt || new Date().toISOString();
    row.updated_at = issue.updatedAt || new Date().toISOString();
  } else {
    row.updated_at = issue.updatedAt || new Date().toISOString();
  }

  return row;
}

// -- Comment mapping (pure, exported for testing) ----------------------------

export function mapCommentWebhookToRow(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Record<string, unknown> {
  const comment = data as unknown as LinearCommentData;

  const row: Record<string, unknown> = {
    linear_id: comment.id,
    user_id: userId,
    synced_at: new Date().toISOString(),
    data, // Store full webhook payload as-is
  };

  // Extract indexed column for filtering
  if (comment.issue?.id !== undefined) row.issue_linear_id = comment.issue.id;

  if (action === "create") {
    row.created_at = comment.createdAt || new Date().toISOString();
    row.updated_at = comment.updatedAt || new Date().toISOString();
  } else {
    row.updated_at = comment.updatedAt || new Date().toISOString();
  }

  return row;
}

// -- Issue event handler -----------------------------------------------------

export async function handleIssueEvent(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Promise<void> {
  const issue = data as unknown as LinearIssueData;

  if (action === "remove") {
    await supabaseAdmin
      .from("synced_issues")
      .delete()
      .eq("user_id", userId)
      .eq("linear_id", issue.id);
    return;
  }

  const row = mapIssueWebhookToRow(action, data, userId);

  const { error } = await supabaseAdmin.from("synced_issues").upsert(row, {
    onConflict: "user_id,linear_id",
  });

  if (error) {
    console.error("Failed to upsert synced_issue:", error);
    throw error;
  }

  if (action === "create") {
    const ctx = await issueContextFromData(data);
    if (ctx) void ensurePulseAttachmentsForIssue(ctx);
  }

  if (action === "update") {
    void reconcileIssueEmojiOnUpdate(issue);
  }
}

// -- Emoji reconciliation ---------------------------------------------------

/**
 * On issue update, recompute the expected leading emoji from labels + priority
 * and update the title if it has drifted. No-op if nothing changed (which is
 * also why our own title-update webhooks don't loop here).
 */
async function reconcileIssueEmojiOnUpdate(
  issue: LinearIssueData
): Promise<void> {
  if (!issue.id || typeof issue.title !== "string") return;
  const newEmoji = classifyIssueEmoji(issue.labels, issue.priority);
  const newTitle = applyEmojiToTitle(issue.title, newEmoji);
  if (newTitle === issue.title) return;
  try {
    await updateIssueTitle(issue.id, newTitle);
  } catch (err) {
    console.error(
      `[issue-emoji] Failed to reconcile title for ${issue.id}:`,
      err
    );
  }
}

/**
 * On comment create, fill in the emoji prefix on the parent issue's title
 * if it doesn't already have one. Never replaces an existing prefix —
 * full reconciliation only runs on issue-update events.
 */
async function backfillIssueEmojiFromComment(issueId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("synced_issues")
    .select("data")
    .eq("linear_id", issueId)
    .maybeSingle();
  if (error || !data?.data) return;

  const issue = data.data as LinearIssueData;
  if (!issue.id || typeof issue.title !== "string") return;

  const { emoji: existing } = extractLeadingEmoji(issue.title);
  if (existing) return;

  const newEmoji = classifyIssueEmoji(issue.labels, issue.priority);
  if (!newEmoji) return;

  const newTitle = applyEmojiToTitle(issue.title, newEmoji);
  try {
    await updateIssueTitle(issue.id, newTitle);
  } catch (err) {
    console.error(
      `[issue-emoji] Failed to backfill title for ${issueId}:`,
      err
    );
  }
}

// -- Comment event handler ---------------------------------------------------

export async function handleCommentEvent(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Promise<void> {
  const comment = data as unknown as LinearCommentData;

  if (action === "remove") {
    await supabaseAdmin
      .from("synced_comments")
      .delete()
      .eq("user_id", userId)
      .eq("linear_id", comment.id);
    return;
  }

  const row = mapCommentWebhookToRow(action, data, userId);

  const { error } = await supabaseAdmin.from("synced_comments").upsert(row, {
    onConflict: "user_id,linear_id",
  });

  if (error) {
    console.error("Failed to upsert synced_comment:", error);
    throw error;
  }

  if (action === "create") {
    const issueId = (comment.issue as { id?: string } | undefined)?.id;
    if (issueId) {
      const ctx = await loadIssueContext(issueId);
      if (ctx) void ensurePulseAttachmentsForIssue(ctx);
      void backfillIssueEmojiFromComment(issueId);
    }

    // Confirm client-facing Linear comments made it into Pulse by adding
    // the :pulse: reaction on the original Linear comment.
    if (comment.body && isClientFacing(comment.body)) {
      void reactPulseOnComment(comment.id);
    }
  }
}

// -- Cycle mapping (pure, exported for testing) ------------------------------

export function mapCycleWebhookToRow(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Record<string, unknown> {
  const cycle = data as unknown as LinearCycleData;

  const row: Record<string, unknown> = {
    linear_id: cycle.id,
    user_id: userId,
    synced_at: new Date().toISOString(),
    data,
  };

  if (cycle.name !== undefined) row.name = cycle.name;
  if (cycle.number !== undefined) row.number = cycle.number;
  // Linear webhooks send teamId as top-level string OR nested object
  const teamId = cycle.team?.id ?? cycle.teamId;
  if (teamId) row.team_id = teamId;
  if (cycle.startsAt !== undefined) row.starts_at = cycle.startsAt;
  if (cycle.endsAt !== undefined) row.ends_at = cycle.endsAt;

  if (action === "create") {
    row.created_at = cycle.createdAt || new Date().toISOString();
    row.updated_at = cycle.updatedAt || new Date().toISOString();
  } else {
    row.updated_at = cycle.updatedAt || new Date().toISOString();
  }

  return row;
}

// -- Project mapping (pure, exported for testing) ----------------------------

export function mapProjectWebhookToRow(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Record<string, unknown> {
  const project = data as unknown as LinearProjectData;

  const row: Record<string, unknown> = {
    linear_id: project.id,
    user_id: userId,
    synced_at: new Date().toISOString(),
    data,
  };

  if (project.name !== undefined) row.name = project.name;
  if (project.status?.name !== undefined) row.status_name = project.status.name;
  if (project.lead?.name !== undefined) row.lead_name = project.lead.name;
  if (project.priority !== undefined) row.priority = project.priority;

  if (action === "create") {
    row.created_at = project.createdAt || new Date().toISOString();
    row.updated_at = project.updatedAt || new Date().toISOString();
  } else {
    row.updated_at = project.updatedAt || new Date().toISOString();
  }

  return row;
}

// -- Initiative mapping (pure, exported for testing) -------------------------

export function mapInitiativeWebhookToRow(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Record<string, unknown> {
  const initiative = data as unknown as LinearInitiativeData;

  const row: Record<string, unknown> = {
    linear_id: initiative.id,
    user_id: userId,
    synced_at: new Date().toISOString(),
    data,
  };

  if (initiative.name !== undefined) row.name = initiative.name;
  if (initiative.status !== undefined) row.status = initiative.status;
  if (initiative.owner?.name !== undefined) row.owner_name = initiative.owner.name;

  if (action === "create") {
    row.created_at = initiative.createdAt || new Date().toISOString();
    row.updated_at = initiative.updatedAt || new Date().toISOString();
  } else {
    row.updated_at = initiative.updatedAt || new Date().toISOString();
  }

  return row;
}

// -- Project event handler ---------------------------------------------------

/** Fields in the data JSON blob that come from GraphQL nested relations
 *  (initial sync / reconciliation) but are NOT present in webhook payloads.
 *  We preserve these from the existing row so webhooks don't wipe them out. */
const PROJECT_PRESERVED_FIELDS = [
  "links",
  "documents",
  "milestones",
  "labels",
  "teams",
  "initiatives",
] as const;

export async function handleProjectEvent(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Promise<void> {
  const project = data as unknown as LinearProjectData;

  if (action === "remove") {
    await supabaseAdmin
      .from("synced_projects")
      .delete()
      .eq("user_id", userId)
      .eq("linear_id", project.id);
    return;
  }

  const row = mapProjectWebhookToRow(action, data, userId);

  // Merge: preserve nested relation fields from the existing row's data blob
  // that webhook payloads don't include (links, documents, milestones, etc.)
  const { data: existing } = await supabaseAdmin
    .from("synced_projects")
    .select("data")
    .eq("user_id", userId)
    .eq("linear_id", project.id)
    .single();

  if (existing?.data && typeof existing.data === "object") {
    const existingData = existing.data as Record<string, unknown>;
    const rowData = row.data as Record<string, unknown>;
    for (const field of PROJECT_PRESERVED_FIELDS) {
      if (!(field in rowData) && field in existingData) {
        rowData[field] = existingData[field];
      }
    }
  }

  const { error } = await supabaseAdmin.from("synced_projects").upsert(row, {
    onConflict: "user_id,linear_id",
  });

  if (error) {
    console.error("Failed to upsert synced_project:", error);
    throw error;
  }
}

// -- Project update mapping + event handler ----------------------------------
//
// Linear "project health updates" (ProjectUpdate). Every update is synced;
// client visibility is decided at READ time via the pulse/heyclient body
// prefix (see hub-read.ts). Do NOT filter here.

export function mapProjectUpdateWebhookToRow(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Record<string, unknown> {
  const update = data as unknown as LinearProjectUpdateData;

  const row: Record<string, unknown> = {
    linear_id: update.id,
    user_id: userId,
    synced_at: new Date().toISOString(),
    data, // Store full webhook payload as-is
  };

  // Linear webhooks send projectId as a top-level string OR nested object
  const projectId = update.project?.id ?? update.projectId;
  if (projectId) row.project_id = projectId;
  if (update.health !== undefined) row.health = update.health;

  if (action === "create") {
    row.created_at = update.createdAt || new Date().toISOString();
    row.updated_at = update.updatedAt || new Date().toISOString();
  } else {
    row.updated_at = update.updatedAt || new Date().toISOString();
  }

  return row;
}

export async function handleProjectUpdateEvent(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Promise<void> {
  const update = data as unknown as LinearProjectUpdateData;

  if (action === "remove") {
    await supabaseAdmin
      .from("synced_project_updates")
      .delete()
      .eq("user_id", userId)
      .eq("linear_id", update.id);
    return;
  }

  const row = mapProjectUpdateWebhookToRow(action, data, userId);

  const { error } = await supabaseAdmin
    .from("synced_project_updates")
    .upsert(row, { onConflict: "user_id,linear_id" });

  if (error) {
    console.error("Failed to upsert synced_project_update:", error);
    throw error;
  }
}

// -- Cycle event handler -----------------------------------------------------

/** Fields in the data JSON blob that come from GraphQL nested relations
 *  (initial sync / reconciliation) but are NOT present in webhook payloads.
 *  We preserve these from the existing row so webhooks don't wipe them out. */
const CYCLE_PRESERVED_FIELDS = [
  "links",
  "documents",
] as const;

export async function handleCycleEvent(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Promise<void> {
  const cycle = data as unknown as LinearCycleData;

  if (action === "remove") {
    await supabaseAdmin
      .from("synced_cycles")
      .delete()
      .eq("user_id", userId)
      .eq("linear_id", cycle.id);
    return;
  }

  const row = mapCycleWebhookToRow(action, data, userId);

  // Merge: preserve nested relation fields from the existing row's data blob
  // that webhook payloads don't include (links, documents)
  const { data: existing } = await supabaseAdmin
    .from("synced_cycles")
    .select("data")
    .eq("user_id", userId)
    .eq("linear_id", cycle.id)
    .single();

  if (existing?.data && typeof existing.data === "object") {
    const existingData = existing.data as Record<string, unknown>;
    const rowData = row.data as Record<string, unknown>;
    for (const field of CYCLE_PRESERVED_FIELDS) {
      if (!(field in rowData) && field in existingData) {
        rowData[field] = existingData[field];
      }
    }
  }

  const { error } = await supabaseAdmin.from("synced_cycles").upsert(row, {
    onConflict: "user_id,linear_id",
  });

  if (error) {
    console.error("Failed to upsert synced_cycle:", error);
    throw error;
  }
}

// -- Initiative event handler ------------------------------------------------

export async function handleInitiativeEvent(
  action: string,
  data: Record<string, unknown>,
  userId: string
): Promise<void> {
  const initiative = data as unknown as LinearInitiativeData;

  if (action === "remove") {
    await supabaseAdmin
      .from("synced_initiatives")
      .delete()
      .eq("user_id", userId)
      .eq("linear_id", initiative.id);
    return;
  }

  const row = mapInitiativeWebhookToRow(action, data, userId);

  const { error } = await supabaseAdmin.from("synced_initiatives").upsert(row, {
    onConflict: "user_id,linear_id",
  });

  if (error) {
    console.error("Failed to upsert synced_initiative:", error);
    throw error;
  }
}

// -- Main event router -------------------------------------------------------

export async function routeWebhookEvent(
  payload: LinearWebhookPayload,
  userId: string
): Promise<void> {
  const { action, type, data } = payload;

  switch (type) {
    case "Issue":
      await handleIssueEvent(action, data, userId);
      break;
    case "Comment":
      await handleCommentEvent(action, data, userId);
      break;
    case "Project":
      await handleProjectEvent(action, data, userId);
      break;
    case "ProjectUpdate":
      await handleProjectUpdateEvent(action, data, userId);
      break;
    case "Initiative":
      await handleInitiativeEvent(action, data, userId);
      break;
    case "Cycle":
      await handleCycleEvent(action, data, userId);
      break;
    default:
      console.log(`Ignoring unhandled webhook event type: ${type}`);
  }
}
