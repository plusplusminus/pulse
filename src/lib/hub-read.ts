import { supabaseAdmin, type HubTeamMapping, type HubMemberRole } from "./supabase";
import { getWorkspaceToken } from "./workspace";
import { isIssueProjectVisible } from "./hub-visibility-rules";
import type { LinearIssue, RoadmapIssue } from "./linear";

const WORKSPACE_USER_ID = "workspace";

// -- Row mapper types (inlined from former sync-read.ts) ─────────────────────

type IssueData = {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string;
  priority?: number;
  priorityLabel?: string;
  url?: string;
  dueDate?: string;
  state?: { id?: string; name?: string; color?: string; type?: string };
  assignee?: { id?: string; name?: string };
  labels?: Array<{ id: string; name: string; color: string }>;
  project?: { id?: string; name?: string; color?: string };
  cycle?: { id?: string; name?: string; number?: number };
  createdAt?: string;
  updatedAt?: string;
};

type CommentData = {
  id?: string;
  body?: string;
  user?: { id?: string; name?: string };
  parent?: { id?: string };
  createdAt?: string;
  updatedAt?: string;
};

type TeamData = {
  id?: string;
  name?: string;
  displayName?: string;
  key?: string;
  description?: string;
  icon?: string;
  color?: string;
  private?: boolean;
  parent?: { id?: string; name?: string; key?: string };
  children?: Array<{ id: string }>;
  members?: Array<{ id: string; name: string }>;
  createdAt?: string;
  updatedAt?: string;
};

type ProjectData = {
  id?: string;
  name?: string;
  description?: string;
  content?: string;
  icon?: string;
  color?: string;
  url?: string;
  priority?: number;
  priorityLabel?: string;
  progress?: number;
  health?: string;
  startDate?: string;
  targetDate?: string;
  status?: { id?: string; name?: string; color?: string; type?: string };
  lead?: { id?: string; name?: string };
  labels?: Array<{ id: string; name: string; color: string }>;
  teams?: Array<{ id: string; name: string; key: string }>;
  teamIds?: string[];
  initiatives?: Array<{ id: string; name: string }>;
  milestones?: Array<{ id: string; name: string; targetDate?: string }>;
  links?: Array<{ id: string; label: string; url: string; createdAt: string }>;
  documents?: Array<{ id: string; title: string; content?: string; slugId: string; icon?: string; color?: string; updatedAt: string }>;
  createdAt?: string;
  updatedAt?: string;
};

type InitiativeData = {
  id?: string;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  url?: string;
  status?: string;
  health?: string;
  healthUpdatedAt?: string;
  targetDate?: string;
  owner?: { id?: string; name?: string };
  projects?: Array<{ id: string; name: string }>;
  subInitiatives?: Array<{ id: string; name: string }>;
  parentInitiative?: { id?: string; name?: string };
  createdAt?: string;
  updatedAt?: string;
};

type CycleData = {
  id?: string;
  name?: string;
  number?: number;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  completedAt?: string;
  progress?: number;
  completedIssueCountHistory?: number[];
  issueCountHistory?: number[];
  completedScopeHistory?: number[];
  scopeHistory?: number[];
  team?: { id?: string; name?: string; key?: string };
  links?: Array<{ id: string; label: string; url: string; createdAt: string }>;
  documents?: Array<{ id: string; title: string; content?: string; slugId: string; icon?: string; color?: string; updatedAt: string }>;
  createdAt?: string;
  updatedAt?: string;
};

export function priorityToLabel(priority: number): string {
  switch (priority) {
    case 0: return "No priority";
    case 1: return "Urgent";
    case 2: return "High";
    case 3: return "Medium";
    case 4: return "Low";
    default: return "No priority";
  }
}

export function mapRowToLinearIssue(row: {
  linear_id: string;
  data: IssueData;
  created_at: string;
  updated_at: string;
}): LinearIssue {
  const d = row.data;
  return {
    id: d.id ?? row.linear_id,
    identifier: d.identifier ?? "",
    title: d.title ?? "",
    description: d.description ?? undefined,
    priority: d.priority ?? 0,
    priorityLabel: d.priorityLabel ?? priorityToLabel(d.priority ?? 0),
    url: d.url ?? "",
    state: {
      id: d.state?.id ?? "",
      name: d.state?.name ?? "Unknown",
      color: d.state?.color ?? "",
      type: d.state?.type ?? "",
    },
    assignee: d.assignee
      ? { id: d.assignee.id ?? "", name: d.assignee.name ?? "" }
      : undefined,
    labels: Array.isArray(d.labels) ? d.labels : [],
    cycle: d.cycle ? {
      id: (d.cycle as Record<string, unknown>).id as string ?? "",
      name: (d.cycle as Record<string, unknown>).name as string ?? "",
      number: (d.cycle as Record<string, unknown>).number as number ?? 0,
    } : undefined,
    createdAt: d.createdAt ?? row.created_at,
    updatedAt: d.updatedAt ?? row.updated_at,
  };
}

const CLIENT_FACING_PREFIX = /^@?(?:heyclient|pulse)[\s\n]?/i;

/**
 * Check if a comment body is client-facing (starts with heyclient).
 */
export function isClientFacing(body: string): boolean {
  return CLIENT_FACING_PREFIX.test(body.trimStart());
}

/**
 * Strip the heyclient prefix from a comment body.
 * Removes the prefix plus one optional trailing space or newline.
 */
export function stripClientPrefix(body: string): string {
  const trimmed = body.trimStart();
  const leadingWhitespace = body.slice(0, body.length - trimmed.length);
  const stripped = trimmed.replace(CLIENT_FACING_PREFIX, "");
  // If stripping leaves an empty body, return empty
  if (!stripped.trim()) return "";
  return leadingWhitespace + stripped;
}

// -- Project update trigger (looser than comments) ---------------------------
//
// Project health updates are structured — PMs usually lead with a bold title
// line and put the trigger on the next line — so the pulse/heyclient trigger is
// matched at the start of ANY line, not just the very first character. Comments
// keep the stricter first-character rule above. The lookahead requires a whole
// word so "pulseaudio" and the like don't match.
const CLIENT_FACING_UPDATE_LINE = /^@?(?:heyclient|pulse)(?=\s|$)/i;

/** Whether a project update is client-facing: any line starts with the trigger. */
export function isClientFacingUpdate(body: string): boolean {
  return body
    .split("\n")
    .some((line) => CLIENT_FACING_UPDATE_LINE.test(line.trimStart()));
}

/**
 * Strip the pulse/heyclient trigger from the first line that carries it,
 * preserving the rest of the update (e.g. a leading title line). Returns "" if
 * nothing but the trigger remains.
 */
