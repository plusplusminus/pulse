import { supabaseAdmin } from "@/lib/supabase";
import { getTeamToHubMap } from "@/lib/hub-team-lookup";

export type HubInfo = {
  id: string;
  slug: string;
  name: string;
};

/**
 * Get hub details for all hubs that include a given team.
 * Returns empty array if the team isn't mapped to any hub.
 */
export async function getHubsForTeam(teamId: string): Promise<HubInfo[]> {
  const map = await getTeamToHubMap();
  const hubIds = map.get(teamId);
  if (!hubIds || hubIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("client_hubs")
    .select("id, slug, name")
    .in("id", hubIds)
    .eq("is_active", true);

  if (error) {
    console.error("getHubsForTeam: failed to fetch hub details:", error);
    return [];
  }

  return (data ?? []) as HubInfo[];
}

/**
 * Get all active hubs (for org-level entities like Initiatives that aren't team-scoped).
 */
export async function getAllActiveHubs(): Promise<HubInfo[]> {
  const { data, error } = await supabaseAdmin
    .from("client_hubs")
    .select("id, slug, name")
    .eq("is_active", true);

  if (error) {
    console.error("getAllActiveHubs: failed to fetch hubs:", error);
    return [];
  }

  return (data ?? []) as HubInfo[];
}

/**
 * Check if a project is visible to a specific hub.
 * A project is visible if auto_include_projects is on for any mapping,
 * or if it appears in any mapping's visible_project_ids.
 */
export async function isProjectVisibleToHub(
  hubId: string,
  projectId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("visible_project_ids, auto_include_projects")
    .eq("hub_id", hubId)
    .eq("is_active", true);

  if (error || !data || data.length === 0) return false;

  for (const mapping of data) {
    if (mapping.auto_include_projects) return true;
    const ids = mapping.visible_project_ids as string[];
    if (ids && ids.includes(projectId)) return true;
  }

  return false;
}

/**
 * Check if a project is overview-only in a hub (should not show issues/notifications).
 */
export async function isProjectOverviewOnlyInHub(
  hubId: string,
  projectId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("overview_only_project_ids")
    .eq("hub_id", hubId)
    .eq("is_active", true);

  if (error || !data || data.length === 0) return false;

  return data.some((mapping) => {
    const ids = mapping.overview_only_project_ids as string[];
    return ids && ids.includes(projectId);
  });
}

/**
 * Whether the hub opts in to showing issues that aren't linked to any project.
 * Mirrors `shouldIncludeUnassigned` on the read side (hub-read.ts) so the
 * notification fan-out and the Tasks tab agree on project-less issues.
 */
export async function hubIncludesUnassignedIssues(
  hubId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("include_unassigned_issues")
    .eq("hub_id", hubId)
    .eq("is_active", true);

  if (error || !data || data.length === 0) return false;

  return data.some((mapping) => mapping.include_unassigned_issues === true);
}

/**
 * Check if an initiative is visible to a specific hub.
 */
export async function isInitiativeVisibleToHub(
  hubId: string,
  initiativeId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("visible_initiative_ids")
    .eq("hub_id", hubId)
    .eq("is_active", true);

  if (error || !data || data.length === 0) return false;

  for (const mapping of data) {
    const ids = mapping.visible_initiative_ids as string[];
    if (!ids || ids.length === 0) continue;
    if (ids.includes(initiativeId)) return true;
  }

  return false;
}

/**
 * Returns true if an issue carrying any of the given label IDs should be hidden
 * from the hub, based on the team's `hidden_label_ids` config.
 */
export async function hasHiddenLabelInHub(
  hubId: string,
  teamId: string,
  labelIds: string[]
): Promise<boolean> {
  if (!labelIds || labelIds.length === 0) return false;

  const { data, error } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("hidden_label_ids")
    .eq("hub_id", hubId)
    .eq("linear_team_id", teamId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return false;
  const hidden = (data.hidden_label_ids as string[] | null) ?? [];
  if (hidden.length === 0) return false;
  return labelIds.some((id) => hidden.includes(id));
}
