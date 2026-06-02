/**
 * Per-person comment mentions (PULSE-362).
 *
 * PMs author client-facing comments in Linear, where we can't add a mention
 * picker — so a mention is a typed convention: any `@token` in a client-facing
 * (heyclient/pulse) comment body. Each token resolves to at most one hub member,
 * trying in order: explicit `mention_handle` → email local-part.
 *
 * Resolution is fail-OPEN: a token that matches zero or multiple members is
 * "unresolved" and never silently drops anyone. The caller broadcasts to
 * everyone and posts an echo warning so the PM knows the mention didn't land.
 */

export type MentionableMember = {
  user_id: string;
  email: string | null;
  mention_handle: string | null;
};

export type MentionResolution = {
  /** Distinct user_ids that were unambiguously mentioned. */
  mentionedUserIds: string[];
  /** Tokens (without the leading '@') that matched zero or multiple members. */
  unresolved: string[];
};

// @token at a token boundary. The negative lookbehind keeps the @ from being
// part of an email or word, so "jane@acme.com" in prose is NOT a mention; we
// capture only the username portion. Matches @jane, @jane.doe.
const MENTION_TOKEN = /(?<![\w.@-])@([a-z0-9._+-]+)/gi;

// The client-facing trigger words are not mentions when written as @heyclient.
const TRIGGER_TOKENS = new Set(["heyclient", "pulse"]);

/** Extract unique mention tokens (without '@'), lowercased, trigger words removed. */
export function extractMentionTokens(body: string): string[] {
  const out = new Set<string>();
  for (const match of body.matchAll(MENTION_TOKEN)) {
    // Strip trailing dots so "@jane." resolves as "jane".
    const token = match[1].toLowerCase().replace(/[.]+$/, "");
    if (!token || TRIGGER_TOKENS.has(token)) continue;
    out.add(token);
  }
  return [...out];
}

function emailLocalPart(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at).toLowerCase() : null;
}

/** Unique user_ids of members matching a predicate. */
function matchTier(
  members: MentionableMember[],
  predicate: (m: MentionableMember) => boolean
): string[] {
  return [...new Set(members.filter(predicate).map((m) => m.user_id))];
}

/**
 * Resolve the `@token` mentions in a comment body against a hub's members.
 *
 * Per token, tiers are tried in precedence order and the first tier with any
 * match decides the outcome: exactly one member → mentioned; zero or several →
 * unresolved (fail-open). Tiers do not fall through on ambiguity, so a duplicated
 * handle is unresolved rather than silently matching an email instead.
 */
export function resolveMentions(
  body: string,
  members: MentionableMember[]
): MentionResolution {
  const mentionedUserIds = new Set<string>();
  const unresolved: string[] = [];

  for (const token of extractMentionTokens(body)) {
    const byHandle = matchTier(
      members,
      (m) => !!m.mention_handle && m.mention_handle.toLowerCase() === token
    );
    const tier =
      byHandle.length > 0
        ? byHandle
        : matchTier(members, (m) => emailLocalPart(m.email) === token);

    if (tier.length === 1) {
      mentionedUserIds.add(tier[0]);
    } else {
      unresolved.push(token);
    }
  }

  return { mentionedUserIds: [...mentionedUserIds], unresolved };
}