export function stripUpdateClientPrefix(body: string): string {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (CLIENT_FACING_UPDATE_LINE.test(trimmed)) {
      const leading = lines[i].slice(0, lines[i].length - trimmed.length);
      // Remove the trigger word plus one optional following space/tab.
      lines[i] = leading + trimmed.replace(/^@?(?:heyclient|pulse)[ \t]?/i, "");
      break;
    }
  }
  return lines.join("\n").trim();
}

export function mapRowToComment(row: {
  linear_id: string;
  data: CommentData;
  created_at: string;
  updated_at: string;
}) {
  const d = row.data;
  return {
    id: d.id ?? row.linear_id,
    linearId: row.linear_id,
    body: d.body ?? "",
    parentId: d.parent?.id ?? undefined,
    createdAt: d.createdAt ?? row.created_at,
    updatedAt: d.updatedAt ?? row.updated_at,
    user: {
      id: d.user?.id ?? "",
      name: d.user?.name ?? "Unknown",
    },
  };
}

export function mapRowToTeam(row: {
  linear_id: string;
  data: TeamData;
  created_at: string;
  updated_at: string;
}) {
  const d = row.data;
  return {
    id: d.id ?? row.linear_id,
    name: d.name ?? "",
    displayName: d.displayName ?? d.name ?? "",
    key: d.key ?? "",
    description: d.description ?? undefined,
    icon: d.icon ?? undefined,
    color: d.color ?? undefined,
    private: d.private ?? false,
    parent: d.parent ?? undefined,
    children: Array.isArray(d.children) ? d.children : [],
    members: Array.isArray(d.members) ? d.members : [],
    createdAt: d.createdAt ?? row.created_at,
    updatedAt: d.updatedAt ?? row.updated_at,
  };
}

export function mapRowToProject(row: {
  linear_id: string;
  data: ProjectData;
  created_at: string;
  updated_at: string;
}) {
  const d = row.data;
  return {
    id: d.id ?? row.linear_id,
    name: d.name ?? "",
    description: d.description ?? undefined,
    content: d.content ?? undefined,
    icon: d.icon ?? undefined,
    color: d.color ?? undefined,
    url: d.url ?? "",
    priority: d.priority ?? 0,
    priorityLabel: d.priorityLabel ?? priorityToLabel(d.priority ?? 0),
    progress: d.progress ?? 0,
    health: d.health ?? undefined,
    healthUpdatedAt:
      (d as { healthUpdatedAt?: string }).healthUpdatedAt ?? undefined,
    startDate: d.startDate ?? undefined,
    targetDate: d.targetDate ?? undefined,
    status: d.status
      ? { id: d.status.id ?? "", name: d.status.name ?? "", color: d.status.color ?? "", type: d.status.type ?? "" }
      : { id: "", name: "Unknown", color: "", type: "" },
    lead: d.lead
      ? { id: d.lead.id ?? "", name: d.lead.name ?? "" }
      : undefined,
    labels: Array.isArray(d.labels) ? d.labels : [],
    teams: Array.isArray(d.teams)
      ? d.teams
      : Array.isArray(d.teamIds)
        ? d.teamIds.map((id) => ({ id, name: "", key: "" }))
        : [],
    initiatives: Array.isArray(d.initiatives) ? d.initiatives : [],
    milestones: Array.isArray(d.milestones) ? d.milestones : [],
    links: Array.isArray(d.links) ? d.links : [],
    documents: Array.isArray(d.documents) ? d.documents : [],
    createdAt: d.createdAt ?? row.created_at,
    updatedAt: d.updatedAt ?? row.updated_at,
  };
}

export function mapRowToInitiative(row: {
  linear_id: string;
  data: InitiativeData;
  created_at: string;
  updated_at: string;
}) {
  const d = row.data;
  return {
    id: d.id ?? row.linear_id,
    name: d.name ?? "",
    description: d.description ?? undefined,
    icon: d.icon ?? undefined,
    color: d.color ?? undefined,
    url: d.url ?? "",
    status: d.status ?? "Planned",
    health: d.health ?? undefined,
    healthUpdatedAt: d.healthUpdatedAt ?? undefined,
    targetDate: d.targetDate ?? undefined,
    owner: d.owner
      ? { id: d.owner.id ?? "", name: d.owner.name ?? "" }
      : undefined,
    projects: Array.isArray(d.projects) ? d.projects : [],
    subInitiatives: Array.isArray(d.subInitiatives) ? d.subInitiatives : [],
    parentInitiative: d.parentInitiative ?? undefined,
    createdAt: d.createdAt ?? row.created_at,
    updatedAt: d.updatedAt ?? row.updated_at,
  };
}

// -- Standalone query functions (formerly in sync-read.ts) ───────────────────

export async function fetchSyncedIssues(
  options: {
    projectId?: string;
    teamId?: string;
    statuses?: string[];
  }
): Promise<LinearIssue[]> {
  let query = supabaseAdmin
    .from("synced_issues")
    .select("linear_id, data, created_at, updated_at")
    .eq("user_id", WORKSPACE_USER_ID)
    .order("updated_at", { ascending: false });

  if (options.projectId) {
    query = query.eq("project_id", options.projectId);
  }
  if (options.teamId) {
    query = query.eq("team_id", options.teamId);
  }
  if (options.statuses && options.statuses.length > 0) {
    query = query.in("state_name", options.statuses);
  }

  const { data, error } = await query;

  if (error) {
    console.error("fetchSyncedIssues error:", error);
    throw error;
  }

  return (data || []).map((row) =>
    mapRowToLinearIssue(row as { linear_id: string; data: IssueData; created_at: string; updated_at: string })
  );
}

// -- Hub access ──────────────────────────────────────────────────────────────

export type HubAccess = {
  hubId: string;
  role: HubMemberRole;
};

/**
 * Verify the user is a member of the hub and return their role.
 * Returns null if not a member.
 */
export async function verifyHubAccess(
  hubId: string,
  userId: string
): Promise<HubAccess | null> {
  const { data } = await supabaseAdmin
    .from("hub_members")
    .select("role")
    .eq("hub_id", hubId)
    .eq("user_id", userId)
    .single();

  if (!data) return null;

  return { hubId, role: data.role as HubMemberRole };
}

// -- Internal helpers ────────────────────────────────────────────────────────

/**
 * Fetch active team mappings for a hub, including visibility arrays.
 */
async function getHubMappings(hubId: string): Promise<HubTeamMapping[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("*")
    .eq("hub_id", hubId)
    .eq("is_active", true);

  if (error) {
    console.error("getHubMappings error:", error);
    throw error;
  }

  return (data as HubTeamMapping[]) ?? [];
}

/**
 * Get allowed team IDs for a hub.
 */
async function getHubTeamIds(hubId: string): Promise<string[]> {
  const mappings = await getHubMappings(hubId);
  return mappings.map((m) => m.linear_team_id);
}

/**
 * Merge visibility arrays from all team mappings.
 * Empty array in any mapping = "all visible" for that team → return null (no filter).
 * Otherwise return the union of all IDs across mappings.
 */
