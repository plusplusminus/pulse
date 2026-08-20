import { supabaseAdmin } from "./supabase";

// ─── Types ───

export type RiceScore = {
  projectLinearId: string;
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  effort: number | null;
  score: number | null;
  updatedAt: string;
};

export type CompositeRiceScore = {
  projectLinearId: string;
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

// ─── Read queries ───

export async function fetchUserRiceScores(
  hubId: string,
  userId: string
): Promise<RiceScore[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_rice_scores")
    .select(
      "project_linear_id, reach, impact, confidence, effort, score, updated_at"
    )
    .eq("hub_id", hubId)
    .eq("user_id", userId);

  if (error) {
    console.error("fetchUserRiceScores error:", error);
    throw error;
  }

  return (data ?? []).map((row) => ({
    projectLinearId: row.project_linear_id,
    reach: row.reach,
    impact: row.impact,
    confidence: row.confidence,
    effort: row.effort,
    score: row.score,
    updatedAt: row.updated_at,
  }));
}

export async function fetchCompositeRiceScores(
  hubId: string
): Promise<CompositeRiceScore[]> {
  const { data, error } = await supabaseAdmin
    .from("hub_rice_scores")
    .select(
      "project_linear_id, user_id, reach, impact, confidence, effort, score"
    )
    .eq("hub_id", hubId);

  if (error) {
    console.error("fetchCompositeRiceScores error:", error);
    throw error;
  }

  if (!data || data.length === 0) return [];

  // Group by project
  const grouped = new Map<string, typeof data>();
  for (const row of data) {
    if (!grouped.has(row.project_linear_id)) {
      grouped.set(row.project_linear_id, []);
    }
    grouped.get(row.project_linear_id)!.push(row);
  }

  const avg = (arr: (number | null)[]): number | null => {
    const valid = arr.filter((v): v is number => v !== null);
    if (valid.length === 0) return null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  };

  const result: CompositeRiceScore[] = [];
  for (const [projectLinearId, rows] of grouped) {
    const withScore = rows.filter((r) => r.score !== null);

    result.push({
      projectLinearId,
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
    // Sort by score descending, nulls last
    if (a.averageScore === null && b.averageScore === null) return 0;
    if (a.averageScore === null) return 1;
    if (b.averageScore === null) return -1;
    return b.averageScore - a.averageScore;
  });
}

// ─── Write operations ───

export async function saveRiceScore(
  hubId: string,
  userId: string,
  projectLinearId: string,
  values: {
    reach?: number | null;
    impact?: number | null;
    confidence?: number | null;
    effort?: number | null;
  }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("hub_rice_scores")
    .upsert(
      {
        hub_id: hubId,
        user_id: userId,
        project_linear_id: projectLinearId,
        reach: values.reach ?? null,
        impact: values.impact ?? null,
        confidence: values.confidence ?? null,
        effort: values.effort ?? null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "hub_id,user_id,project_linear_id",
      }
    );

  if (error) {
    console.error("saveRiceScore error:", error);
    throw error;
  }
}
