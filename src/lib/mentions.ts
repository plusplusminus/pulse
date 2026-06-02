/**
 * Per-person comment mentions (PULSE-362).
 *
 * PMs author client-facing comments in Linear, where we can't add a mention
 * picker — so a mention is a typed convention: any `@token` in a client-facing
 * (heyclient/pulse) comment body. Each token resolves to at most one hub member,
 * trying in order: explicit `mention_handle` → email local-part → full email.
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

// @token where token is a handle/local-part (letters, digits, . _ + -) and may
// optionally be a full email (…@domain.tld). Matches @jane, @jane.doe,
// @jane@acme.com.
const MENTION_TOKEN =
  /@([A-Za-z0-9._+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g;

// The client-facing trigger words are not mentions when written as @heyclient.
const TRIGGER_TOKENS = new Set(["heyclient", "pulse"]);

/** Extract unique mention tokens (without '@'), lowercased, trigger words removed. */
export function extractMentionTokens(body: string): string[] {
  const out = new Set<string>();
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const token = match[1].toLowerCase();
    if (TRIGGER_TOKENS.has(token)) continue;
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
        : (() => {
            const byLocal = matchTier(
              members,
              (m) => emailLocalPart(m.email) === token
            );
            if (byLocal.length > 0) return byLocal;
            return matchTier(
              members,
              (m) => !!m.email && m.email.toLowerCase() === token
            );
          })();

    if (tier.length === 1) {
      mentionedUserIds.add(tier[0]);
    } else {
      unresolved.push(token);
    }
  }

  return { mentionedUserIds: [...mentionedUserIds], unresolved };
}
