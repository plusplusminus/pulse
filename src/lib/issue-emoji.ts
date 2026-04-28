// -- Emoji classification ─────────────────────────────────────────────────────
//
// Tasks created/edited via Pulse get a leading emoji on their title that
// encodes the issue's (priority + category). The classifier reads the
// authoritative signals straight from Linear: the issue's labels and priority.

export const URGENT_EMOJI = "🔥";
export const BUG_HIGH_EMOJI = "🔴";
export const BUG_MEDIUM_EMOJI = "🟠";
export const BUG_LOW_EMOJI = "🟡";
export const FEATURE_HIGH_EMOJI = "🟣";
export const FEATURE_MED_LOW_EMOJI = "🔵";

export const KNOWN_EMOJIS = [
  URGENT_EMOJI,
  BUG_HIGH_EMOJI,
  BUG_MEDIUM_EMOJI,
  BUG_LOW_EMOJI,
  FEATURE_HIGH_EMOJI,
  FEATURE_MED_LOW_EMOJI,
] as const;

const BUG_LABELS = ["bug", "defect"];
const FEATURE_LABELS = ["feature", "improvement"];
const EMERGENCY_LABEL = "emergency sos";

const PRIORITY_URGENT = 1;
const PRIORITY_HIGH = 2;
const PRIORITY_MEDIUM = 3;
const PRIORITY_LOW = 4;

type LabelLike = { name?: string | null };

function hasLabel(labels: LabelLike[] | undefined, candidates: string[]): boolean {
  if (!labels?.length) return false;
  const names = labels
    .map((l) => l.name?.trim().toLowerCase())
    .filter((n): n is string => !!n);
  return candidates.some((c) => names.includes(c));
}

/**
 * Determine the emoji for an issue based on its labels and priority.
 *
 * Rules (first match wins):
 *   1. priority === Urgent OR labels include "Emergency SoS" → 🔥
 *   2. labels include Bug/Defect → 🔴 / 🟠 / 🟡 by priority
 *   3. labels include Feature/Improvement → 🟣 / 🔵 by priority
 *   4. otherwise → null
 */
export function classifyIssueEmoji(
  labels: LabelLike[] | undefined,
  priority: number | undefined
): string | null {
  if (priority === PRIORITY_URGENT || hasLabel(labels, [EMERGENCY_LABEL])) {
    return URGENT_EMOJI;
  }

  if (hasLabel(labels, BUG_LABELS)) {
    if (priority === PRIORITY_HIGH) return BUG_HIGH_EMOJI;
    if (priority === PRIORITY_MEDIUM) return BUG_MEDIUM_EMOJI;
    if (priority === PRIORITY_LOW) return BUG_LOW_EMOJI;
    return null;
  }

  if (hasLabel(labels, FEATURE_LABELS)) {
    if (priority === PRIORITY_HIGH) return FEATURE_HIGH_EMOJI;
    if (priority === PRIORITY_MEDIUM || priority === PRIORITY_LOW) {
      return FEATURE_MED_LOW_EMOJI;
    }
    return null;
  }

  return null;
}

/**
 * If `title` starts with one of our known emojis (optionally followed by
 * whitespace), return both the emoji and the rest. Otherwise the emoji is null.
 */
export function extractLeadingEmoji(title: string): {
  emoji: string | null;
  rest: string;
} {
  for (const emoji of KNOWN_EMOJIS) {
    if (title.startsWith(emoji)) {
      const rest = title.slice(emoji.length).replace(/^\s+/, "");
      return { emoji, rest };
    }
  }
  return { emoji: null, rest: title };
}

/**
 * Strip any known leading emoji and prepend `newEmoji` (if non-null).
 * Idempotent: applying the same emoji twice is a no-op.
 */
export function applyEmojiToTitle(title: string, newEmoji: string | null): string {
  const { rest } = extractLeadingEmoji(title);
  return newEmoji ? `${newEmoji} ${rest}` : rest;
}
