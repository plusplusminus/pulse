import { supabaseAdmin, type HubTeamMapping } from "./supabase";

// ─── Visibility helpers ───

/**
 * Get all project IDs that have task prioritisation enabled for a hub.
 * Merges task_priority_project_ids across all active team mappings.
 */
export async function fetchTaskPriorityProjectIds(
  hubId: string
): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("task_priority_project_ids")
    .eq("hub_id", hubId)
    .eq("is_active", true);

  if (error) {
    console.error("fetchTaskPriorityProjectIds error:", error);
    throw error;
  }

  const ids = new Set<string>();
  for (const mapping of data ?? []) {
    for (const id of (mapping as { task_priority_project_ids: string[] }).task_priority_project_ids ?? []) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Check if task prioritisation is enabled for a specific project in a hub.
 */
export async function isTaskPriorityEnabled(
  hubId: string,
  projectId: string
): Promise<boolean> {
  const ids = await fetchTaskPriorityProjectIds(hubId);
  return ids.has(projectId);
}

// ─── Task Rankings ───

export type TaskRanking = {
  issueLinearId: string;
  rank: number;
};

export async function fetchUserTaskRanking(
  hubId: string,
  userId: string,
  projectId: string
): Promise<TaskRanking[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_task_rankings")
    .select("issue_linear_id, rank")
    .eq("hub_id", hubId)
    .eq("user_id", userId)
    .eq("project_linear_id", projectId)
    .order("rank", { ascending: true });

  if (error) {
    console.error("fetchUserTaskRanking error:", error);
    throw error;
  }

  return (data ?? []).map((r) => ({
    issueLinearId: r.issue_linear_id,
    rank: r.rank,
  }));
}

export type CompositeTaskRank = {
  issueLinearId: string;
  averageRank: number;
  rankerCount: number;
  ranks: number[];
};

export async function fetchCompositeTaskRanking(
  hubId: string,
  projectId: string
): Promise<CompositeTaskRank[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_task_rankings")
    .select("issue_linear_id, rank, user_id")
    .eq("hub_id", hubId)
    .eq("project_linear_id", projectId)
    .order("rank", { ascending: true });

  if (error) {
    console.error("fetchCompositeTaskRanking error:", error);
    throw error;
  }

  if (!data || data.length === 0) return [];

  const grouped = new Map<string, { ranks: number[]; users: Set<string> }>();
  for (const row of data) {
    if (!grouped.has(row.issue_linear_id)) {
      grouped.set(row.issue_linear_id, { ranks: [], users: new Set() });
    }
    const entry = grouped.get(row.issue_linear_id)!;
    entry.ranks.push(row.rank);
    entry.users.add(row.user_id);
  }

  const result: CompositeTaskRank[] = [];
  for (const [issueLinearId, entry] of grouped) {
    const sum = entry.ranks.reduce((a, b) => a + b, 0);
    result.push({
      issueLinearId,
      averageRank: sum / entry.ranks.length,
      rankerCount: entry.users.size,
      ranks: entry.ranks,
    });
  }

  return result.sort((a, b) => a.averageRank - b.averageRank);
}

export type TaskRankingLogEntry = {
  id: string;
  hubId: string;
  userId: string;
  projectLinearId: string;
  issueLinearId: string;
  previousRank: number | null;
  newRank: number;
  createdAt: string;
};

export async function fetchTaskRankingLog(
  hubId: string,
  projectId: string,
  options?: {
    userId?: string;
    limit?: number;
    offset?: number;
  }
): Promise<TaskRankingLogEntry[]> {
  let query = supabaseAdmin
    .from("hub_task_ranking_log")
    .select("*")
    .eq("hub_id", hubId)
    .eq("project_linear_id", projectId)
    .order("created_at", { ascending: false });

  if (options?.userId) {
    query = query.eq("user_id", options.userId);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.range(
      options.offset,
      options.offset + (options.limit ?? 50) - 1
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("fetchTaskRankingLog error:", error);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    hubId: row.hub_id,
    userId: row.user_id,
    projectLinearId: row.project_linear_id,
    issueLinearId: row.issue_linear_id,
    previousRank: row.previous_rank,
    newRank: row.new_rank,
    createdAt: row.created_at,
  }));
}

/**
 * Save a user's full task ranking within a project.
 * Uses delete/re-insert to avoid UNIQUE constraint violations.
 */
