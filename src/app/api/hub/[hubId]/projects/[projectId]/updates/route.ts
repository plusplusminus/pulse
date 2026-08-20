import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import {
  isProjectVisibleInHub,
  fetchProjectUpdatesForProjectIds,
} from "@/lib/hub-read";

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ hubId: string; projectId: string }> }
) {
  try {
    const { hubId, projectId } = await params;

    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    // Only expose updates for a project that is actually visible in this hub.
    if (!(await isProjectVisibleInHub(hubId, projectId))) {
      return NextResponse.json(
        { error: "Project not visible in this hub" },
        { status: 403 }
      );
    }

    // Client-facing (pulse/heyclient) updates only, prefix stripped, newest first.
    const updates = (
      await fetchProjectUpdatesForProjectIds([projectId])
    ).map((u) => ({
      id: u.id,
      body: u.body,
      health: u.health ?? "",
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));

    return NextResponse.json({ updates });
  } catch (error) {
    console.error(
      "GET /api/hub/[hubId]/projects/[projectId]/updates error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
