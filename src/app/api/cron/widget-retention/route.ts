import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  WIDGET_RETENTION_MONITOR_SLUG,
  WIDGET_RETENTION_SCHEDULE,
  liveRetentionDeps,
  runWidgetRetention,
} from "@/lib/widget-retention-run";

/**
 * Daily retention cron for widget media (PULSE-317/341). Registered in
 * `vercel.json` at WIDGET_RETENTION_SCHEDULE; the work itself lives in
 * `lib/widget-retention-run` because Next.js route files may only export
 * HTTP handlers.
 */

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: WIDGET_RETENTION_MONITOR_SLUG, status: "in_progress" },
    {
      schedule: { type: "crontab", value: WIDGET_RETENTION_SCHEDULE },
      checkinMargin: 60,
      maxRuntime: 15,
      failureIssueThreshold: 2,
      recoveryThreshold: 1,
    }
  );

  const startTime = Date.now();

  try {
    const result = await runWidgetRetention(liveRetentionDeps(new Date()));
    const durationMs = Date.now() - startTime;

    console.log(
      `widget-retention cron completed in ${durationMs}ms — scanned ${result.scanned} over ${result.pages} page(s), deleted ${result.objectsDeleted} object(s), purged ${result.rowsUpdated} row(s), ${result.objectsFailed} object failure(s), ${result.rowUpdatesFailed} row update failure(s)${result.truncated ? ", TRUNCATED (more candidates remain)" : ""}; assets: scanned ${result.assetsScanned} over ${result.assetPages} page(s), deleted ${result.assetObjectsDeleted} object(s), purged ${result.assetsPurged}, ${result.assetObjectsFailed} object failure(s), ${result.assetPurgesFailed} purge failure(s)${result.assetsTruncated ? ", TRUNCATED (more assets remain)" : ""}`
    );

    // Partial failures retry tomorrow, but a run that cannot finish its backlog
    // needs a human — surface both through the monitor.
    const degraded =
      result.truncated ||
      result.objectsFailed > 0 ||
      result.rowUpdatesFailed > 0 ||
      result.assetsTruncated ||
      result.assetObjectsFailed > 0 ||
      result.assetPurgesFailed > 0;

    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: WIDGET_RETENTION_MONITOR_SLUG,
      status: degraded ? "error" : "ok",
    });

    return NextResponse.json({ success: true, durationMs, ...result });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: WIDGET_RETENTION_MONITOR_SLUG,
      status: "error",
    });
    Sentry.captureException(error, { tags: { area: "widget" } });
    console.error(
      `GET /api/cron/widget-retention error after ${durationMs}ms:`,
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
