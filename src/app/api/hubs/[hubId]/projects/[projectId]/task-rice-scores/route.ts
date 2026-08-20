import { NextResponse } from "next/server";
import {
  withHubAuth,
  withHubAuthWrite,
  type HubAuthError,
} from "@/lib/hub-auth";
import {
  isTaskPriorityEnabled,
  fetchUserTaskRiceScores,
  fetchCompositeTaskRiceScores,
  saveTaskRiceScore,
} from "@/lib/hub-task-priorities";

type Params = { params: Promise<{ hubId: string; projectId: string }> };

// GET: Fetch task RICE scores (user's own or composite for admin)
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
      const scores = await fetchCompositeTaskRiceScores(hubId, projectId);
      return NextResponse.json({ scores });
    }

    const scores = await fetchUserTaskRiceScores(hubId, auth.user.id, projectId);
    return NextResponse.json({ scores });
  } catch (error) {
    console.error("GET /api/hubs/[hubId]/projects/[projectId]/task-rice-scores error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT: Save/update RICE score for a single task
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

    let body: {
      issueLinearId?: string;
      reach?: number | null;
      impact?: number | null;
      confidence?: number | null;
      effort?: number | null;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body" },
        { status: 400 }
      );
    }

    if (!body.issueLinearId) {
      return NextResponse.json(
        { error: "issueLinearId is required" },
        { status: 400 }
      );
    }

    // Validate ranges
    if (body.reach !== undefined && body.reach !== null) {
      if (typeof body.reach !== "number" || !Number.isFinite(body.reach) || !Number.isInteger(body.reach) || body.reach < 1 || body.reach > 10) {
        return NextResponse.json(
          { error: "reach must be an integer between 1 and 10" },
          { status: 400 }
        );
      }
    }
    if (body.impact !== undefined && body.impact !== null) {
      const validImpacts = [0.25, 0.5, 1, 2, 3];
      if (typeof body.impact !== "number" || !validImpacts.includes(body.impact)) {
        return NextResponse.json(
          { error: "impact must be one of: 0.25, 0.5, 1, 2, 3" },
          { status: 400 }
        );
      }
    }
    if (body.confidence !== undefined && body.confidence !== null) {
      if (typeof body.confidence !== "number" || !Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 100) {
        return NextResponse.json(
          { error: "confidence must be a number between 0 and 100" },
          { status: 400 }
        );
      }
    }
    if (body.effort !== undefined && body.effort !== null) {
      if (typeof body.effort !== "number" || !Number.isFinite(body.effort) || body.effort < 0.5) {
        return NextResponse.json(
          { error: "effort must be a number at least 0.5" },
          { status: 400 }
        );
      }
    }

    await saveTaskRiceScore(hubId, auth.user.id, projectId, body.issueLinearId, {
      reach: body.reach,
      impact: body.impact,
      confidence: body.confidence,
      effort: body.effort,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PUT /api/hubs/[hubId]/projects/[projectId]/task-rice-scores error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
