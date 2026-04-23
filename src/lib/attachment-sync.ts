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

function buildPulseIssueUrl(
  hubSlug: string,
  teamKey: string,
  issueLinearId: string
): string {
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
 * Returns null if we can't determine the team key (required for the Pulse URL).
 *
 * Webhook payloads carry `teamId` (string); initial-sync blobs carry
 * `team: {id, key}`. When the webhook shape lacks `team.key`, resolve it from
 * `synced_teams` by ID.
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
 * Create a "View in Pulse" Linear attachment on a newly-created issue for
 * every hub that the issue is currently visible in.
 *
 * Applies the same visibility rules as the hub UI: the issue's project must
 * be visible and not overview-only, and the issue must not carry any of the
 * hub's configured hidden labels.
 *
 * Fire-and-forget: swallows errors so the caller is never affected.
 * Scope is create-only — we don't track which attachments we made, so we
 * can't remove or update them later if visibility changes.
 */
export async function attachPulseLinksOnCreate(
  issue: IssueContext
): Promise<void> {
  try {
    const hubs = await getHubsForTeam(issue.teamId);

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

      const url = buildPulseIssueUrl(hub.slug, issue.teamKey, issue.linearId);
      const title = `View in Pulse — ${hub.name}`;

      await linearMutation(ATTACHMENT_CREATE_MUTATION, {
        issueId: issue.linearId,
        url,
        title,
      });
    }
  } catch (err) {
    console.error("[attachPulseLinksOnCreate] unexpected error:", err);
  }
}
