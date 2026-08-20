// Pure hub-visibility predicates — no DB or env dependencies, so they can be
// unit-tested in isolation and shared across the read, emit and detail paths.
import type { HubTeamMapping } from "@/lib/supabase";

/**
 * Whether an issue may be shown to a hub as a task, applying the same rule as
 * the Tasks tab (fetchHubRoadmapIssues): its project must be visible and not
 * overview-only, OR the issue has no project and the hub opts in to unassigned
 * issues. Hidden-label exclusion is handled separately by `isIssueHidden`.
 *
 * Keeps the Activity feed, notifications and the issue-detail view in step with
 * the Tasks tab so an out-of-scope issue can't leak through one surface while
 * being correctly hidden on another (PULSE-370).
 */
export function isIssueProjectVisible(
  mappings: HubTeamMapping[],
  projectId: string | null | undefined
): boolean {
  // Project-less issue: only visible when the hub opts in to unassigned issues.
  if (!projectId) {
    return mappings.some((m) => m.include_unassigned_issues === true);
  }

  // A project is in scope if any mapping auto-includes all projects, or lists
  // this project explicitly.
  const autoInclude = mappings.some((m) => m.auto_include_projects === true);
  if (!autoInclude) {
    const visible = mappings.some((m) =>
      (m.visible_project_ids ?? []).includes(projectId)
    );
    if (!visible) return false;
  }

  // Overview-only projects show their overview but not their individual issues,
  // so an issue from one is never visible as a task — even under auto-include.
  const overviewOnly = mappings.some((m) =>
    (m.overview_only_project_ids ?? []).includes(projectId)
  );
  return !overviewOnly;
}
