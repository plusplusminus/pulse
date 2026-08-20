import { supabaseAdmin } from "./supabase";

/**
 * Timestamp of the most recent completed sync run that refreshed this hub:
 * workspace-wide reconciles (hub_id null - the every-30-min cron syncs all hubs
 * in one run) plus this hub's own targeted syncs. A different hub's targeted
 * sync must not bump this hub's timestamp.
 *
 * Served by the partial index idx_sync_runs_completed (status='completed',
 * completed_at not null) so the ORDER BY ... LIMIT 1 stops after one row.
 */
export async function getLastSyncedAt(hubId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("sync_runs")
    .select("completed_at")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .or(`hub_id.is.null,hub_id.eq.${hubId}`)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getLastSyncedAt error:", error);
    throw error;
  }

  return data?.completed_at ?? null;
}
