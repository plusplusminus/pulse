import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";

type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export async function GET() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: totalEvents24h, error: totalError },
      { count: errorEvents24h, error: errorError },
      { data: lastEventRow, error: lastEventError },
      { data: lastRunRow, error: lastRunError },
      { count: failedPushCount },
    ] = await Promise.all([
      // Total events in last 24h (exclude skipped — unmapped team noise)
      supabaseAdmin
        .from("sync_events")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since24h)
        .neq("status", "skipped"),

      // Error events in last 24h
      supabaseAdmin
        .from("sync_events")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since24h)
        .eq("status", "error"),

      // Most recent successful event
      supabaseAdmin
        .from("sync_events")
        .select("created_at")
        .eq("status", "success")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Most recent sync run
      supabaseAdmin
        .from("sync_runs")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Failed hub comment pushes (outbound to Linear)
      supabaseAdmin
        .from("hub_comments")
        .select("id", { count: "exact", head: true })
        .eq("push_status", "failed"),
    ]);

    if (totalError) {
      console.error("GET /api/admin/sync/health total count error:", totalError);
      return NextResponse.json(
        { error: "Failed to fetch sync health data" },
        { status: 500 }
      );
    }
    if (errorError) {
      console.error("GET /api/admin/sync/health error count error:", errorError);
      return NextResponse.json(
        { error: "Failed to fetch sync health data" },
        { status: 500 }
      );
    }
    if (lastEventError) {
      console.error(
        "GET /api/admin/sync/health last event error:",
        lastEventError
      );
      return NextResponse.json(
        { error: "Failed to fetch sync health data" },
        { status: 500 }
      );
    }
    if (lastRunError) {
      console.error("GET /api/admin/sync/health last run error:", lastRunError);
      return NextResponse.json(
        { error: "Failed to fetch sync health data" },
        { status: 500 }
      );
    }

    const total = totalEvents24h ?? 0;
    const errors = errorEvents24h ?? 0;
    const lastEventAt = lastEventRow?.created_at ?? null;
    const lastSyncRunAt = lastRunRow?.created_at ?? null;
    const failedPushes = failedPushCount ?? 0;

    const errorRate = total > 0 ? errors / total : 0;

    let status: HealthStatus;

    if (total === 0) {
      status = "unknown";
    } else {
      const now = Date.now();
      const lastEventMs = lastEventAt ? new Date(lastEventAt).getTime() : 0;
      const hoursSinceLastEvent = (now - lastEventMs) / (1000 * 60 * 60);

      const isRecentEvent = hoursSinceLastEvent < 1;
      const isModeratelyRecent =
        hoursSinceLastEvent >= 1 && hoursSinceLastEvent < 6;

      if (errorRate < 0.05 && isRecentEvent && failedPushes === 0) {
        status = "healthy";
      } else if (errorRate > 0.2 || hoursSinceLastEvent >= 6) {
        status = "unhealthy";
      } else if (
        failedPushes > 0 ||
        (errorRate >= 0.05 && errorRate <= 0.2) ||
        isModeratelyRecent
      ) {
        status = "degraded";
      } else {
        status = "unhealthy";
      }
    }

    return NextResponse.json({
      status,
      totalEvents24h: total,
      errorRate,
      lastEventAt,
      lastSyncRunAt,
      failedPushes,
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "sync" } });
    console.error("GET /api/admin/sync/health error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
