import * as Sentry from "@sentry/nextjs";
import { getWorkspaceToken } from "./workspace";

const LINEAR_API = "https://api.linear.app/graphql";

/**
 * Fetch the set of label IDs accessible for issue creation/update under a
 * given Linear team. Returns null when the lookup fails — callers should
 * treat that as "do not filter" rather than "no labels allowed" so a transient
 * Linear outage doesn't strip every label off legitimate submissions.
 */
export async function fetchAllowedTeamLabelIds(
  teamId: string
): Promise<Set<string> | null> {
  try {
    const token = await getWorkspaceToken();
    const res = await fetch(LINEAR_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        query: `
          query TeamLabels($teamId: String!) {
            team(id: $teamId) {
              labels(first: 250) { nodes { id } }
            }
          }
        `,
        variables: { teamId },
      }),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { team?: { labels?: { nodes?: Array<{ id: string }> } } };
      errors?: Array<{ message: string }>;
    };
    const nodes = json.data?.team?.labels?.nodes;
    if (!nodes) return null;
    return new Set(nodes.map((n) => n.id));
  } catch (err) {
    Sentry.captureException(err, {
      tags: { surface: "label-validation" },
      extra: { teamId },
    });
    return null;
  }
}

export type LabelFilterResult = {
  allowed: string[];
  dropped: string[];
};

/**
 * Filter a requested set of label IDs down to those accessible for the team.
 * On lookup failure returns all requested IDs unchanged with `dropped: []`
 * — we'd rather attempt the Linear call with possibly-stale IDs than fail
 * legitimate submissions because Linear is briefly unreachable.
 */
export async function filterToAllowedLabelIds(
  teamId: string,
  requested: string[]
): Promise<LabelFilterResult> {
  if (requested.length === 0) return { allowed: [], dropped: [] };

  const allowedSet = await fetchAllowedTeamLabelIds(teamId);
  if (!allowedSet) {
    return { allowed: requested, dropped: [] };
  }

  const allowed: string[] = [];
  const dropped: string[] = [];
  for (const id of requested) {
    if (allowedSet.has(id)) allowed.push(id);
    else dropped.push(id);
  }
  return { allowed, dropped };
}
