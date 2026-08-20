import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { processDigests } from "@/lib/notification-digest";
import { captureServerEvent, flushPostHog } from "@/lib/posthog-server";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || cronSecret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: "send-digests", status: "in_progress" },
    {
      schedule: { type: "crontab", value: "0 * * * *" },
      checkinMargin: 5,
      maxRuntime: 10,
      failureIssueThreshold: 2,
      recoveryThreshold: 1,
    }
  );

  const startTime = Date.now();

  try {
    const [daily, weekly] = await Promise.all([
      processDigests("daily"),
      processDigests("weekly"),
    ]);

    const durationMs = Date.now() - startTime;

    console.log(
      `send-digests cron completed in ${durationMs}ms — daily: ${daily.sent} sent, ${daily.skipped} skipped, ${daily.errors} errors; weekly: ${weekly.sent} sent, ${weekly.skipped} skipped, ${weekly.errors} errors`
    );

    try {
      captureServerEvent("system", POSTHOG_EVENTS.digest_sent, {
        recipientCount: daily.sent + weekly.sent,
      });
      await flushPostHog();
    } catch (err) {
      console.error("PostHog telemetry error:", err);
    }

    Sentry.captureCheckIn({ checkInId, monitorSlug: "send-digests", status: "ok" });
    return NextResponse.json({
      success: true,
      durationMs,
      daily,
      weekly,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    Sentry.captureCheckIn({ checkInId, monitorSlug: "send-digests", status: "error" });
    Sentry.captureException(error, { tags: { area: "email" } });
    console.error(`send-digests cron failed after ${durationMs}ms:`, error);
    return NextResponse.json(
      { error: "Internal error", durationMs },
      { status: 500 }
    );
  }
}