function mergeVisibility(
  mappings: HubTeamMapping[],
  field: "visible_project_ids" | "visible_initiative_ids" | "visible_label_ids"
): string[] | null {
  const ids = new Set<string>();

  for (const m of mappings) {
    const arr = m[field];
    if (arr && arr.length > 0) {
      for (const id of arr) ids.add(id);
    }
    // Empty array = nothing configured for this team → contributes nothing
  }

  // Union of all configured IDs. Empty = nothing configured = nothing visible.
  return Array.from(ids);
}

/**
 * Merge project visibility, taking auto_include_projects into account.
 * If ANY mapping has auto_include_projects = true, return null (no filter for that team's projects).
 * Otherwise merge visible_project_ids as before.
 */
function mergeProjectVisibility(
  mappings: HubTeamMapping[]
): string[] | null {
  // If any mapping auto-includes all projects, we can't filter at DB level
  if (mappings.some((m) => m.auto_include_projects)) {
    return null;
  }

  return mergeVisibility(mappings, "visible_project_ids");
}

/**
 * Returns true if any mapping opts in to showing project-less issues.
 */
function shouldIncludeUnassigned(mappings: HubTeamMapping[]): boolean {
  return mappings.some((m) => m.include_unassigned_issues);
}

/**
 * Check if a project is marked as overview-only for a specific team in the hub.
 * Overview-only projects show description/updates but not issues.
 */
export async function isProjectOverviewOnly(
  hubId: string,
  teamId: string,
  projectId: string
): Promise<boolean> {
  const mappings = await getHubMappings(hubId);
  return mappings.some(
    (m) =>
      m.linear_team_id === teamId &&
      m.overview_only_project_ids &&
      m.overview_only_project_ids.includes(projectId)
  );
}

/**
 * Get the set of overview-only project IDs across all team mappings for a hub.
 */
export function getOverviewOnlyProjectIds(
  mappings: HubTeamMapping[]
): Set<string> {
  const ids = new Set<string>();
  for (const m of mappings) {
    if (m.overview_only_project_ids) {
      for (const id of m.overview_only_project_ids) ids.add(id);
    }
  }
  return ids;
}

/**
 * Fetch the set of overview-only project IDs for a hub.
 */
export async function fetchOverviewOnlyProjectIds(
  hubId: string
): Promise<Set<string>> {
  const mappings = await getHubMappings(hubId);
  return getOverviewOnlyProjectIds(mappings);
}

/**
 * Strip assignee data from a LinearIssue (clients should not see assignees).
 */
function stripAssignee<T extends LinearIssue>(issue: T): T {
  return { ...issue, assignee: undefined };
}

/**
 * Get visible label IDs for a specific team within a hub.
 * Returns null if the team has no label restrictions (empty config).
 * Returns empty array if the team isn't found in mappings.
 */
function getTeamLabelIds(
  mappings: HubTeamMapping[],
  teamId: string
): string[] | null {
  const mapping = mappings.find((m) => m.linear_team_id === teamId);
  if (!mapping) return [];
  const arr = mapping.visible_label_ids;
  if (!arr || arr.length === 0) return [];
  return arr;
}

/**
 * Check if an issue should be hidden based on the team's hidden_label_ids config.
 * Returns true if the issue has ANY label in the hidden set.
 */
function isIssueHidden(
  issue: LinearIssue,
  mappings: HubTeamMapping[],
  teamId: string
): boolean {
  const mapping = mappings.find((m) => m.linear_team_id === teamId);
  if (!mapping) return false;
  const hidden = mapping.hidden_label_ids;
  if (!hidden || hidden.length === 0) return false;
  return issue.labels.some((l) => hidden.includes(l.id));
}

/**
 * Filter labels on an issue using the per-team visibility config.
 */
function filterLabelsByTeam<T extends LinearIssue>(
  issue: T,
  mappings: HubTeamMapping[],
  teamId: string
): T {
  const allowed = getTeamLabelIds(mappings, teamId);
  if (!allowed) return issue;
  return {
    ...issue,
    labels: issue.labels.filter((l) => allowed.includes(l.id)),
  };
}

// -- Hub-scoped query functions ──────────────────────────────────────────────

/**
 * Fetch issues scoped to a hub's teams, with visibility filtering.
 * Strips assignees. Filters labels.
 */
export async function fetchHubIssues(
  hubId: string,
  options?: {
    projectId?: string;
    teamId?: string;
    statuses?: string[];
  }
): Promise<LinearIssue[]> {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return [];

  const teamIds = mappings.map((m) => m.linear_team_id);
  const allowedProjectIds = mergeProjectVisibility(mappings);

  // If a specific teamId is requested, verify it belongs to this hub
  if (options?.teamId && !teamIds.includes(options.teamId)) {
    return [];
  }

  // If a specific projectId is requested, verify it's visible
  if (options?.projectId && allowedProjectIds && !allowedProjectIds.includes(options.projectId)) {
    return [];
  }

  let query = supabaseAdmin
    .from("synced_issues")
    .select("linear_id, data, created_at, updated_at, team_id")
    .eq("user_id", WORKSPACE_USER_ID)
    .in("team_id", options?.teamId ? [options.teamId] : teamIds)
    .order("updated_at", { ascending: false });

  if (options?.projectId) {
    query = query.eq("project_id", options.projectId);
  } else if (allowedProjectIds) {
    query = query.in("project_id", allowedProjectIds);
  }

  if (options?.statuses && options.statuses.length > 0) {
    query = query.in("state_name", options.statuses);
  }

  const { data, error } = await query;

  if (error) {
    console.error("fetchHubIssues error:", error);
    throw error;
  }

  return (data || []).reduce<LinearIssue[]>((acc, row) => {
    const r = row as { linear_id: string; data: Record<string, unknown>; created_at: string; updated_at: string; team_id: string };
    const issue = stripAssignee(mapRowToLinearIssue(r));
    if (isIssueHidden(issue, mappings, r.team_id)) return acc;
    acc.push(filterLabelsByTeam(issue, mappings, r.team_id));
    return acc;
  }, []);
}

/**
 * Fetch a single issue by Linear ID, scoped to a hub.
 * Returns the issue with description, dueDate, and hub-visible labels, or null.
 */
