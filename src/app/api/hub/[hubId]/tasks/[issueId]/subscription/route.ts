import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import {
  getTaskSubscription,
  setTaskSubscription,
  type TaskSubscriptionState,
} from "@/lib/task-subscriptions";

// Per-task notification subscription for the current user (PULSE-364).
// Uses withHubAuth (not …Write) — this is a personal notification preference, so
// view-only members may manage their own subscriptions.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hubId: string; issueId: string }> }
) {
  try {
    const { hubId, issueId } = await params;
    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }
    const subscription = await getTaskSubscription(hubId, auth.user.id, issueId);
    return NextResponse.json({
      state: subscription?.state ?? null,
      source: subscription?.source ?? null,
    });
  } catch (error) {
    console.error(
      "GET /api/hub/[hubId]/tasks/[issueId]/subscription error:",
      error
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ hubId: string; issueId: string }> }
) {
  try {
    const { hubId, issueId } = await params;
    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const body = (await request.json()) as { state?: string | null };
    const validStates = new Set(["subscribed", "muted"]);
    if (
      body.state !== null &&
      body.state !== undefined &&
      !validStates.has(body.state)
    ) {
      return NextResponse.json(
        { error: `Invalid state: ${body.state}` },
        { status: 400 }
      );
    }

    const next = (body.state ?? null) as TaskSubscriptionState | null;
    await setTaskSubscription(hubId, auth.user.id, issueId, next);
    return NextResponse.json({ state: next, source: next ? "manual" : null });
  } catch (error) {
    console.error(
      "PUT /api/hub/[hubId]/tasks/[issueId]/subscription error:",
      error
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
