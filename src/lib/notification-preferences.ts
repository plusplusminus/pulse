import { supabaseAdmin } from "./supabase";

export const EVENT_TYPES = [
  "comment",
  "status_change",
  "project_update",
  "new_issue",
  "cycle_update",
  "initiative_update",
] as const;

export type NotificationEventType = (typeof EVENT_TYPES)[number];

export type NotificationPreference = {
  event_type: NotificationEventType;
  in_app_enabled: boolean;
  email_mode: "off" | "immediate" | "daily" | "weekly";
  digest_time: string;
  timezone: string;
};

// Default timezone for digest delivery timing. Recipients are predominantly
// South Africa–based, so "09:00" should mean 9am local rather than 9am UTC.
export const DEFAULT_TIMEZONE = "Africa/Johannesburg";
export const DEFAULT_DIGEST_TIME = "09:00";

export const DEFAULT_PREFERENCE: Omit<NotificationPreference, "event_type"> = {
  in_app_enabled: true,
  email_mode: "daily",
  digest_time: DEFAULT_DIGEST_TIME,
  timezone: DEFAULT_TIMEZONE,
};

/**
 * Fetch notification preferences for a user in a hub.
 * Returns defaults for any event types that don't have a stored preference.
 */
export async function getPreferencesForUser(
  hubId: string,
  userId: string
): Promise<NotificationPreference[]> {
  const { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .select("event_type, in_app_enabled, email_mode, digest_time, timezone")
    .eq("hub_id", hubId)
    .eq("user_id", userId);

  if (error) {
    console.error("getPreferencesForUser error:", error);
    throw error;
  }

  const stored = new Map<string, NotificationPreference>();
  for (const row of data || []) {
    stored.set(row.event_type, {
      event_type: row.event_type as NotificationEventType,
      in_app_enabled: row.in_app_enabled,
      email_mode: row.email_mode,
      digest_time: row.digest_time,
      timezone: row.timezone,
    });
  }

  return EVENT_TYPES.map((eventType) =>
    stored.get(eventType) ?? { event_type: eventType, ...DEFAULT_PREFERENCE }
  );
}

/**
 * Upsert notification preferences for a user in a hub.
 * Uses INSERT ... ON CONFLICT DO UPDATE on the (hub_id, user_id, event_type) unique constraint.
 */
export async function upsertPreferences(
  hubId: string,
  userId: string,
  preferences: Array<{
    event_type: NotificationEventType;
    in_app_enabled?: boolean;
    email_mode?: "off" | "immediate" | "daily" | "weekly";
    digest_time?: string;
    timezone?: string;
  }>
): Promise<NotificationPreference[]> {
  const rows = preferences.map((p) => ({
    hub_id: hubId,
    user_id: userId,
    event_type: p.event_type,
    in_app_enabled: p.in_app_enabled ?? true,
    email_mode: p.email_mode ?? "daily",
    digest_time: p.digest_time ?? DEFAULT_DIGEST_TIME,
    timezone: p.timezone ?? DEFAULT_TIMEZONE,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("notification_preferences")
    .upsert(rows, { onConflict: "hub_id,user_id,event_type" });

  if (error) {
    console.error("upsertPreferences error:", error);
    throw error;
  }

  return getPreferencesForUser(hubId, userId);
}