export async function fetchHubIssueDetail(
  hubId: string,
  issueLinearId: string
) {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return null;

  const teamIds = mappings.map((m) => m.linear_team_id);

  const { data: row } = await supabaseAdmin
    .from("synced_issues")
    .select("linear_id, data, created_at, updated_at, team_id")
    .eq("user_id", WORKSPACE_USER_ID)
    .eq("linear_id", issueLinearId)
    .single();

  if (!row || !teamIds.includes(row.team_id)) return null;

  const d = row.data as Record<string, unknown>;

  // Enforce project scoping so a direct ?issue= link can't open an issue whose
  // project isn't visible to the hub (or an unscoped issue when the hub doesn't
  // include unassigned issues) — matching the Tasks tab (PULSE-370).
  const projectId = (d.project as { id?: string } | undefined)?.id ?? null;
  if (!isIssueProjectVisible(mappings, projectId)) return null;

  const issue = mapRowToLinearIssue(
    row as { linear_id: string; data: Record<string, unknown>; created_at: string; updated_at: string }
  );

  const detailed = stripAssignee({
    ...issue,
    dueDate: (d.dueDate as string) ?? undefined,
    cycle: d.cycle ? {
      id: (d.cycle as Record<string, unknown>).id as string ?? "",
      name: (d.cycle as Record<string, unknown>).name as string ?? "",
      number: (d.cycle as Record<string, unknown>).number as number ?? 0,
    } : undefined,
  });

  // Exclude entirely if issue carries a hidden label
  if (isIssueHidden(detailed, mappings, row.team_id)) return null;

  return {
    ...filterLabelsByTeam(detailed, mappings, row.team_id),
    teamId: row.team_id as string,
  };
}

type IssueScopedEvent = {
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown> | null;
};

/**
 * Drop activity/notification events whose underlying issue isn't currently
 * visible to the hub. Emit-time scoping (notification-events.ts) prevents new
 * leaks, but this re-checks live visibility at read time so events emitted
 * before that guard — or for an issue later moved into a hidden project —
 * stop showing (PULSE-370). Non-issue events (projects, cycles, initiatives)
 * pass through untouched.
 */
export async function filterEventsByIssueVisibility<T extends IssueScopedEvent>(
  hubId: string,
  events: T[]
): Promise<T[]> {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return [];
  const teamIds = new Set(mappings.map((m) => m.linear_team_id));

  // Map each issue/comment event to the Linear id of its underlying issue.
  // Issue events store it in entity_id; comment events store the comment id in
  // entity_id and the parent issue id in metadata._issue_id.
  const issueIdByEvent = new Map<T, string | null>();
  for (const e of events) {
    if (e.entity_type === "issue") {
      issueIdByEvent.set(e, e.entity_id);
    } else if (e.entity_type === "comment") {
      const issueId = (e.metadata?._issue_id as string | undefined) ?? null;
      issueIdByEvent.set(e, issueId);
    }
  }

  const issueIds = [...new Set([...issueIdByEvent.values()].filter((v): v is string => !!v))];
  const visibility = new Map<string, boolean>();
  if (issueIds.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from("synced_issues")
      .select("linear_id, team_id, project_id")
      .eq("user_id", WORKSPACE_USER_ID)
      .in("linear_id", issueIds);
    for (const r of rows ?? []) {
      const visible =
        teamIds.has(r.team_id as string) &&
        isIssueProjectVisible(mappings, (r.project_id as string | null) ?? null);
      visibility.set(r.linear_id as string, visible);
    }
  }

  return events.filter((e) => {
    if (e.entity_type !== "issue" && e.entity_type !== "comment") return true;
    const issueId = issueIdByEvent.get(e);
    // Unresolvable issue (missing id or not in synced_issues) → can't confirm
    // visibility, so drop it rather than risk leaking.
    if (!issueId) return false;
    return visibility.get(issueId) === true;
  });
}

/**
 * Fetch roadmap issues scoped to a hub, supporting multiple project IDs.
 */
export async function fetchHubRoadmapIssues(
  hubId: string,
  projectIds: string[]
): Promise<RoadmapIssue[]> {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return [];

  const allowedProjectIds = mergeProjectVisibility(mappings);

  // Filter requested projectIds to only those visible in the hub
  const filteredProjectIds = allowedProjectIds
    ? projectIds.filter((id) => allowedProjectIds.includes(id))
    : projectIds;

  const includeUnassigned = shouldIncludeUnassigned(mappings);
  if (filteredProjectIds.length === 0 && !includeUnassigned) return [];

  // Query 1: Issues belonging to specified projects
  const projectQuery = filteredProjectIds.length > 0
    ? supabaseAdmin
        .from("synced_issues")
        .select("linear_id, data, created_at, updated_at, team_id")
        .eq("user_id", WORKSPACE_USER_ID)
        .in("project_id", filteredProjectIds)
        .order("updated_at", { ascending: false })
    : null;

  // Query 2: Issues with no project (when include_unassigned_issues is on)
  const teamIds = mappings.map((m) => m.linear_team_id);
  const unassignedQuery = includeUnassigned
    ? supabaseAdmin
        .from("synced_issues")
        .select("linear_id, data, created_at, updated_at, team_id")
        .eq("user_id", WORKSPACE_USER_ID)
        .in("team_id", teamIds)
        .is("project_id", null)
        .order("updated_at", { ascending: false })
    : null;

  const [projectResult, unassignedResult] = await Promise.all([
    projectQuery ?? Promise.resolve({ data: null, error: null }),
    unassignedQuery ?? Promise.resolve({ data: null, error: null }),
  ]);

  if (projectResult.error) {
    console.error("fetchHubRoadmapIssues error:", projectResult.error);
    throw projectResult.error;
  }
  if (unassignedResult.error) {
    console.error("fetchHubRoadmapIssues unassigned error:", unassignedResult.error);
    throw unassignedResult.error;
  }

  const data = [...(projectResult.data || []), ...(unassignedResult.data || [])];

  return (data || []).reduce<RoadmapIssue[]>((acc, row) => {
    const r = row as { linear_id: string; data: Record<string, unknown>; created_at: string; updated_at: string; team_id: string };
    const d = r.data;
    const issue = stripAssignee({
      ...mapRowToLinearIssue(r),
      dueDate: (d.dueDate as string) ?? undefined,
      project: d.project
        ? {
            id: (d.project as Record<string, unknown>).id as string ?? "",
            name: (d.project as Record<string, unknown>).name as string ?? "",
            color: (d.project as Record<string, unknown>).color as string | undefined,
          }
        : undefined,
    });
    if (isIssueHidden(issue, mappings, r.team_id)) return acc;
    acc.push(filterLabelsByTeam(issue, mappings, r.team_id));
    return acc;
  }, []);
}

/**
 * Fetch issues belonging to a specific cycle, scoped to the hub.
 */
