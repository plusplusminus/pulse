import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Returns the timestamp of the most recent completed sync run, so the hub
 * topbar can show an honest "Synced Xm ago" instead of a client-side timer
 * seeded at page load. Available to any authorised hub user (incl. view-only).
 */
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

    const { data, error } = await supabaseAdmin
      .from("sync_runs")
      .select("completed_at")
      .eq("status", "completed")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("GET /api/hub/[hubId]/last-sync error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ lastSyncedAt: data?.completed_at ?? null });
  } catch (error) {
    console.error("GET /api/hub/[hubId]/last-sync error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