export async function saveUserTaskRanking(
  hubId: string,
  userId: string,
  projectId: string,
  orderedIssueIds: string[]
): Promise<{ issueLinearId: string; previousRank: number | null; newRank: number }[]> {
  const current = await fetchUserTaskRanking(hubId, userId, projectId);
  const currentMap = new Map(
    current.map((r) => [r.issueLinearId, r.rank])
  );

  const { error: deleteError } = await supabaseAdmin
    .from("hub_task_rankings")
    .delete()
    .eq("hub_id", hubId)
    .eq("user_id", userId)
    .eq("project_linear_id", projectId);

  if (deleteError) {
    console.error("saveUserTaskRanking delete error:", deleteError);
    throw deleteError;
  }

  const rows = orderedIssueIds.map((issueLinearId, index) => ({
    hub_id: hubId,
    user_id: userId,
    project_linear_id: projectId,
    issue_linear_id: issueLinearId,
    rank: index + 1,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from("hub_task_rankings")
      .insert(rows);

    if (insertError) {
      console.error("saveUserTaskRanking insert error:", insertError);
      throw insertError;
    }
  }

  const changes: {
    issueLinearId: string;
    previousRank: number | null;
    newRank: number;
  }[] = [];

  for (let i = 0; i < orderedIssueIds.length; i++) {
    const issueLinearId = orderedIssueIds[i];
    const newRank = i + 1;
    const previousRank = currentMap.get(issueLinearId) ?? null;

    if (previousRank !== newRank) {
      changes.push({ issueLinearId, previousRank, newRank });
    }
  }

  if (changes.length > 0) {
    const logRows = changes.map((c) => ({
      hub_id: hubId,
      user_id: userId,
      project_linear_id: projectId,
      issue_linear_id: c.issueLinearId,
      previous_rank: c.previousRank,
      new_rank: c.newRank,
    }));

    const { error: logError } = await supabaseAdmin
      .from("hub_task_ranking_log")
      .insert(logRows);

    if (logError) {
      console.error("saveUserTaskRanking log error:", logError);
    }
  }

  return changes;
}

// ─── Task RICE Scores ───

export type TaskRiceScore = {
  issueLinearId: string;
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  effort: number | null;
  score: number | null;
  updatedAt: string;
};

export async function fetchUserTaskRiceScores(
  hubId: string,
  userId: string,
  projectId: string
): Promise<TaskRiceScore[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_task_rice_scores")
    .select(
      "issue_linear_id, reach, impact, confidence, effort, score, updated_at"
    )
    .eq("hub_id", hubId)
    .eq("user_id", userId)
    .eq("project_linear_id", projectId);

  if (error) {
    console.error("fetchUserTaskRiceScores error:", error);
    throw error;
  }

  return (data ?? []).map((row) => ({
    issueLinearId: row.issue_linear_id,
    reach: row.reach,
    impact: row.impact,
    confidence: row.confidence,
    effort: row.effort,
    score: row.score,
    updatedAt: row.updated_at,
  }));
}

export type CompositeTaskRiceScore = {
  issueLinearId: string;
  averageReach: number | null;
  averageImpact: number | null;
  averageConfidence: number | null;
  averageEffort: number | null;
  averageScore: number | null;
  scorerCount: number;
  scores: Array<{
    userId: string;
    reach: number | null;
    impact: number | null;
    confidence: number | null;
    effort: number | null;
    score: number | null;
  }>;
};

export async function fetchCompositeTaskRiceScores(
  hubId: string,
  projectId: string
): Promise<CompositeTaskRiceScore[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_task_rice_scores")
    .select(
      "issue_linear_id, user_id, reach, impact, confidence, effort, score"
    )
    .eq("hub_id", hubId)
    .eq("project_linear_id", projectId);

  if (error) {
    console.error("fetchCompositeTaskRiceScores error:", error);
    throw error;
  }

  if (!data || data.length === 0) return [];

  const grouped = new Map<string, typeof data>();
  for (const row of data) {
    if (!grouped.has(row.issue_linear_id)) {
      grouped.set(row.issue_linear_id, []);
    }
    grouped.get(row.issue_linear_id)!.push(row);
  }

  const avg = (arr: (number | null)[]): number | null => {
    const valid = arr.filter((v): v is number => v !== null);
    if (valid.length === 0) return null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  };

  const result: CompositeTaskRiceScore[] = [];
  for (const [issueLinearId, rows] of grouped) {
    const withScore = rows.filter((r) => r.score !== null);

    result.push({
      issueLinearId,
      averageReach: avg(rows.map((r) => r.reach)),
      averageImpact: avg(rows.map((r) => r.impact)),
      averageConfidence: avg(rows.map((r) => r.confidence)),
      averageEffort: avg(rows.map((r) => r.effort)),
      averageScore: avg(withScore.map((r) => r.score)),
      scorerCount: new Set(withScore.map((r) => r.user_id)).size,
      scores: rows.map((r) => ({
        userId: r.user_id,
        reach: r.reach,
        impact: r.impact,
        confidence: r.confidence,
        effort: r.effort,
        score: r.score,
      })),
    });
  }

  return result.sort((a, b) => {
    if (a.averageScore === null && b.averageScore === null) return 0;
    if (a.averageScore === null) return 1;
    if (b.averageScore === null) return -1;
    return b.averageScore - a.averageScore;
  });
}

export async function saveTaskRiceScore(
  hubId: string,
  userId: string,
  projectId: string,
  issueLinearId: string,
  values: {
    reach?: number | null;
    impact?: number | null;
    confidence?: number | null;
    effort?: number | null;
  }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("hub_task_rice_scores")
    .upsert(
      {
        hub_id: hubId,
        user_id: userId,
        project_linear_id: projectId,
        issue_linear_id: issueLinearId,
        reach: values.reach ?? null,
        impact: values.impact ?? null,
        confidence: values.confidence ?? null,
        effort: values.effort ?? null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "hub_id,user_id,project_linear_id,issue_linear_id",
      }
    );

  if (error) {
    console.error("saveTaskRiceScore error:", error);
    throw error;
  }
}