export async function fetchHubCycleIssues(
  hubId: string,
  cycleLinearId: string
): Promise<RoadmapIssue[]> {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return [];

  const teamIds = mappings.map((m) => m.linear_team_id);

  const { data, error } = await supabaseAdmin
    .from("synced_issues")
    .select("linear_id, data, created_at, updated_at, team_id")
    .eq("user_id", WORKSPACE_USER_ID)
    .in("team_id", teamIds)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("fetchHubCycleIssues error:", error);
    throw error;
  }

  const overviewOnlyIds = getOverviewOnlyProjectIds(mappings);
  const allowedProjectIds = mergeProjectVisibility(mappings);
  const includeUnassigned = shouldIncludeUnassigned(mappings);

  return (data || []).reduce<RoadmapIssue[]>((acc, row) => {
    const r = row as { linear_id: string; data: Record<string, unknown>; created_at: string; updated_at: string; team_id: string };
    const d = r.data;
    const cycle = d.cycle as Record<string, unknown> | undefined;
    if (!cycle || cycle.id !== cycleLinearId) return acc;
    const projectId = (d.project as Record<string, unknown> | undefined)?.id as string | undefined;
    // Enforce project visibility: project-less issues require opt-in,
    // project issues must be in the allowed set and not overview-only.
    if (!projectId) {
      if (!includeUnassigned) return acc;
    } else {
      if (allowedProjectIds && !allowedProjectIds.includes(projectId)) return acc;
      if (overviewOnlyIds.has(projectId)) return acc;
    }
    const issue = stripAssignee({
      ...mapRowToLinearIssue(r),
      dueDate: (d.dueDate as string) ?? undefined,
      project: d.project
        ? {
            id: (d.project as Record<string, unknown>).id as string ?? "",
            name: (d.project as Record<string, unknown>).name as string ?? "",
            color: (d.project as Record<string, unknown>).color as string | undefined,
          }
        : undefined,
    });
    if (isIssueHidden(issue, mappings, r.team_id)) return acc;
    acc.push(filterLabelsByTeam(issue, mappings, r.team_id));
    return acc;
  }, []);
}

/**
 * Fetch comments for an issue, verifying the issue belongs to the hub's scope.
 * Merges synced Linear comments with hub_comments (client-authored).
 */
