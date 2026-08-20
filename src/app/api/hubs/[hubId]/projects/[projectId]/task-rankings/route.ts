import { NextResponse } from "next/server";
import { withHubAuth, withHubAuthWrite, type HubAuthError } from "@/lib/hub-auth";
import {
  isTaskPriorityEnabled,
  fetchUserTaskRanking,
  fetchCompositeTaskRanking,
  saveUserTaskRanking,
} from "@/lib/hub-task-priorities";
import { fetchHubIssues } from "@/lib/hub-read";

type Params = { params: Promise<{ hubId: string; projectId: string }> };

// GET: Fetch current user's task ranking and composite ranking for a project
export async function GET(request: Request, { params }: Params) {
  try {
    const { hubId, projectId } = await params;
    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const enabled = await isTaskPriorityEnabled(hubId, projectId);
    if (!enabled) {
      return NextResponse.json(
        { error: "Task prioritisation is not enabled for this project" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const composite = url.searchParams.get("composite") === "true";

    if (composite) {
      if (auth.role !== "admin") {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
      const rankings = await fetchCompositeTaskRanking(hubId, projectId);
      return NextResponse.json({ composite: rankings });
    }

    const userRanking = await fetchUserTaskRanking(hubId, auth.user.id, projectId);

    return NextResponse.json({
      userRanking: userRanking.map((r) => ({
        issueLinearId: r.issueLinearId,
        rank: r.rank,
      })),
    });
  } catch (error) {
    console.error("GET /api/hubs/[hubId]/projects/[projectId]/task-rankings error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT: Save user's full task ranking for a project
export async function PUT(request: Request, { params }: Params) {
  try {
    const { hubId, projectId } = await params;
    const auth = await withHubAuthWrite(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const enabled = await isTaskPriorityEnabled(hubId, projectId);
    if (!enabled) {
      return NextResponse.json(
        { error: "Task prioritisation is not enabled for this project" },
        { status: 403 }
      );
    }

    let body: { ranking?: string[] };
    try {
      body = (await request.json()) as { ranking?: string[] };
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body" },
        { status: 400 }
      );
    }

    if (!body.ranking || !Array.isArray(body.ranking)) {
      return NextResponse.json(
        { error: "ranking must be an array of issue IDs" },
        { status: 400 }
      );
    }

    if (body.ranking.length === 0) {
      return NextResponse.json(
        { error: "ranking cannot be empty" },
        { status: 400 }
      );
    }

    // Check for duplicates
    const uniqueIds = new Set(body.ranking);
    if (uniqueIds.size !== body.ranking.length) {
      return NextResponse.json(
        { error: "ranking contains duplicate issue IDs" },
        { status: 400 }
      );
    }

    // Validate all IDs are visible issues for this project
    const visibleIssues = await fetchHubIssues(hubId, { projectId });
    const visibleIds = new Set(visibleIssues.map((i) => i.id));
    const invalidIds = body.ranking.filter((id) => !visibleIds.has(id));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: "ranking contains invalid issue IDs" },
        { status: 400 }
      );
    }

    const changes = await saveUserTaskRanking(hubId, auth.user.id, projectId, body.ranking);

    return NextResponse.json({ ok: true, changedCount: changes.length });
  } catch (error) {
    console.error("PUT /api/hubs/[hubId]/projects/[projectId]/task-rankings error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
