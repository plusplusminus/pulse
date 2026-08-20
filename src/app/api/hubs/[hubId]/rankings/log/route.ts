import { NextResponse } from "next/server";
import { WorkOS } from "@workos-inc/node";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import { fetchRankingLog } from "@/lib/hub-rankings";
import { supabaseAdmin } from "@/lib/supabase";

const workos = new WorkOS(process.env.WORKOS_API_KEY!);

type Params = { params: Promise<{ hubId: string }> };

// GET: Fetch ranking activity log (admin-only)
export async function GET(request: Request, { params }: Params) {
  try {
    const { hubId } = await params;
    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    // Only admins can view the full log
    if (auth.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const projectLinearId = url.searchParams.get("project") ?? undefined;
    const userId = url.searchParams.get("user") ?? undefined;
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const rawOffset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
    const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

    const log = await fetchRankingLog(hubId, {
      projectLinearId,
      userId,
      limit,
      offset,
    });

    // Collect unique user IDs and resolve to emails
    const userIds = [...new Set(log.map((l) => l.userId))];
    const { data: members } = await supabaseAdmin
      .from("hub_members")
      .select("user_id, email")
      .eq("hub_id", hubId)
      .in("user_id", userIds.length > 0 ? userIds : ["__none__"]);

    const memberMap: Record<string, string> = {};
    for (const m of members ?? []) {
      if (m.user_id && m.email) memberMap[m.user_id] = m.email;
    }

    // Resolve any unmatched user IDs via WorkOS
    const unresolved = userIds.filter((id) => !memberMap[id]);
    if (unresolved.length > 0) {
      await Promise.all(
        unresolved.map(async (id) => {
          try {
            const user = await workos.userManagement.getUser(id);
            memberMap[id] =
              user.email ||
              [user.firstName, user.lastName].filter(Boolean).join(" ") ||
              id;
          } catch {
            // User not found in WorkOS — leave unmapped
          }
        })
      );
    }

    return NextResponse.json({ log, members: memberMap });
  } catch (error) {
    console.error("GET /api/hubs/[hubId]/rankings/log error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
