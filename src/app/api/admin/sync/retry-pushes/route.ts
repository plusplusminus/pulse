import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCommentToLinear } from "@/lib/linear-push";
import { isAdminLinearConnected } from "@/lib/admin-linear-oauth";

export async function POST() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;

    // Use admin's personal Linear token if connected
    const adminConnected = await isAdminLinearConnected(user.id);
    const adminUserId = adminConnected ? user.id : undefined;

    // Fetch all failed hub comments
    const { data: failedComments, error: fetchError } = await supabaseAdmin
      .from("hub_comments")
      .select("id, issue_linear_id, author_name, body, parent_comment_id")
      .eq("push_status", "failed")
      .order("created_at", { ascending: true })
      .limit(50); // Process in batches to avoid timeouts

    if (fetchError) {
      console.error("Failed to fetch failed comments:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch comments" },
        { status: 500 }
      );
    }

    if (!failedComments || failedComments.length === 0) {
      return NextResponse.json({ retried: 0, succeeded: 0, failed: 0 });
    }

    let succeeded = 0;
    let failed = 0;

    for (const comment of failedComments) {
      try {
        const linearCommentId = await pushCommentToLinear(
          comment.issue_linear_id,
          comment.body,
          comment.parent_comment_id ?? undefined,
          undefined,
          { authorName: comment.author_name },
          adminUserId
        );

        await supabaseAdmin
          .from("hub_comments")
          .update({
            linear_comment_id: linearCommentId,
            push_status: "pushed",
            push_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", comment.id);

        succeeded++;
      } catch (pushError) {
        const errorMsg =
          pushError instanceof Error ? pushError.message : "Unknown error";

        await supabaseAdmin
          .from("hub_comments")
          .update({
            push_error: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", comment.id);

        failed++;

        // If we hit a rate limit, stop retrying the rest
        if (errorMsg.includes("rate limit")) {
          break;
        }
      }
    }

    return NextResponse.json({
      retried: succeeded + failed,
      succeeded,
      failed,
    });
  } catch (error) {
    console.error("POST /api/admin/sync/retry-pushes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
