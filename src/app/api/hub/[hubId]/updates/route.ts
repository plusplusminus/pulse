import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import {
  fetchHubProjects,
  fetchProjectUpdatesForProjectIds,
} from "@/lib/hub-read";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const { hubId } = await params;

    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const projects = await fetchHubProjects(hubId);
    if (projects.length === 0) {
      return NextResponse.json({ updates: [] });
    }

    const projectMeta = new Map(
      projects.map((p) => [p.id, { name: p.name, color: p.color ?? null }])
    );

    // Client-facing (pulse/heyclient) updates only, prefix stripped. The DB query
    // orders by created_at desc, so the flattened feed is already newest-first.
    const updates = (
      await fetchProjectUpdatesForProjectIds(projects.map((p) => p.id))
    ).map((u) => {
      const meta = projectMeta.get(u.projectId);
      return {
        id: u.id,
        body: u.body,
        health: u.health ?? "",
        createdAt: u.createdAt,
        projectName: meta?.name ?? "",
        projectColor: meta?.color ?? null,
      };
    });

    return NextResponse.json({ updates });
  } catch (error) {
    console.error("GET /api/hub/[hubId]/updates error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
