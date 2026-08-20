import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCommentToLinear, RateLimitDeferredError } from "@/lib/linear-push";
import { LinearRateLimiter } from "@/lib/linear-rate-limiter";

const MAX_RETRY_COUNT = 3;
const MAX_COMMENTS_PER_RUN = 20;

/**
 * Calculate the minimum time that must have elapsed since the last attempt
 * before a comment is eligible for retry: 2^count * 5 minutes.
 *   retry 0 → 5 min, retry 1 → 10 min, retry 2 → 20 min
 */
function backoffThreshold(retryCount: number): Date {
  const delayMs = Math.pow(2, retryCount) * 5 * 60 * 1000;
  return new Date(Date.now() - delayMs);
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: "retry-pushes", status: "in_progress" },
    {
      schedule: { type: "crontab", value: "*/15 * * * *" },
      checkinMargin: 2,
      maxRuntime: 5,
      failureIssueThreshold: 3,
      recoveryThreshold: 1,
    }
  );

  try {
    // 1. Fetch candidate failed comments, ordered oldest-first
    const { data: candidates, error: fetchError } = await supabaseAdmin
      .from("hub_comments")
      .select(
        "id, issue_linear_id, author_name, body, parent_comment_id, push_retry_count, updated_at"
      )
      .eq("push_status", "failed")
      .order("updated_at", { ascending: true })
      .limit(MAX_COMMENTS_PER_RUN * 2); // over-fetch to account for backoff filtering

    if (fetchError) {
      throw new Error(`Failed to fetch failed comments: ${fetchError.message}`);
    }

    if (!candidates || candidates.length === 0) {
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: "retry-pushes",
        status: "ok",
      });
      return NextResponse.json({
        success: true,
        eligible: 0,
        retried: 0,
        succeeded: 0,
        failed: 0,
        abandoned: 0,
      });
    }

    // Filter to comments whose backoff period has elapsed
    const eligibleIds = candidates
      .filter((c) => {
        const threshold = backoffThreshold(c.push_retry_count ?? 0);
        return new Date(c.updated_at) <= threshold;
      })
      .slice(0, MAX_COMMENTS_PER_RUN)
      .map((c) => c.id);

    if (eligibleIds.length === 0) {
      Sentry.captureCheckIn({ checkInId, monitorSlug: "retry-pushes", status: "ok" });
      return NextResponse.json({ success: true, eligible: 0, retried: 0, succeeded: 0, failed: 0, abandoned: 0 });
    }

    // 2. Atomically claim eligible rows: flip status from "failed" to "retrying"
    //    to prevent concurrent cron runs from processing the same comments
    const { data: claimedRows, error: claimError } = await supabaseAdmin
      .from("hub_comments")
      .update({ push_status: "retrying", updated_at: new Date().toISOString() })
      .eq("push_status", "failed")
      .in("id", eligibleIds)
      .select("id, issue_linear_id, author_name, body, parent_comment_id, push_retry_count");

    if (claimError) {
      throw new Error(`Failed to claim comments for retry: ${claimError.message}`);
    }

    if (!claimedRows || claimedRows.length === 0) {
      // Another process already claimed them
      Sentry.captureCheckIn({ checkInId, monitorSlug: "retry-pushes", status: "ok" });
      return NextResponse.json({ success: true, eligible: 0, retried: 0, succeeded: 0, failed: 0, abandoned: 0 });
    }

    // 3. Process claimed comments — track processed IDs for cleanup
    let succeeded = 0;
    let failed = 0;
    let abandoned = 0;
    const rateLimiter = new LinearRateLimiter();
    const processedIds = new Set<string>();

    try {
      for (const comment of claimedRows) {
        const retryCount = (comment.push_retry_count ?? 0) + 1;
        const linearBody = `**${comment.author_name}:** ${comment.body}`;

        try {
          const linearCommentId = await pushCommentToLinear(
            comment.issue_linear_id,
            linearBody,
            comment.parent_comment_id ?? undefined,
            rateLimiter
          );

          const { error: updateError } = await supabaseAdmin
            .from("hub_comments")
            .update({
              linear_comment_id: linearCommentId,
              push_status: "pushed",
              push_error: null,
              push_retry_count: retryCount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", comment.id);

          if (updateError) {
            console.error(`[retry-pushes] Failed to mark comment ${comment.id} as pushed:`, updateError);
          }

          processedIds.add(comment.id);
          succeeded++;
        } catch (pushError) {
          // Rate limit deferred — stop processing, finally block releases remaining
          if (pushError instanceof RateLimitDeferredError) {
            console.warn("[retry-pushes] Rate limit approaching — deferring remaining comments");
            break;
          }

          const errorMsg =
            pushError instanceof Error ? pushError.message : "Unknown error";

          if (retryCount >= MAX_RETRY_COUNT) {
            const { error: updateError } = await supabaseAdmin
              .from("hub_comments")
              .update({
                push_status: "abandoned",
                push_error: errorMsg,
                push_retry_count: retryCount,
                updated_at: new Date().toISOString(),
              })
              .eq("id", comment.id);

            if (updateError) {
              console.error(`[retry-pushes] Failed to mark comment ${comment.id} as abandoned:`, updateError);
            }

            Sentry.captureException(
              new Error(`Comment push abandoned after ${retryCount} retries: ${errorMsg}`),
              {
                tags: { area: "sync", "sync.entity": "hub_comment" },
                extra: {
                  commentId: comment.id,
                  issueLinearId: comment.issue_linear_id,
                  retryCount,
                },
              }
            );

            processedIds.add(comment.id);
            abandoned++;
          } else {
            const { error: updateError } = await supabaseAdmin
              .from("hub_comments")
              .update({
                push_status: "failed",
                push_error: errorMsg,
                push_retry_count: retryCount,
                updated_at: new Date().toISOString(),
              })
              .eq("id", comment.id);

            if (updateError) {
              console.error(`[retry-pushes] Failed to update retry count for comment ${comment.id}:`, updateError);
            }

            processedIds.add(comment.id);
            failed++;
          }
        }
      }
    } finally {
      // Release any claimed rows that were not processed (crash, rate limit, etc.)
      const strandedIds = claimedRows
        .map((c) => c.id)
        .filter((id) => !processedIds.has(id));
      if (strandedIds.length > 0) {
        console.warn(`[retry-pushes] Releasing ${strandedIds.length} stranded "retrying" rows back to "failed"`);
        await supabaseAdmin
          .from("hub_comments")
          .update({ push_status: "failed" })
          .eq("push_status", "retrying")
          .in("id", strandedIds);
      }
    }

    const checkInStatus = abandoned > 0 ? "error" : "ok";
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "retry-pushes",
      status: checkInStatus,
    });

    return NextResponse.json({
      success: true,
      eligible: claimedRows.length,
      retried: succeeded + failed + abandoned,
      succeeded,
      failed,
      abandoned,
    });
  } catch (error) {
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "retry-pushes",
      status: "error",
    });
    Sentry.captureException(error, { tags: { area: "sync" } });
    console.error("GET /api/cron/retry-pushes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
