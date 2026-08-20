import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import { fetchTaskRankingLog, isTaskPriorityEnabled } from "@/lib/hub-task-priorities";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ hubId: string; projectId: string }> };

// GET: Fetch task ranking activity log (admin-only)
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

    if (auth.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
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
    const userId = url.searchParams.get("user") ?? undefined;
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const rawOffset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
    const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

    const log = await fetchTaskRankingLog(hubId, projectId, {
      userId,
      limit,
      offset,
    });

    // Resolve user IDs to emails
    const userIds = [...new Set(log.map((l) => l.userId))];
    let members: Array<{ user_id: string | null; email: string | null }> | null = null;
    if (userIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("hub_members")
        .select("user_id, email")
        .eq("hub_id", hubId)
        .in("user_id", userIds);
      members = data;
    }

    const memberMap: Record<string, string> = {};
    for (const m of members ?? []) {
      if (m.user_id && m.email) memberMap[m.user_id] = m.email;
    }

    return NextResponse.json({ log, members: memberMap });
  } catch (error) {
    console.error("GET /api/hubs/[hubId]/projects/[projectId]/task-rankings/log error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
