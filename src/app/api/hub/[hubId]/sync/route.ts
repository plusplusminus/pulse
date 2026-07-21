import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import { supabaseAdmin, type HubTeamMapping } from "@/lib/supabase";
import { runHubSync } from "@/lib/initial-sync";
import { startSyncRun, completeSyncRun } from "@/lib/sync-logger";

/**
 * On-demand sync for a hub, triggered by the topbar refresh button. Available
 * to any authorised hub user (not just admins) so "Synced Xm ago" can be
 * refreshed on demand rather than only by the 30-min cron.
 *
 * Pulls the hub's Linear data into Supabase via `runHubSync` and logs a
 * `hub_sync` run, which is what the /last-sync endpoint reads to update the
 * "Synced just now" label. Overlapping syncs are coalesced so a burst of
 * clicks (or several users on the same hub) can't stack full syncs.
 */
export async function POST(
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

    // Coalesce: if a sync for this hub is already running, don't start another.
    const { data: inFlight } = await supabaseAdmin
      .from("sync_runs")
      .select("id")
      .eq("run_type", "hub_sync")
      .eq("hub_id", hubId)
      .eq("status", "running")
      .limit(1)
      .maybeSingle();

    if (inFlight) {
      return NextResponse.json({ success: true, alreadyRunning: true });
    }

    const { data: hub } = await supabaseAdmin
      .from("client_hubs")
      .select("id, is_active")
      .eq("id", hubId)
      .single();

    if (!hub) {
      return NextResponse.json({ error: "Hub not found" }, { status: 404 });
    }
    if (!hub.is_active) {
      return NextResponse.json({ error: "Hub is not active" }, { status: 400 });
    }

    const { data: mappings } = await supabaseAdmin
      .from("hub_team_mappings")
      .select("*")
      .eq("hub_id", hubId)
      .eq("is_active", true);

    if (!mappings || mappings.length === 0) {
      return NextResponse.json(
        { error: "No teams configured for this hub" },
        { status: 400 }
      );
    }

    const startedAt = Date.now();
    const runId = await startSyncRun({
      runType: "hub_sync",
      trigger: "manual",
      hubId,
    });

    const result = await runHubSync(hubId, mappings as HubTeamMapping[]);

    const totalIssues =
      result.teamResults?.reduce((sum, r) => sum + (r.issueCount ?? 0), 0) ?? 0;
    const totalComments =
      result.teamResults?.reduce((sum, r) => sum + (r.commentCount ?? 0), 0) ?? 0;
    const totalProjects =
      result.teamResults?.reduce((sum, r) => sum + (r.projectCount ?? 0), 0) ?? 0;
    const totalCycles =
      result.teamResults?.reduce((sum, r) => sum + (r.cycleCount ?? 0), 0) ?? 0;

    await completeSyncRun({
      runId,
      status: result.success ? "completed" : "failed",
      entitiesProcessed: {
        issues: totalIssues,
        comments: totalComments,
        projects: totalProjects,
        cycles: totalCycles,
        teams: result.teamCount ?? 0,
        initiatives: result.initiativeCount ?? 0,
      },
      errorsCount: result.success ? 0 : 1,
      startedAt,
    });

    return NextResponse.json({ success: result.success, error: result.error });
  } catch (error) {
    console.error("POST /api/hub/[hubId]/sync error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
