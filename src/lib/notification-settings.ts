import { supabaseAdmin } from "./supabase";

/**
 * Per-(hub, user) notification settings (PULSE-362 / PULSE-365).
 *
 * comment_scope:
 *   'all'           — every client-facing comment (default)
 *   'mentions_only' — only comments that mention this user
 * watch_mode:
 *   'all'             — all activity, minus tasks the user muted (default)
 *   'subscribed_only' — only tasks the user follows, plus direct @mentions
 *
 * Both live on a single hub_notification_settings row.
 */
export type CommentScope = "all" | "mentions_only";
export type WatchMode = "all" | "subscribed_only";

export const COMMENT_SCOPES: readonly CommentScope[] = ["all", "mentions_only"];
export const WATCH_MODES: readonly WatchMode[] = ["all", "subscribed_only"];

export type NotificationSettings = {
  commentScope: CommentScope;
  watchMode: WatchMode;
};

export const DEFAULT_SETTINGS: NotificationSettings = {
  commentScope: "all",
  watchMode: "all",
};

type SettingsRow = { comment_scope?: string | null; watch_mode?: string | null };

function rowToSettings(row: SettingsRow | null | undefined): NotificationSettings {
  return {
    commentScope:
      (row?.comment_scope as CommentScope) ?? DEFAULT_SETTINGS.commentScope,
    watchMode: (row?.watch_mode as WatchMode) ?? DEFAULT_SETTINGS.watchMode,
  };
}

/** Settings for one user in one hub; defaults when unset. */
export async function getSettings(
  hubId: string,
  userId: string
): Promise<NotificationSettings> {
  const { data, error } = await supabaseAdmin
    .from("hub_notification_settings")
    .select("comment_scope, watch_mode")
    .eq("hub_id", hubId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("getSettings error:", error);
    return DEFAULT_SETTINGS;
  }
  return rowToSettings(data);
}

/** Settings for every user with a row in a hub, keyed by user_id. */
export async function getSettingsForHub(
  hubId: string
): Promise<Map<string, NotificationSettings>> {
  const map = new Map<string, NotificationSettings>();
  const { data, error } = await supabaseAdmin
    .from("hub_notification_settings")
    .select("user_id, comment_scope, watch_mode")
    .eq("hub_id", hubId);

  if (error) {
    console.error("getSettingsForHub error:", error);
    return map;
  }
  for (const row of data ?? []) {
    map.set(row.user_id, rowToSettings(row));
  }
  return map;
}

/**
 * Upsert only the supplied settings fields, preserving any not provided.
 * On insert, omitted columns take their DB defaults; on conflict, only the
 * supplied columns are updated.
 */
export async function upsertSettings(
  hubId: string,
  userId: string,
  patch: { commentScope?: CommentScope; watchMode?: WatchMode }
): Promise<NotificationSettings> {
  const row: Record<string, unknown> = {
    hub_id: hubId,
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (patch.commentScope !== undefined) row.comment_scope = patch.commentScope;
  if (patch.watchMode !== undefined) row.watch_mode = patch.watchMode;

  const { error } = await supabaseAdmin
    .from("hub_notification_settings")
    .upsert(row, { onConflict: "hub_id,user_id" });

  if (error) {
    console.error("upsertSettings error:", error);
    throw error;
  }
  return getSettings(hubId, userId);
}
