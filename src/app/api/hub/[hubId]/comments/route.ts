import { NextResponse } from "next/server";
import { withHubAuthWrite, type HubAuthError } from "@/lib/hub-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCommentToLinear } from "@/lib/linear-push";
import { isPPMAdmin } from "@/lib/ppm-admin";
import { isAdminLinearConnected } from "@/lib/admin-linear-oauth";
import { logSyncEvent } from "@/lib/sync-logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const { hubId } = await params;

    const auth = await withHubAuthWrite(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const { user } = auth;
    const { issueLinearId, body, parentId } = (await request.json()) as {
      issueLinearId?: string;
      body?: string;
      parentId?: string;
    };

    if (!issueLinearId || !body?.trim()) {
      return NextResponse.json(
        { error: "issueLinearId and body are required" },
        { status: 400 }
      );
    }

    const authorName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(" ") || user.email;

    // Check if user is a PPM admin (their personal Linear token will be used if available)
    const isAdmin = await isPPMAdmin(user.id, user.email);

    // PPM admins must connect their Linear account before creating comments
    if (isAdmin) {
      const connected = await isAdminLinearConnected(user.id);
      if (!connected) {
        return NextResponse.json(
          {
            error: "linear_not_connected",
            message:
              "Connect your Linear account in admin settings before creating issues/comments",
          },
          { status: 403 }
        );
      }
    }

    // Insert comment locally
    const { data: comment, error: insertError } = await supabaseAdmin
      .from("hub_comments")
      .insert({
        hub_id: hubId,
        issue_linear_id: issueLinearId,
        user_id: user.id,
        author_name: authorName,
        author_email: user.email,
        body: body.trim(),
        parent_comment_id: parentId ?? null,
        push_status: "pending",
      })
      .select("id, author_name, author_email, body, parent_comment_id, push_status, created_at, updated_at")
      .single();

    if (insertError || !comment) {
      console.error("Insert hub_comment error:", insertError);
      return NextResponse.json(
        { error: "Failed to save comment" },
        { status: 500 }
      );
    }

    // Push to Linear with author attribution (createAsUser if OAuth app configured)
    try {
      const linearCommentId = await pushCommentToLinear(
        issueLinearId,
        body.trim(),
        parentId,
        undefined,
        {
          authorName,
          authorAvatarUrl: user.profilePictureUrl ?? undefined,
        },
        isAdmin ? user.id : undefined
      );

      await supabaseAdmin
        .from("hub_comments")
        .update({
          linear_comment_id: linearCommentId,
          push_status: "pushed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", comment.id);

      void logSyncEvent({
        eventType: "CommentPush",
        action: "create",
        entityId: comment.id,
        status: "success",
        payloadSummary: { issueLinearId, authorName, linearCommentId },
      });

      return NextResponse.json({
        ...comment,
        linear_comment_id: linearCommentId,
        push_status: "pushed",
        isHubComment: true,
        user: { id: user.id, name: authorName },
      });
    } catch (pushError) {
      const errorMsg =
        pushError instanceof Error ? pushError.message : "Unknown push error";
      console.error("Push to Linear failed:", errorMsg);

      await supabaseAdmin
        .from("hub_comments")
        .update({
          push_status: "failed",
          push_error: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", comment.id);

      void logSyncEvent({
        eventType: "CommentPush",
        action: "create",
        entityId: comment.id,
        status: "error",
        errorMessage: errorMsg,
        payloadSummary: { issueLinearId, authorName },
      });

      // Still return the comment — it's saved locally, just not pushed
      return NextResponse.json({
        ...comment,
        push_status: "failed",
        push_error: errorMsg,
        isHubComment: true,
        user: { id: user.id, name: authorName },
      });
    }
  } catch (error) {
    console.error("POST /api/hub/[hubId]/comments error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH: Retry pushing a failed comment to Linear
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const { hubId } = await params;

    const auth = await withHubAuthWrite(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const { user } = auth;
    const { commentId } = (await request.json()) as { commentId?: string };
    if (!commentId) {
      return NextResponse.json(
        { error: "commentId is required" },
        { status: 400 }
      );
    }

    // Check if user is a PPM admin (use their personal Linear token if available)
    const isAdmin = await isPPMAdmin(user.id, user.email);
    const adminUserId = isAdmin ? user.id : undefined;

    // Fetch the failed comment
    const { data: comment, error: fetchError } = await supabaseAdmin
      .from("hub_comments")
      .select("*")
      .eq("id", commentId)
      .eq("hub_id", hubId)
      .eq("push_status", "failed")
      .single();

    if (fetchError || !comment) {
      return NextResponse.json(
        { error: "Comment not found or not in failed state" },
        { status: 404 }
      );
    }

    try {
      // Avatar URL is not persisted in hub_comments (it's transient from the
      // WorkOS user profile at request time), so retries won't have an avatar.
      // The author name is still attributed via createAsUser.
      const linearCommentId = await pushCommentToLinear(
        comment.issue_linear_id,
        comment.body,
        comment.parent_comment_id ?? undefined,
        undefined,
        {
          authorName: comment.author_name,
        },
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
        .eq("id", commentId);

      void logSyncEvent({
        eventType: "CommentPush",
        action: "retry",
        entityId: commentId,
        status: "success",
        payloadSummary: { issueLinearId: comment.issue_linear_id, linearCommentId },
      });

      return NextResponse.json({
        id: commentId,
        linear_comment_id: linearCommentId,
        push_status: "pushed",
      });
    } catch (pushError) {
      const errorMsg =
        pushError instanceof Error ? pushError.message : "Unknown push error";

      await supabaseAdmin
        .from("hub_comments")
        .update({
          push_error: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", commentId);

      void logSyncEvent({
        eventType: "CommentPush",
        action: "retry",
        entityId: commentId,
        status: "error",
        errorMessage: errorMsg,
        payloadSummary: { issueLinearId: comment.issue_linear_id },
      });

      return NextResponse.json(
        { error: errorMsg, push_status: "failed" },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("PATCH /api/hub/[hubId]/comments error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
