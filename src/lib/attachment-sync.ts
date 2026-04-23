import { supabaseAdmin } from "@/lib/supabase";
import { getWorkspaceToken } from "@/lib/workspace";
import {
  getHubsForTeam,
  isProjectVisibleToHub,
  isProjectOverviewOnlyInHub,
  hasHiddenLabelInHub,
} from "@/lib/hub-visibility";

const LINEAR_API = "https://api.linear.app/graphql";

function linearAuthHeader(token: string): string {
  return token.startsWith("lin_api_") ? token : `Bearer ${token}`;
}

function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function buildPulseIssueUrl(hubSlug: string, teamKey: string, issueLinearId: string): string {
  return `${getAppUrl()}/hub/${hubSlug}/${teamKey}?issue=${issueLinearId}`;
}

const ATTACHMENT_CREATE_MUTATION = `
  mutation AttachmentCreate($issueId: String!, $url: String!, $title: String!) {
    attachmentCreate(input: { issueId: $issueId, url: $url, title: $title }) {
      success
      attachment { id }
    }
  }
`;

const ATTACHMENT_DELETE_MUTATION = `
  mutation AttachmentDelete($id: String!) {
    attachmentDelete(id: $id) { success }
  }
`;

async function linearMutation<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T | null> {
  try {
    const token = await getWorkspaceToken();
    const res = await fetch(LINEAR_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: linearAuthHeader(token.trim()),
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (json.errors) {
      console.error("[attachment-sync] Linear GraphQL errors:", json.errors);
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error("[attachment-sync] Linear mutation failed:", err);
    return null;
  }
}

export type IssueContext = {
  linearId: string;
  teamId: string;
  teamKey: string;
  projectId?: string;
  labelIds: string[];
};

/**
 * Extract an IssueContext from a raw webhook payload or synced_issues.data blob.
 * Returns null if the payload is missing fields we can't recover.
 *
 * Webhook payloads provide `teamId` (string); initial-sync blobs provide
 * `team: {id, key}`. We resolve the team key from synced_teams when the
 * webhook-shape payload doesn't carry it.
 */
export async function issueContextFromData(
  data: Record<string, unknown>
): Promise<IssueContext | null> {
  const linearId = data.id as string | undefined;
  if (!linearId) return null;

  const team = data.team as { id?: string; key?: string } | undefined;
  const teamId =
    team?.id ?? (typeof data.teamId === "string" ? data.teamId : undefined);
  if (!teamId) return null;

  let teamKey: string | null | undefined = team?.key;
  if (!teamKey) {
    const { data: teamRow } = await supabaseAdmin
      .from("synced_teams")
      .select("key")
      .eq("linear_id", teamId)
      .maybeSingle();
    teamKey = teamRow?.key ?? null;
  }
  if (!teamKey) return null;

  const project = data.project as { id?: string } | undefined;
  const projectId =
    project?.id ??
    (typeof data.projectId === "string" ? data.projectId : undefined);

  const labels = data.labels as Array<{ id?: string }> | undefined;
  let labelIds: string[] = [];
  if (Array.isArray(labels)) {
    labelIds = labels.map((l) => l.id).filter((id): id is string => !!id);
  } else if (Array.isArray(data.labelIds)) {
    labelIds = (data.labelIds as string[]).filter((id) => typeof id === "string");
  }

  return { linearId, teamId, teamKey, projectId, labelIds };
}

/**
 * Reconcile Linear attachments for a single issue so that there is exactly
 * one attachment per hub the issue is visible in. Creates missing attachments
 * and removes any that no longer qualify.
 *
 * Fire-and-forget: swallows errors so a failure here never affects the caller.
 */
export async function syncIssueAttachments(issue: IssueContext): Promise<void> {
  try {
    const hubs = await getHubsForTeam(issue.teamId);

    const qualifyingHubIds = new Set<string>();
    for (const hub of hubs) {
      if (issue.projectId) {
        const visible = await isProjectVisibleToHub(hub.id, issue.projectId);
        if (!visible) continue;
        const overviewOnly = await isProjectOverviewOnlyInHub(
          hub.id,
          issue.projectId
        );
        if (overviewOnly) continue;
      }
      if (issue.labelIds.length > 0) {
        const hidden = await hasHiddenLabelInHub(
          hub.id,
          issue.teamId,
          issue.labelIds
        );
        if (hidden) continue;
      }
      qualifyingHubIds.add(hub.id);
    }

    const { data: existing } = await supabaseAdmin
      .from("hub_issue_attachments")
      .select("hub_id, linear_attachment_id")
      .eq("issue_linear_id", issue.linearId);

    const existingByHub = new Map<string, string>(
      (existing ?? []).map((r) => [
        r.hub_id as string,
        r.linear_attachment_id as string,
      ])
    );

    // Remove attachments for hubs that no longer qualify.
    for (const [hubId, attachmentId] of existingByHub) {
      if (qualifyingHubIds.has(hubId)) continue;
      const result = await linearMutation<{
        attachmentDelete?: { success?: boolean };
      }>(ATTACHMENT_DELETE_MUTATION, { id: attachmentId });
      if (result?.attachmentDelete?.success) {
        await supabaseAdmin
          .from("hub_issue_attachments")
          .delete()
          .eq("issue_linear_id", issue.linearId)
          .eq("hub_id", hubId);
      }
    }

    // Create attachments for qualifying hubs that don't already have one.
    for (const hub of hubs) {
      if (!qualifyingHubIds.has(hub.id)) continue;
      if (existingByHub.has(hub.id)) continue;

      const url = buildPulseIssueUrl(hub.slug, issue.teamKey, issue.linearId);
      const title = `View in Pulse — ${hub.name}`;

      const result = await linearMutation<{
        attachmentCreate?: { success?: boolean; attachment?: { id: string } };
      }>(ATTACHMENT_CREATE_MUTATION, {
        issueId: issue.linearId,
        url,
        title,
      });
      const attachmentId = result?.attachmentCreate?.attachment?.id;
      if (!attachmentId) continue;

      await supabaseAdmin.from("hub_issue_attachments").upsert(
        {
          issue_linear_id: issue.linearId,
          hub_id: hub.id,
          linear_attachment_id: attachmentId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "issue_linear_id,hub_id" }
      );
    }
  } catch (err) {
    console.error("[syncIssueAttachments] unexpected error:", err);
  }
}

/**
 * Remove every Pulse-created attachment for an issue — used when the issue
 * itself is deleted from Linear.
 */
export async function removeAllAttachmentsForIssue(
  issueLinearId: string
): Promise<void> {
  try {
    const { data: rows } = await supabaseAdmin
      .from("hub_issue_attachments")
      .select("linear_attachment_id")
      .eq("issue_linear_id", issueLinearId);

    for (const row of rows ?? []) {
      await linearMutation(ATTACHMENT_DELETE_MUTATION, {
        id: row.linear_attachment_id as string,
      });
    }

    await supabaseAdmin
      .from("hub_issue_attachments")
      .delete()
      .eq("issue_linear_id", issueLinearId);
  } catch (err) {
    console.error("[removeAllAttachmentsForIssue] error:", err);
  }
}
