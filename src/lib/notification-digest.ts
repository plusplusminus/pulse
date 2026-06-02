import { supabaseAdmin } from "./supabase";
import { sendEmail } from "./email";
import { DigestNotification, type DigestEvent } from "@/emails/digest-notification";
import { createElement } from "react";
import { getAllActiveHubs } from "./hub-visibility";
import {
  EVENT_TYPES,
  DEFAULT_PREFERENCE,
  DEFAULT_TIMEZONE,
  DEFAULT_DIGEST_TIME,
  type NotificationPreference,
} from "./notification-preferences";

type DigestType = "daily" | "weekly";

type Recipient = { userId: string; email: string };

type StoredPreference = {
  event_type: string;
  email_mode: string;
  digest_time: string | null;
  timezone: string | null;
};

type DigestCandidate = {
  hubId: string;
  hubName: string;
  hubSlug: string;
  userId: string;
  email: string;
  digestTime: string;
  timezone: string;
  eventTypes: string[];
  lastDigestAt: string | null;
};

/**
 * Process digest emails for all eligible recipients.
 *
 * Called hourly by the cron job. Every active hub's members (plus PPM admins)
 * are considered — a recipient receives a digest when their *effective*
 * preference for at least one event type is set to this digest mode. Effective
 * preferences fall back to {@link DEFAULT_PREFERENCE} when a user has never
 * saved their settings, so digests reach everyone the UI implies they should
 * rather than only users who manually hit "Save".
 */
