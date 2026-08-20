import { supabaseAdmin } from "./supabase";

export const EVENT_TYPES = [
  "comment",
  "status_change",
  "project_update",
  "new_issue",
  "cycle_update",
  "initiative_update",
  "health_update",
] as const;

export type NotificationEventType = (typeof EVENT_TYPES)[number];

export type NotificationPreference = {
  event_type: NotificationEventType;
  in_app_enabled: boolean;
  email_mode: "off" | "immediate" | "daily" | "weekly";
  digest_time: string;
  timezone: string;
};

// Quiet-by-default baseline (PULSE-360).
//
// New hub members have no stored rows, so these defaults decide what they
// receive out of the box. Previously every event type defaulted to a daily
// email digest, which firehosed clients with automated noise and buried the
// messages PMs actually addressed to them. We now default email ON only for
// the client-directed streams (`comment`, `health_update`) and OFF for automated
// event types. The in-app activity feed still surfaces everything (in_app_enabled
// stays true); only the push channel (email) is quieted.
//
// `health_update` (PULSE-363) is a deliberate PM-authored client update gated by
// the heyclient/pulse trigger — like comments, it's directed at the client, so
// it's email-on by default.
const EMAIL_ON_BY_DEFAULT: ReadonlySet<NotificationEventType> = new Set([
  "comment",
  "health_update",
]);

const BASE_DEFAULT = {
  in_app_enabled: true,
  digest_time: "09:00",
  // Recipients are predominantly SA-based, so "09:00" means 9am SAST, not UTC
  // (PULSE-307). Backfilled for existing rows in 20260602_digest_default_timezone.sql.
  timezone: "Africa/Johannesburg",
} as const;

export function defaultPreferenceFor(
  eventType: NotificationEventType
): NotificationPreference {
  return {
    event_type: eventType,
    ...BASE_DEFAULT,
    email_mode: EMAIL_ON_BY_DEFAULT.has(eventType) ? "immediate" : "off",
  };
}

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

  return EVENT_TYPES.map(
    (eventType) => stored.get(eventType) ?? defaultPreferenceFor(eventType)
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
  const rows = preferences.map((p) => {
    const d = defaultPreferenceFor(p.event_type);
    return {
      hub_id: hubId,
      user_id: userId,
      event_type: p.event_type,
      in_app_enabled: p.in_app_enabled ?? d.in_app_enabled,
      email_mode: p.email_mode ?? d.email_mode,
      digest_time: p.digest_time ?? d.digest_time,
      timezone: p.timezone ?? d.timezone,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabaseAdmin
    .from("notification_preferences")
    .upsert(rows, { onConflict: "hub_id,user_id,event_type" });

  if (error) {
    console.error("upsertPreferences error:", error);
    throw error;
  }

  return getPreferencesForUser(hubId, userId);
}