export async function fetchHubComments(
  hubId: string,
  issueLinearId: string
) {
  // Verify the issue belongs to this hub's teams
  const teamIds = await getHubTeamIds(hubId);
  if (teamIds.length === 0) return [];

  const { data: issueRow } = await supabaseAdmin
    .from("synced_issues")
    .select("team_id")
    .eq("user_id", WORKSPACE_USER_ID)
    .eq("linear_id", issueLinearId)
    .single();

  if (!issueRow || !teamIds.includes(issueRow.team_id)) {
    return [];
  }

  // Fetch both Linear synced comments and hub comments in parallel
  const [linearResult, hubResult] = await Promise.all([
    supabaseAdmin
      .from("synced_comments")
      .select("linear_id, data, created_at, updated_at")
      .eq("user_id", WORKSPACE_USER_ID)
      .eq("issue_linear_id", issueLinearId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("hub_comments")
      .select("id, linear_comment_id, parent_comment_id, user_id, author_name, author_email, body, push_status, push_error, created_at, updated_at")
      .eq("hub_id", hubId)
      .eq("issue_linear_id", issueLinearId)
      .order("created_at", { ascending: true }),
  ]);

  const allLinearComments = (linearResult.data || []).map((row) => {
    const mapped = mapRowToComment(
      row as { linear_id: string; data: Record<string, unknown>; created_at: string; updated_at: string }
    );
    return mapped;
  });

  // Filter synced comments: only show heyclient comments and their thread replies.
  // Step 1: Identify client-facing root comments (those with heyclient prefix)
  const visibleLinearIds = new Set<string>();
  for (const c of allLinearComments) {
    if (isClientFacing(c.body)) {
      visibleLinearIds.add(c.linearId);
    }
  }

  // Step 2: Walk replies — if parent is visible, child is visible too (recursive)
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of allLinearComments) {
      if (visibleLinearIds.has(c.linearId)) continue;
      if (c.parentId && visibleLinearIds.has(c.parentId)) {
        visibleLinearIds.add(c.linearId);
        changed = true;
      }
    }
  }

  // Step 3: Filter and strip prefix from client-facing root comments
  const linearComments = allLinearComments
    .filter((c) => visibleLinearIds.has(c.linearId))
    .map((c) => {
      if (isClientFacing(c.body)) {
        const stripped = stripClientPrefix(c.body);
        // Hide comments that are just "heyclient" with no actual content
        if (!stripped) return null;
        return { ...c, body: stripped, isTeamComment: true };
      }
      // Thread replies from the team (no prefix) — show as-is
      return { ...c, isTeamComment: true };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const hubComments = (hubResult.data || []).map((row) => ({
    id: row.id,
    linearId: row.linear_comment_id as string | undefined,
    body: row.body,
    parentId: row.parent_comment_id as string | undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    push_status: row.push_status as string | undefined,
    push_error: row.push_error as string | undefined,
    user: {
      id: row.user_id as string,
      name: row.author_name,
    },
    isHubComment: true,
    isTeamComment: false,
  }));

  // Deduplicate: when a hub comment has been pushed to Linear and synced back,
  // the synced_comments version would show a duplicate. Remove synced comments
  // whose linear_id matches a hub comment's linear_comment_id.
  const pushedHubLinearIds = new Set(
    hubComments
      .filter((c) => c.linearId && c.push_status === "pushed")
      .map((c) => c.linearId!)
  );

  const deduplicatedLinearComments = linearComments.filter(
    (c) => !pushedHubLinearIds.has(c.linearId)
  );

  // Merge and sort by createdAt
  type FlatComment = {
    id: string;
    linearId?: string;
    body: string;
    parentId?: string;
    createdAt: string;
    updatedAt: string;
    user: { id: string; name: string };
    isHubComment?: boolean;
    isTeamComment?: boolean;
    push_status?: string;
    push_error?: string;
  };
  const all: FlatComment[] = [...deduplicatedLinearComments, ...hubComments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Build threaded structure: group children under parents by Linear comment ID
  type ThreadedComment = FlatComment & { children: FlatComment[] };
  const byLinearId = new Map<string, ThreadedComment>();
  const roots: ThreadedComment[] = [];

  for (const c of all) {
    const tc: ThreadedComment = { ...c, children: [] };
    if (c.linearId) byLinearId.set(c.linearId, tc);

    if (!c.parentId) {
      roots.push(tc);
    } else {
      const parent = byLinearId.get(c.parentId);
      if (parent) {
        parent.children.push(tc);
      } else {
        // Orphan — hide if it's a synced comment (parent was internal/hidden)
        // Show if it's a hub comment (client authored)
        if (c.isHubComment) {
          roots.push(tc);
        }
        // Otherwise: orphaned synced reply to a hidden thread — drop it
      }
    }
  }

  return roots;
}

/**
 * Fetch teams mapped to a hub.
 */
export async function fetchHubTeams(hubId: string) {
  const teamIds = await getHubTeamIds(hubId);
  if (teamIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("synced_teams")
    .select("linear_id, data, created_at, updated_at")
    .eq("user_id", WORKSPACE_USER_ID)
    .in("linear_id", teamIds)
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchHubTeams error:", error);
    throw error;
  }

  return (data || []).map((row) =>
    mapRowToTeam(
      row as { linear_id: string; data: Record<string, unknown>; created_at: string; updated_at: string }
    )
  );
}

/**
 * Fetch per-team stats for a hub's landing page.
 * Returns project count, open issue count, and last activity per team.
 */
export async function fetchHubTeamStats(hubId: string) {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return new Map<string, { projectCount: number; openIssueCount: number; lastActivity: string | null }>();

  const teamIds = mappings.map((m) => m.linear_team_id);

  // Fetch open issue counts and latest updated_at per team
  // "Open" = not in completed/cancelled state types
  const { data: issues } = await supabaseAdmin
    .from("synced_issues")
    .select("team_id, data, updated_at")
    .eq("user_id", WORKSPACE_USER_ID)
    .in("team_id", teamIds);

  // Fetch projects and count per team
  const { data: projects } = await supabaseAdmin
    .from("synced_projects")
    .select("linear_id, data")
    .eq("user_id", WORKSPACE_USER_ID);

  const stats = new Map<string, { projectCount: number; openIssueCount: number; lastActivity: string | null }>();

  for (const teamId of teamIds) {
    stats.set(teamId, { projectCount: 0, openIssueCount: 0, lastActivity: null });
  }

  // Count open issues and track latest activity per team
  const completedTypes = new Set(["completed", "cancelled"]);
  for (const issue of issues || []) {
    const teamStat = stats.get(issue.team_id);
    if (!teamStat) continue;

    const d = issue.data as Record<string, unknown>;
    const stateType = (d.state as Record<string, unknown> | undefined)?.type as string | undefined;
    if (!stateType || !completedTypes.has(stateType)) {
      teamStat.openIssueCount++;
    }

    if (!teamStat.lastActivity || issue.updated_at > teamStat.lastActivity) {
      teamStat.lastActivity = issue.updated_at;
    }
  }

  // Count projects per team (projects have teams array in data)
  const allowedProjectIds = mergeProjectVisibility(mappings);
  for (const proj of projects || []) {
    if (allowedProjectIds && !allowedProjectIds.includes(proj.linear_id)) continue;
    const d = proj.data as Record<string, unknown>;
    const projTeams = d.teams as Array<{ id: string }> | undefined;
    const projTeamIds = Array.isArray(projTeams)
      ? projTeams.map((t) => t.id)
      : Array.isArray(d.teamIds)
        ? (d.teamIds as string[])
        : [];
    for (const tid of projTeamIds) {
      const teamStat = stats.get(tid);
      if (teamStat) teamStat.projectCount++;
    }
  }

  return stats;
}

/**
 * Fetch projects visible to a hub.
 * Filters by allowed project IDs from hub_team_mappings visibility config.
 */
export async function fetchHubProjects(
  hubId: string,
  options?: { statusName?: string }
) {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return [];

  const teamIds = mappings.map((m) => m.linear_team_id);
  const allowedProjectIds = mergeProjectVisibility(mappings);

  // Explicit empty array means no projects are allowed (auto-include off, none selected)
  if (Array.isArray(allowedProjectIds) && allowedProjectIds.length === 0) {
    return [];
  }

  // Projects are linked to teams — fetch all, then filter
  let query = supabaseAdmin
    .from("synced_projects")
    .select("linear_id, data, created_at, updated_at")
    .eq("user_id", WORKSPACE_USER_ID)
    .order("updated_at", { ascending: false });

  if (options?.statusName) {
    query = query.eq("status_name", options.statusName);
  }

  if (allowedProjectIds) {
    query = query.in("linear_id", allowedProjectIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error("fetchHubProjects error:", error);
    throw error;
  }

  // Post-filter: only projects that belong to at least one hub team
  const projects = (data || [])
    .map((row) =>
      mapRowToProject(
        row as { linear_id: string; data: Record<string, unknown>; created_at: string; updated_at: string }
      )
    )
    .filter((project) => {
      // If we filtered by specific allowedProjectIds, all are visible
      if (allowedProjectIds) return true;
      // Otherwise (null = auto-include) ensure the project has at least one team in the hub
      return project.teams.some((t) => teamIds.includes(t.id));
    });

  // Override raw project health with the latest *client-facing* update's health
  // so clients only ever see opted-in (pulse/heyclient) status — never the raw
  // internal health. Projects with no client-facing update get no badge.
  const derivedHealth = await deriveClientFacingHealth(projects.map((p) => p.id));
  for (const project of projects) {
    const derived = derivedHealth.get(project.id);
    project.health = derived?.health ?? undefined;
    project.healthUpdatedAt = derived?.at ?? undefined;
  }

  return projects;
}

/**
 * Cheap single-project visibility check for a hub — avoids loading every hub
 * project (and deriving health for all of them) just to validate one id.
 * Mirrors the visibility rules in fetchHubProjects.
 */
export async function isProjectVisibleInHub(
  hubId: string,
  projectId: string
): Promise<boolean> {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return false;

  const allowedProjectIds = mergeProjectVisibility(mappings);

  // Explicit empty array = nothing visible.
  if (Array.isArray(allowedProjectIds) && allowedProjectIds.length === 0) {
    return false;
  }

  // Scoped to a specific set — id must be in it (no DB read needed).
  if (allowedProjectIds) return allowedProjectIds.includes(projectId);

  // Auto-include (null): the project must belong to at least one hub team.
  const teamIds = mappings.map((m) => m.linear_team_id);
  const { data } = await supabaseAdmin
    .from("synced_projects")
    .select("data")
    .eq("user_id", WORKSPACE_USER_ID)
    .eq("linear_id", projectId)
    .maybeSingle();
  if (!data?.data) return false;
  const d = data.data as { teams?: Array<{ id: string }>; teamIds?: string[] };
  const projectTeamIds = Array.isArray(d.teams)
    ? d.teams.map((t) => t.id)
    : Array.isArray(d.teamIds)
      ? d.teamIds
      : [];
  return projectTeamIds.some((id) => teamIds.includes(id));
}

export type HubProjectUpdate = {
  id: string;
  projectId: string;
  body: string;
  health: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * For each given project, the health + date of its most recent *client-facing*
 * health update (pulse/heyclient prefixed). Used to override raw project.health
 * so clients only see opted-in status. Projects with no client-facing update are
 * absent from the map (caller leaves health undefined → badge hidden).
 * Best-effort: on query error returns an empty map (no derived health).
 */
export async function deriveClientFacingHealth(
  projectIds: string[]
): Promise<Map<string, { health: string | null; at: string }>> {
  const result = new Map<string, { health: string | null; at: string }>();
  if (projectIds.length === 0) return result;

  const { data, error } = await supabaseAdmin
    .from("synced_project_updates")
    .select("project_id, health, data, created_at")
    .eq("user_id", WORKSPACE_USER_ID)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("deriveClientFacingHealth error:", error);
    return result;
  }

  // Rows are newest-first; the first client-facing update per project wins.
  for (const row of data || []) {
    const pid = row.project_id as string | null;
    if (!pid || result.has(pid)) continue;
    const body = ((row.data as { body?: string } | null)?.body ?? "").toString();
    if (!isClientFacingUpdate(body)) continue;
    result.set(pid, {
      health: (row.health as string | null) ?? null,
      at: row.created_at as string,
    });
  }

  return result;
}

/**
 * Fetch the client-facing project health updates for the given project IDs.
 * Reads synced_project_updates, keeps only pulse/heyclient-prefixed updates,
 * strips the prefix, newest first. Callers are responsible for passing only
 * hub-visible project IDs (visibility is enforced upstream).
 */
export async function fetchProjectUpdatesForProjectIds(
  projectIds: string[]
): Promise<HubProjectUpdate[]> {
  if (projectIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("synced_project_updates")
    .select("linear_id, project_id, health, data, created_at, updated_at")
    .eq("user_id", WORKSPACE_USER_ID)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchProjectUpdatesForProjectIds error:", error);
    throw error;
  }

  const updates: HubProjectUpdate[] = [];
  for (const row of data || []) {
    const body = ((row.data as { body?: string } | null)?.body ?? "").toString();
    if (!isClientFacingUpdate(body)) continue;
    const stripped = stripUpdateClientPrefix(body);
    if (!stripped) continue; // bare "pulse"/"heyclient" with no content → hide
    updates.push({
      id: row.linear_id as string,
      projectId: row.project_id as string,
      body: stripped,
      health: (row.health as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    });
  }

  return updates;
}

/**
 * Fetch initiatives visible to a hub.
 * Filters by allowed initiative IDs from hub_team_mappings visibility config.
 */
export async function fetchHubInitiatives(
  hubId: string,
  options?: { status?: string }
) {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return [];

  const allowedInitiativeIds = mergeVisibility(mappings, "visible_initiative_ids");

  let query = supabaseAdmin
    .from("synced_initiatives")
    .select("linear_id, data, created_at, updated_at")
    .eq("user_id", WORKSPACE_USER_ID)
    .order("updated_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  if (allowedInitiativeIds) {
    query = query.in("linear_id", allowedInitiativeIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error("fetchHubInitiatives error:", error);
    throw error;
  }

  return (data || []).map((row) =>
    mapRowToInitiative(
      row as { linear_id: string; data: Record<string, unknown>; created_at: string; updated_at: string }
    )
  );
}

// -- Hub votes ────────────────────────────────────────────────────────────────

/**
 * Fetch vote counts per issue for a list of issue Linear IDs within a hub.
 */
export async function fetchHubVotes(
  hubId: string,
  issueLinearIds: string[]
): Promise<Record<string, number>> {
  if (issueLinearIds.length === 0) return {};

  const { data, error } = await supabaseAdmin
    .from("hub_votes")
    .select("issue_linear_id")
    .eq("hub_id", hubId)
    .in("issue_linear_id", issueLinearIds);

  if (error) {
    console.error("fetchHubVotes error:", error);
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.issue_linear_id] = (counts[row.issue_linear_id] || 0) + 1;
  }
  return counts;
}

/**
 * Fetch the set of issue Linear IDs that a user has voted on in a hub.
 */
export async function fetchUserVotes(
  hubId: string,
  userId: string
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_votes")
    .select("issue_linear_id")
    .eq("hub_id", hubId)
    .eq("user_id", userId);

  if (error) {
    console.error("fetchUserVotes error:", error);
    return [];
  }

  return (data || []).map((row) => row.issue_linear_id);
}

/**
 * Get the set of hub-visible label IDs for a specific team.
 * Returns empty array if the team has no labels configured (= nothing visible).
 */
export async function getHubVisibleLabelIds(
  hubId: string,
  teamId: string
): Promise<string[] | null> {
  const mappings = await getHubMappings(hubId);
  return getTeamLabelIds(mappings, teamId);
}

/**
 * Fetch the full label definitions (id, name, color) for a team's visible labels.
 * Queries the Linear API for the team's labels and filters to the hub's configured visible set.
 * Returns empty array if no labels are configured for the team.
 */
export function mapRowToCycle(row: {
  linear_id: string;
  data: CycleData;
  created_at: string;
  updated_at: string;
}) {
  const d = row.data;
  const now = new Date();
  const startsAt = d.startsAt ? new Date(d.startsAt) : null;
  const endsAt = d.endsAt ? new Date(d.endsAt) : null;
  const isCurrent = startsAt && endsAt ? startsAt <= now && endsAt > now : false;
  const isUpcoming = startsAt ? startsAt > now : false;

  return {
    id: d.id ?? row.linear_id,
    name: d.name ?? null,
    number: d.number ?? 0,
    description: d.description ?? undefined,
    startsAt: d.startsAt ?? null,
    endsAt: d.endsAt ?? null,
    completedAt: d.completedAt ?? undefined,
    progress: d.progress ?? 0,
    isCurrent,
    isUpcoming,
    completedIssueCountHistory: d.completedIssueCountHistory ?? [],
    issueCountHistory: d.issueCountHistory ?? [],
    completedScopeHistory: d.completedScopeHistory ?? [],
    scopeHistory: d.scopeHistory ?? [],
    team: d.team ?? undefined,
    links: Array.isArray(d.links) ? d.links : [],
    documents: Array.isArray(d.documents) ? d.documents : [],
    createdAt: d.createdAt ?? row.created_at,
    updatedAt: d.updatedAt ?? row.updated_at,
  };
}

export async function fetchHubCycles(
  hubId: string,
  options?: { teamId?: string }
) {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return [];

  const teamIds = mappings.map((m) => m.linear_team_id);

  if (options?.teamId && !teamIds.includes(options.teamId)) {
    return [];
  }

  const targetTeamIds = options?.teamId ? [options.teamId] : teamIds;

  const { data, error } = await supabaseAdmin
    .from("synced_cycles")
    .select("linear_id, data, created_at, updated_at")
    .eq("user_id", WORKSPACE_USER_ID)
    .in("team_id", targetTeamIds)
    .order("starts_at", { ascending: false });

  if (error) {
    console.error("fetchHubCycles error:", error);
    throw error;
  }

  return (data || []).map((row) =>
    mapRowToCycle(
      row as { linear_id: string; data: CycleData; created_at: string; updated_at: string }
    )
  );
}

export async function fetchHubCycleStats(
  hubId: string,
  cycleLinearIds: string[]
): Promise<Record<string, { total: number; completed: number }>> {
  if (cycleLinearIds.length === 0) return {};

  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return {};

  const teamIds = mappings.map((m) => m.linear_team_id);
  const overviewOnlyIds = getOverviewOnlyProjectIds(mappings);

  const { data, error } = await supabaseAdmin
    .from("synced_issues")
    .select("data")
    .eq("user_id", WORKSPACE_USER_ID)
    .in("team_id", teamIds)
    .not("data->cycle", "is", null);

  if (error) {
    console.error("fetchHubCycleStats error:", error);
    return {};
  }

  const stats: Record<string, { total: number; completed: number }> = {};
  for (const id of cycleLinearIds) {
    stats[id] = { total: 0, completed: 0 };
  }

  const completedTypes = new Set(["completed", "cancelled"]);

  for (const row of data || []) {
    const d = row.data as Record<string, unknown>;
    const cycle = d.cycle as { id?: string } | undefined;
    if (!cycle?.id || !stats[cycle.id]) continue;

    const projectId = (d.project as Record<string, unknown> | undefined)?.id as string | undefined;
    if (projectId && overviewOnlyIds.has(projectId)) continue;

    stats[cycle.id].total++;
    const stateType = (d.state as Record<string, unknown> | undefined)?.type as string | undefined;
    if (stateType && completedTypes.has(stateType)) {
      stats[cycle.id].completed++;
    }
  }

  return stats;
}

export async function fetchHubTeamLabels(
  hubId: string,
  teamId: string
): Promise<Array<{ id: string; name: string; color: string }>> {
  const mappings = await getHubMappings(hubId);
  const allowedIds = getTeamLabelIds(mappings, teamId);

  // No labels configured or empty = nothing visible
  if (!allowedIds || allowedIds.length === 0) return [];

  const token = await getWorkspaceToken();
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({
      query: `
        query TeamLabels($teamId: String!) {
          team(id: $teamId) {
            labels(first: 250) {
              nodes { id name color }
            }
          }
        }
      `,
      variables: { teamId },
    }),
  });

  const result = (await res.json()) as {
    data?: { team?: { labels: { nodes: Array<{ id: string; name: string; color: string }> } } };
  };

  const allLabels = result.data?.team?.labels.nodes ?? [];
  return allLabels.filter((l) => allowedIds.includes(l.id));
}

/**
 * Derive metadata (states, labels) from hub-scoped issues.
 * Strips assignees — returns states and visible labels only.
 */
export async function fetchHubMetadata(
  hubId: string,
  options?: { projectId?: string; teamId?: string }
) {
  const mappings = await getHubMappings(hubId);
  if (mappings.length === 0) return { states: [], labels: [], cycles: [] };

  const teamIds = mappings.map((m) => m.linear_team_id);

  // If a specific teamId is requested, verify it belongs to this hub
  if (options?.teamId && !teamIds.includes(options.teamId)) {
    return { states: [], labels: [], cycles: [] };
  }

  // For labels, scope to the requested team only
  const labelTeamId = options?.teamId;
  const allowedLabelIds = labelTeamId
    ? getTeamLabelIds(mappings, labelTeamId)
    : null; // No team context = no label filtering (callers should provide teamId)

  let query = supabaseAdmin
    .from("synced_issues")
    .select("data, team_id")
    .eq("user_id", WORKSPACE_USER_ID)
    .in("team_id", options?.teamId ? [options.teamId] : teamIds);

  if (options?.projectId) query = query.eq("project_id", options.projectId);

  const { data, error } = await query;
  if (error || !data) return { states: [], labels: [], cycles: [] };

  const statesMap = new Map<string, { id: string; name: string; color: string; type: string }>();
  const labelsMap = new Map<string, { id: string; name: string; color: string }>();
  const cyclesMap = new Map<string, { id: string; name: string; number: number; startsAt: string | null; endsAt: string | null }>();

  // For scoping cycle extraction to only visible issues
  const metaAllowedProjectIds = mergeProjectVisibility(mappings);
  const metaOverviewOnlyIds = getOverviewOnlyProjectIds(mappings);
  const metaIncludeUnassigned = shouldIncludeUnassigned(mappings);

  for (const row of data) {
    const d = row.data as Record<string, unknown>;
    const rowTeamId = (row as Record<string, unknown>).team_id as string;

    // Skip hidden issues from metadata extraction
    const issueLabels = d.labels as Array<{ id: string; name: string; color: string }> | undefined;
    if (issueLabels) {
      const mapping = mappings.find((m) => m.linear_team_id === rowTeamId);
      const hiddenIds = mapping?.hidden_label_ids;
      if (hiddenIds && hiddenIds.length > 0 && issueLabels.some((l) => hiddenIds.includes(l.id))) {
        continue;
      }
    }

    const state = d.state as { id?: string; name?: string; color?: string; type?: string } | undefined;
    if (state?.name) {
      statesMap.set(state.name, {
        id: state.id ?? "",
        name: state.name,
        color: state.color ?? "",
        type: state.type ?? "",
      });
    }
    const labels = d.labels as Array<{ id: string; name: string; color: string }> | undefined;
    if (Array.isArray(labels)) {
      // Use per-team label visibility
      const teamLabelIds = labelTeamId
        ? allowedLabelIds
        : getTeamLabelIds(mappings, rowTeamId);
      // teamLabelIds: null = no filtering, [] = nothing visible, [...ids] = only those
      if (teamLabelIds && teamLabelIds.length === 0) continue; // nothing visible for this team
      for (const label of labels) {
        if (teamLabelIds && !teamLabelIds.includes(label.id)) continue;
        labelsMap.set(label.id, label);
      }
    }
    // Only include cycles from issues that are actually visible (respects project scoping)
    const cycle = d.cycle as { id?: string; name?: string; number?: number } | undefined;
    if (cycle?.id) {
      const pid = (d.project as Record<string, unknown> | undefined)?.id as string | undefined;
      const projectVisible = pid
        ? (!metaAllowedProjectIds || metaAllowedProjectIds.includes(pid)) && !metaOverviewOnlyIds.has(pid)
        : metaIncludeUnassigned;
      if (projectVisible && !cyclesMap.has(cycle.id)) {
        cyclesMap.set(cycle.id, {
          id: cycle.id,
          name: cycle.name ?? "",
          number: cycle.number ?? 0,
          startsAt: null,
          endsAt: null,
        });
      }
    }
    // No assignees — intentionally omitted for client hub view
  }

  // Enrich cycles with date ranges from synced_cycles
  const cycleIds = Array.from(cyclesMap.keys());
  if (cycleIds.length > 0) {
    const { data: cycleRows } = await supabaseAdmin
      .from("synced_cycles")
      .select("linear_id, data")
      .in("linear_id", cycleIds);

    for (const row of cycleRows ?? []) {
      const d = row.data as Record<string, unknown>;
      const entry = cyclesMap.get(row.linear_id as string);
      if (entry) {
        entry.startsAt = (d.startsAt as string) ?? null;
        entry.endsAt = (d.endsAt as string) ?? null;
      }
    }
  }

  return {
    states: Array.from(statesMap.values()),
    labels: Array.from(labelsMap.values()),
    cycles: Array.from(cyclesMap.values()),
  };
}
