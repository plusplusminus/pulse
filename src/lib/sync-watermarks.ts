import { supabaseAdmin } from "./supabase";

/**
 * Read the last reconciliation watermark for a team+entity pair.
 * Returns null if no watermark exists (meaning: do a full fetch).
 */
export async function getWatermark(
  teamId: string,
  entityType: string
): Promise<Date | null> {
  const { data, error } = await supabaseAdmin
    .from("sync_watermarks")
    .select("last_reconciled_at")
    .eq("team_id", teamId)
    .eq("entity_type", entityType)
    .single();

  if (error || !data) return null;
  return new Date(data.last_reconciled_at);
}

/**
 * Upsert the watermark after a successful sync of a team+entity pair.
 */
export async function setWatermark(
  teamId: string,
  entityType: string,
  timestamp: Date
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sync_watermarks")
    .upsert(
      {
        team_id: teamId,
        entity_type: entityType,
        last_reconciled_at: timestamp.toISOString(),
      },
      { onConflict: "team_id,entity_type" }
    );

  if (error) {
    console.error(`Failed to set watermark for ${teamId}/${entityType}:`, error);
    throw error;
  }
}
