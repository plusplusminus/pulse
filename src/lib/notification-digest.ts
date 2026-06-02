import { supabaseAdmin } from "./supabase";
import { sendEmail } from "./email";
import { DigestNotification, type DigestEvent } from "@/emails/digest-notification";
import { shouldIncludeInDigest } from "./notification-eligibility";
import type {
  NotificationEventType,
  NotificationPreference,
} from "./notification-preferences";
import { createElement } from "react";

type DigestType = "daily" | "weekly";

type DigestCandidate = {
  hub_id: string;
  user_id: string;
  digest_time: string;
  timezone: string;
  event_types: string[];
  last_digest_at: string | null;
};

type HubInfo = {
  name: string;
  slug: string;
};

/**
 * Process digest emails for all eligible users.
 * Called hourly by the cron job — checks each user's timezone + preferred hour.
 */
export async function processDigests(
  type: DigestType
): Promise<{ sent: number; skipped: number; errors: number }> {
  const stats = { sent: 0, skipped: 0, errors: 0 };
  const emailModeColumn = type;
  const lastDigestColumn =
    type === "daily" ? "last_daily_digest_at" : "last_weekly_digest_at";
  const lookbackHours = type === "daily" ? 24 : 168; // 24h or 7d

  // Step 1: Fetch all preferences with this digest mode enabled
  const { data: prefs, error: prefsError } = await supabaseAdmin
    .from("notification_preferences")
    .select(
      `hub_id, user_id, event_type, digest_time, timezone, ${lastDigestColumn}`
    )
    .eq("email_mode", emailModeColumn);

  if (prefsError || !prefs || prefs.length === 0) {
    if (prefsError) console.error("processDigests: prefs query error:", prefsError);
    return stats;
  }

  // Step 2: Group by (hub_id, user_id) and aggregate event types
  const candidateMap = new Map<string, DigestCandidate>();
  for (const row of prefs) {
    const key = `${row.hub_id}:${row.user_id}`;
    const existing = candidateMap.get(key);
    if (existing) {
      existing.event_types.push(row.event_type);
    } else {
      candidateMap.set(key, {
        hub_id: row.hub_id,
        user_id: row.user_id,
        digest_time: row.digest_time,
        timezone: row.timezone,
        event_types: [row.event_type],
        last_digest_at: (row as Record<string, unknown>)[lastDigestColumn] as string | null,
      });
    }
  }

  // Step 3: Filter candidates that are due now
  const dueCandidates: DigestCandidate[] = [];
  for (const candidate of candidateMap.values()) {
    if (!isDueNow(candidate, type)) {
      stats.skipped++;
      continue;
    }
    dueCandidates.push(candidate);
  }

  if (dueCandidates.length === 0) return stats;

  // Step 4: Batch-fetch hub info for all relevant hubs
  const hubIds = [...new Set(dueCandidates.map((c) => c.hub_id))];
  const hubMap = await fetchHubInfoBatch(hubIds);

  // Step 5: Batch-fetch user emails
  const userIds = [...new Set(dueCandidates.map((c) => c.user_id))];
  const emailMap = await fetchUserEmailsBatch(userIds);

  // Step 6: Process each candidate
  for (const candidate of dueCandidates) {
    try {
      await processOneDigest(candidate, type, lastDigestColumn, lookbackHours, hubMap, emailMap);
      stats.sent++;
    } catch (err) {
      stats.errors++;
      console.error(
        `processDigests: error for user=${candidate.user_id} hub=${candidate.hub_id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return stats;
}

/**
 * Check if the current hour matches the user's preferred digest_time in their timezone.
 * For weekly digests, also checks that today is Monday.
 */
function isDueNow(candidate: DigestCandidate, type: DigestType): boolean {
  const now = new Date();

  // Current hour/day in the recipient's timezone, falling back to the shared
  // default zone (not UTC) when the stored timezone is missing or invalid.
  const { hour: userHour, day: userDay } = hourAndDayInTimeZone(
    now,
    candidate.timezone
  );

  // Parse the preferred hour from digest_time (e.g. "09:00"). Treat anything
  // missing, non-numeric, or outside 0–23 (e.g. "24:00", "99:00") as malformed
  // and fall back to the default hour rather than scheduling incorrectly.
  const parsedHour = parseInt((candidate.digest_time ?? "").split(":")[0], 10);
  const preferredHour =
    Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23
      ? parsedHour
      : DEFAULT_DIGEST_HOUR;
  if (userHour !== preferredHour) return false;

  // Weekly digests only on Monday
  if (type === "weekly" && userDay !== 1) return false;

  // Check we haven't already sent within the current window
  if (candidate.last_digest_at) {
    const lastSent = new Date(candidate.last_digest_at);
    const hoursSinceLast =
      (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);
    // For daily: must be >20h since last (avoids re-send within same hour)
    // For weekly: must be >6 days
    const minGap = type === "daily" ? 20 : 144;
    if (hoursSinceLast < minGap) return false;
  }

  return true;
}

// Shared default for digest scheduling when a recipient's stored values are
// missing or invalid. Kept local to avoid coupling to the preferences module.
const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const DEFAULT_DIGEST_HOUR = 9;

/**
 * Current hour (0–23) and weekday (0=Sun … 6=Sat) in `tz`. Falls back to the
 * shared default timezone, then UTC, when `tz` is missing or not a valid zone.
 */
function hourAndDayInTimeZone(
  now: Date,
  tz: string | null | undefined
): { hour: number; day: number } {
  const DAY_INDEX: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  for (const zone of [tz, DEFAULT_TIMEZONE]) {
    if (!zone || !zone.trim()) continue;
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        hour12: false,
        weekday: "short",
      }).formatToParts(now);
      let hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      if (hour === 24) hour = 0; // Intl can report midnight as 24
      const day =
        DAY_INDEX[parts.find((p) => p.type === "weekday")?.value ?? ""] ?? 0;
      return { hour, day };
    } catch {
      // invalid zone — try the next candidate
    }
  }
  return { hour: now.getUTCHours(), day: now.getUTCDay() };
}

async function fetchHubInfoBatch(
  hubIds: string[]
): Promise<Map<string, HubInfo>> {
  const map = new Map<string, HubInfo>();
  if (hubIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("client_hubs")
    .select("id, name, slug")
    .in("id", hubIds);

  if (error) {
    throw new Error(`fetchHubInfoBatch: client_hubs lookup failed: ${error.message}`);
  }

  for (const row of data || []) {
    map.set(row.id, { name: row.name, slug: row.slug });
  }
  return map;
}

async function fetchUserEmailsBatch(
  userIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;

  // Fetch from both hub_members and ppm_admins in parallel
  const [
    { data: memberData, error: memberError },
    { data: adminData, error: adminError },
  ] = await Promise.all([
    supabaseAdmin
      .from("hub_members")
      .select("user_id, email")
      .in("user_id", userIds)
      .not("email", "is", null),
    supabaseAdmin
      .from("ppm_admins")
      .select("user_id, email")
      .in("user_id", userIds)
      .not("email", "is", null),
  ]);

  if (memberError) {
    throw new Error(`fetchUserEmailsBatch: hub_members lookup failed: ${memberError.message}`);
  }
  if (adminError) {
    throw new Error(`fetchUserEmailsBatch: ppm_admins lookup failed: ${adminError.message}`);
  }

  for (const row of memberData || []) {
    if (row.email && row.user_id) {
      map.set(row.user_id, row.email);
    }
  }
  // PPM admins fill in any user_ids not already found via hub_members
  for (const row of adminData || []) {
    if (row.email && row.user_id && !map.has(row.user_id)) {
      map.set(row.user_id, row.email);
    }
  }
  return map;
}

/**
 * Reconstruct the recipient's preference for an event type from a digest
 * candidate. The candidate was built from notification_preferences rows whose
 * email_mode equals this digest's cadence, so any type present in
 * candidate.event_types has email_mode === cadence; anything else has no
 * matching preference (undefined) and is excluded by the resolver.
 */
function candidatePreferenceFor(
  candidate: DigestCandidate,
  eventType: string,
  cadence: DigestType
): NotificationPreference | undefined {
  if (!candidate.event_types.includes(eventType)) return undefined;
  return {
    event_type: eventType as NotificationEventType,
    email_mode: cadence,
    in_app_enabled: true,
    digest_time: candidate.digest_time,
    timezone: candidate.timezone,
  };
}

async function processOneDigest(
  candidate: DigestCandidate,
  type: DigestType,
  lastDigestColumn: string,
  lookbackHours: number,
  hubMap: Map<string, HubInfo>,
  emailMap: Map<string, string>
) {
  const hub = hubMap.get(candidate.hub_id);
  if (!hub) return;

  const userEmail = emailMap.get(candidate.user_id);
  if (!userEmail) return;

  // Calculate lookback window
  const since = candidate.last_digest_at
    ? candidate.last_digest_at
    : new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  // Fetch events since last digest, filtered to user's preferred event types
  const { data: events, error } = await supabaseAdmin
    .from("notification_events")
    .select("id, event_type, entity_type, entity_id, actor_name, summary, metadata, created_at")
    .eq("hub_id", candidate.hub_id)
    .in("event_type", candidate.event_types)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !events || events.length === 0) return;

  // The shared resolver (notification-eligibility.ts) is the authority on what
  // belongs in this digest. Today it mirrors the event_types prefetch above;
  // PULSE-362/364 will layer mention-scope and per-task rules in here for free.
  const eligibleEvents = events.filter((ev) =>
    shouldIncludeInDigest(
      { event_type: ev.event_type },
      { preference: candidatePreferenceFor(candidate, ev.event_type, type) },
      type
    )
  );

  if (eligibleEvents.length === 0) return;

  // Group events by type for the template
  const grouped: Record<string, DigestEvent[]> = {};
  for (const ev of eligibleEvents) {
    if (!grouped[ev.event_type]) grouped[ev.event_type] = [];
    const meta = ev.metadata as Record<string, string | undefined>;
    const teamKey = meta?.team_key;
    let deepLinkUrl = `${getBaseUrl()}/hub/${hub.slug}`;
    if (teamKey && ev.entity_type === "issue") {
      deepLinkUrl = `${getBaseUrl()}/hub/${hub.slug}/${teamKey}/task/${ev.entity_id}`;
    } else if (teamKey && ev.entity_type === "project") {
      deepLinkUrl = `${getBaseUrl()}/hub/${hub.slug}/${teamKey}/projects/${ev.entity_id}`;
    }

    grouped[ev.event_type].push({
      type: ev.event_type,
      summary: ev.summary,
      timestamp: ev.created_at,
      deepLinkUrl,
      actorName: ev.actor_name ?? undefined,
      metadata: ev.metadata as Record<string, string> | undefined,
    });
  }

  // Build date range string
  const sinceDate = new Date(since);
  const nowDate = new Date();
  const dateRange = `${formatDate(sinceDate)} — ${formatDate(nowDate)}`;

  // Send the digest email
  const subject =
    type === "daily"
      ? `Daily digest — ${hub.name}`
      : `Weekly digest — ${hub.name}`;

  const result = await sendEmail({
    to: userEmail,
    subject,
    react: createElement(DigestNotification, {
      hubName: hub.name,
      hubSlug: hub.slug,
      events: grouped,
      period: type,
      dateRange,
      timeZone: candidate.timezone,
    }),
  });

  // Record in email queue (reference first event for the FK)
  const firstEventId = eligibleEvents[0].id;
  await supabaseAdmin.from("notification_email_queue").insert({
    notification_event_id: firstEventId,
    user_id: candidate.user_id,
    hub_id: candidate.hub_id,
    email_address: userEmail,
    status: result.success ? "sent" : "failed",
    is_digest: true,
    resend_message_id: result.messageId ?? null,
    error_message: result.error ?? null,
    sent_at: result.success ? new Date().toISOString() : null,
  });

  // Don't advance last_*_digest_at on a failed send: leave it unchanged so the
  // events roll into the next digest instead of being skipped, and surface the
  // failure so the caller counts it as an error rather than a send.
  if (!result.success) {
    throw new Error(result.error ?? "Failed to send digest email");
  }

  // Update last digest timestamp (only after a confirmed successful send)
  await supabaseAdmin
    .from("notification_preferences")
    .update({ [lastDigestColumn]: new Date().toISOString() })
    .eq("hub_id", candidate.hub_id)
    .eq("user_id", candidate.user_id)
    .in("event_type", candidate.event_types);
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
