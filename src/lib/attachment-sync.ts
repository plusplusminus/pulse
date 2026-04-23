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

const ISSUE_ATTACHMENTS_QUERY = `
  query IssueAttachments($id: String!) {
    issue(id: $id) {
      attachments { nodes { id url } }
    }
  }
`;

async function linearGraphQL<T>(
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
    console.error("[attachment-sync] Linear request failed:", err);
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
 * Load an IssueContext for a Linear issue id by reading the latest
 * synced_issues row. Returns null if we have no record of the issue or
 * can't resolve a team key.
 */
export async function loadIssueContext(
  issueLinearId: string
): Promise<IssueContext | null> {
  const { data } = await supabaseAdmin
    .from("synced_issues")
    .select("data")
    .eq("linear_id", issueLinearId)
    .maybeSingle();
  if (!data?.data) return null;
  return issueContextFromData(data.data as Record<string, unknown>);
}

/**
 * Ensure the issue has a "View in Pulse" attachment for every hub that
 * the issue is visible in. Skips hubs that already have an attachment
 * pointing to the Pulse URL, so this is safe to call repeatedly.
 *
 * Fire-and-forget: swallows errors so the caller is never affected.
 */
export async function ensurePulseAttachmentsForIssue(
  issue: IssueContext
): Promise<void> {
  try {
    const hubs = await getHubsForTeam(issue.teamId);
    if (hubs.length === 0) return;

    // Find which qualifying hubs don't yet have our attachment.
    const needed: Array<{ hub: (typeof hubs)[number]; url: string; title: string }> = [];

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
      needed.push({ hub, url, title: `View in Pulse — ${hub.name}` });
    }

    if (needed.length === 0) return;

    // Fetch existing attachments once and skip any hub whose URL is already present.
    const existing = await linearGraphQL<{
      issue?: { attachments?: { nodes?: Array<{ id: string; url: string }> } };
    }>(ISSUE_ATTACHMENTS_QUERY, { id: issue.linearId });

    const existingUrls = new Set(
      existing?.issue?.attachments?.nodes?.map((n) => n.url) ?? []
    );

    for (const { url, title } of needed) {
      if (existingUrls.has(url)) continue;
      await linearGraphQL(ATTACHMENT_CREATE_MUTATION, {
        issueId: issue.linearId,
        url,
        title,
      });
    }
  } catch (err) {
    console.error("[ensurePulseAttachmentsForIssue] unexpected error:", err);
  }
}
