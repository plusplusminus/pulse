import { getWorkspaceToken } from "@/lib/workspace";

const LINEAR_API = "https://api.linear.app/graphql";
const PULSE_EMOJI = "pulse";

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
 * Add the :pulse: reaction to a Linear comment as a visual confirmation
 * that the comment was successfully synced into Pulse (and, for client-facing
 * comments, surfaced to the client).
 *
 * Fail-soft: any error is logged as a warning and swallowed — this is a
 * non-critical follow-up that must never break the caller.
 */
export async function reactPulseOnComment(commentId: string): Promise<void> {
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
        variables: { commentId, emoji: PULSE_EMOJI },
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
