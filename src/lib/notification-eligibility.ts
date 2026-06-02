import type { NotificationPreference } from "./notification-preferences";
import type { CommentScope } from "./notification-settings";
import type { TaskSubscriptionState } from "./task-subscriptions";

/**
 * Unified notification delivery resolver (PULSE-361).
 *
 * The SINGLE source of truth for "should this recipient receive an email about
 * this event, and through which channel?". Both delivery paths consult it:
 *   - immediate path: src/lib/notification-delivery.ts  → processImmediateEmails
 *   - digest path:    src/lib/notification-digest.ts     → processOneDigest
 *
 * Keeping the decision in one place means upcoming features extend it HERE
 * instead of patching two call sites that would otherwise drift:
 *   - PULSE-362  per-person mention scope (comment_scope = 'mentions_only')
 *   - PULSE-364  per-task mute / subscribe overrides
 *   - PULSE-365  'subscribed only' watch mode
 *
 * Today the rule is simply the recipient's stored `email_mode` for the event's
 * type, so the resolver is intentionally thin — the seam is the point.
 */

export type EmailDeliveryMode = "off" | "immediate" | "daily" | "weekly";

/**
 * Minimal event shape the resolver needs. Extend as later features need more
 * signal (e.g. PULSE-362 adds `mentioned_user_ids`, PULSE-364 the issue id so a
 * per-task subscription can be looked up).
 */
export type DeliveryEvent = {
  event_type: string;
};

/**
 * Per-recipient context the resolver needs to decide delivery. Today that is
 * just the recipient's preference for the event's type. Later features add more
 * (PULSE-362/365 the per-(hub,user) settings row; PULSE-364 the recipient's
 * subscription state for the event's task).
 */
export type RecipientContext = {
  /** The recipient's preference for THIS event's type, or undefined if none. */
  preference: NotificationPreference | undefined;
  /**
   * The recipient's comment-scope setting (PULSE-362). 'mentions_only' means
   * they only want comment emails that mention them. Defaults to 'all'.
   */
  commentScope?: CommentScope;
  /** Whether this event explicitly mentions the recipient (PULSE-362). */
  isMentioned?: boolean;
  /**
   * The recipient's per-task override for this event's task (PULSE-364):
   * 'muted' suppresses all notifications for the task; 'subscribed' follows it
   * (and pierces the comment 'mentions_only' scope). Undefined = follow global.
   */
  taskState?: TaskSubscriptionState;
};

/**
 * Resolve the email channel an event should be delivered to a recipient by.
 * Returns "off" when the recipient should not be emailed about this event
 * (including when they have no preference for its type).
 */
export function resolveEmailDelivery(
  event: DeliveryEvent,
  ctx: RecipientContext
): EmailDeliveryMode {
  // Per-task mute (PULSE-364) wins over everything — including a direct mention.
  if (ctx.taskState === "muted") return "off";

  const mode = ctx.preference?.email_mode ?? "off";
  if (mode === "off") return "off";

  // Comment mention-scope (PULSE-362): a recipient set to 'mentions_only' is
  // emailed about a comment only when the event mentions them. Other event types
  // and the default 'all' scope are unaffected. A mention pierces the quiet
  // 'mentions_only' setting — as does an explicit per-task subscribe (PULSE-364)
  // — but neither overrides an 'off' channel or a task mute.
  if (
    event.event_type === "comment" &&
    (ctx.commentScope ?? "all") === "mentions_only" &&
    !ctx.isMentioned &&
    ctx.taskState !== "subscribed"
  ) {
    return "off";
  }

  return mode;
}

/** True when the event should trigger an immediate email to the recipient. */
export function shouldSendImmediateEmail(
  event: DeliveryEvent,
  ctx: RecipientContext
): boolean {
  return resolveEmailDelivery(event, ctx) === "immediate";
}

/**
 * True when the event should be included in the recipient's digest of the given
 * cadence (daily or weekly).
 */
export function shouldIncludeInDigest(
  event: DeliveryEvent,
  ctx: RecipientContext,
  cadence: "daily" | "weekly"
): boolean {
  return resolveEmailDelivery(event, ctx) === cadence;
}
