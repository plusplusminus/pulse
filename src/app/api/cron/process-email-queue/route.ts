import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { retryFailedEmails } from "@/lib/notification-delivery";
import { captureServerEvent, flushPostHog } from "@/lib/posthog-server";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || cronSecret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: "process-email-queue", status: "in_progress" },
    {
      schedule: { type: "crontab", value: "*/5 * * * *" },
      checkinMargin: 2,
      maxRuntime: 5,
      failureIssueThreshold: 3,
      recoveryThreshold: 1,
    }
  );

  try {
    const result = await retryFailedEmails(3);

    try {
      captureServerEvent("system", POSTHOG_EVENTS.email_queue_processed, {
        retried: result.retried,
        succeeded: result.succeeded,
      });
      await flushPostHog();
    } catch (err) {
      console.error("PostHog telemetry error:", err);
    }

    Sentry.captureCheckIn({ checkInId, monitorSlug: "process-email-queue", status: "ok" });
    return NextResponse.json({
      success: true,
      retried: result.retried,
      succeeded: result.succeeded,
    });
  } catch (error) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: "process-email-queue", status: "error" });
    Sentry.captureException(error, { tags: { area: "email" } });
    console.error("process-email-queue cron error:", error);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
