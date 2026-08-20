import { supabaseAdmin } from "./supabase";

/**
 * Per-task notification subscriptions (PULSE-364).
 *
 * A subscription row overrides a user's global notification settings for one
 * task. Absence of a row = follow global settings.
 *   - 'muted'      → never notify (wins over everything, incl. mentions)
 *   - 'subscribed' → follow the task (pierces comment 'mentions_only' scope)
 */

export type TaskSubscriptionState = "subscribed" | "muted";
export type TaskSubscriptionSource = "manual" | "auto_comment" | "auto_mention";

export type TaskSubscription = {
  state: TaskSubscriptionState;
  source: TaskSubscriptionSource;
};

/**
 * The issue a notification event relates to, for per-task subscription lookups.
 * Only issue and comment events are task-scoped; project/health/cycle/initiative
 * events return null (no per-task override applies).
 */
export function eventIssueLinearId(
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (entityType === "issue") return entityId;
  if (entityType === "comment") return (metadata?._issue_id as string) ?? null;
  return null;
}

/** One user's subscription for one task (null = default / follow global). */
export async function getTaskSubscription(
  hubId: string,
  userId: string,
  issueLinearId: string
): Promise<TaskSubscription | null> {
  const { data, error } = await supabaseAdmin
    .from("hub_task_subscriptions")
    .select("state, source")
    .eq("hub_id", hubId)
    .eq("user_id", userId)
    .eq("issue_linear_id", issueLinearId)
    .maybeSingle();

  if (error) {
    console.error("getTaskSubscription error:", error);
    return null;
  }
  return data
    ? { state: data.state as TaskSubscriptionState, source: data.source as TaskSubscriptionSource }
    : null;
}

/** All users' subscription states for one task — for immediate delivery. */
export async function getTaskStatesForIssue(
  hubId: string,
  issueLinearId: string
): Promise<Map<string, TaskSubscriptionState>> {
  const map = new Map<string, TaskSubscriptionState>();
  const { data, error } = await supabaseAdmin
    .from("hub_task_subscriptions")
    .select("user_id, state")
    .eq("hub_id", hubId)
    .eq("issue_linear_id", issueLinearId);

  if (error) {
    console.error("getTaskStatesForIssue error:", error);
    return map;
  }
  for (const row of data ?? []) {
    map.set(row.user_id, row.state as TaskSubscriptionState);
  }
  return map;
}

/** One user's subscription states across many tasks (keyed by issue) — for digests. */
export async function getTaskStatesForUser(
  hubId: string,
  userId: string,
  issueLinearIds: string[]
): Promise<Map<string, TaskSubscriptionState>> {
  const map = new Map<string, TaskSubscriptionState>();
  if (issueLinearIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("hub_task_subscriptions")
    .select("issue_linear_id, state")
    .eq("hub_id", hubId)
    .eq("user_id", userId)
    .in("issue_linear_id", issueLinearIds);

  if (error) {
    console.error("getTaskStatesForUser error:", error);
    return map;
  }
  for (const row of data ?? []) {
    map.set(row.issue_linear_id, row.state as TaskSubscriptionState);
  }
  return map;
}

/** Manually set or clear a user's subscription for a task (null = back to default). */
export async function setTaskSubscription(
  hubId: string,
  userId: string,
  issueLinearId: string,
  state: TaskSubscriptionState | null
): Promise<void> {
  if (state === null) {
    const { error } = await supabaseAdmin
      .from("hub_task_subscriptions")
      .delete()
      .eq("hub_id", hubId)
      .eq("user_id", userId)
      .eq("issue_linear_id", issueLinearId);
    if (error) {
      console.error("setTaskSubscription delete error:", error);
      throw error;
    }
    return;
  }

  const { error } = await supabaseAdmin.from("hub_task_subscriptions").upsert(
    {
      hub_id: hubId,
      user_id: userId,
      issue_linear_id: issueLinearId,
      state,
      source: "manual",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "hub_id,user_id,issue_linear_id" }
  );
  if (error) {
    console.error("setTaskSubscription upsert error:", error);
    throw error;
  }
}

/**
 * Auto-subscribe a participant — insert ONLY if no override exists, so a user's
 * explicit mute (or earlier subscribe) is never overwritten. Fire-and-forget.
 */
export async function autoSubscribe(
  hubId: string,
  userId: string,
  issueLinearId: string,
  source: TaskSubscriptionSource
): Promise<void> {
  // Fire-and-forget: never throw, so callers can `void` this without risking an
  // unhandled rejection if the upsert (or its underlying request) fails.
  try {
    const { error } = await supabaseAdmin.from("hub_task_subscriptions").upsert(
      {
        hub_id: hubId,
        user_id: userId,
        issue_linear_id: issueLinearId,
        state: "subscribed",
        source,
      },
      { onConflict: "hub_id,user_id,issue_linear_id", ignoreDuplicates: true }
    );
    if (error) console.error("autoSubscribe error:", error);
  } catch (err) {
    console.error("autoSubscribe failed:", err);
  }
}