export async function processDigests(
  type: DigestType
): Promise<{ sent: number; skipped: number; errors: number }> {
  const stats = { sent: 0, skipped: 0, errors: 0 };
  const lookbackHours = type === "daily" ? 24 : 168; // 24h or 7d
  // Minimum gap since the last digest of this type — guards against a second
  // send if the cron double-fires within the same hour.
  const minGapHours = type === "daily" ? 20 : 144;

  // Step 1: All active hubs
  const hubs = await getAllActiveHubs();
  if (hubs.length === 0) return stats;
  const hubIds = hubs.map((h) => h.id);

  // Step 2: Recipients (hub members + PPM admins) and any stored preferences
  const [membersByHub, admins, storedByUser] = await Promise.all([
    fetchMembersByHub(hubIds),
    fetchPpmAdmins(),
    fetchStoredPreferences(hubIds),
  ]);

  // Step 3: Build a candidate per (hub, recipient) whose effective prefs opt
  // into this digest type for at least one event.
  const candidates: DigestCandidate[] = [];
  for (const hub of hubs) {
    const recipients = dedupeRecipients([
      ...(membersByHub.get(hub.id) ?? []),
      ...admins,
    ]);

    for (const recipient of recipients) {
      const stored = storedByUser.get(`${hub.id}:${recipient.userId}`);
      const prefs = effectivePreferences(stored);
      const subscribed = prefs.filter((p) => p.email_mode === type);
      if (subscribed.length === 0) continue;

      candidates.push({
        hubId: hub.id,
        hubName: hub.name,
        hubSlug: hub.slug,
        userId: recipient.userId,
        email: recipient.email,
        digestTime: subscribed[0].digest_time,
        timezone: subscribed[0].timezone,
        eventTypes: subscribed.map((p) => p.event_type),
        lastDigestAt: null,
      });
    }
  }

  if (candidates.length === 0) return stats;

  // Step 4: Look up the last digest already sent to each (hub, user)
  const lastSent = await fetchLastDigestSent(candidates, lookbackHours);
  for (const candidate of candidates) {
    candidate.lastDigestAt =
      lastSent.get(`${candidate.hubId}:${candidate.userId}`) ?? null;
  }

  // Step 5: Filter to candidates that are due now (resilient per-candidate)
  const dueCandidates: DigestCandidate[] = [];
  for (const candidate of candidates) {
    let due = false;
    try {
      due = isDueNow(candidate, type, minGapHours);
    } catch (err) {
      // A single malformed row must never abort the whole run.
      console.error(
        `processDigests: isDueNow failed for user=${candidate.userId} hub=${candidate.hubId}:`,
        err instanceof Error ? err.message : err
      );
    }
    if (due) dueCandidates.push(candidate);
    else stats.skipped++;
  }

  if (dueCandidates.length === 0) return stats;

  // Step 6: Send each due digest
  for (const candidate of dueCandidates) {
    try {
      const sent = await processOneDigest(candidate, type, lookbackHours);
      if (sent) stats.sent++;
      else stats.skipped++;
    } catch (err) {
      stats.errors++;
      console.error(
        `processDigests: error for user=${candidate.userId} hub=${candidate.hubId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return stats;
}

/**
 * Check if the current hour matches the recipient's preferred digest_time in
 * their timezone. For weekly digests, also requires that today is Monday.
 * Tolerates missing/invalid timezone and digest_time by falling back to the
 * configured defaults rather than throwing.
 */
function isDueNow(
  candidate: DigestCandidate,
  type: DigestType,
  minGapHours: number
): boolean {
  const now = new Date();
  const timeZone =
    candidate.timezone && candidate.timezone.trim() !== ""
      ? candidate.timezone
      : DEFAULT_TIMEZONE;

  let userHour: number;
  let userDay: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    }).formatToParts(now);
    userHour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const dayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    userDay = dayMap[dayStr] ?? 0;
  } catch {
    // Invalid timezone — fall back to UTC.
    userHour = now.getUTCHours();
    userDay = now.getUTCDay();
  }

  // Intl can report midnight as hour 24 in some environments; normalize to 0.
  if (userHour === 24) userHour = 0;

  const preferredHour = parsePreferredHour(candidate.digestTime);
  if (userHour !== preferredHour) return false;

  // Weekly digests only on Monday
  if (type === "weekly" && userDay !== 1) return false;

  // Don't re-send within the minimum gap for this digest type.
  if (candidate.lastDigestAt) {
    const hoursSinceLast =
      (now.getTime() - new Date(candidate.lastDigestAt).getTime()) /
      (1000 * 60 * 60);
    if (hoursSinceLast < minGapHours) return false;
  }

  return true;
}

function parsePreferredHour(digestTime: string | null | undefined): number {
  const fallback = parseInt(DEFAULT_DIGEST_TIME.split(":")[0], 10);
  if (!digestTime || typeof digestTime !== "string") return fallback;
  const hour = parseInt(digestTime.split(":")[0], 10);
  return Number.isNaN(hour) ? fallback : hour;
}

// -- Recipient + preference fetching -----------------------------------------

async function fetchMembersByHub(
  hubIds: string[]
): Promise<Map<string, Recipient[]>> {
  const map = new Map<string, Recipient[]>();
  if (hubIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("hub_members")
    .select("hub_id, user_id, email")
    .in("hub_id", hubIds)
    .not("user_id", "is", null)
    .not("email", "is", null);

  if (error) {
    console.error("fetchMembersByHub error:", error);
    return map;
  }

  for (const row of data ?? []) {
    if (!row.user_id || !row.email) continue;
    const list = map.get(row.hub_id) ?? [];
    list.push({ userId: row.user_id, email: row.email });
    map.set(row.hub_id, list);
  }
  return map;
}

async function fetchPpmAdmins(): Promise<Recipient[]> {
  const { data, error } = await supabaseAdmin
    .from("ppm_admins")
    .select("user_id, email")
    .not("user_id", "is", null)
    .not("email", "is", null);

  if (error) {
    console.error("fetchPpmAdmins error:", error);
    return [];
  }

  const rows = (data ?? []) as Array<{
    user_id: string | null;
    email: string | null;
  }>;
  return rows
    .filter((row) => row.user_id && row.email)
    .map((row) => ({ userId: row.user_id as string, email: row.email as string }));
}

function dedupeRecipients(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const recipient of list) {
    if (seen.has(recipient.userId)) continue;
    seen.add(recipient.userId);
    out.push(recipient);
  }
  return out;
}

async function fetchStoredPreferences(
  hubIds: string[]
): Promise<Map<string, Map<string, StoredPreference>>> {
  const map = new Map<string, Map<string, StoredPreference>>();
  if (hubIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .select("hub_id, user_id, event_type, email_mode, digest_time, timezone")
    .in("hub_id", hubIds);

  if (error) {
    console.error("fetchStoredPreferences error:", error);
    return map;
  }

  for (const row of data ?? []) {
    const key = `${row.hub_id}:${row.user_id}`;
    const inner = map.get(key) ?? new Map<string, StoredPreference>();
    inner.set(row.event_type, row as StoredPreference);
    map.set(key, inner);
  }
  return map;
}

/**
 * Merge stored rows with defaults to get the effective preference for every
 * event type — mirrors getPreferencesForUser but works from an in-memory map
 * so the whole digest run needs a single preferences query.
 */
function effectivePreferences(
  stored?: Map<string, StoredPreference>
): NotificationPreference[] {
  return EVENT_TYPES.map((eventType) => {
    const row = stored?.get(eventType);
    if (!row) {
      return { event_type: eventType, ...DEFAULT_PREFERENCE };
    }
    return {
      event_type: eventType,
      in_app_enabled: true,
      email_mode: row.email_mode as NotificationPreference["email_mode"],
      digest_time: row.digest_time || DEFAULT_DIGEST_TIME,
      timezone: row.timezone || DEFAULT_TIMEZONE,
    };
  });
}

/**
 * Most recent digest send per (hub, user), read from the email queue. Using
 * the queue (rather than a column on a preference row) lets us track sends for
 * recipients who have never persisted preferences.
 */
async function fetchLastDigestSent(
  candidates: DigestCandidate[],
  lookbackHours: number
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const hubIds = [...new Set(candidates.map((c) => c.hubId))];
  const userIds = [...new Set(candidates.map((c) => c.userId))];
  if (hubIds.length === 0 || userIds.length === 0) return map;

  const windowStart = new Date(
    Date.now() - (lookbackHours + 1) * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabaseAdmin
    .from("notification_email_queue")
    .select("hub_id, user_id, sent_at")
    .eq("is_digest", true)
    .eq("status", "sent")
    .in("hub_id", hubIds)
    .in("user_id", userIds)
    .gt("sent_at", windowStart)
    .order("sent_at", { ascending: false });

  if (error) {
    console.error("fetchLastDigestSent error:", error);
    return map;
  }

  for (const row of data ?? []) {
    if (!row.sent_at) continue;
    const key = `${row.hub_id}:${row.user_id}`;
    // Rows are ordered newest-first, so the first per key is the most recent.
    if (!map.has(key)) map.set(key, row.sent_at);
  }
  return map;
}

// -- Digest send -------------------------------------------------------------

async function processOneDigest(
  candidate: DigestCandidate,
  type: DigestType,
  lookbackHours: number
): Promise<boolean> {
  // Calculate lookback window
  const since =
    candidate.lastDigestAt ??
    new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  // Fetch events since last digest, filtered to subscribed event types
  const { data: events, error } = await supabaseAdmin
    .from("notification_events")
    .select(
      "id, event_type, entity_type, entity_id, actor_name, summary, metadata, created_at"
    )
    .eq("hub_id", candidate.hubId)
    .in("event_type", candidate.eventTypes)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  if (!events || events.length === 0) return false;

  // Group events by type for the template
  const grouped: Record<string, DigestEvent[]> = {};
  for (const ev of events) {
    const meta = ev.metadata as Record<string, string | undefined>;
    const teamKey = meta?.team_key;
    let deepLinkUrl = `${getBaseUrl()}/hub/${candidate.hubSlug}`;
    if (teamKey && ev.entity_type === "issue") {
      deepLinkUrl = `${getBaseUrl()}/hub/${candidate.hubSlug}/${teamKey}/task/${ev.entity_id}`;
    } else if (teamKey && ev.entity_type === "project") {
      deepLinkUrl = `${getBaseUrl()}/hub/${candidate.hubSlug}/${teamKey}/projects/${ev.entity_id}`;
    }

    if (!grouped[ev.event_type]) grouped[ev.event_type] = [];
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
  const dateRange = `${formatDate(new Date(since))} — ${formatDate(new Date())}`;

  const subject =
    type === "daily"
      ? `Daily digest — ${candidate.hubName}`
      : `Weekly digest — ${candidate.hubName}`;

  const result = await sendEmail({
    to: candidate.email,
    subject,
    react: createElement(DigestNotification, {
      hubName: candidate.hubName,
      hubSlug: candidate.hubSlug,
      events: grouped,
      period: type,
      dateRange,
    }),
  });

  // Record in email queue (reference first event for the FK)
  await supabaseAdmin.from("notification_email_queue").insert({
    notification_event_id: events[0].id,
    user_id: candidate.userId,
    hub_id: candidate.hubId,
    email_address: candidate.email,
    status: result.success ? "sent" : "failed",
    is_digest: true,
    resend_message_id: result.messageId ?? null,
    error_message: result.error ?? null,
    sent_at: result.success ? new Date().toISOString() : null,
  });

  if (!result.success) {
    throw new Error(result.error ?? "Failed to send digest email");
  }

  return true;
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
