import crypto from "crypto";
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { withAdminAuth } from "@/lib/admin-auth";
import {
  getWorkspaceToken,
  getWorkspaceSetting,
  setWorkspaceSetting,
} from "@/lib/workspace";

function getWebhookUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/linear`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api/webhooks/linear`;
  return "http://localhost:3000/api/webhooks/linear";
}

// Resource types the org-wide webhook subscribes to. Keep in sync with the
// event types handled in webhook-handlers.ts → routeWebhookEvent.
const DEFAULT_RESOURCE_TYPES = [
  "Issue",
  "Comment",
  "Project",
  "ProjectUpdate",
  "Initiative",
];

type LinearGraphQLResult<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

async function linearGraphQL<T>(
  apiToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<LinearGraphQLResult<T>> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiToken },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Linear API ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 500)}` : ""}`
    );
  }
  return (await res.json()) as LinearGraphQLResult<T>;
}

/**
 * Create the org-wide webhook (allPublicTeams) and persist its id + secret.
 * Throws on failure.
 */
async function createOrgWebhook(
  userId: string
): Promise<{ id: string; enabled: boolean }> {
  const apiToken = await getWorkspaceToken();
  const webhookSecret = crypto.randomBytes(32).toString("hex");

  const mutation = `
    mutation WebhookCreate($input: WebhookCreateInput!) {
      webhookCreate(input: $input) {
        success
        webhook { id enabled }
      }
    }
  `;

  const result = await linearGraphQL<{
    webhookCreate: {
      success: boolean;
      webhook: { id: string; enabled: boolean };
    };
  }>(apiToken, mutation, {
    input: {
      url: getWebhookUrl(),
      resourceTypes: DEFAULT_RESOURCE_TYPES,
      secret: webhookSecret,
      allPublicTeams: true,
    },
  });

  if (result.errors || !result.data?.webhookCreate.success) {
    throw new Error(
      result.errors?.map((e) => e.message).join(", ") ||
        "Failed to create webhook in Linear"
    );
  }

  const webhook = result.data.webhookCreate.webhook;
  // These two writes aren't atomic, so persist the secret BEFORE the id: the
  // webhook receiver gates on linear_webhook_secret. If the second write fails,
  // secret-without-id still verifies + processes events (only delete/update lose
  // the id reference) — far milder than id-without-secret, which would reject
  // every event with "No webhook configured".
  await setWorkspaceSetting("linear_webhook_secret", webhookSecret, userId);
  await setWorkspaceSetting("linear_webhook_id", webhook.id, userId);
  return webhook;
}

// POST: Create org-wide webhook (allPublicTeams)
export async function POST() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;

    // Check if webhook already exists
    const existingId = await getWorkspaceSetting("linear_webhook_id");
    if (existingId) {
      return NextResponse.json(
        { error: "Org-wide webhook already exists" },
        { status: 409 }
      );
    }

    const webhook = await createOrgWebhook(user.id);

    return NextResponse.json({
      success: true,
      webhook: {
        id: webhook.id,
        enabled: webhook.enabled,
        allPublicTeams: true,
        resourceTypes: DEFAULT_RESOURCE_TYPES,
      },
    });
  } catch (error) {
    console.error("POST /api/admin/webhook error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH: Idempotently ensure the org webhook exists AND its resourceTypes are
// current (e.g. adds ProjectUpdate to a webhook created before it existed).
// Updates in place via webhookUpdate — no delete/recreate, no secret churn, no
// event-delivery gap. Create-fallback if no webhook exists yet. Safe to re-run.
export async function PATCH() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;

    const existingId = await getWorkspaceSetting("linear_webhook_id");

    // Create-fallback: no webhook yet → create it with the current types.
    if (!existingId) {
      const webhook = await createOrgWebhook(user.id);
      return NextResponse.json({
        success: true,
        created: true,
        webhook: {
          id: webhook.id,
          enabled: webhook.enabled,
          resourceTypes: DEFAULT_RESOURCE_TYPES,
        },
      });
    }

    const apiToken = await getWorkspaceToken();
    const mutation = `
      mutation WebhookUpdate($id: String!, $input: WebhookUpdateInput!) {
        webhookUpdate(id: $id, input: $input) {
          success
          webhook { id enabled resourceTypes }
        }
      }
    `;

    const result = await linearGraphQL<{
      webhookUpdate: {
        success: boolean;
        webhook: { id: string; enabled: boolean; resourceTypes: string[] };
      };
    }>(apiToken, mutation, {
      id: existingId,
      input: { resourceTypes: DEFAULT_RESOURCE_TYPES },
    });

    if (result.errors || !result.data?.webhookUpdate.success) {
      const msg =
        result.errors?.map((e) => e.message).join(", ") ||
        "Failed to update webhook in Linear";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      created: false,
      webhook: result.data.webhookUpdate.webhook,
    });
  } catch (error) {
    console.error("PATCH /api/admin/webhook error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Remove org-wide webhook
export async function DELETE() {
  try {
    const { user } = await withAuth();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const webhookId = await getWorkspaceSetting("linear_webhook_id");
    if (!webhookId) {
      return NextResponse.json(
        { error: "No webhook configured" },
        { status: 404 }
      );
    }

    // Best-effort: delete from Linear
    try {
      const apiToken = await getWorkspaceToken();
      const mutation = `
        mutation WebhookDelete($id: String!) {
          webhookDelete(id: $id) { success }
        }
      `;
      await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiToken,
        },
        body: JSON.stringify({
          query: mutation,
          variables: { id: webhookId },
        }),
      });
    } catch (error) {
      console.error("Failed to delete webhook from Linear:", error);
    }

    // Remove from workspace settings
    await setWorkspaceSetting("linear_webhook_id", "", user.id);
    await setWorkspaceSetting("linear_webhook_secret", "", user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET: Check webhook status, including resource-type drift so the admin UI can
// prompt a PATCH when the live webhook is missing newer types (e.g. ProjectUpdate).
export async function GET() {
  try {
    const { user } = await withAuth();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const webhookId = await getWorkspaceSetting("linear_webhook_id");

    if (!webhookId) {
      return NextResponse.json({
        configured: false,
        webhookId: null,
        expectedResourceTypes: DEFAULT_RESOURCE_TYPES,
      });
    }

    // Report the live webhook's resourceTypes so drift is visible. Best-effort —
    // never throws; on lookup failure we just omit the live values.
    let resourceTypes: string[] | null = null;
    let needsUpdate = false;
    try {
      const apiToken = await getWorkspaceToken();
      const query = `
        query Webhook($id: String!) {
          webhook(id: $id) { id enabled resourceTypes }
        }
      `;
      const result = await linearGraphQL<{
        webhook: {
          id: string;
          enabled: boolean;
          resourceTypes: string[];
        } | null;
      }>(apiToken, query, { id: webhookId });
      const live = result.data?.webhook;
      if (live?.resourceTypes) {
        resourceTypes = live.resourceTypes;
        needsUpdate = DEFAULT_RESOURCE_TYPES.some(
          (t) => !live.resourceTypes.includes(t)
        );
      }
    } catch (err) {
      console.error("Failed to fetch webhook resourceTypes:", err);
    }

    return NextResponse.json({
      configured: true,
      webhookId,
      resourceTypes,
      expectedResourceTypes: DEFAULT_RESOURCE_TYPES,
      needsUpdate,
    });
  } catch (error) {
    console.error("GET /api/admin/webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
