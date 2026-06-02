import { getWorkspaceToken } from "@/lib/workspace";

const LINEAR_API = "https://api.linear.app/graphql";
const PULSE_EMOJI = "pulse";
// 👤 — signals "Pulse recognised your @mention" (resolved it to a hub member).
// NOTE: verify this shortcode renders as 👤 in Linear; reactions fail-soft if not.
const MENTION_EMOJI = "bust_in_silhouette";

const REACTION_CREATE_MUTATION = `
  mutation ReactionCreate($commentId: String!, $emoji: String!) {
    reactionCreate(input: { commentId: $commentId, emoji: $emoji }) {
      success
    }
  }
`;

function linearAuthHeader(token: string): string {
  return token.startsWith("lin_api_") ? token : `Bearer ${token}`;
}

/**
 * Add a reaction (by emoji shortcode) to a Linear comment.
 *
 * Fail-soft: any error is logged as a warning and swallowed — these are
 * non-critical follow-ups that must never break the caller.
 */
async function reactOnComment(commentId: string, emoji: string): Promise<void> {
  try {
    const token = await getWorkspaceToken();
    const res = await fetch(LINEAR_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: linearAuthHeader(token.trim()),
      },
      body: JSON.stringify({
        query: REACTION_CREATE_MUTATION,
        variables: { commentId, emoji },
      }),
    });
    if (!res.ok) {
      console.warn(
        `[pulse-reaction] Linear API ${res.status}: ${await res.text()}`
      );
      return;
    }
    const json = (await res.json()) as {
      errors?: Array<{ message: string }>;
    };
    if (json.errors) {
      console.warn(
        "[pulse-reaction] GraphQL errors:",
        json.errors.map((e) => e.message).join(", ")
      );
    }
  } catch (err) {
    console.warn("[pulse-reaction] request failed:", err);
  }
}

/**
 * Add the :pulse: reaction to a Linear comment as a visual confirmation that
 * the comment was successfully synced into Pulse (and, for client-facing
 * comments, surfaced to the client).
 */
export async function reactPulseOnComment(commentId: string): Promise<void> {
  return reactOnComment(commentId, PULSE_EMOJI);
}

/**
 * Add the 👤 reaction to a Linear comment to signal that Pulse RECOGNISED an
 * @mention in it (resolved at least one token to a hub member). This is a
 * recognition signal, not a delivery guarantee.
 */
export async function reactMentionOnComment(commentId: string): Promise<void> {
  return reactOnComment(commentId, MENTION_EMOJI);
}
