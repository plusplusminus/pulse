import { supabaseAdmin } from "./supabase";

// ─── Read queries ───

export async function fetchUserRanking(hubId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("hub_project_rankings")
    .select("project_linear_id, rank")
    .eq("hub_id", hubId)
    .eq("user_id", userId)
    .order("rank", { ascending: true });

  if (error) {
    console.error("fetchUserRanking error:", error);
    throw error;
  }

  return data ?? [];
}

export type CompositeRank = {
  projectLinearId: string;
  averageRank: number;
  rankerCount: number;
  ranks: number[]; // individual ranks for variance calculation
};

export async function fetchCompositeRanking(
  hubId: string
): Promise<CompositeRank[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_project_rankings")
    .select("project_linear_id, rank, user_id")
    .eq("hub_id", hubId)
    .order("rank", { ascending: true });

  if (error) {
    console.error("fetchCompositeRanking error:", error);
    throw error;
  }

  if (!data || data.length === 0) return [];

  // Group by project
  const grouped = new Map<
    string,
    { ranks: number[]; users: Set<string> }
  >();
  for (const row of data) {
    if (!grouped.has(row.project_linear_id)) {
      grouped.set(row.project_linear_id, { ranks: [], users: new Set() });
    }
    const entry = grouped.get(row.project_linear_id)!;
    entry.ranks.push(row.rank);
    entry.users.add(row.user_id);
  }

  const result: CompositeRank[] = [];
  for (const [projectLinearId, entry] of grouped) {
    const sum = entry.ranks.reduce((a, b) => a + b, 0);
    result.push({
      projectLinearId,
      averageRank: sum / entry.ranks.length,
      rankerCount: entry.users.size,
      ranks: entry.ranks,
    });
  }

  return result.sort((a, b) => a.averageRank - b.averageRank);
}

export type RankingLogEntry = {
  id: string;
  hubId: string;
  userId: string;
  projectLinearId: string;
  previousRank: number | null;
  newRank: number;
  createdAt: string;
};

export async function fetchRankingLog(
  hubId: string,
  options?: {
    projectLinearId?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }
): Promise<RankingLogEntry[]> {
  let query = supabaseAdmin
    .from("hub_ranking_log")
    .select("*")
    .eq("hub_id", hubId)
    .order("created_at", { ascending: false });

  if (options?.projectLinearId) {
    query = query.eq("project_linear_id", options.projectLinearId);
  }
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
    console.error("fetchRankingLog error:", error);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    hubId: row.hub_id,
    userId: row.user_id,
    projectLinearId: row.project_linear_id,
    previousRank: row.previous_rank,
    newRank: row.new_rank,
    createdAt: row.created_at,
  }));
}

// ─── Write operations ───

/**
 * Save a user's full project ranking.
 * Returns the list of changes (for logging).
 */
export async function saveUserRanking(
  hubId: string,
  userId: string,
  orderedProjectIds: string[]
): Promise<{ projectLinearId: string; previousRank: number | null; newRank: number }[]> {
  // Fetch current ranking for diff
  const current = await fetchUserRanking(hubId, userId);
  const currentMap = new Map(
    current.map((r) => [r.project_linear_id, r.rank])
  );

  // Delete all existing rankings for this user/hub, then insert fresh.
  // This avoids UNIQUE(hub_id, user_id, rank) conflicts that occur with
  // upsert when ranks are being reassigned across projects.
  const { error: deleteError } = await supabaseAdmin
    .from("hub_project_rankings")
    .delete()
    .eq("hub_id", hubId)
    .eq("user_id", userId);

  if (deleteError) {
    console.error("saveUserRanking delete error:", deleteError);
    throw deleteError;
  }

  // Insert new rankings
  const rows = orderedProjectIds.map((projectLinearId, index) => ({
    hub_id: hubId,
    user_id: userId,
    project_linear_id: projectLinearId,
    rank: index + 1,
    updated_at: new Date().toISOString(),
  }));

  const { error: insertError } = await supabaseAdmin
    .from("hub_project_rankings")
    .insert(rows);

  if (insertError) {
    console.error("saveUserRanking insert error:", insertError);
    throw insertError;
  }

  // Calculate diffs
  const changes: {
    projectLinearId: string;
    previousRank: number | null;
    newRank: number;
  }[] = [];

  for (let i = 0; i < orderedProjectIds.length; i++) {
    const projectLinearId = orderedProjectIds[i];
    const newRank = i + 1;
    const previousRank = currentMap.get(projectLinearId) ?? null;

    if (previousRank !== newRank) {
      changes.push({ projectLinearId, previousRank, newRank });
    }
  }

  // Log changes
  if (changes.length > 0) {
    const logRows = changes.map((c) => ({
      hub_id: hubId,
      user_id: userId,
      project_linear_id: c.projectLinearId,
      previous_rank: c.previousRank,
      new_rank: c.newRank,
    }));

    const { error: logError } = await supabaseAdmin
      .from("hub_ranking_log")
      .insert(logRows);

    if (logError) {
      // Non-critical — log but don't fail
      console.error("saveUserRanking log error:", logError);
    }
  }

  return changes;
}

/**
 * Remove ranking entries for projects no longer visible.
 * Compresses remaining ranks to remove gaps.
 */
export async function reconcileRankings(
  hubId: string,
  visibleProjectIds: string[]
) {
  const visibleSet = new Set(visibleProjectIds);

  // Get all rankings for this hub
  const { data, error } = await supabaseAdmin
    .from("hub_project_rankings")
    .select("id, user_id, project_linear_id, rank")
    .eq("hub_id", hubId)
    .order("rank", { ascending: true });

  if (error || !data) return;

  // Group by user
  const byUser = new Map<string, typeof data>();
  for (const row of data) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id)!.push(row);
  }

  const toDelete: string[] = [];
  const toUpdate: { id: string; rank: number }[] = [];

  for (const [, rows] of byUser) {
    let newRank = 1;
    for (const row of rows) {
      if (!visibleSet.has(row.project_linear_id)) {
        toDelete.push(row.id);
      } else {
        if (row.rank !== newRank) {
          toUpdate.push({ id: row.id, rank: newRank });
        }
        newRank++;
      }
    }
  }

  // Delete stale entries
  if (toDelete.length > 0) {
    await supabaseAdmin
      .from("hub_project_rankings")
      .delete()
      .in("id", toDelete);
  }

  // Update compressed ranks in parallel
  if (toUpdate.length > 0) {
    const now = new Date().toISOString();
    await Promise.all(
      toUpdate.map((u) =>
        supabaseAdmin
          .from("hub_project_rankings")
          .update({ rank: u.rank, updated_at: now })
          .eq("id", u.id)
      )
    );
  }
}
