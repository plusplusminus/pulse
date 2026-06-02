import { supabaseAdmin } from "./supabase";

/**
 * Per-(hub, user) notification settings (PULSE-362).
 *
 * comment_scope:
 *   'all'           — every client-facing comment (default / current behaviour)
 *   'mentions_only' — only comments that mention this user
 *
 * (PULSE-365 adds watch_mode to the same row.)
 */
export type CommentScope = "all" | "mentions_only";

export const COMMENT_SCOPES: readonly CommentScope[] = ["all", "mentions_only"];

const DEFAULT_COMMENT_SCOPE: CommentScope = "all";

/** Comment scope for one user in one hub; defaults to 'all' when unset. */
export async function getCommentScope(
  hubId: string,
  userId: string
): Promise<CommentScope> {
  const { data, error } = await supabaseAdmin
    .from("hub_notification_settings")
    .select("comment_scope")
    .eq("hub_id", hubId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("getCommentScope error:", error);
    return DEFAULT_COMMENT_SCOPE;
  }
  return (data?.comment_scope as CommentScope) ?? DEFAULT_COMMENT_SCOPE;
}

/** All explicitly-set comment scopes for a hub, keyed by user_id. */
export async function getCommentScopesForHub(
  hubId: string
): Promise<Map<string, CommentScope>> {
  const map = new Map<string, CommentScope>();
  const { data, error } = await supabaseAdmin
    .from("hub_notification_settings")
    .select("user_id, comment_scope")
    .eq("hub_id", hubId);

  if (error) {
    console.error("getCommentScopesForHub error:", error);
    return map;
  }
  for (const row of data ?? []) {
    map.set(row.user_id, row.comment_scope as CommentScope);
  }
  return map;
}

/** Upsert a user's comment scope for a hub. */
export async function upsertCommentScope(
  hubId: string,
  userId: string,
  scope: CommentScope
): Promise<CommentScope> {
  const { error } = await supabaseAdmin
    .from("hub_notification_settings")
    .upsert(
      {
        hub_id: hubId,
        user_id: userId,
        comment_scope: scope,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "hub_id,user_id" }
    );

  if (error) {
    console.error("upsertCommentScope error:", error);
    throw error;
  }
  return scope;
}
